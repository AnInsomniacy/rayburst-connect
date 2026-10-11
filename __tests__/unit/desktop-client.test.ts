import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import {
  API_CONNECTIVITY_TIMEOUT_MS,
  API_HANDOFF_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  ApiAuthError,
  ApiCompatibilityError,
  ApiEngineError,
  checkConnection,
  ApiUnreachableError,
  DesktopApiClient,
} from '@/lib/api';

const stat = {
  downloadSpeed: '0',
  uploadSpeed: '0',
  numActive: '0',
  numWaiting: '0',
  numStopped: '0',
  numStoppedTotal: '0',
};

function requestAt(index = 0): Request {
  const input = vi.mocked(fetch).mock.calls[index]?.[0];
  expect(input).toBeInstanceOf(Request);
  return input as Request;
}

async function jsonBody(request: Request): Promise<unknown> {
  return JSON.parse(await request.clone().text());
}

describe('DesktopApiClient', () => {
  let client: DesktopApiClient;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await browser.storage.local.clear();
    client = new DesktopApiClient({ port: 29110, secret: 'secret' });
  });

  it('preserves the desktop version when its engine is unavailable', async () => {
    const result = await checkConnection({
      ping: async () => ({ product: 'rayburst', status: 'ok', version: '4.0.0' }),
      getStat: async () => {
        throw new ApiEngineError('engine_unavailable');
      },
      getDownloadCapabilities: vi.fn(),
    });
    expect(result).toEqual({
      status: 'disconnected',
      version: '4.0.0',
      error: 'ApiEngineUnavailableError',
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'engine_starting' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(client.checkReady()).rejects.toThrow();
    await expect(client.getDownloadCapabilities()).rejects.toMatchObject({
      name: 'ApiEngineStartingError',
    });
  });

  it('identifies the unsupported legacy desktop without treating malformed responses as legacy', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', version: '3.9.9' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })))
      .mockResolvedValueOnce(new Response('Missing endpoint', { status: 404 }));
    await expect(client.ping()).rejects.toMatchObject({
      name: 'MotrixNextUnsupportedError',
      version: '3.9.9',
    });
    await expect(client.ping()).rejects.not.toBeInstanceOf(ApiCompatibilityError);
    await expect(client.getDownloadCapabilities()).rejects.toBeInstanceOf(ApiCompatibilityError);
    expect(vi.mocked(fetch).mock.calls.every((_, index) => requestAt(index).method === 'GET')).toBe(
      true,
    );
  });

  it('uses the configured port and keeps ping unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ product: 'rayburst', status: 'ok', version: '1.0.0' })),
    );

    await client.ping();
    client.updateConfig({ port: 12345, secret: 'new-secret' });
    await client.ping();

    expect(requestAt(0).url).toBe('http://127.0.0.1:29110/ping');
    expect(requestAt(0).headers.get('authorization')).toBeNull();
    expect(requestAt(1).url).toBe('http://127.0.0.1:12345/ping');
  });

  it('submits the complete download contract with bearer authentication', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ product: 'rayburst', protocolVersion: 3 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ action: 'added', gid: 'gid' })));
    const payload = {
      url: 'https://example.com/file.zip',
      finalUrl: 'https://cdn.example.com/file.zip',
      referer: 'https://example.com/page',
      cookie: 'sid=value',
      filename: 'file.zip',
      userAgent: 'Browser/1.0',
      requestHeaders: [{ name: 'Accept', value: 'application/octet-stream' }],
      verify: true,
      mime: 'application/zip',
      size: 1000,
    };

    await expect(client.addDownload(payload)).resolves.toEqual({ action: 'added', gid: 'gid' });
    expect(requestAt(1).url).toBe('http://127.0.0.1:29110/add');
    expect(requestAt(1).method).toBe('POST');
    expect(requestAt(1).headers.get('authorization')).toBe('Bearer secret');
    await expect(jsonBody(requestAt(1))).resolves.toEqual(payload);
  });

  it('rejects another product before submitting a download', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          product: 'another-product',
          protocolVersion: 2,
          filenameHints: true,
        }),
      ),
    );
    await expect(client.addDownload({ url: 'https://example.test/file' })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestAt(0).method).toBe('GET');
  });

  it('uses the authenticated stat and task-control endpoints', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify((input as Request).url.endsWith('/stat') ? stat : { status: 'ok' }),
        ),
    );

    await client.getStat();
    await client.pauseAll();
    await client.resumeAll();

    expect(vi.mocked(fetch).mock.calls.map((_, index) => requestAt(index).url)).toEqual([
      'http://127.0.0.1:29110/stat',
      'http://127.0.0.1:29110/pause-all',
      'http://127.0.0.1:29110/resume-all',
    ]);
    expect(requestAt(1).method).toBe('POST');
  });

  it('rejects malformed desktop responses at the API boundary', async () => {
    for (const [call, payload] of [
      [() => client.ping(), { status: 'ok' }],
      [() => client.getStat(), { downloadSpeed: '0' }],
      [() => client.addDownload({ url: 'https://example.com' }), { gid: 'missing-action' }],
    ] as const) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(payload)));
      await expect(call()).rejects.toThrow();
      vi.restoreAllMocks();
    }
  });

  it('classifies transport failures and preserves parsed HTTP error details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );
    await expect(client.getStat()).rejects.toBeInstanceOf(ApiAuthError);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.ping()).rejects.toBeInstanceOf(ApiUnreachableError);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Download rejected', { status: 409 }),
    );
    await expect(client.addDownload({ url: 'https://example.com/file.zip' })).rejects.toThrow(
      'HTTP 409 — Download rejected',
    );
  });

  it('uses short readiness timeouts and longer work-request timeouts', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      signals.push((input as Request).signal);
      return new Promise<Response>(() => {});
    });

    void client.ping().catch(() => {});
    await vi.advanceTimersByTimeAsync(API_CONNECTIVITY_TIMEOUT_MS);
    expect(signals[0]?.aborted).toBe(true);

    void client.getStat().catch(() => {});
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    expect(signals[1]?.aborted).toBe(true);
  });

  it('reports readiness without throwing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ product: 'rayburst', status: 'ok', version: '1.0.0' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(stat)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ product: 'rayburst', protocolVersion: 3 })),
      )
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));

    await expect(client.isReady()).resolves.toBe(true);
    await expect(client.isReady()).resolves.toBe(false);
  });
  it('waits for the desktop to verify or confirm a handoff', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const request = input as Request;
      if (request.url.endsWith('/capabilities'))
        return new Response(JSON.stringify({ product: 'rayburst', protocolVersion: 3 }));
      signals.push(request.signal);
      return new Promise<Response>(() => {});
    });
    const awake = vi
      .spyOn(browser.runtime, 'getPlatformInfo')
      .mockImplementation(
        async () => ({ os: 'win', arch: 'x86-64' }) as Browser.runtime.PlatformInfo,
      );
    void client.addDownload({ url: 'https://example.com/file.zip' }).catch(() => {});
    await vi.advanceTimersByTimeAsync(API_HANDOFF_TIMEOUT_MS - 1000);
    expect(signals[0]?.aborted).toBe(false);
    // The worker stays alive while the browser download is held.
    expect(awake.mock.calls.length).toBeGreaterThanOrEqual(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('pins the connection through a settings change', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if ((input as Request).url.endsWith('/capabilities')) {
        await gate;
        return new Response(JSON.stringify({ product: 'rayburst', protocolVersion: 3 }));
      }
      return new Response(JSON.stringify({ action: 'added', gid: 'owned' }));
    });
    const delivery = client.addDownload({ url: 'https://example.test/file.zip' });
    client.updateConfig({ port: 29111, secret: 'changed' });
    release();
    await delivery;
    expect(requestAt(1).url).toBe('http://127.0.0.1:29110/add');
    expect(requestAt(1).headers.get('Authorization')).toBe('Bearer secret');
    expect(await browser.storage.local.get(null)).toEqual({});
  });

  it('lists tasks and controls one task', async () => {
    const task = {
      gid: 'a1',
      name: 'file.zip',
      status: 'active',
      totalLength: '100',
      completedLength: '50',
      downloadSpeed: '10',
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ stat, tasks: [task] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })));
    await expect(client.getTasks()).resolves.toEqual({ stat, tasks: [task] });
    await client.pauseTask('a1');
    await client.resumeTask('a1');
    expect(requestAt(0).url).toBe('http://127.0.0.1:29110/tasks');
    expect(requestAt(1).url).toBe('http://127.0.0.1:29110/tasks/a1/pause');
    expect(requestAt(2).url).toBe('http://127.0.0.1:29110/tasks/a1/resume');
    expect(requestAt(2).headers.get('authorization')).toBe('Bearer secret');
  });
});
