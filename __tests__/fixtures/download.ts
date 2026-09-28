import { vi } from 'vitest';
import { DesktopApiClient } from '@/lib/api';
import { DuplicateDownloadGuard } from '@/lib/download/duplicate-guard';
import type { DownloadItem, OrchestratorDeps } from '@/lib/download/orchestrator';
import { createDefaultSnapshot } from '@/lib/schema';

export function downloadItem(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 1,
    url: 'https://example.com/file.zip',
    finalUrl: 'https://example.com/file.zip',
    filename: 'file.zip',
    fileSize: 10_000_000,
    totalBytes: 10_000_000,
    mime: 'application/zip',
    state: 'in_progress',
    referrer: 'https://example.com/page',
    ...overrides,
  };
}

export function downloadDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const snapshot = createDefaultSnapshot();
  const desktopClient = new DesktopApiClient(snapshot.connection);
  vi.spyOn(desktopClient, 'isReady').mockResolvedValue(true);
  vi.spyOn(desktopClient, 'addDownload').mockResolvedValue({
    id: 'request',
    action: 'needs-confirmation',
  });
  return {
    downloads: {
      cancel: vi.fn().mockResolvedValue(undefined),
      erase: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
    },
    diagnosticLog: { append: vi.fn() },
    cookies: { getAll: vi.fn().mockResolvedValue([]) },
    onDuplicateBlocked: vi.fn(),
    getSettings: () => snapshot.settings,
    getSiteRules: () => snapshot.siteRules,
    duplicateGuard: new DuplicateDownloadGuard(),
    desktopClient,
    activateDesktop: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}
