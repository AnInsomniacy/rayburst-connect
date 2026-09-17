import { encodeCaptureChunk } from '@/lib/media/capture';
import { createPlayerControls } from '@/lib/media/player-controls';
import { browser } from 'wxt/browser';
import {
  createExternalProtocolClickHandler,
  type ExternalProtocolDisposition,
} from '@/lib/browser';
import { parseDownloadSettings } from '@/lib/schema';
import { observePageMedia } from '@/lib/media/page-observer';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main(ctx) {
    let settings = parseDownloadSettings(null);
    let observer: ReturnType<typeof observePageMedia> | undefined;
    let disposed = false;
    let sessionId: unknown;
    const players = createPlayerControls();
    function configure(value: unknown) {
      settings = parseDownloadSettings(value);
      if (settings.mediaDiscovery.enabled && !observer && !disposed)
        observer = observePageMedia((message) => browser.runtime.sendMessage(message));
      if (!settings.mediaDiscovery.enabled) {
        window.postMessage(
          { channel: 'rayburst-control', mode: 'stop', sessionId },
          location.origin,
        );
        observer?.stop();
        observer = undefined;
      }
    }
    void browser.storage.local.get('settings').then((data) => {
      if (!disposed) configure(data.settings);
    });
    const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area === 'local' && changes.settings) configure(changes.settings.newValue);
    };
    const message: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return;
      if (raw.type === 'MEDIA_PLAYER' && 'command' in raw)
        return players(raw.command).catch(() => ({ error: 'operation_failed' }));
      if (raw.type === 'MEDIA_RESCAN') observer?.rescan();
      if (raw.type === 'MEDIA_CONTROL' && 'mode' in raw) {
        sessionId = 'sessionId' in raw ? raw.sessionId : undefined;
        window.postMessage({ ...raw, channel: 'rayburst-control' }, location.origin);
      }
    };
    let windowStart = Date.now();
    let events = 0;
    ctx.addEventListener(window, 'message', (event: MessageEvent<unknown>) => {
      if (
        !settings.mediaDiscovery.enabled ||
        event.source !== window ||
        event.origin !== location.origin ||
        !event.data ||
        typeof event.data !== 'object'
      )
        return;
      const data = event.data as Record<string, unknown>;
      if (data.channel !== 'rayburst-observation') return;
      if (Date.now() - windowStart > 1000) {
        windowStart = Date.now();
        events = 0;
      }
      if (++events > 128) return;
      void (async () => {
        let payload = data;
        if (data.type === 'chunk')
          payload = { ...(await encodeCaptureChunk(data)), sessionId: data.sessionId };
        const result: unknown = await browser.runtime.sendMessage({
          type: 'MEDIA_SCRIPT_DATA',
          data: payload,
        });
        if (typeof data.id === 'string')
          window.postMessage(
            {
              channel: 'rayburst-ack',
              id: data.id,
              ok: Boolean(result && typeof result === 'object' && 'ok' in result && result.ok),
            },
            location.origin,
          );
      })().catch(() => {
        if (typeof data.id === 'string')
          window.postMessage({ channel: 'rayburst-ack', id: data.id, ok: false }, location.origin);
      });
    });
    browser.storage.onChanged.addListener(changed);
    browser.runtime.onMessage.addListener(message);
    const click = createExternalProtocolClickHandler({
      shouldIntercept: (link) => settings.enabled && settings.interceptionScope[link.protocol],
      sendProtocol: async ({ protocol, url }): Promise<ExternalProtocolDisposition> => {
        const response: unknown = await browser.runtime.sendMessage({
          type: 'HANDLE_EXTERNAL_PROTOCOL',
          protocol,
          url,
        });
        return response !== null &&
          typeof response === 'object' &&
          'disposition' in response &&
          response.disposition === 'browser'
          ? 'browser'
          : 'handled';
      },
      openInBrowser: (url) => window.location.assign(url),
    });
    ctx.addEventListener(document, 'click', click, { capture: true });
    ctx.addEventListener(window, 'pageshow', () => observer?.rescan());
    ctx.onInvalidated(() => {
      disposed = true;
      observer?.stop();
      browser.storage.onChanged.removeListener(changed);
      browser.runtime.onMessage.removeListener(message);
    });
  },
});
