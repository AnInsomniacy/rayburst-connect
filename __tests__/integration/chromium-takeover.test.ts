import { describe, expect, it, vi } from 'vitest';
import { startChromiumTakeover, type ChromiumCancellation } from '@/lib/download/chromium-takeover';
import { DownloadOrchestrator } from '@/lib/download/orchestrator';
import { DEFAULT_DOWNLOAD_SETTINGS, type DownloadSettings } from '@/lib/schema';
import { downloadItem, downloadDeps } from '../fixtures/download';

const createDownloadItem = () =>
  downloadItem({
    finalUrl: 'https://cdn.example.com/file.zip',
    filenameSource: 'browser-determined',
  });

function createDeps(
  options: {
    settings?: DownloadSettings;
    ready?: boolean;
    activationResult?: boolean;
    routeFails?: boolean;
    cancellation?: Promise<void>;
  } = {},
) {
  const settings = options.settings ?? DEFAULT_DOWNLOAD_SETTINGS;
  const deps = downloadDeps({ getSettings: () => settings });
  vi.mocked(deps.desktopClient.isReady).mockResolvedValue(options.ready ?? true);
  if (options.routeFails)
    vi.mocked(deps.desktopClient.addDownload).mockRejectedValue(new Error('Connection lost'));
  vi.mocked(deps.activateDesktop).mockResolvedValue(options.activationResult ?? true);
  if (options.cancellation) vi.mocked(deps.downloads.cancel).mockReturnValue(options.cancellation);
  return deps;
}

describe('Chromium takeover', () => {
  it('issues cancellation before returning from the filename event turn', () => {
    const calls: string[] = [];
    const cancel = vi.fn(() => {
      calls.push('cancel');
      return Promise.resolve();
    });
    const continueTakeover = vi.fn(async () => {
      calls.push('continue');
    });

    expect(startChromiumTakeover(cancel, continueTakeover, vi.fn(), vi.fn())).toBe(true);
    expect(calls).toEqual(['cancel', 'continue']);
  });

  it('routes only after Chromium confirms cancellation', async () => {
    let finishCancellation: ((result: ChromiumCancellation) => void) | undefined;
    const cancellation = new Promise<ChromiumCancellation>((resolve) => {
      finishCancellation = resolve;
    });
    const deps = createDeps();
    const orchestrator = new DownloadOrchestrator(deps);
    const takeover = orchestrator.handleChromiumTakeover(createDownloadItem(), cancellation);

    expect(deps.desktopClient.addDownload).not.toHaveBeenCalled();
    finishCancellation?.({ ok: true });
    await expect(takeover).resolves.toBe(true);
    expect(deps.downloads.erase).toHaveBeenCalledWith({ id: 1 });
    expect(deps.desktopClient.addDownload).toHaveBeenCalledTimes(1);
    expect(deps.downloads.download).not.toHaveBeenCalled();
  });

  it('restarts a filtered download in Chrome', async () => {
    const settings = {
      ...DEFAULT_DOWNLOAD_SETTINGS,
      enabled: false,
    } satisfies DownloadSettings;
    const deps = createDeps({ settings });
    const orchestrator = new DownloadOrchestrator(deps);

    await expect(
      orchestrator.handleChromiumTakeover(createDownloadItem(), Promise.resolve({ ok: true })),
    ).resolves.toBe(false);
    expect(deps.downloads.download).toHaveBeenCalledWith({
      url: 'https://example.com/file.zip',
    });
    expect(deps.desktopClient.isReady).not.toHaveBeenCalled();
  });

  it('restores Chrome downloads across desktop availability and routing failures', async () => {
    const settings = {
      ...DEFAULT_DOWNLOAD_SETTINGS,
      desktopUnavailable: {
        ...DEFAULT_DOWNLOAD_SETTINGS.desktopUnavailable,
        action: 'browser' as const,
      },
    } satisfies DownloadSettings;
    for (const options of [
      { settings, ready: false },
      { settings, routeFails: true },
      { ready: false, activationResult: false },
      { routeFails: true },
    ]) {
      const deps = createDeps(options);
      const orchestrator = new DownloadOrchestrator(deps);
      await expect(
        orchestrator.handleChromiumTakeover(createDownloadItem(), Promise.resolve({ ok: true })),
      ).resolves.toBe(false);
      expect(deps.downloads.download).toHaveBeenCalledWith({
        url: 'https://example.com/file.zip',
      });
    }
  });
});

describe('filename callback ownership', () => {
  it('suppresses implicit suggestions after successful cancellation', async () => {
    const release = vi.fn();
    const error = vi.fn();
    let result: Promise<ChromiumCancellation> | undefined;
    const returned = startChromiumTakeover(
      () => Promise.resolve(),
      async (cancellation) => {
        result = cancellation;
      },
      error,
      release,
    );
    expect(returned).toBe(true);
    await expect(result).resolves.toEqual({ ok: true });
    expect(release).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('observes rejection while configuration is pending and releases the filename', async () => {
    const failure = new Error('Cancellation unavailable');
    const release = vi.fn();
    let continueSetup: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      continueSetup = resolve;
    });
    const outcomes: ChromiumCancellation[] = [];
    startChromiumTakeover(
      () => Promise.reject(failure),
      async (cancellation) => {
        await ready;
        outcomes.push(await cancellation);
      },
      vi.fn(),
      release,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(release).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([]);
    continueSetup?.();
    await ready;
    await Promise.resolve();
    expect(outcomes).toEqual([{ ok: false, error: failure }]);
  });
});
