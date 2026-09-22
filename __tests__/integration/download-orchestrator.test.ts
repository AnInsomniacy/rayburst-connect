import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAuthError, ApiCompatibilityError, ApiDeliveryUncertainError } from '@/lib/api';
import { DownloadOrchestrator, type OrchestratorDeps } from '@/lib/download/orchestrator';
import type { RequestHeaderContext } from '@/lib/download/request-context';
import { DEFAULT_DOWNLOAD_SETTINGS } from '@/lib/schema';
import { downloadItem as item, downloadDeps as deps } from '../fixtures/download';

function desktopClient(ready = true) {
  const client = deps().desktopClient;
  vi.mocked(client.isReady).mockResolvedValue(ready);
  return client;
}

describe('DownloadOrchestrator', () => {
  let baseDeps: OrchestratorDeps;

  beforeEach(() => {
    baseDeps = deps();
  });

  it('ignores stale Firefox replay events without work or log noise', async () => {
    const orchestrator = new DownloadOrchestrator(baseDeps);

    await expect(
      orchestrator.handleFirefoxCreatedDownload(item({ state: 'complete' })),
    ).resolves.toBe(false);
    expect(baseDeps.downloads.cancel).not.toHaveBeenCalled();
    expect(baseDeps.diagnosticLog.append).not.toHaveBeenCalled();
  });

  it('routes claimed Firefox responses and recreates them after routing failure', async () => {
    const client = desktopClient(true);
    const add = vi
      .spyOn(client, 'addDownload')
      .mockResolvedValue({ id: 'request', action: 'needs-confirmation' });
    const successDeps = deps({ desktopClient: client });
    const success = new DownloadOrchestrator(successDeps);
    const candidate = (({ id: _id, state: _state, ...rest }) => rest)(item());

    await expect(success.handleFirefoxResponseTakeover(candidate)).resolves.toBe(true);
    expect(add).toHaveBeenCalledTimes(1);

    add.mockRejectedValue(new Error('offline'));
    const fallbackDeps = deps({ desktopClient: client });
    const fallback = new DownloadOrchestrator(fallbackDeps);
    await expect(fallback.handleFirefoxResponseTakeover(candidate)).resolves.toBe(false);
    expect(fallbackDeps.downloads.download).toHaveBeenCalledWith({ url: candidate.url });
    await expect(fallback.handleFirefoxCreatedDownload(item())).resolves.toBe(false);
    expect(fallbackDeps.downloads.cancel).not.toHaveBeenCalled();
  });

  it('forwards the complete authenticated request context without logging sensitive values', async () => {
    const client = desktopClient(true);
    const add = vi
      .spyOn(client, 'addDownload')
      .mockResolvedValue({ id: 'request', action: 'needs-confirmation' });
    const requestHeaderContext: RequestHeaderContext = {
      url: 'https://example.com/file.zip',
      createdAt: Date.now(),
      referer: 'https://example.com/page',
      userAgent: 'Browser/1.0',
      cookie: 'session=secret',
      requestHeaders: [{ name: 'Accept', value: 'application/zip' }],
    };
    const contextDeps = deps({ desktopClient: client });
    const orchestrator = new DownloadOrchestrator(contextDeps);

    await orchestrator.handleFirefoxCreatedDownload(
      item({ filename: 'archive.zip', requestHeaderContext }),
    );

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        cookie: 'session=secret',
        userAgent: 'Browser/1.0',
        requestHeaders: [{ name: 'Accept', value: 'application/zip' }],
        filename: 'archive.zip',
      }),
    );
    const event = vi.mocked(contextDeps.diagnosticLog.append).mock.calls.at(-1)?.[0];
    expect(event).toMatchObject({
      code: 'download_delegated',
      context: { hasCookie: true, headerCount: 1 },
    });
    expect(JSON.stringify(event)).not.toContain('session=secret');
  });

  it('forwards tentative browser names as suggestions', async () => {
    const client = desktopClient(true);
    const add = vi
      .spyOn(client, 'addDownload')
      .mockResolvedValue({ id: 'request', action: 'needs-confirmation' });
    const orchestrator = new DownloadOrchestrator(deps({ desktopClient: client }));

    await orchestrator.handleFirefoxCreatedDownload(
      item({
        url: 'https://example.com/download',
        finalUrl: 'https://example.com/download',
        filename: 'download',
      }),
    );

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'download', filenameSource: 'suggested' }),
    );
  });

  it('routes explicit HTTP and protocol URLs through the desktop API', async () => {
    const client = desktopClient(true);
    const add = vi
      .spyOn(client, 'addDownload')
      .mockResolvedValue({ id: 'request', action: 'needs-confirmation' });
    const orchestrator = new DownloadOrchestrator(deps({ desktopClient: client }));

    await orchestrator.sendUrl('https://example.com/file.zip', 'https://example.com', {
      source: 'context-menu',
    });
    await orchestrator.sendUrl('magnet:?xt=urn:btih:abc', '', {
      source: 'external-protocol',
    });

    expect(add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'https://example.com/file.zip',
        referer: 'https://example.com',
      }),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: expect.stringMatching(/^magnet:/) }),
    );
  });

  it('activates once and retries an explicit delivery', async () => {
    const client = desktopClient(false);
    const add = vi
      .spyOn(client, 'addDownload')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'request', action: 'needs-confirmation' });
    const activateDesktop = vi.fn().mockResolvedValue(true);
    const orchestrator = new DownloadOrchestrator(deps({ desktopClient: client, activateDesktop }));

    await orchestrator.sendUrl('https://example.com/file.zip', '', { source: 'context-menu' });

    expect(activateDesktop).toHaveBeenCalledWith(15_000);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new ApiAuthError(), 'api-auth-failed', 'api_auth_failed'],
    [new ApiCompatibilityError('3.9.9', true), 'api-incompatible', 'download_delivery_failed'],
  ])('does not activate after a permanent preflight failure: %s', async (error, reason, code) => {
    const client = desktopClient(true);
    vi.spyOn(client, 'addDownload').mockRejectedValue(error);
    const failureDeps = deps({ desktopClient: client });
    const orchestrator = new DownloadOrchestrator(failureDeps);
    await expect(
      orchestrator.sendUrl('https://example.com/file.zip', '', { source: 'context-menu' }),
    ).rejects.toThrow(reason);
    expect(failureDeps.activateDesktop).not.toHaveBeenCalled();
    expect(failureDeps.diagnosticLog.append).toHaveBeenCalledTimes(1);
    expect(failureDeps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ code, level: 'error' }),
    );
  });

  it('logs cookie degradation and continues without cookies', async () => {
    const client = desktopClient(true);
    const add = vi
      .spyOn(client, 'addDownload')
      .mockResolvedValue({ id: 'request', action: 'needs-confirmation' });
    const cookieDeps = deps({
      desktopClient: client,
      cookies: { getAll: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const orchestrator = new DownloadOrchestrator(cookieDeps);

    await orchestrator.handleFirefoxCreatedDownload(item());

    expect(add).toHaveBeenCalledWith(expect.not.objectContaining({ cookie: expect.anything() }));
    expect(cookieDeps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'cookie_collect_failed', level: 'warn' }),
    );
  });

  it('stops before routing when browser cancellation fails', async () => {
    const cancelDeps = deps({
      downloads: {
        cancel: vi.fn().mockRejectedValue(new Error('cancel failed')),
        erase: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue(2),
      },
    });
    const orchestrator = new DownloadOrchestrator(cancelDeps);

    await expect(orchestrator.handleFirefoxCreatedDownload(item())).resolves.toBe(false);
    expect(cancelDeps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'download_cancel_failed', level: 'warn' }),
    );
  });

  it('suppresses routine skip noise while retaining actionable rule skips', async () => {
    const quietDeps = deps({
      getSettings: () => ({
        ...structuredClone(DEFAULT_DOWNLOAD_SETTINGS),
        enabled: false,
      }),
    });
    await new DownloadOrchestrator(quietDeps).handleFirefoxCreatedDownload(item());
    expect(quietDeps.diagnosticLog.append).not.toHaveBeenCalled();

    const ruleDeps = deps({
      getSiteRules: () => [{ id: 'skip', pattern: 'example.com', action: 'always-skip' }],
    });
    await new DownloadOrchestrator(ruleDeps).handleFirefoxCreatedDownload(item());
    expect(ruleDeps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'download_skipped',
        context: expect.objectContaining({ stage: 'site-rule' }),
      }),
    );
  });
  it('replays an uncertain submission with one ID and does not duplicate it in the browser', async () => {
    const add = vi
      .mocked(baseDeps.desktopClient.addDownload)
      .mockRejectedValue(new ApiDeliveryUncertainError(new Error('reply lost')));
    const orchestrator = new DownloadOrchestrator(baseDeps);
    await expect(
      orchestrator.handleChromiumTakeover(item(), Promise.resolve({ ok: true })),
    ).resolves.toBe(true);
    expect(add).toHaveBeenCalledTimes(2);
    expect(new Set(add.mock.calls.map(([request]) => request.id)).size).toBe(1);
    expect(baseDeps.downloads.download).not.toHaveBeenCalled();
  });
});
