import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  loadSnapshot,
  saveSnapshot,
  updateMediaSettings,
  updateSettings,
  saveConnectionConfig,
} from '@/lib/storage';
import { createDefaultSnapshot, parseMediaSettings } from '@/lib/schema';
beforeEach(() => fakeBrowser.reset());
describe('media settings ownership', () => {
  it('retains concurrent edits across independent settings writers', async () => {
    await saveSnapshot(createDefaultSnapshot());
    await Promise.all([
      updateSettings({ enabled: false }),
      updateMediaSettings({ newestFirst: true }),
      updateMediaSettings({ quickDownload: false }),
    ]);
    const value = await loadSnapshot();
    expect(value.settings.enabled).toBe(false);
    expect(value.settings.mediaDiscovery).toMatchObject({
      newestFirst: true,
      quickDownload: false,
    });
  });
  it('resets only media defaults and preserves connection and interception', async () => {
    await saveConnectionConfig({ port: 29999, secret: 'test-key' });
    await updateSettings({ enabled: false });
    await updateMediaSettings({ enabled: false, excludedHosts: ['example.com'] });
    await updateMediaSettings(parseMediaSettings({}));
    const value = await loadSnapshot();
    expect(value.connection).toEqual({ port: 29999, secret: 'test-key' });
    expect(value.settings.enabled).toBe(false);
    expect(value.settings.mediaDiscovery).toEqual(parseMediaSettings({}));
  });
});
