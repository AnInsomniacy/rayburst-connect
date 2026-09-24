import { MediaApiError } from '@/lib/api';
import { browser, type Browser } from 'wxt/browser';
import { DownloadOrchestrator, type DownloadCandidate } from '@/lib/download/orchestrator';
import { startChromiumTakeover, type ChromiumCancellation } from '@/lib/download/chromium-takeover';
import { DuplicateDownloadGuard } from '@/lib/download/duplicate-guard';
import {
  RequestHeaderContextStore,
  type RequestHeaderMatchResult,
} from '@/lib/download/request-context';
import { parseFirefoxDownloadResponse } from '@/lib/download/firefox-response';
import { ApiAuthError, ApiCompatibilityError, ApiEngineError, DesktopApiClient } from '@/lib/api';
import { startMediaBackground } from '@/lib/media/background';
import { fileRequestContext } from '@/lib/media/request-context';
import {
  DesktopActivationError,
  activateDesktop,
  createDesktopActivationCoordinator,
  type DesktopActionResponse,
} from '@/lib/desktop';
import {
  CONTEXT_MENU_CONTEXTS,
  CONTEXT_MENU_ID,
  buildDuplicateDownloadNotification,
  extractContextMenuUrl,
  hasCookieForwardingAccess,
  hasDownloadUiAccess,
  isExternalProtocol,
  type ExternalProtocol,
} from '@/lib/browser';
import { loadDiagnosticEvents, loadSnapshot, saveDiagnosticEvents } from '@/lib/storage';
import {
  DEFAULT_DIAGNOSTIC_SETTINGS,
  DEFAULT_DOWNLOAD_SETTINGS,
  parseConnectionConfig,
  parseDownloadSettings,
  parseDiagnosticSettings,
  parseSiteRules,
  parseUiPrefs,
  type DiagnosticCode,
  type DownloadSettings,
  type SiteRule,
} from '@/lib/schema';
import { createDiagnosticJournal, type DiagnosticInput } from '@/lib/diagnostics';
import { I18nEngine } from '@/shared/i18n/engine';
import { resolveLocaleId } from '@/shared/i18n/dictionaries';
import { FALLBACK_LOCALE } from '@/shared/i18n/locales';

