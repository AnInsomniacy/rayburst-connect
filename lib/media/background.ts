import { mediaSiteAllowed, selectMedia } from './rules';
import type { DuplicateDownloadGuard } from '../download/duplicate-guard';
import { startMediaTools } from './tools';
import { browser, type Browser } from 'wxt/browser';
import type { DesktopApiClient } from '../api';
import { MediaApiError } from '../api';
import { updateMediaSettings } from '../storage';
import {
  type ConnectionConfig,
  type DownloadSettings,
  type MediaCandidate,
  type SiteRule,
} from '../schema';
import { type RequestHeaderContextStore } from '../download/request-context';
import { matchSiteRule } from '../site-rules';
import { createMediaCatalog } from './catalog';
import { hostname } from './detection';
import { startMediaDiscovery } from './discovery';
import { captureMediaContext } from './request-context';
import { MediaCommandSchema, MediaObservationsSchema, type MediaList } from './messages';
import { createMediaWorkflow, mediaErrorCode } from './workflow';

const CLEANUP_ALARM = 'media-cleanup';

export function startMediaBackground(options: {
  client: DesktopApiClient;
  duplicateGuard: DuplicateDownloadGuard;
  ensureConfig: () => Promise<void>;
  settings: () => DownloadSettings;
  siteRules: () => SiteRule[];
  connection: () => ConnectionConfig;
  activate: () => Promise<boolean>;
  sendFile: (candidate: MediaCandidate) => Promise<boolean>;
  requestHeaders: RequestHeaderContextStore;
  onError?: () => void;
  onDownloadError?: (candidateId: string, error: string) => void;
}) {
  const catalog = createMediaCatalog();
  const report = () => options.onError?.();
  const safely = (work: Promise<unknown>) => {
    void work.catch(report);
  };

  function allowed(pageUrl: string, url: string): boolean {
    const settings = options.settings();
    return (
      mediaSiteAllowed(settings.mediaDiscovery, pageUrl) &&
      matchSiteRule(options.siteRules(), [pageUrl, url]) !== 'always-skip'
    );
  }

  const { observe, validateCandidate, synchronizeTab, updateBadge, clearRequests, contextFor } =
    startMediaDiscovery({
      catalog,
      ensureConfig: options.ensureConfig,
      settings: options.settings,
      requestHeaders: options.requestHeaders,
      allowed,
      report,
    });

  async function connectionKey() {
    const connection = options.connection();
    const settings = options.settings();
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        JSON.stringify([
          connection.port,
          connection.secret,
          settings.forwardCookies,
          settings.forwardRequestHeaders,
        ]),
      ),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }
  const workflow = createMediaWorkflow({
    catalog,
    client: options.client,
    duplicateGuard: options.duplicateGuard,
    getSettings: options.settings,
    activate: options.activate,
    sendFile: options.sendFile,
    validateCandidate,
    connectionKey,
  });

  startMediaTools({
    ensureConfig: options.ensureConfig,
    onDownloadError: options.onDownloadError,
    catalog,
    client: options.client,
    allowed,
    workflow,
    contextFor,
    settings: options.settings,
    probe: workflow.probe,
    observe: async (item) => {
      await catalog.observe(item);
      await updateBadge(item.tabId);
    },
  });

  async function list(tabId: number): Promise<MediaList> {
    if (tabId === -1) {
      const tabs = await browser.tabs.query({});
      const lists = await Promise.all(
        tabs
          .filter((tab) => tab.id !== undefined && tab.url?.startsWith('http'))
          .map((tab) => list(tab.id!)),
      );
      return {
        host: '',
        enabled: options.settings().mediaDiscovery.enabled,
        excluded: false,
        items: lists.flatMap((value) => value.items),
      };
    }
    await synchronizeTab(tabId);
    const tab = await browser.tabs.get(tabId);
    const host = hostname(tab.url ?? '');
    const settings = options.settings();
    return catalog.run((state) => ({
      host,
      enabled: settings.mediaDiscovery.enabled,
      excluded: !mediaSiteAllowed(settings.mediaDiscovery, tab.url ?? ''),
      items: state.candidates
        .filter((item) => item.tabId === tabId)
        .map(({ context, ...candidate }) => {
          const operation = state.operations.find((item) => item.candidateId === candidate.id);
          const view = operation
            ? (({ request, connectionKey: _connectionKey, ...data }) => ({
                ...data,
                probeId: request.id,
              }))(operation)
            : undefined;
          return {
            ...candidate,
            hasRequestContext: Boolean(context?.headers.length),
            operation: view,
          };
        }),
    }));
  }

  browser.runtime.onMessage.addListener((raw: unknown, sender: Browser.runtime.MessageSender) => {
    const observations = MediaObservationsSchema.safeParse(raw);
    if (observations.success) {
      if (
        sender.id !== browser.runtime.id ||
        sender.tab?.id === undefined ||
        sender.frameId === undefined
      )
        return;
      const tabId = sender.tab.id;
      const frameId = sender.frameId;
      return Promise.all(
        observations.data.observations.map((item) =>
          observe(
            item,
            tabId,
            frameId,
            sender.documentId,
            observations.data.title,
            undefined,
            sender.url,
          ),
        ),
      )
        .then(() => ({ ok: true }))
        .catch(() => ({ ok: false }));
    }
    const command = MediaCommandSchema.safeParse(raw);
    if (
      !command.success ||
      sender.id !== browser.runtime.id ||
      !sender.url?.startsWith(browser.runtime.getURL(''))
    )
      return;
    return (async () => {
      await options.ensureConfig();
      const message = command.data;
      switch (message.type) {
        case 'MEDIA_ENABLE':
          await updateMediaSettings({ enabled: message.enabled });
          break;
        case 'MEDIA_SITE': {
          const host = hostname((await browser.tabs.get(message.tabId)).url ?? '');
          if (!host) throw new MediaApiError('unsupported_source');
          const excluded = options
            .settings()
            .mediaDiscovery.excludedHosts.filter((value) => value !== host);
          if (message.excluded === (options.settings().mediaDiscovery.siteMode === 'exclude'))
            excluded.push(host);
          if (excluded.length > 100) throw new MediaApiError('site_limit');
          await updateMediaSettings({ excludedHosts: excluded });
          break;
        }
        case 'MEDIA_RESCAN':
          await browser.tabs.sendMessage(message.tabId, { type: 'MEDIA_RESCAN' });
          break;
        case 'MEDIA_CLEAR':
          await catalog.remove(message.tabId, message.candidateId);
          break;
        case 'MEDIA_DOWNLOAD_FILE':
          await workflow.downloadFile(message.tabId, message.candidateId);
          break;
        case 'MEDIA_PROBE':
          await workflow.probe(message.tabId, message.candidateId);
          break;
        case 'MEDIA_POLL':
          await workflow.poll(message.tabId, message.candidateId);
          break;
        case 'MEDIA_SUBMIT':
          await workflow.submit(message.tabId, message.candidateId, message.selection);
          break;
        case 'MEDIA_CANCEL':
          await workflow.cancel(message.tabId, message.candidateId);
          break;
      }
      const data = await list(message.tabId);
      return { ok: true, data };
    })().catch((error: unknown) => ({ ok: false, error: mediaErrorCode(error) }));
  });

  async function cleanup() {
    await options.ensureConfig();
    const tabs = await browser.tabs.query({});
    const key = await connectionKey();
    const openIds = new Set(tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])));
    await catalog.run((state) => {
      state.candidates = state.candidates.filter(
        (item) =>
          openIds.has(item.tabId) &&
          allowed(item.pageUrl, item.url) &&
          (item.evidence === 'capture' ||
            item.kind === 'collection' ||
            item.variant ||
            state.operations.some((operation) => operation.candidateId === item.id) ||
            selectMedia(
              {
                url: item.url,
                mime: item.mime,
                evidence: item.evidence,
                length: item.size === null ? undefined : String(item.size),
              },
              options.settings().mediaDiscovery,
            )),
      );
      for (const item of state.candidates)
        if (item.context && item.evidence !== 'capture')
          item.context = {
            ...captureMediaContext(item.url, item.context.headers, options.settings()),
            capturedAt: item.context.capturedAt,
          };
      state.contexts = state.contexts
        .filter((item) => openIds.has(item.tabId) && allowed(item.pageUrl, item.url))
        .map((item) => ({
          ...item,
          headers: captureMediaContext(item.url, item.headers, options.settings()).headers,
        }));
      for (const operation of state.operations) {
        const stripped = operation.request.source.requestContexts.map((context) => ({
          ...context,
          headers: captureMediaContext(context.url, context.headers, options.settings()).headers,
        }));
        if (JSON.stringify(stripped) !== JSON.stringify(operation.request.source.requestContexts)) {
          operation.request.source.requestContexts = [];
          if (!['submitted', 'cancelled'].includes(operation.state)) {
            if (!['submitting', 'cancelling'].includes(operation.state)) operation.state = 'failed';
            operation.error = 'privacy_changed';
          }
        }
        if (
          operation.connectionKey !== key &&
          !['submitted', 'cancelled'].includes(operation.state)
        ) {
          operation.request.source.requestContexts = [];
          if (!['submitting', 'cancelling'].includes(operation.state)) operation.state = 'failed';
          operation.error = 'connection_changed';
        }
      }
    }, true);
    for (const tabId of openIds) await updateBadge(tabId).catch(() => undefined);
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.siteRules || changes.connection)) {
      clearRequests();
      options.requestHeaders.clear();
      safely(cleanup());
    }
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CLEANUP_ALARM) safely(cleanup());
  });
  safely(
    (async () => {
      await browser.alarms.create(CLEANUP_ALARM, { periodInMinutes: 1 });
    })(),
  );
  safely(cleanup());
}
