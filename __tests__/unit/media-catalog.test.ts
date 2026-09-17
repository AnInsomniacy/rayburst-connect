import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';
import { createMediaCatalog } from '@/lib/media/catalog';
import {
  MEDIA_MAX_PER_TAB,
  MEDIA_RETENTION_MS,
  MEDIA_SESSION_KEY,
  parseDownloadSettings,
} from '@/lib/schema';
import { mediaCandidate } from '../fixtures/media';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('media session ownership', () => {
  it('keeps network credentials when an inline playlist arrives in the same batch', async () => {
    const catalog = createMediaCatalog();
    const first = mediaCandidate({
      context: {
        url: 'https://example.com/stream',
        capturedAt: Date.now(),
        headers: [{ name: 'authorization', value: 'Bearer scoped' }],
      },
    });
    const input = { manifests: [{ url: first.url, content: '#EXTM3U\n' }], tracks: [], keys: [] };
    await Promise.all([
      catalog.observe(first),
      catalog.observe({
        ...first,
        id: crypto.randomUUID(),
        evidence: 'script',
        context: undefined,
        input,
      }),
    ]);
    expect(await catalog.run((state) => state.candidates)).toEqual([{ ...first, input }]);
  });
  it('does not resurrect observations after a clear races the capture batch', async () => {
    const catalog = createMediaCatalog();
    const item = mediaCandidate();
    await Promise.all([catalog.observe(item), catalog.remove(item.tabId)]);
    expect(await catalog.run((state) => state.candidates)).toEqual([]);
  });
  it('keeps distinct blob hints for multiple players in the same frame', async () => {
    const catalog = createMediaCatalog();
    await catalog.observe(
      mediaCandidate({ kind: 'embedded', url: 'blob:https://example.com/one' }),
    );
    await catalog.observe(
      mediaCandidate({ kind: 'embedded', url: 'blob:https://example.com/two' }),
    );
    expect(await catalog.run((state) => state.candidates.map((item) => item.url).sort())).toEqual([
      'blob:https://example.com/one',
      'blob:https://example.com/two',
    ]);
  });
  it('merges duplicate hints without losing captured credentials or stable identity', async () => {
    const catalog = createMediaCatalog();
    const first = mediaCandidate({
      context: {
        url: 'https://cdn.example.com/master.m3u8?token=secret',
        capturedAt: Date.now(),
        headers: [{ name: 'cookie', value: 'private' }],
      },
    });
    await Promise.all([
      catalog.observe(first),
      catalog.observe({
        ...first,
        id: crypto.randomUUID(),
        evidence: 'resource',
        mime: '',
        context: undefined,
      }),
    ]);
    const restored = createMediaCatalog();
    expect(await restored.run((state) => state.candidates)).toEqual([first]);
    expect((await browser.storage.local.get(null))[MEDIA_SESSION_KEY]).toBeUndefined();
  });
  it('bounds each tab and expires inactive sources while preserving other tabs', async () => {
    const catalog = createMediaCatalog();
    const other = mediaCandidate({ tabId: 2 });
    await catalog.observe(other);
    await catalog.run((state) => {
      for (let i = 0; i <= MEDIA_MAX_PER_TAB; i++)
        state.candidates.push(
          mediaCandidate({ url: `https://example.com/${i}.mp4`, lastSeen: Date.now() + i }),
        );
      state.candidates.push(
        mediaCandidate({ tabId: 3, lastSeen: Date.now() - MEDIA_RETENTION_MS - 1 }),
      );
    }, true);
    expect(
      await catalog.run((state) => state.candidates.filter((item) => item.tabId === 1).length),
    ).toBe(MEDIA_MAX_PER_TAB);
    expect(await catalog.run((state) => state.candidates.some((item) => item.tabId === 3))).toBe(
      false,
    );
    await catalog.remove(1);
    expect(await catalog.run((state) => state.candidates)).toEqual([other]);
  });
  it('does not commit failed storage writes and recovers a corrupt session', async () => {
    await browser.storage.session.set({ [MEDIA_SESSION_KEY]: { candidates: 'bad' } });
    const catalog = createMediaCatalog();
    const write = vi
      .spyOn(browser.storage.session, 'set')
      .mockRejectedValueOnce(new Error('quota'));
    await expect(catalog.observe(mediaCandidate())).rejects.toThrow('quota');
    expect(await catalog.run((state) => state.candidates)).toEqual([]);
    write.mockRestore();
    await catalog.observe(mediaCandidate());
    expect(await catalog.run((state) => state.candidates)).toHaveLength(1);
  });
  it('repairs media settings without changing download interception preferences', () => {
    expect(
      parseDownloadSettings({
        enabled: false,
        mediaDiscovery: { enabled: 'invalid', excludedHosts: ['example.com'] },
      }),
    ).toMatchObject({
      enabled: false,
      mediaDiscovery: { enabled: true, excludedHosts: ['example.com'] },
    });
  });
});