export default defineBackground(() => {
  // ─── State (restored from storage on each SW wake) ────
  let settings: DownloadSettings = structuredClone(DEFAULT_DOWNLOAD_SETTINGS);
  let siteRules: SiteRule[] = [];
  let configLoaded = false;

  const bgI18n = new I18nEngine(FALLBACK_LOCALE);
  const diagnosticLog = createDiagnosticJournal({
    load: loadDiagnosticEvents,
    save: saveDiagnosticEvents,
    maxEvents: DEFAULT_DIAGNOSTIC_SETTINGS.maxEvents,
    onPersistError: (error) => {
      console.warn('[Rayburst] Diagnostic persistence failed:', error);
    },
  });
  const requestHeaderContexts = new RequestHeaderContextStore();
  const duplicateDownloadGuard = new DuplicateDownloadGuard();
  let connectionConfig = parseConnectionConfig(null);
  const desktopClient = new DesktopApiClient(connectionConfig);
  const activateDesktopAndWait = createDesktopActivationCoordinator();

  // ─── Logging ──────────────────────────────────────────

  function log(
    level: DiagnosticInput['level'],
    code: DiagnosticCode,
    message: string,
    context?: DiagnosticInput['context'],
  ): void {
    diagnosticLog.append({ level, code, message, context });
  }

  const logInfo = log.bind(null, 'info');
  const logWarn = log.bind(null, 'warn');
  const logError = log.bind(null, 'error');

  function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  // ─── Config Loading ───────────────────────────────────
  // One read per Service Worker lifecycle; storage.onChanged keeps the
  // in-memory config in sync afterwards.

  let configLoadPromise: Promise<void> | null = null;

  function ensureConfigLoaded(): Promise<void> {
    configLoadPromise ??= (async () => {
      try {
        const data = await loadSnapshot();
        settings = data.settings;
        diagnosticLog.setMaxEvents(data.diagnostics.maxEvents);
        siteRules = data.siteRules;
        connectionConfig = data.connection;
        desktopClient.updateConfig(connectionConfig);
        bgI18n.setLocale(effectiveLocale(data.uiPrefs.locale));
      } catch (e) {
        logError('config_load_failed', 'Configuration could not be loaded; defaults are active', {
          error: errorMessage(e),
        });
      } finally {
        configLoaded = true;
      }
    })();
    return configLoadPromise;
  }

  function effectiveLocale(locale: string): string {
    return locale === 'auto' ? resolveLocaleId(browser.i18n.getUILanguage()) : locale;
  }

  // ─── Download Bar ─────────────────────────────────────

  async function applyDownloadBarPreference(): Promise<void> {
    // Firefox does not support browser.downloads.setUiOptions.
    if (import.meta.env.FIREFOX) return;
    if (!settings.hideDownloadBar) {
      const canRestore = await hasDownloadUiAccess().catch(() => false);
      if (!canRestore) return;
    }
    await browser.downloads.setUiOptions({ enabled: !settings.hideDownloadBar });
  }

  function applyDownloadBarPreferenceSafely(): void {
    applyDownloadBarPreference().catch((e) => {
      logWarn('download_bar_failed', 'Download bar preference could not be applied', {
        error: errorMessage(e),
      });
    });
  }

  // ─── Orchestrator ─────────────────────────────────────

  const activateDesktopApp = () =>
    activateDesktop((hostName, message) => browser.runtime.sendNativeMessage(hostName, message));

  const orchestrator = new DownloadOrchestrator({
    downloads: {
      cancel: (id) => browser.downloads.cancel(id),
      erase: (query) => browser.downloads.erase(query).then(() => {}),
      download: (options) => browser.downloads.download(options),
    },
    cookies: {
      getAll: async (details) => {
        const granted = await hasCookieForwardingAccess().catch((e) => {
          logWarn('permission_check_failed', 'Cookie permission check failed', {
            permission: 'cookies',
            error: errorMessage(e),
          });
          return false;
        });
        return granted ? browser.cookies.getAll(details) : [];
      },
    },
    diagnosticLog: {
      append: diagnosticLog.append,
    },
    getSettings: () => settings,
    getSiteRules: () => siteRules,
    duplicateGuard: duplicateDownloadGuard,
    desktopClient,
    activateDesktop: (timeoutMs) =>
      activateDesktopAndWait({
        activate: activateDesktopApp,
        checkReady: () => desktopClient.checkReady(),
        isFatalReadinessError: (error) =>
          error instanceof ApiAuthError ||
          error instanceof ApiCompatibilityError ||
          error instanceof ApiEngineError,
        maxWaitMs: timeoutMs,
      }),
    onDuplicateBlocked: () => {
      const payload = buildDuplicateDownloadNotification(
        bgI18n.t('notification_duplicate_guard_title', 'Task submitted'),
        bgI18n.t('notification_duplicate_guard_body', 'Duplicate request skipped'),
      );
      try {
        void Promise.resolve(browser.notifications.create(payload.id, payload.options)).catch(
          (error) => {
            logWarn('notification_failed', 'Duplicate notification could not be shown', {
              error: errorMessage(error),
            });
          },
        );
      } catch (error) {
        logWarn('notification_failed', 'Duplicate notification could not be shown', {
          error: errorMessage(error),
        });
      }
    },
  });

  // ─── webRequest Listeners ─────────────────────────────

  const ALL_HTTP_URLS = ['http://*/*', 'https://*/*'];
  const HEADER_MATCH_DISABLED: RequestHeaderMatchResult = {
    matched: false,
    reason: 'not-found',
    context: undefined,
    source: undefined,
  };

  function matchRequestHeaders(
    item: { url: string; finalUrl?: string },
    consume: boolean,
  ): RequestHeaderMatchResult {
    if (!settings.forwardRequestHeaders) return HEADER_MATCH_DISABLED;
    return consume ? requestHeaderContexts.match(item) : requestHeaderContexts.peek(item);
  }

  async function handleFirefoxResponseTakeover(candidate: DownloadCandidate): Promise<void> {
    await ensureConfigLoaded();
    const match = matchRequestHeaders(candidate, true);
    await orchestrator.handleFirefoxResponseTakeover({
      ...candidate,
      requestHeaderContext: match.context,
      requestHeaderMatchReason: settings.forwardRequestHeaders
        ? match.reason
        : ('disabled' as const),
    });
  }

  /** Firefox: synchronously cancel binary responses before the native picker. */
  function registerFirefoxResponseInterception(): void {
    if (!import.meta.env.FIREFOX) return;
    try {
      browser.webRequest.onHeadersReceived.addListener(
        (details) => {
          const parsed = parseFirefoxDownloadResponse(details);
          if (!parsed) return;
          if (configLoaded && !orchestrator.shouldClaimFirefoxResponse(parsed)) return;

          void handleFirefoxResponseTakeover(parsed).catch((error) => {
            logError('download_handler_failed', 'Firefox response takeover failed', {
              url: parsed.url,
              mime: parsed.mime,
              error: errorMessage(error),
            });
          });
          return { cancel: true };
        },
        { urls: ALL_HTTP_URLS, types: ['main_frame', 'sub_frame'] },
        ['blocking', 'responseHeaders'],
      );
    } catch (e) {
      logWarn('firefox_interception_failed', 'Firefox response interception is unavailable', {
        error: errorMessage(e),
      });
    }
  }

  registerFirefoxResponseInterception();
  startMediaBackground({
    duplicateGuard: duplicateDownloadGuard,
    client: desktopClient,
    ensureConfig: ensureConfigLoaded,
    settings: () => settings,
    siteRules: () => siteRules,
    connection: () => connectionConfig,
    requestHeaders: requestHeaderContexts,
    sendFile: async (candidate) => {
      const context = fileRequestContext(candidate, settings);
      const result = await orchestrator.sendUrl(candidate.url, context.referer ?? '', {
        source: 'media',
        headerContext: context,
        filename: candidate.filename,
      });
      if (result === 'duplicate-blocked') throw new MediaApiError('duplicate_blocked');
      return true;
    },
    onError: () =>
      logWarn('media_discovery_failed', 'Media discovery could not update its session'),
    onDownloadError: (candidateId, error) =>
      logWarn('download_delivery_failed', 'Media download could not be submitted', {
        candidateId,
        error,
      }),
    activate: () =>
      activateDesktopAndWait({
        activate: activateDesktopApp,
        checkReady: () => desktopClient.checkReady(),
        isFatalReadinessError: (error) =>
          error instanceof ApiAuthError ||
          error instanceof ApiCompatibilityError ||
          error instanceof ApiEngineError,
        maxWaitMs: settings.desktopUnavailable.startupTimeoutSeconds * 1000,
      }),
  });

  // ─── Download Interception ────────────────────────────

  function createBrowserDownloadItem(
    item: Browser.downloads.DownloadItem,
    consumeHeaders: boolean,
    filenameSource?: 'browser-determined',
  ) {
    const identity = { url: item.url, finalUrl: item.finalUrl || item.url };
    const match = matchRequestHeaders(identity, consumeHeaders);
    return {
      id: item.id,
      url: item.url,
      finalUrl: identity.finalUrl,
      filename: item.filename || '',
      ...(filenameSource ? { filenameSource } : {}),
      fileSize: item.fileSize ?? -1,
      totalBytes: item.totalBytes ?? item.fileSize ?? -1,
      mime: item.mime || '',
      byExtensionId: item.byExtensionId,
      state: item.state || 'in_progress',
      referrer: item.referrer || '',
      requestHeaderContext: match.context,
      requestHeaderMatchReason: settings.forwardRequestHeaders
        ? match.reason
        : ('disabled' as const),
    };
  }

  async function handleFirefoxCreatedDownload(item: Browser.downloads.DownloadItem): Promise<void> {
    await ensureConfigLoaded();
    await orchestrator.handleFirefoxCreatedDownload(createBrowserDownloadItem(item, true));
  }

  async function handleChromiumTakeover(
    item: Browser.downloads.DownloadItem,
    cancellation: Promise<ChromiumCancellation>,
  ): Promise<void> {
    await ensureConfigLoaded();
    await orchestrator.handleChromiumTakeover(
      createBrowserDownloadItem(item, true, 'browser-determined'),
      cancellation,
    );
  }

  function isPotentialChromiumDownload(item: Browser.downloads.DownloadItem): boolean {
    if (item.state !== 'in_progress' || item.byExtensionId) return false;
    try {
      return ['http:', 'https:'].includes(new URL(item.url).protocol);
    } catch {
      return false;
    }
  }

  function logDownloadHandlerError(item: Browser.downloads.DownloadItem, error: unknown): void {
    logError('download_handler_failed', 'Download handler failed', {
      url: item.url,
      mime: item.mime || '',
      error: errorMessage(error),
    });
  }

  if (import.meta.env.FIREFOX) {
    browser.downloads.onCreated.addListener((item) => {
      void handleFirefoxCreatedDownload(item).catch((error) => {
        logDownloadHandlerError(item, error);
      });
    });
  } else {
    browser.downloads.onDeterminingFilename.addListener((item, suggest) => {
      if (!isPotentialChromiumDownload(item)) return;
      if (
        configLoaded &&
        !orchestrator.shouldClaimChromiumDownload(
          createBrowserDownloadItem(item, false, 'browser-determined'),
        )
      ) {
        return;
      }

      return startChromiumTakeover(
        () => browser.downloads.cancel(item.id),
        (cancellation) => handleChromiumTakeover(item, cancellation),
        (error) => logDownloadHandlerError(item, error),
        suggest,
      );
    });
  }

  // ─── Context Menu ─────────────────────────────────────

  function contextMenuTitle(): string {
    return bgI18n.t('context_menu_download', 'Download with Rayburst');
  }

  function registerContextMenu(): void {
    browser.contextMenus.create(
      {
        id: CONTEXT_MENU_ID,
        title: contextMenuTitle(),
        contexts: CONTEXT_MENU_CONTEXTS as unknown as [Browser.contextMenus.ContextType],
      },
      () => {
        const error = browser.runtime.lastError;
        const message = error?.message ?? '';
        if (message && !message.includes('duplicate')) {
          logWarn('context_menu_failed', 'Context menu could not be registered', {
            error: message,
          });
        }
      },
    );
  }

  browser.contextMenus.onClicked.addListener((info) => {
    const rawUrl = extractContextMenuUrl(info);
    if (!rawUrl) return;

    void ensureConfigLoaded().then(async () => {
      try {
        await orchestrator.sendUrl(rawUrl, info.pageUrl ?? '', { source: 'context-menu' });
      } catch {
        // The orchestrator records the terminal delivery failure.
      }
    });
  });

  // ─── External Protocol Links (from content script) ────

  interface ExternalProtocolMessage {
    type: 'HANDLE_EXTERNAL_PROTOCOL';
    url: string;
    protocol: ExternalProtocol;
  }

  function parseExternalProtocolMessage(msg: unknown): ExternalProtocolMessage | null {
    if (msg == null || typeof msg !== 'object') return null;
    const raw = msg as Record<string, unknown>;
    if (raw.type !== 'HANDLE_EXTERNAL_PROTOCOL') return null;
    if (typeof raw.url !== 'string') return null;
    if (typeof raw.protocol !== 'string' || !isExternalProtocol(raw.protocol)) return null;
    return { type: 'HANDLE_EXTERNAL_PROTOCOL', url: raw.url, protocol: raw.protocol };
  }

  async function handleExternalProtocol(
    msg: ExternalProtocolMessage,
  ): Promise<{ disposition: 'handled' | 'browser' }> {
    await ensureConfigLoaded();
    if (!settings.enabled || !settings.interceptionScope[msg.protocol]) {
      return { disposition: 'browser' };
    }

    const browserMode = settings.desktopUnavailable.action === 'browser';
    if (browserMode && !(await desktopClient.isReady())) {
      logWarn('download_restored_to_browser', 'Browser retained the protocol link', {
        url: msg.url,
        protocol: msg.protocol,
        reason: 'desktop-unavailable',
        mode: 'continued',
      });
      return { disposition: 'browser' };
    }

    try {
      await orchestrator.sendUrl(msg.url, '', {
        source: 'external-protocol',
        allowActivation: !browserMode,
      });
      return { disposition: 'handled' };
    } catch {
      // The orchestrator records the terminal delivery failure.
      return { disposition: browserMode ? 'browser' : 'handled' };
    }
  }

  async function handleDesktopOpen(): Promise<DesktopActionResponse> {
    try {
      await activateDesktopApp();
      return { ok: true };
    } catch (error) {
      const code = error instanceof DesktopActivationError ? error.code : 'unknown';
      const cause = error instanceof DesktopActivationError ? error.cause : undefined;
      const nativeError =
        cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
      logError('desktop_activation_failed', 'Rayburst could not be activated', {
        source: 'popup',
        reason: code,
        ...(nativeError ? { nativeError } : {}),
      });
      return { ok: false, error: code };
    }
  }

  async function handleDesktopStart(): Promise<DesktopActionResponse> {
    await ensureConfigLoaded();
    try {
      const ready = await activateDesktopAndWait({
        activate: activateDesktopApp,
        checkReady: () => desktopClient.checkReady(),
        isFatalReadinessError: (error) =>
          error instanceof ApiAuthError ||
          error instanceof ApiCompatibilityError ||
          error instanceof ApiEngineError,
        maxWaitMs: 15_000,
      });
      if (ready) return { ok: true };

      logError('desktop_activation_failed', 'Rayburst did not become ready', {
        source: 'popup',
        reason: 'readiness-timeout',
      });
      return { ok: false, error: 'readiness_timeout' };
    } catch (error) {
      if (error instanceof ApiCompatibilityError) {
        logWarn('desktop_incompatible', 'The connected desktop is not supported', {
          source: 'popup',
          version: error.version ?? '',
          reason: error.name,
        });
        return { ok: false, error: error.name };
      }
      if (error instanceof ApiEngineError) return { ok: false, error: error.name };
      const authFailure = error instanceof ApiAuthError;
      const code =
        error instanceof DesktopActivationError
          ? error.code
          : authFailure
            ? 'api_auth_failed'
            : 'unknown';
      const cause = error instanceof DesktopActivationError ? error.cause : undefined;
      const nativeError =
        cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
      logError(
        authFailure ? 'api_auth_failed' : 'desktop_activation_failed',
        authFailure ? 'Rayburst rejected the API credentials' : 'Rayburst could not be started',
        { source: 'popup', reason: code, ...(nativeError ? { nativeError } : {}) },
      );
      return { ok: false, error: code };
    }
  }

  async function handleDesktopCommand(
    action: 'pause-all' | 'resume-all',
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    await ensureConfigLoaded();
    try {
      if (action === 'pause-all') await desktopClient.pauseAll();
      else await desktopClient.resumeAll();
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiEngineError) return { ok: false, error: error.name };
      const authFailure = error instanceof ApiAuthError;
      logError(
        authFailure ? 'api_auth_failed' : 'api_unreachable',
        authFailure
          ? 'Rayburst rejected the API credentials'
          : 'Rayburst could not complete the requested action',
        { source: 'popup', action, error: errorMessage(error) },
      );
      return { ok: false, error: errorMessage(error) };
    }
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg === null || typeof msg !== 'object') return undefined;
    if ('type' in msg && msg.type === 'OPEN_DESKTOP') return handleDesktopOpen();
    if ('type' in msg && msg.type === 'START_DESKTOP') return handleDesktopStart();
    if ('type' in msg && msg.type === 'CLEAR_DIAGNOSTICS') {
      return ensureConfigLoaded()
        .then(() => diagnosticLog.clear())
        .then(() => ({ ok: true as const }));
    }
    if ('type' in msg && msg.type === 'GET_DIAGNOSTICS') {
      return ensureConfigLoaded()
        .then(() => diagnosticLog.initialize())
        .then(() => ({
          ok: true as const,
          events: diagnosticLog.getAll(),
        }));
    }
    if ('type' in msg && msg.type === 'PAUSE_ALL') return handleDesktopCommand('pause-all');
    if ('type' in msg && msg.type === 'RESUME_ALL') return handleDesktopCommand('resume-all');
    const protocolMessage = parseExternalProtocolMessage(msg);
    return protocolMessage ? handleExternalProtocol(protocolMessage) : undefined;
  });

  // ─── Storage Sync ─────────────────────────────────────

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.connection?.newValue) {
      connectionConfig = parseConnectionConfig(changes.connection.newValue);
      desktopClient.updateConfig(connectionConfig);
    }
    if (changes.settings?.newValue) {
      settings = parseDownloadSettings(changes.settings.newValue);
      applyDownloadBarPreferenceSafely();
    }
    if (changes.siteRules?.newValue) {
      siteRules = parseSiteRules(changes.siteRules.newValue);
    }
    if (changes.uiPrefs?.newValue) {
      bgI18n.setLocale(effectiveLocale(parseUiPrefs(changes.uiPrefs.newValue).locale));
      void browser.contextMenus
        .update(CONTEXT_MENU_ID, { title: contextMenuTitle() })
        .catch((error) => {
          logWarn('context_menu_failed', 'Context menu title could not be updated', {
            error: errorMessage(error),
          });
        });
    }
    if (changes.diagnostics?.newValue) {
      diagnosticLog.setMaxEvents(parseDiagnosticSettings(changes.diagnostics.newValue).maxEvents);
    }
  });

  // ─── Lifecycle ────────────────────────────────────────

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      logInfo('extension_installed', 'Extension installed');
    } else if (details.reason === 'update') {
      logInfo('extension_updated', 'Extension was updated', {
        previousVersion: details.previousVersion ?? 'unknown',
        currentVersion: browser.runtime.getManifest().version,
      });
    }
  });

  browser.permissions.onAdded?.addListener((permissions) => {
    logInfo('permission_granted', 'Browser permissions were granted', {
      permissions: permissions.permissions?.join(', ') ?? '',
      origins: permissions.origins?.join(', ') ?? '',
    });
  });

  browser.permissions.onRemoved?.addListener((permissions) => {
    logWarn('permission_revoked', 'Browser permissions were revoked', {
      permissions: permissions.permissions?.join(', ') ?? '',
      origins: permissions.origins?.join(', ') ?? '',
    });
  });

  void ensureConfigLoaded().then(async () => {
    await diagnosticLog.initialize();
    // Register browser actions before waiting for desktop receipt recovery.
    registerContextMenu();
    applyDownloadBarPreferenceSafely();
    try {
      const pending = await desktopClient.reconcileDownloads();
      if (pending)
        logWarn('download_delivery_failed', 'Download receipts are still pending', {
          count: pending,
        });
    } catch (error) {
      logError('download_delivery_failed', 'Download receipt recovery failed', {
        error: errorMessage(error),
      });
    }
  });
});
