import { describe, expect, it, vi } from 'vitest';
import { DownloadOrchestrator } from '@/lib/download/orchestrator';
import { ApiUnreachableError } from '@/lib/api';
import { createDefaultSnapshot } from '@/lib/schema';
import { downloadItem as createDownloadItem, downloadDeps } from '../fixtures/download';

function createDeps(
  options: {
    action?: 'launch' | 'browser';
    ready?: boolean;
    activationResult?: boolean;
    activationFails?: boolean;
    routeFails?: boolean;
    calls?: string[];
  } = {},
) {
  const settings = createDefaultSnapshot().settings;
  settings.desktopUnavailable.action = options.action ?? 'browser';
  const deps = downloadDeps({ getSettings: () => settings });
  vi.mocked(deps.desktopClient.isReady).mockResolvedValue(options.ready ?? false);
  vi.mocked(deps.desktopClient.addDownload).mockImplementation(async () => {
    if (options.routeFails || !(options.ready || options.activationResult))
      throw new ApiUnreachableError();
    options.calls?.push('route');
    return { id: 'request', action: 'needs-confirmation' };
  });
  vi.mocked(deps.downloads.cancel).mockImplementation(async () => {
    options.calls?.push('cancel');
  });
  vi.mocked(deps.activateDesktop).mockImplementation(async () => {
    options.calls?.push('activate');
    if (options.activationFails) throw new Error('Native host activation failed');
    return options.activationResult ?? false;
  });
  return deps;
}

describe('automatic download fallback', () => {
  it('leaves the browser download untouched when Rayburst is unavailable', async () => {
    const deps = createDeps();
    const orchestrator = new DownloadOrchestrator(deps);

    const intercepted = await orchestrator.handleFirefoxCreatedDownload(createDownloadItem());

    expect(intercepted).toBe(false);
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(deps.downloads.erase).not.toHaveBeenCalled();
    expect(deps.activateDesktop).not.toHaveBeenCalled();
    expect(deps.diagnosticLog.append).toHaveBeenCalledTimes(1);
    expect(deps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'download_restored_to_browser',
        context: expect.objectContaining({ mode: 'continued', reason: 'desktop-unavailable' }),
      }),
    );
  });

  it('intercepts normally in browser mode when Rayburst and its engine are ready', async () => {
    const calls: string[] = [];
    const deps = createDeps({ action: 'browser', ready: true, calls });
    const orchestrator = new DownloadOrchestrator(deps);

    const intercepted = await orchestrator.handleFirefoxCreatedDownload(createDownloadItem());

    expect(intercepted).toBe(true);
    expect(deps.desktopClient.isReady).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['route', 'cancel']);
    expect(deps.diagnosticLog.append).toHaveBeenCalledTimes(1);
    expect(deps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'download_delegated' }),
    );
  });

  it('waits for a desktop receipt before cancelling in launch mode', async () => {
    const calls: string[] = [];
    const deps = createDeps({
      action: 'launch',
      ready: true,
      activationResult: true,
      calls,
    });
    const orchestrator = new DownloadOrchestrator(deps);

    const intercepted = await orchestrator.handleFirefoxCreatedDownload(createDownloadItem());

    expect(intercepted).toBe(true);
    expect(calls).toEqual(['activate', 'route', 'cancel']);
  });

  it('waits for Firefox startup using the configured timeout before intercepting', async () => {
    const deps = createDeps({ action: 'launch', ready: false, activationResult: true });
    const orchestrator = new DownloadOrchestrator(deps);

    const intercepted = await orchestrator.handleFirefoxResponseTakeover(createDownloadItem());

    expect(intercepted).toBe(true);
    expect(deps.activateDesktop).toHaveBeenCalledWith(15_000);
    expect(deps.desktopClient.addDownload).toHaveBeenCalledTimes(1);
  });

  it('restores the browser download when desktop submission fails in launch mode', async () => {
    const deps = createDeps({
      action: 'launch',
      ready: true,
      activationResult: true,
      routeFails: true,
    });
    const orchestrator = new DownloadOrchestrator(deps);

    const intercepted = await orchestrator.handleFirefoxCreatedDownload(createDownloadItem());

    expect(intercepted).toBe(false);
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(deps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'download_restored_to_browser', level: 'warn' }),
    );
  });

  it('restores the browser download when desktop activation fails', async () => {
    const calls: string[] = [];
    const deps = createDeps({
      action: 'launch',
      ready: false,
      activationFails: true,
      calls,
    });
    const orchestrator = new DownloadOrchestrator(deps);

    const intercepted = await orchestrator.handleFirefoxCreatedDownload(createDownloadItem());

    expect(intercepted).toBe(false);
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(calls).toEqual(['activate']);
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
    expect(deps.diagnosticLog.append).toHaveBeenCalledTimes(1);
    expect(deps.diagnosticLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'download_restored_to_browser',
        level: 'warn',
        context: expect.objectContaining({ reason: 'desktop-activation-failed' }),
      }),
    );
  });

  it('restores a Firefox response when desktop startup times out', async () => {
    const deps = createDeps({ action: 'launch', ready: false, activationResult: false });
    const orchestrator = new DownloadOrchestrator(deps);

    expect(await orchestrator.handleFirefoxResponseTakeover(createDownloadItem())).toBe(false);

    expect(deps.activateDesktop).toHaveBeenCalledTimes(1);
    expect(deps.downloads.cancel).not.toHaveBeenCalled();
  });
});
