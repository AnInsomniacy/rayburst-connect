import { DuplicateDownloadGuard } from '@/lib/download/duplicate-guard';
import { z } from 'zod';
import { MediaListSchema } from '@/lib/media/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';
import { startMediaBackground } from '@/lib/media/background';
import { DesktopApiClient } from '@/lib/api';
import { RequestHeaderContextStore } from '@/lib/download/request-context';
import { MEDIA_SESSION_KEY, MediaSessionSchema, parseDownloadSettings } from '@/lib/schema';

let response: Parameters<typeof browser.webRequest.onResponseStarted.addListener>[0];
let request: Parameters<typeof browser.webRequest.onSendHeaders.addListener>[0];
let tabId: number;
let documentId: string;
let frameUrl: string;

async function snapshot() {
  const saved = await browser.storage.session.get(MEDIA_SESSION_KEY);
  const result = MediaSessionSchema.safeParse(saved[MEDIA_SESSION_KEY]);
  return result.success ? result.data : { candidates: [], operations: [], contexts: [] };
}
function resource(
  url: string,
  patch: Partial<Parameters<typeof response>[0]> = {},
): Parameters<typeof response>[0] {
  return {
    url,
    requestId: 'request-one',
    method: 'GET',
    type: 'xmlhttprequest',
    tabId,
    frameId: 0,
    documentId,
    documentLifecycle: 'active',
    frameType: 'outermost_frame',
    parentFrameId: -1,
    timeStamp: Date.now(),
    statusCode: 200,
    statusLine: 'HTTP/1.1 200 OK',
    fromCache: false,
    ip: '127.0.0.1',
    responseHeaders: [{ name: 'Content-Type', value: 'application/vnd.apple.mpegurl' }],
    ...patch,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  const tab = await fakeBrowser.tabs.create({ url: 'https://example.com/watch', active: true });
  if (tab.id === undefined) throw new Error('Missing test tab');
  tabId = tab.id;
  documentId = 'current-document';
  frameUrl = 'https://example.com/watch';
  vi.spyOn(browser.webRequest.onSendHeaders, 'addListener').mockImplementation((listener) => {
    request = listener;
  });
  vi.spyOn(browser.webRequest.onResponseStarted, 'addListener').mockImplementation((listener) => {
    response = listener;
  });
  vi.spyOn(browser.webRequest.onCompleted, 'addListener').mockImplementation(() => undefined);
  vi.spyOn(browser.webRequest.onErrorOccurred, 'addListener').mockImplementation(() => undefined);
  vi.spyOn(browser.tabs.onReplaced, 'addListener').mockImplementation(() => undefined);
  vi.spyOn(browser.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(browser.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
  vi.spyOn(browser.webNavigation, 'getFrame').mockImplementation(async () => ({
    url: frameUrl,
    documentId,
    errorOccurred: false,
    parentFrameId: -1,
    documentLifecycle: 'active',
    frameType: 'outermost_frame',
    processId: 1,
  }));
  vi.spyOn(browser.webNavigation, 'getAllFrames').mockImplementation(async () => [
    {
      url: frameUrl,
      documentId,
      frameId: 0,
      errorOccurred: false,
      parentFrameId: -1,
      documentLifecycle: 'active',
      frameType: 'outermost_frame',
      processId: 1,
    },
  ]);
  const settings = parseDownloadSettings(null);
  startMediaBackground({
    duplicateGuard: new DuplicateDownloadGuard(),
    client: new DesktopApiClient({ port: 29110, secret: '' }),
    ensureConfig: async () => undefined,
    settings: () => settings,
    siteRules: () => [],
    connection: () => ({ port: 29110, secret: '' }),
    activate: async () => false,
    sendFile: async () => true,
    requestHeaders: new RequestHeaderContextStore(),
  });
  // Flush startup cleanup before feeding native event fixtures.
  await vi.waitFor(async () => expect(browser.action.setBadgeText).toHaveBeenCalled());
});
afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('browser discovery integration', () => {
  it('reports an unsupported player source and removes it from the download queue', async () => {
    await fakeBrowser.runtime.onMessage.trigger(
      {
        type: 'MEDIA_OBSERVATIONS',
        title: 'Player',
        observations: [
          {
            url: 'blob:https://example.com/player',
            evidence: 'element',
            elementType: 'video',
          },
        ],
      },
      {
        id: browser.runtime.id,
        tab: await browser.tabs.get(tabId),
        frameId: 0,
        documentId,
        url: frameUrl,
      },
    );
    const source = (await snapshot()).candidates[0]!;
    expect(source.kind).toBe('embedded');
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'MEDIA_BATCH', tabId, ids: [source.id] },
      { id: browser.runtime.id, url: browser.runtime.getURL('/popup.html') },
    );
    await vi.waitFor(async () =>
      expect((await snapshot()).candidates[0]?.downloadError).toBe('unsupported_source'),
    );
    expect((await browser.storage.session.get('mediaQueue')).mediaQueue).toEqual([]);
  });

  it('recovers exact request credentials for a disguised inline manifest', async () => {
    const sessionId = crypto.randomUUID();
    await browser.storage.session.set({
      mediaTools: { [tabId]: { id: sessionId, mode: 'deep', streams: {} } },
    });
    const details = resource('https://cdn.example.com/disguised', {
      responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
    });
    request({
      ...details,
      requestHeaders: [{ name: 'Authorization', value: 'Bearer exact-document' }],
    });
    response(details);
    await Promise.resolve();
    await fakeBrowser.runtime.onMessage.trigger(
      {
        type: 'MEDIA_SCRIPT_DATA',
        data: { sessionId, type: 'manifest', kind: 'hls', url: details.url, content: '#EXTM3U\n' },
      },
      {
        id: browser.runtime.id,
        tab: await browser.tabs.get(tabId),
        frameId: 0,
        documentId,
        url: frameUrl,
      },
    );
    const item = (await snapshot()).candidates[0];
    expect(item?.context?.headers).toContainEqual({
      name: 'authorization',
      value: 'Bearer exact-document',
    });
    expect(item?.input?.manifests[0]?.content).toBe('#EXTM3U\n');
  });
  it('does not duplicate capture bytes or mix frames after a replay', async () => {
    const sessionId = crypto.randomUUID(),
      captureId = crypto.randomUUID(),
      id = crypto.randomUUID();
    const append = vi
      .spyOn(DesktopApiClient.prototype, 'appendCapture')
      .mockResolvedValue({ offset: 3 });
    await browser.storage.session.set({
      mediaTools: { [tabId]: { id: sessionId, mode: 'cache', captureId, streams: {} } },
    });
    const sender = {
      id: browser.runtime.id,
      tab: await browser.tabs.get(tabId),
      frameId: 0,
      documentId,
      url: frameUrl,
    };
    const data = {
      type: 'chunk',
      sessionId,
      id,
      stream: 0,
      mime: 'video/mp4',
      offsetMs: 25,
      data: btoa('abc'),
    };
    await fakeBrowser.runtime.onMessage.trigger({ type: 'MEDIA_SCRIPT_DATA', data }, sender);
    await fakeBrowser.runtime.onMessage.trigger({ type: 'MEDIA_SCRIPT_DATA', data }, sender);
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'MEDIA_SCRIPT_DATA', data: { ...data, id: crypto.randomUUID() } },
      { ...sender, frameId: 1 },
    );
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'MEDIA_SCRIPT_DATA', data: { ...data, sessionId: crypto.randomUUID() } },
      sender,
    );
    expect(append).toHaveBeenCalledExactlyOnceWith(captureId, 0, 0, new Uint8Array([97, 98, 99]));
    const state = (await browser.storage.session.get('mediaTools')).mediaTools;
    expect(state).toMatchObject({
      [tabId]: { frameId: 0, streams: { 0: { offset: 3, lastId: id, offsetMs: 25 } } },
    });
  });
  it('rejects a pre-navigation response even when a browser provides no document ID', async () => {
    const stale = resource('https://cdn.example.com/stale.m3u8', { documentId: undefined });
    request({ ...stale, requestHeaders: [{ name: 'Cookie', value: 'previous-session' }] });
    await fakeBrowser.webNavigation.onCommitted.trigger({
      tabId,
      frameId: 0,
      url: frameUrl,
      timeStamp: Date.now(),
      processId: 1,
      transitionType: 'reload',
      transitionQualifiers: [],
    });
    response(stale);
    const fresh = resource('https://cdn.example.com/fresh.m3u8', {
      requestId: 'fresh-request',
      documentId: undefined,
    });
    request({ ...fresh, requestHeaders: [] });
    response(fresh);
    await vi.waitFor(async () => expect((await snapshot()).candidates).toHaveLength(1));
    expect((await snapshot()).candidates[0]?.url).toContain('fresh.m3u8');
  });
  it('pairs headers by request ID and never exposes them in the popup snapshot', async () => {
    const details = resource('https://cdn.example.com/master.m3u8?signature=secret');
    request({
      ...details,
      requestHeaders: [
        { name: 'Cookie', value: 'session=private' },
        { name: 'Authorization', value: 'Bearer private' },
      ],
    });
    response(details);
    await vi.waitFor(async () => expect((await snapshot()).candidates).toHaveLength(1));
    expect(
      (await snapshot()).candidates[0]?.context?.headers.some(
        (header) => header.name === 'authorization',
      ),
    ).toBe(true);
    const results: unknown[] = await fakeBrowser.runtime.onMessage.trigger(
      { type: 'MEDIA_LIST', tabId },
      { id: browser.runtime.id, url: browser.runtime.getURL('/popup.html') },
    );
    const result = results.find((value) => value !== undefined);
    const parsed = z.object({ ok: z.literal(true), data: MediaListSchema }).parse(result).data;
    expect(parsed.items[0]?.hasRequestContext).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('session=private');
    expect(JSON.stringify(parsed)).not.toContain('Bearer private');
  });
  it('drops responses from an old document and never assigns worker requests to the active tab', async () => {
    response(resource('https://cdn.example.com/old.m3u8', { documentId: 'previous-document' }));
    response(resource('https://cdn.example.com/worker.m3u8', { tabId: -1 }));
    response(resource('https://cdn.example.com/current.m3u8'));
    await vi.waitFor(async () => expect((await snapshot()).candidates).toHaveLength(1));
    expect((await snapshot()).candidates[0]?.url).toContain('current.m3u8');
  });
  it('hides TS entries while retaining origin headers for native playlist downloads', async () => {
    const details = resource('https://segments.example.com/part-1.ts', {
      responseHeaders: [{ name: 'Content-Type', value: 'video/mp2t' }],
    });
    request({ ...details, requestHeaders: [{ name: 'Cookie', value: 'segment-session=private' }] });
    response(details);
    await vi.waitFor(async () => expect((await snapshot()).contexts).toHaveLength(1));
    expect((await snapshot()).candidates).toEqual([]);
    expect((await snapshot()).contexts[0]?.headers).toContainEqual({
      name: 'cookie',
      value: 'segment-session=private',
    });
  });
  it('classifies fragments separately and preserves their origin context', async () => {
    const details = resource('https://segments.example.com/part-1.m4s', {
      responseHeaders: [{ name: 'Content-Type', value: 'video/iso.segment' }],
    });
    request({ ...details, requestHeaders: [{ name: 'Cookie', value: 'segment-session=private' }] });
    response(details);
    await vi.waitFor(async () => expect((await snapshot()).contexts).toHaveLength(1));
    await vi.waitFor(async () =>
      expect((await snapshot()).candidates[0]).toMatchObject({
        kind: 'fragment',
        url: details.url,
      }),
    );
    expect((await snapshot()).contexts[0]?.url).toBe(details.url);
  });
  it('ignores privileged commands from content scripts', async () => {
    const results: unknown[] = await fakeBrowser.runtime.onMessage.trigger(
      { type: 'MEDIA_ENABLE', tabId, enabled: false },
      {
        id: browser.runtime.id,
        url: frameUrl,
        tab: await fakeBrowser.tabs.get(tabId),
        frameId: 0,
      },
    );
    expect(results.every((result) => result === undefined)).toBe(true);
    expect((await browser.storage.local.get('settings')).settings).toBeUndefined();
  });
  it('removes sources when the tab closes', async () => {
    response(resource('https://cdn.example.com/master.m3u8'));
    await vi.waitFor(async () => expect((await snapshot()).candidates).toHaveLength(1));
    await fakeBrowser.tabs.onRemoved.trigger(tabId, { windowId: 1, isWindowClosing: false });
    await vi.waitFor(async () => expect((await snapshot()).candidates).toEqual([]));
  });
});
