import { describe, expect, it, vi } from 'vitest';
import { holdChromiumDownload } from '@/lib/download/chromium-takeover';
import { DownloadOrchestrator } from '@/lib/download/orchestrator';
import { ApiUnreachableError } from '@/lib/api';
import { downloadItem, downloadDeps } from '../fixtures/download';

describe('browser ownership during handoff', () => {
  it('holds filename selection until the desktop receipt arrives', async () => {
    const deps = downloadDeps();
    let accept!: () => void;
    vi.mocked(deps.desktopClient.addDownload).mockImplementation(async (request) => {
      await new Promise<void>((resolve) => {
        accept = resolve;
      });
      return { id: request.id, action: 'submitted', gid: 'original' };
    });
    const suggest = vi.fn();
    const errors = vi.fn();
    expect(
      holdChromiumDownload(
        () => new DownloadOrchestrator(deps).handleChromiumTakeover(downloadItem()),
        errors,
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(accept).toBeDefined());
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(suggest).not.toHaveBeenCalled();
    accept();
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
    expect(deps.downloads.cancel).toHaveBeenCalledWith(1);
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
