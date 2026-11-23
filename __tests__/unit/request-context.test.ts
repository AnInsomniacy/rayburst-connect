import { describe, expect, it } from 'vitest';
import {
  RequestHeaderContextStore,
  captureRequestHeaderContext,
} from '@/lib/download/request-context';

describe('request header context', () => {
  it('separates Cookie and User-Agent while forwarding only sanitized allowlisted headers', () => {
    const context = captureRequestHeaderContext({
      url: 'https://cdn.example.com/file.zip',
      now: 1000,
      requestHeaders: [
        { name: 'Cookie', value: 'session=secret' },
        { name: 'User-Agent', value: 'Browser\r\nInjected: 1' },
        { name: 'Accept', value: 'application/zip' },
        { name: 'Origin', value: 'https://example.com\nInjected: 1' },
        { name: 'Authorization', value: 'Bearer secret' },
        { name: 'Accept-Encoding', value: 'gzip' },
        { name: 'X-Custom-Token', value: 'secret' },
      ],
    });

    expect(context).toEqual({
      url: 'https://cdn.example.com/file.zip',
      createdAt: 1000,
      cookie: 'session=secret',
      userAgent: 'Browser Injected: 1',
      requestHeaders: [
        { name: 'Accept', value: 'application/zip' },
        { name: 'Origin', value: 'https://example.com Injected: 1' },
      ],
    });
  });

  it('prefers final URLs, consumes matches, and preserves peeks', () => {
    const store = new RequestHeaderContextStore(() => 1000, 30_000, 16);
    const original = captureRequestHeaderContext({
      url: 'https://origin.example.com/download',
      requestHeaders: [{ name: 'Accept', value: 'origin' }],
    });
    const final = captureRequestHeaderContext({
      url: 'https://cdn.example.com/file.zip',
      requestHeaders: [{ name: 'Accept', value: 'final' }],
    });
    if (!original || !final) throw new Error('fixture capture failed');
    store.remember(original);
    store.remember(final);

    expect(store.peek({ url: original.url, finalUrl: final.url })).toMatchObject({
      matched: true,
      source: 'finalUrl',
      context: final,
    });
    expect(store.match({ url: original.url, finalUrl: final.url })).toMatchObject({
      matched: true,
      source: 'finalUrl',
      context: final,
    });
    expect(store.match({ url: original.url, finalUrl: final.url })).toMatchObject({
      matched: true,
      source: 'url',
      context: original,
    });
  });

  it('retains the original request through redirects without mixing origin cookies', () => {
    const store = new RequestHeaderContextStore(() => 1000);
    const source = {
      url: 'https://origin.example/get',
      createdAt: 1000,
      cookie: 'origin=one',
      requestHeaders: [],
    };
    const target = {
      url: 'https://cdn.example/file',
      createdAt: 1000,
      cookie: 'cdn=two',
      requestHeaders: [],
    };
    store.remember(source, 'request-one');
    store.remember(target, 'request-one');
    expect(store.peek({ url: target.url }).context).toMatchObject({
      originalUrl: source.url,
      cookie: 'cdn=two',
    });
    expect(store.peek({ url: source.url }).context?.cookie).toBe('origin=one');
    store.remember({ ...target, url: 'https://unrelated.example/file' }, 'request-two');
    expect(store.peek({ url: 'https://unrelated.example/file' }).context?.originalUrl).toBe(
      'https://unrelated.example/file',
    );
  });

  it('starts a download where its request started, not at the page that began it', () => {
    const store = new RequestHeaderContextStore(() => 1000);
    const page = 'https://meeting.example/download/';
    const file = 'https://cdn.example/app.exe';
    store.remember({ url: page, createdAt: 1000, cookie: 'page=1', requestHeaders: [] }, 'nav');
    store.remember({ url: file, createdAt: 1000, cookie: 'cdn=2', requestHeaders: [] }, 'file');
    // Chromium reports the page as the URL after location.replace() (#711).
    expect(store.download({ url: page, finalUrl: file })).toMatchObject({
      originalUrl: file,
      context: { cookie: 'cdn=2' },
    });

    store.remember({ url: 'https://origin.example/get', createdAt: 1000, requestHeaders: [] }, 'r');
    store.remember({ url: 'https://cdn.example/moved', createdAt: 1000, requestHeaders: [] }, 'r');
    expect(
      store.download({ url: 'https://origin.example/get', finalUrl: 'https://cdn.example/moved' })
        .originalUrl,
    ).toBe('https://origin.example/get');
    // Without a trace the browser's own URL stands.
    expect(
      store.download({ url: 'https://other.example/a', finalUrl: 'https://cdn.example/b' }),
    ).toMatchObject({ originalUrl: 'https://other.example/a', matched: false });
  });

  it('hands over the GET a form POST redirected to, never the POST itself', () => {
    const store = new RequestHeaderContextStore(() => 1000);
    const form = 'https://host.example/download';
    const file = 'https://cdn.example/f/signed';
    // Two submissions of the same form within the TTL make the POST ambiguous.
    for (const [id, tabId] of [
      ['one', 1],
      ['two', 2],
    ] as const) {
      store.remember({ url: form, method: 'POST', tabId, createdAt: 1000, requestHeaders: [] }, id);
    }
    store.remember(
      { url: file, method: 'GET', tabId: 2, createdAt: 1000, cookie: 'cdn=1', requestHeaders: [] },
      'two',
    );
    expect(store.download({ url: form, finalUrl: file })).toMatchObject({
      originalUrl: file,
      method: 'GET',
      matched: true,
      context: { url: file, originalUrl: form, originalMethod: 'POST', cookie: 'cdn=1' },
    });
    // Firefox reports the response that arrived, without a final URL.
    expect(store.download({ url: file })).toMatchObject({ originalUrl: file, method: 'GET' });
  });

  it('keeps a POST in the browser when its match is ambiguous or the redirect keeps it', () => {
    const store = new RequestHeaderContextStore(() => 1000);
    const form = 'https://host.example/download';
    for (const tabId of [1, 2]) {
      store.remember({ url: form, method: 'POST', tabId, createdAt: 1000, requestHeaders: [] });
    }
    // The final hop was not captured: the ambiguous POST still names its method.
    expect(store.download({ url: form, finalUrl: 'https://cdn.example/other' })).toMatchObject({
      originalUrl: form,
      matched: false,
      reason: 'ambiguous',
      method: 'POST',
    });

    const kept = new RequestHeaderContextStore(() => 1000);
    kept.remember({ url: form, method: 'POST', createdAt: 1000, requestHeaders: [] }, 'r');
    kept.remember(
      { url: 'https://cdn.example/f', method: 'POST', createdAt: 1000, requestHeaders: [] },
      'r',
    );
    // A 307 or 308 repeats the POST: the original request stays the source.
    expect(kept.download({ url: form, finalUrl: 'https://cdn.example/f' })).toMatchObject({
      originalUrl: form,
      method: 'POST',
    });

    const plain = new RequestHeaderContextStore(() => 1000);
    for (const tabId of [1, 2]) {
      plain.remember({ url: form, method: 'GET', tabId, createdAt: 1000, requestHeaders: [] });
    }
    expect(plain.peek({ url: form })).toEqual({ matched: false, reason: 'ambiguous' });
  });

  it('distinguishes expired and missing contexts without exposing values', () => {
    let now = 1000;
    const store = new RequestHeaderContextStore(() => now, 100, 16);
    const context = captureRequestHeaderContext({
      url: 'https://cdn.example.com/file.zip',
      now,
      requestHeaders: [{ name: 'Accept', value: 'secret-value' }],
    });
    if (!context) throw new Error('fixture capture failed');
    store.remember(context);
    now = 1101;

    expect(store.match({ url: context.url })).toEqual({ matched: false, reason: 'expired' });
    expect(store.match({ url: 'https://example.com/missing' })).toEqual({
      matched: false,
      reason: 'not-found',
    });
  });

  it('refuses to guess credentials when two tabs request the same URL', () => {
    const store = new RequestHeaderContextStore(() => 1000);
    for (const tabId of [1, 2]) {
      const context = captureRequestHeaderContext({
        url: 'https://example.com/video.mp4',
        tabId,
        now: 1000,
        requestHeaders: [{ name: 'Cookie', value: `session=${tabId}` }],
      });
      if (context) store.remember(context);
    }
    expect(store.peek({ url: 'https://example.com/video.mp4' }).reason).toBe('ambiguous');
    store.clear(1);
    expect(store.match({ url: 'https://example.com/video.mp4' }).context?.cookie).toBe('session=2');
  });
});
