import { describe, expect, it, vi } from 'vitest';
import { holdChromiumDownload } from '@/lib/download/chromium-takeover';
import { DownloadOrchestrator } from '@/lib/download/orchestrator';
import { ApiUnreachableError } from '@/lib/api';
import { downloadItem, downloadDeps } from '../fixtures/download';

describe('browser ownership during handoff', () => {
  it('holds filename selection until the desktop answers', async () => {
    const deps = downloadDeps();
    let accept!: () => void;
    vi.mocked(deps.desktopClient.addDownload).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        accept = resolve;
      });
      return { action: 'added', gid: 'original' };
    });
    const suggest = vi.fn();
    const errors = vi.fn();
    let handoff!: Promise<boolean>;
    expect(
      holdChromiumDownload(
        () => (handoff = new DownloadOrchestrator(deps).handleChromiumTakeover(downloadItem())),
        errors,
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(accept).toBeDefined());
    // The browser must not download while the desktop dialog waits.
    expect(deps.downloads.pause).toHaveBeenCalledWith(1);
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(suggest).not.toHaveBeenCalled();
    accept();
    await expect(handoff).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.downloads.cancel).toHaveBeenCalledWith(1);
    expect(deps.downloads.resume).not.toHaveBeenCalled();
    // The cancelled item no longer exists, so it gets no filename.
    expect(suggest).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('releases the original browser request after a definite failure', async () => {
    const deps = downloadDeps();
    vi.mocked(deps.desktopClient.addDownload).mockRejectedValue(new ApiUnreachableError());
    const suggest = vi.fn();
    holdChromiumDownload(
      () => new DownloadOrchestrator(deps).handleChromiumTakeover(downloadItem()),
      vi.fn(),
      suggest,
    );
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(deps.downloads.resume).toHaveBeenCalledWith(1);
  });

  it('hands over an unpaused download when the browser refuses to pause', async () => {
    const deps = downloadDeps();
    vi.mocked(deps.downloads.pause).mockRejectedValue(new Error('not in progress'));
    const suggest = vi.fn();
    holdChromiumDownload(
      () => new DownloadOrchestrator(deps).handleChromiumTakeover(downloadItem()),
      vi.fn(),
      suggest,
    );
    await vi.waitFor(() => expect(deps.downloads.cancel).toHaveBeenCalledWith(1));
    expect(deps.downloads.resume).not.toHaveBeenCalled();
    expect(deps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'download_pause_failed', level: 'warn' }),
    );
  });

  it('releases filename selection even if setup throws', async () => {
    const failure = new Error('Setup failed');
    const suggest = vi.fn();
    const errors = vi.fn();
    holdChromiumDownload(
      async () => {
        throw failure;
      },
      errors,
      suggest,
    );
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
    expect(errors).toHaveBeenCalledWith(failure);
  });
});
