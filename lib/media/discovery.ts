import { browser } from 'wxt/browser';
import {
  MEDIA_RETENTION_MS,
  type DownloadSettings,
  type MediaCandidate,
  type MediaCapturedContext,
} from '../schema';
import {
  captureRequestHeaderContext,
  type RequestHeaderContextStore,
} from '../download/request-context';
import { detectMedia, mediaOrigin, type MediaObservation } from './detection';
import { captureMediaContext } from './request-context';
import type { MediaCatalog } from './catalog';
import { selectMedia } from './rules';
import { countMediaResources } from './resources';

const HTTP_URLS = ['http://*/*', 'https://*/*'];
const REQUEST_TTL_MS = 2 * 60_000;

export async function frameContext(tabId: number, frameId: number, documentId?: string) {
  if (tabId < 0 || frameId < 0) return null;
  const [tab, frame] = await Promise.all([
    browser.tabs.get(tabId),
    browser.webNavigation.getFrame({ tabId, frameId }),
  ]);
  if (!tab.url || !/^https?:/.test(tab.url) || !frame || frame.errorOccurred) return null;
  if (documentId && frame.documentId && documentId !== frame.documentId) return null;
  return { tab, frame };
}

/** Native request, document and tab events feed one frame-scoped catalogue. */
export function startMediaDiscovery(options: {
  catalog: MediaCatalog;
  ensureConfig: () => Promise<void>;
  settings: () => DownloadSettings;
  requestHeaders: RequestHeaderContextStore;
  allowed: (pageUrl: string, url: string) => boolean;
  report: () => void;
}) {
  const { catalog, allowed } = options;
  const pending = new Map<string, { context: MediaCapturedContext; generation: string }>();
  const recent = new Map<string, MediaCapturedContext>();
  const contextKey = (tabId: number, frameId: number, documentId: string, url: string) =>
    JSON.stringify([tabId, frameId, documentId, url]);
  const generations = new Map<string, number>();
  const safely = (work: Promise<unknown>) => {
    void work.catch(options.report);
  };
  const configuration = options.ensureConfig();
  safely(configuration);
  const generation = (tabId: number, frameId: number) =>
    `${generations.get(`${tabId}:0`) ?? 0}:${generations.get(`${tabId}:${frameId}`) ?? 0}`;

  async function validateCandidate(candidate: MediaCandidate): Promise<boolean> {
    await options.ensureConfig();
    if (!allowed(candidate.pageUrl, candidate.url)) return false;
    try {
      if (options.settings().mediaDiscovery.preserveOnNavigation) {
        await browser.tabs.get(candidate.tabId);
        return candidate.lastSeen >= Date.now() - MEDIA_RETENTION_MS;
      }
      const current = await frameContext(candidate.tabId, candidate.frameId, candidate.documentId);
      return Boolean(
        current &&
        current.frame.url === candidate.frameUrl &&
        current.tab.url === candidate.pageUrl &&
        candidate.lastSeen >= Date.now() - MEDIA_RETENTION_MS,
      );
    } catch {
      return false;
    }
  }

  async function updateBadge(tabId: number) {
    const count = await catalog.run((state) => countMediaResources(state.candidates, tabId));
    await browser.action.setBadgeText({
      tabId,
      text: count ? (count > 99 ? '99+' : String(count)) : '',
    });
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#7B3ED1' });
  }

  async function observe(
    input: MediaObservation,
    tabId: number,
    frameId: number,
    documentId?: string,
    title = '',
    context?: MediaCapturedContext,
    documentUrl?: string,
  ) {
    await options.ensureConfig();
    const detected = selectMedia(input, options.settings().mediaDiscovery);
    const transportMedia = detectMedia(input);
    // Filtered segments still supply document-scoped transport context for their playlist.
    if (
      !detected &&
      !['file', 'hls', 'dash', 'fragment', 'subtitle'].includes(transportMedia?.kind ?? '')
    )
      return;
    const current = await frameContext(tabId, frameId, documentId).catch(() => null);
    if (!current || !allowed(current.tab.url ?? '', input.url)) return;
    if (documentUrl && current.frame.url !== documentUrl) return;
    const now = Date.now();
    const cleanContext =
      context && (!detected || detected.url === input.url)
        ? {
            ...captureMediaContext(input.url, context.headers, options.settings()),
            capturedAt: context.capturedAt,
          }
        : undefined;
    if (cleanContext?.headers.length) {
      await catalog.run((state) => {
        const previous = state.contexts.find(
          (item) =>
            item.tabId === tabId &&
            item.frameId === frameId &&
            item.documentId === (current.frame.documentId ?? '') &&
            mediaOrigin(item.url) === mediaOrigin(input.url),
        );
        // Avoid one storage transaction per fragment when credentials are unchanged.
        if (
          previous &&
          now - previous.capturedAt < 15_000 &&
          JSON.stringify(previous.headers) === JSON.stringify(cleanContext.headers)
        )
          return;
        state.contexts = state.contexts.filter((item) => item !== previous);
        state.contexts.push({
          ...cleanContext,
          tabId,
          frameId,
          documentId: current.frame.documentId ?? '',
          frameUrl: current.frame.url,
          pageUrl: current.tab.url ?? '',
        });
      }, true);
    }
    if (!detected) return;
    await catalog.observe({
      ...detected,
      id: crypto.randomUUID(),
      tabId,
      frameId,
      documentId: current.frame.documentId ?? '',
      frameUrl: current.frame.url,
      pageUrl: current.tab.url ?? '',
      title: (title || current.tab.title || detected.filename).slice(0, 512),
      firstSeen: now,
      lastSeen: now,
      context: cleanContext,
    });
    await updateBadge(tabId);
  }

  browser.webRequest.onSendHeaders.addListener(
    (details) => {
      const eventGeneration = generation(details.tabId, details.frameId);
      const capturedAt = Date.now();
      safely(
        configuration.then(() => {
          // Capture synchronously so a fast response cannot overtake its request context.
          const now = capturedAt;
          for (const [id, entry] of pending)
            if (entry.context.capturedAt < now - REQUEST_TTL_MS) pending.delete(id);
          if (pending.size >= 512) {
            const oldest = pending.keys().next().value;
            if (oldest) pending.delete(oldest);
          }
          const settings = options.settings();
          if (settings.forwardRequestHeaders) {
            const legacy = captureRequestHeaderContext(details);
            if (legacy) options.requestHeaders.remember(legacy);
          }
          if (details.tabId < 0 || !settings.mediaDiscovery.enabled) return;
          pending.set(details.requestId, {
            context: {
              ...captureMediaContext(details.url, details.requestHeaders ?? [], settings),
              capturedAt,
            },
            generation: eventGeneration,
          });
        }),
      );
    },
    { urls: HTTP_URLS },
    import.meta.env.FIREFOX ? ['requestHeaders'] : ['requestHeaders', 'extraHeaders'],
  );

  browser.webRequest.onResponseStarted.addListener(
    (details) => {
      safely(
        configuration.then(() => {
          const captured = pending.get(details.requestId);
          const context = captured?.context;
          pending.delete(details.requestId);
          if (
            !details.documentId &&
            captured &&
            captured.generation !== generation(details.tabId, details.frameId)
          )
            return;
          if (context?.url === details.url && options.settings().mediaDiscovery.enabled) {
            recent.set(
              contextKey(details.tabId, details.frameId, details.documentId ?? '', details.url),
              context,
            );
            for (const [key, value] of recent)
              if (value.capturedAt < Date.now() - REQUEST_TTL_MS || recent.size > 512)
                recent.delete(key);
          }
          const documentUrl =
            'documentUrl' in details && typeof details.documentUrl === 'string'
              ? details.documentUrl
              : undefined;
          const header = (name: string) =>
            details.responseHeaders?.find((item) => item.name.toLowerCase() === name)?.value;
          safely(
            observe(
              {
                url: details.url,
                method: details.method,
                status: details.statusCode,
                evidence: 'network',
                mime: header('content-type'),
                disposition: header('content-disposition'),
                length: header('content-length'),
                contentRange: header('content-range'),
              },
              details.tabId,
              details.frameId,
              details.documentId,
              '',
              context?.url === details.url ? context : undefined,
              documentUrl,
            ),
          );
        }),
      );
    },
    { urls: HTTP_URLS },
    ['responseHeaders'],
  );
  browser.webRequest.onErrorOccurred.addListener(
    (details) => {
      safely(configuration.then(() => pending.delete(details.requestId)));
    },
    { urls: HTTP_URLS },
  );
  browser.webRequest.onCompleted.addListener(
    (details) => {
      safely(configuration.then(() => pending.delete(details.requestId)));
    },
    { urls: HTTP_URLS },
  );

  async function synchronizeTab(tabId: number) {
    const [tab, frames] = await Promise.all([
      browser.tabs.get(tabId),
      browser.webNavigation.getAllFrames({ tabId }),
    ]);
    await catalog.run((state) => {
      state.candidates = state.candidates.filter((item) => {
        if (item.tabId !== tabId || options.settings().mediaDiscovery.preserveOnNavigation)
          return true;
        const frame = frames?.find((value) => value.frameId === item.frameId);
        return (
          frame &&
          !frame.errorOccurred &&
          frame.url === item.frameUrl &&
          (!frame.documentId || frame.documentId === item.documentId) &&
          tab.url === item.pageUrl &&
          allowed(item.pageUrl, item.url)
        );
      });
      state.contexts = state.contexts.filter(
        (item) =>
          item.tabId !== tabId ||
          Boolean(
            frames?.some(
              (frame) =>
                frame.frameId === item.frameId &&
                frame.url === item.frameUrl &&
                (!frame.documentId || frame.documentId === item.documentId),
            ) &&
            tab.url === item.pageUrl &&
            allowed(item.pageUrl, item.url),
          ),
      );
    }, true);
    await updateBadge(tabId);
  }

  browser.webNavigation.onCommitted.addListener((details) => {
    for (const key of recent.keys()) {
      const identity = JSON.parse(key) as [number, number, string, string];
      if (
        identity[0] === details.tabId &&
        (details.frameId === 0 || identity[1] === details.frameId)
      )
        recent.delete(key);
    }
    const key = `${details.tabId}:${details.frameId}`;
    const next = (generations.get(key) ?? 0) + 1;
    if (details.frameId === 0)
      for (const entry of generations.keys())
        if (entry.startsWith(`${details.tabId}:`)) generations.delete(entry);
    generations.set(key, next);
    options.requestHeaders.clear(details.tabId);
    safely(
      catalog
        .run((state) => {
          state.candidates = state.candidates.filter(
            (item) =>
              item.tabId !== details.tabId ||
              options.settings().mediaDiscovery.preserveOnNavigation ||
              (details.frameId !== 0 && item.frameId !== details.frameId) ||
              Boolean(details.documentId && item.documentId === details.documentId),
          );
          state.contexts = state.contexts.filter(
            (item) =>
              item.tabId !== details.tabId ||
              options.settings().mediaDiscovery.preserveOnNavigation ||
              (details.frameId !== 0 && item.frameId !== details.frameId) ||
              Boolean(details.documentId && item.documentId === details.documentId),
          );
        }, true)
        .then(() => updateBadge(details.tabId)),
    );
  });
  const sameDocumentNavigation = (details: { tabId: number; frameId: number; url: string }) => {
    // A same-document route change keeps playing media but refreshes its page provenance.
    safely(
      catalog.run((state) => {
        for (const item of [...state.candidates, ...state.contexts])
          if (item.tabId === details.tabId) {
            if (details.frameId === 0) item.pageUrl = details.url;
            if (item.frameId === details.frameId) item.frameUrl = details.url;
          }
      }, true),
    );
    safely(browser.tabs.sendMessage(details.tabId, { type: 'MEDIA_RESCAN' }));
  };
  browser.webNavigation.onHistoryStateUpdated.addListener(sameDocumentNavigation);
  browser.webNavigation.onReferenceFragmentUpdated.addListener(sameDocumentNavigation);
  browser.tabs.onRemoved.addListener((tabId) => {
    options.requestHeaders.clear(tabId);
    for (const entry of generations.keys())
      if (entry.startsWith(`${tabId}:`)) generations.delete(entry);
    safely(catalog.remove(tabId));
  });
  browser.tabs.onReplaced.addListener((added, removed) => {
    safely(
      catalog.remove(removed).then(() => browser.tabs.sendMessage(added, { type: 'MEDIA_RESCAN' })),
    );
  });

  return {
    observe,
    validateCandidate,
    synchronizeTab,
    updateBadge,
    clearRequests: () => {
      pending.clear();
      recent.clear();
    },
    contextFor: (item: MediaCandidate) => {
      const exact = recent.get(contextKey(item.tabId, item.frameId, item.documentId, item.url));
      // Firefox versions without document IDs still require an exact native frame and URL.
      const value = exact ?? recent.get(contextKey(item.tabId, item.frameId, '', item.url));
      return value && value.capturedAt >= Date.now() - REQUEST_TTL_MS
        ? {
            ...captureMediaContext(value.url, value.headers, options.settings()),
            capturedAt: value.capturedAt,
          }
        : undefined;
    },
  };
}
