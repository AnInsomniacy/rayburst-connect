import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_CONNECTIVITY_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  ApiAuthError,
  ApiCompatibilityError,
  ApiDeliveryUncertainError,
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
    await browser.storage.session.clear();
    client = new DesktopApiClient({ port: 29110, secret: 'secret' });
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
        new Response(
          JSON.stringify({ product: 'rayburst', protocolVersion: 2, filenameHints: true }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'request', action: 'submitted', gid: 'gid' })),
      );
    const payload = {
      id: 'request',
      url: 'https://example.com/file.zip',
      finalUrl: 'https://cdn.example.com/file.zip',
      referer: 'https://example.com/page',
      cookie: 'sid=value',
      filename: 'file.zip',
      userAgent: 'Browser/1.0',
      requestHeaders: [{ name: 'Accept', value: 'application/octet-stream' }],
    };

    await expect(client.addDownload(payload)).resolves.toEqual({
      id: 'request',
      action: 'submitted',
      gid: 'gid',
    });
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
    await expect(
      client.addDownload({ id: 'isolated', url: 'https://example.test/file' }),
    ).rejects.toThrow();
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
      [
        () => client.addDownload({ id: 'request', url: 'https://example.com' }),
        { gid: 'missing-action' },
      ],
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
    await expect(
      client.addDownload({ id: 'request', url: 'https://example.com/file.zip' }),
    ).rejects.toThrow('HTTP 409 — Download rejected');
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

    void client.addDownload({ id: 'request', url: 'https://example.com' }).catch(() => {});
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
        new Response(
          JSON.stringify({ product: 'rayburst', protocolVersion: 2, filenameHints: true }),
        ),
      )
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));

    await expect(client.isReady()).resolves.toBe(true);
    await expect(client.isReady()).resolves.toBe(false);
  });
  it('reconciles a lost receipt after worker restart only against the original connection', async () => {
    const payload = { id: 'durable', url: 'https://example.test/file', filename: 'literal%20.zip' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if ((input as Request).url.endsWith('/capabilities'))
        return new Response(
          JSON.stringify({ product: 'rayburst', protocolVersion: 2, filenameHints: true }),
        );
      throw new TypeError('reply lost');
    });
    await expect(client.addDownload(payload)).rejects.toBeInstanceOf(ApiDeliveryUncertainError);
    expect(await new DesktopApiClient({ port: 29111, secret: 'secret' }).reconcileDownloads()).toBe(
      0,
    );
    fetchMock.mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            (input as Request).url.endsWith('/capabilities')
              ? { product: 'rayburst', protocolVersion: 2, filenameHints: true }
              : { id: 'durable', action: 'submitted', gid: 'original' },
          ),
        ),
    );
    expect(await new DesktopApiClient({ port: 29110, secret: 'secret' }).reconcileDownloads()).toBe(
      0,
    );
    const replay = fetchMock.mock.calls.at(-1)?.[0] as Request;
    await expect(jsonBody(replay)).resolves.toEqual(payload);
    expect(await browser.storage.session.get(null)).toEqual({});
  });
});
