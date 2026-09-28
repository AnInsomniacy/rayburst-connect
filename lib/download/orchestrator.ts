/**
 * Central download interception orchestrator.
 *
 * Automatic flow (Chromium takeover / Firefox response / Firefox fallback):
 *   filter → duplicate guard → unavailable policy → submit over HTTP.
 *   Browser-native holding points preserve the original request until the
 *   desktop accepts it or a durable journal owns an ambiguous submission.
 *
 * Explicit flow (context menu, protocol links):
 *   submit over HTTP → activate Rayburst → retry over HTTP.
 */
import { forgetDownload } from './pending';
import type { DownloadSettings, SiteRule } from '@/lib/schema';
import type { DiagnosticInput } from '@/lib/diagnostics';
import {
  ApiAuthError,
  ApiCompatibilityError,
  ApiDeliveryUncertainError,
  type DesktopApiClient,
} from '@/lib/api';
import { createFilterPipeline, evaluateFilterPipeline, type FilterContext } from './filter';
import { extractFilenameFromUrl, isCookieCollectableUrl } from './url';
import type { RequestHeaderContext, RequestHeaderMatchReason } from './request-context';
import type {
  DuplicateDownloadGuard,
  DuplicateDownloadInput,
  DuplicateDownloadReservation,
} from './duplicate-guard';

// ─── Types ──────────────────────────────────────────────

export interface OrchestratorDeps {
  downloads: {
    cancel: (id: number) => Promise<void>;
    erase: (query: { id: number }) => Promise<void>;
    pause: (id: number) => Promise<void>;
    resume: (id: number) => Promise<void>;
  };
  cookies: {
    getAll: (details: {
      url: string;
      storeId?: string;
      tabId?: number;
      frameId?: number;
    }) => Promise<Array<{ name: string; value: string }>>;
  };
  diagnosticLog: { append: (event: DiagnosticInput) => void };
  getSettings: () => DownloadSettings;
  getSiteRules: () => SiteRule[];
  duplicateGuard: DuplicateDownloadGuard;
  /** Primary submission path when the desktop app and engine are ready. */
  desktopClient: DesktopApiClient;
  /**
   * Activate the desktop app through Native Messaging and wait for its HTTP API.
   * Returns true when the desktop app and engine became ready within the timeout.
   */
  activateDesktop: (timeoutMs: number) => Promise<boolean>;
  onDuplicateBlocked: () => void;
}

/** Download data shared by browser downloads and Firefox response interception. */
export interface DownloadCandidate {
  url: string;
  finalUrl: string;
  filename: string;
  fileSize: number;
  totalBytes: number;
  mime: string;
  incognito?: boolean;
  filenameSource?: 'browser-determined' | 'content-disposition';
  byExtensionId?: string;
  referrer?: string;
  requestHeaderContext?: RequestHeaderContext;
  requestHeaderMatchReason?: RequestHeaderMatchReason | 'disabled';
}

/** Shape of a browser DownloadItem as received from chrome.downloads events. */
export interface DownloadItem extends DownloadCandidate {
  id: number;
  state: string;
}

/** Everything needed to submit one download to the desktop app. */
interface DownloadJob {
  id: string;
  url: string;
  finalUrl?: string;
  referer: string;
  cookie: { value: string; source: string };
  filenameHint?: string;
  filenameSource: string;
  headerContext?: RequestHeaderContext;
  headerMatchReason?: RequestHeaderMatchReason | 'disabled';
  source: DownloadSource;
  browserDownloadId?: number;
}

interface SendOptions {
  allowActivation: boolean;
}

type DeliveryFailureReason =
  | 'desktop-unavailable'
  | 'api-auth-failed'
  | 'api-incompatible'
  | 'api-unreachable'
  | 'desktop-activation-disabled'
  | 'desktop-activation-timeout'
  | 'desktop-activation-failed'
  | 'desktop-routing-failed'
  | 'delivery-unknown';

type DeliveryResult = { ok: true } | { ok: false; reason: DeliveryFailureReason; error?: string };

type DownloadSource =
  | 'chromium-download'
  | 'firefox-download'
  | 'firefox-response'
  | 'context-menu'
  | 'external-protocol'
  | 'media';

interface SendUrlOptions {
  source: Extract<DownloadSource, 'context-menu' | 'external-protocol' | 'media'>;
  headerContext?: RequestHeaderContext;
  filename?: string;
  allowActivation?: boolean;
}

const SILENT_SKIP_STAGES = new Set(['enabled', 'self-trigger', 'interception-scope', 'scheme']);

/** Browser names are already decoded text. The engine owns final path policy. */
function filenameHint(value: string): string | undefined {
  return value.trim().replace(/^.*[/\\]/, '') || undefined;
}

// ─── Orchestrator ───────────────────────────────────────

