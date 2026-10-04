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