export class DownloadOrchestrator {
  private readonly filterStages;
  constructor(private readonly deps: OrchestratorDeps) {
    this.filterStages = createFilterPipeline(() => deps.getSiteRules());
  }

  async handleFirefoxCreatedDownload(item: DownloadItem): Promise<boolean> {
    if (item.state !== 'in_progress' || !this.evaluateCandidate(item)) return false;
    try {
      await this.deps.downloads.pause(item.id);
    } catch (error) {
      this.logBrowserFallback(item, 'pause-failed', 'continued', errorMessage(error));
      return false;
    }
    try {
      const claimed = await this.handleBrowserDownload(item, 'firefox-download');
      if (!claimed) await this.deps.downloads.resume(item.id);
      return claimed;
    } catch (error) {
      await this.deps.downloads.resume(item.id);
      throw error;
    }
  }

  handleChromiumTakeover(item: DownloadItem): Promise<boolean> {
    return this.handleBrowserDownload(item, 'chromium-download');
  }

  private async handleBrowserDownload(
    item: DownloadItem,
    source: DownloadSource,
  ): Promise<boolean> {
    if (item.state !== 'in_progress') return false;
    const claimed = await this.handleCandidate(item, source);
    if (!claimed) return false;
    if ((await this.cancelBrowserDownload(item.id)) && claimed.confirmed)
      await forgetDownload(claimed.id);
    // A durable desktop receipt or pending request now owns the operation.
    return true;
  }

  shouldClaimChromiumDownload(item: DownloadItem): boolean {
    return item.state === 'in_progress' && this.evaluateCandidate(item) !== null;
  }

  async handleFirefoxResponseTakeover(item: DownloadCandidate): Promise<boolean> {
    return Boolean(await this.handleCandidate(item, 'firefox-response'));
  }

  private async handleCandidate(
    item: DownloadCandidate,
    source: DownloadSource,
  ): Promise<{ id: string; confirmed: boolean } | null> {
    const candidate = this.evaluateCandidate(item);
    if (!candidate) return null;
    const duplicate = this.reserveDuplicate(item);
    if (duplicate.blocked) {
      this.reportDuplicate(item.finalUrl || item.url, duplicate.shouldNotify);
      // A heuristic match is not a durable receipt. Preserve this browser item.
      return null;
    }
    const readiness = await this.prepareDesktop(this.deps.getSettings());
    if (!readiness.ok) {
      this.deps.duplicateGuard.release(duplicate.reservation);
      this.logBrowserFallback(item, readiness.reason, 'continued', readiness.error);
      return null;
    }
    const job = await this.buildJob(item, candidate.tabUrl, source);
    const delivery = await this.sendToDesktop(job, { allowActivation: false });
    if (delivery.ok || delivery.reason === 'delivery-unknown')
      return { id: job.id, confirmed: delivery.ok };
    this.deps.duplicateGuard.release(duplicate.reservation);
    this.logBrowserFallback(item, delivery.reason, 'continued', delivery.error);
    return null;
  }

  shouldClaimFirefoxResponse(item: DownloadCandidate): boolean {
    return this.evaluateCandidate(item) !== null;
  }

  /**
   * Send a URL to the desktop app (context menu, protocol links).
   *
   * @returns 'routed-to-desktop' or 'duplicate-blocked'.
   * @throws when no routing path succeeded.
   */
  async sendUrl(
    url: string,
    tabUrl: string,
    options: SendUrlOptions,
  ): Promise<'routed-to-desktop' | 'duplicate-blocked'> {
    const extracted = options.filename || extractFilenameFromUrl(url) || '';
    const name = filenameHint(extracted);
    const displayName = name || url.split('/').pop() || 'download';

    const duplicate = this.reserveDuplicate({
      url,
      finalUrl: url,
      filename: displayName,
      fileSize: -1,
      totalBytes: -1,
      mime: '',
    });
    if (duplicate.blocked) {
      this.reportDuplicate(url, duplicate.shouldNotify);
      return 'duplicate-blocked';
    }

    const delivery = await this.sendToDesktop(
      {
        id: crypto.randomUUID(),
        url,
        referer: tabUrl,
        cookie:
          options.source === 'media'
            ? { value: options.headerContext?.cookie ?? '', source: 'request' }
            : await this.resolveCookieHeader(url, options.headerContext),
        headerContext: options.headerContext,
        filenameHint: name,
        filenameSource: 'url',
        source: options.source,
      },
      { allowActivation: options.allowActivation ?? true },
    );
    if (!delivery.ok) {
      if (delivery.reason !== 'delivery-unknown')
        this.deps.duplicateGuard.release(duplicate.reservation);
      this.log(
        delivery.reason === 'api-auth-failed' ? 'api_auth_failed' : 'download_delivery_failed',
        delivery.reason === 'api-auth-failed'
          ? 'Rayburst rejected the API credentials'
          : 'Download could not be delivered to Rayburst',
        {
          url,
          source: options.source,
          reason: delivery.reason,
          ...(delivery.error ? { error: delivery.error } : {}),
        },
        'error',
      );
      throw new Error(delivery.reason);
    }

    return 'routed-to-desktop';
  }

  // ─── Candidate Evaluation ─────────────────────────────

  private evaluateCandidate(item: DownloadCandidate): { tabUrl: string } | null {
    const tabUrl = item.requestHeaderContext?.referer || item.referrer || '';
    const ctx: FilterContext = {
      url: item.url,
      finalUrl: item.finalUrl,
      filename: item.filename,
      fileSize: item.fileSize,
      totalBytes: item.totalBytes,
      mimeType: item.mime,
      tabUrl,
      byExtensionId: item.byExtensionId,
      requestMethod: item.requestHeaderContext?.method,
      incognito: item.incognito,
    };
    const { verdict, stageName } = evaluateFilterPipeline(
      ctx,
      this.deps.getSettings(),
      this.filterStages,
    );

    if (verdict === 'skip' && !SILENT_SKIP_STAGES.has(stageName ?? '')) {
      this.log('download_skipped', 'Download was skipped by the filter', {
        url: item.url,
        stage: stageName ?? 'unknown',
        mime: item.mime,
        tabUrl,
      });
    }
    return verdict === 'skip' ? null : { tabUrl };
  }

  // ─── Desktop Activation ───────────────────────────────

  private async prepareDesktop(settings: DownloadSettings): Promise<DeliveryResult> {
    if (settings.desktopUnavailable.action === 'launch')
      return this.ensureDesktopActivated(settings);
    return (await this.deps.desktopClient.isReady())
      ? { ok: true }
      : { ok: false, reason: 'desktop-unavailable' };
  }

  /** Launch-mode activation: start the app and wait for its API. */
  private async ensureDesktopActivated(settings: DownloadSettings): Promise<DeliveryResult> {
    const timeoutMs = settings.desktopUnavailable.startupTimeoutSeconds * 1000;

    try {
      return (await this.deps.activateDesktop(timeoutMs))
        ? { ok: true }
        : { ok: false, reason: 'desktop-activation-timeout' };
    } catch (e) {
      if (e instanceof ApiCompatibilityError) {
        return { ok: false, reason: 'api-incompatible', error: e.message };
      }
      return { ok: false, reason: 'desktop-activation-failed', error: errorMessage(e) };
    }
  }

  private async buildJob(
    item: DownloadCandidate,
    tabUrl: string,
    source: DownloadSource,
  ): Promise<DownloadJob> {
    const effectiveUrl = item.finalUrl || item.url;
    const filename = filenameHint(item.filename);
    const filenameSource = item.filenameSource ?? 'suggested';
    return {
      id: crypto.randomUUID(),
      ...('id' in item && typeof item.id === 'number' ? { browserDownloadId: item.id } : {}),
      url: effectiveUrl,
      finalUrl: effectiveUrl,
      referer: tabUrl,
      cookie: await this.resolveCookieHeader(effectiveUrl, item.requestHeaderContext),
      filenameHint: filename,
      filenameSource,
      headerContext: item.requestHeaderContext,
      headerMatchReason: item.requestHeaderMatchReason,
      source,
    };
  }

  /**
   * Try the HTTP API, then activate Rayburst and retry over HTTP.
   */
  private async sendToDesktop(job: DownloadJob, options: SendOptions): Promise<DeliveryResult> {
    try {
      await this.submitToDesktopApi(job);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiCompatibilityError) {
        return { ok: false, reason: 'api-incompatible', error: e.message };
      }
      if (e instanceof ApiDeliveryUncertainError) {
        try {
          await this.submitToDesktopApi(job);
          return { ok: true };
        } catch (retryError) {
          return { ok: false, reason: 'delivery-unknown', error: errorMessage(retryError) };
        }
      }
      if (e instanceof ApiAuthError) {
        return { ok: false, reason: 'api-auth-failed', error: e.message };
      }
      if (!options.allowActivation) {
        return { ok: false, reason: 'api-unreachable', error: errorMessage(e) };
      }
      return this.activateAndRetry(job);
    }
  }

  /** Activate the desktop app and retry the HTTP submission. */
  private async activateAndRetry(job: DownloadJob): Promise<DeliveryResult> {
    const settings = this.deps.getSettings();
    if (settings.desktopUnavailable.action !== 'launch') {
      return { ok: false, reason: 'desktop-activation-disabled' };
    }

    try {
      const activated = await this.deps.activateDesktop(
        settings.desktopUnavailable.startupTimeoutSeconds * 1000,
      );
      if (!activated) return { ok: false, reason: 'desktop-activation-timeout' };
    } catch (e) {
      return { ok: false, reason: 'desktop-activation-failed', error: errorMessage(e) };
    }

    try {
      await this.submitToDesktopApi(job, true);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiDeliveryUncertainError)
        return { ok: false, reason: 'delivery-unknown', error: errorMessage(e) };
      if (e instanceof ApiAuthError) {
        return { ok: false, reason: 'api-auth-failed', error: e.message };
      }
      return { ok: false, reason: 'desktop-routing-failed', error: errorMessage(e) };
    }
  }

  private async submitToDesktopApi(job: DownloadJob, afterActivation = false): Promise<void> {
    const response = await this.deps.desktopClient.addDownload(
      {
        id: job.id,
        filenameSource: ['browser-determined', 'content-disposition'].includes(job.filenameSource)
          ? 'browser'
          : 'suggested',
        url: job.url,
        finalUrl: job.finalUrl || undefined,
        referer: job.referer || undefined,
        cookie: job.cookie.value || undefined,
        ...(job.filenameHint ? { filename: job.filenameHint } : {}),
        ...(job.headerContext?.userAgent ? { userAgent: job.headerContext.userAgent } : {}),
        ...(job.headerContext?.requestHeaders.length
          ? { requestHeaders: job.headerContext.requestHeaders }
          : {}),
      },
      job.browserDownloadId,
    );

    this.log('download_delegated', 'Download sent to Rayburst', {
      url: job.url,
      source: job.source,
      filenameSource: job.filenameSource,
      action: response.action,
      activated: afterActivation,
      ...(response.gid ? { gid: response.gid } : {}),
      hasCookie: job.cookie.value.length > 0,
      cookieSource: job.cookie.source,
      headerCount: job.headerContext?.requestHeaders.length ?? 0,
      headerMatchReason: job.headerMatchReason ?? (job.headerContext ? 'matched' : 'not-found'),
    });
  }

  // ─── Duplicate Guard ──────────────────────────────────

  private reserveDuplicate(
    input: DuplicateDownloadInput,
  ):
    | { blocked: true; shouldNotify: boolean }
    | { blocked: false; reservation?: DuplicateDownloadReservation } {
    return this.deps.duplicateGuard.reserve(input, this.deps.getSettings().duplicateGuard);
  }

  private reportDuplicate(
    url: string,
    shouldNotify: boolean,
    extra: Record<string, string> = {},
  ): void {
    this.log('download_duplicate_blocked', 'Duplicate desktop submission was skipped', {
      url,
      shouldNotify,
      ...extra,
    });
    if (shouldNotify) this.deps.onDuplicateBlocked();
  }

  // ─── Cookies ──────────────────────────────────────────

  private async resolveCookieHeader(
    url: string,
    headerContext?: RequestHeaderContext,
  ): Promise<{ value: string; source: string }> {
    if (!this.deps.getSettings().forwardCookies) return { value: '', source: 'disabled' };

    const captured = headerContext?.cookie?.trim();
    if (captured) return { value: captured, source: 'request-header' };

    if (!isCookieCollectableUrl(url)) return { value: '', source: 'none' };
    try {
      const cookies = await this.deps.cookies.getAll({
        url,
        storeId: headerContext?.cookieStoreId,
        tabId: headerContext?.tabId,
        frameId: headerContext?.frameId,
      });
      const value = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      return { value, source: value ? 'cookies-api' : 'none' };
    } catch (e) {
      // Graceful degradation — never block the download on cookie failure.
      this.log(
        'cookie_collect_failed',
        'Cookies could not be collected',
        { url, error: errorMessage(e) },
        'warn',
      );
      return { value: '', source: 'none' };
    }
  }

  // ─── Misc Helpers ─────────────────────────────────────

  /** Release the browser item only after a durable handoff exists. */
  private async cancelBrowserDownload(id: number): Promise<boolean> {
    try {
      await this.deps.downloads.cancel(id);
    } catch (e) {
      this.log(
        'download_cancel_failed',
        'Browser download could not be cancelled',
        { downloadId: id, error: errorMessage(e) },
        'warn',
      );
      return false;
    }
    await this.deps.downloads.erase({ id }).catch(() => {
      /* already removed from history — benign */
    });
    return true;
  }

  private logBrowserFallback(
    item: DownloadCandidate,
    reason: string,
    mode: 'continued',
    error?: string,
  ): void {
    this.log(
      'download_restored_to_browser',
      'Browser retained the download',
      {
        url: item.finalUrl || item.url,
        reason,
        mode,
        ...(error ? { error } : {}),
      },
      'warn',
    );
  }

  private log(
    code: DiagnosticInput['code'],
    message: string,
    context?: DiagnosticInput['context'],
    level: DiagnosticInput['level'] = 'info',
  ): void {
    this.deps.diagnosticLog.append({ level, code, message, context });
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
