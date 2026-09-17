import { createApp, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';
import { MEDIA_SESSION_KEY, type MediaCandidate } from '@/lib/schema';
import { usePopupNavigation } from '@/entrypoints/popup/use-navigation';
import { mediaCandidate } from '../fixtures/media';

let app: App | undefined;
let tabId: number;

function response(items: MediaCandidate[] = []) {
  return {
    ok: true,
    data: {
      enabled: true,
      excluded: false,
      host: 'example.com',
      items: items.map((item) => ({ ...item, hasRequestContext: false })),
    },
  };
}

function mount() {
  let navigation: ReturnType<typeof usePopupNavigation> | undefined;
  app = createApp({
    setup() {
      navigation = usePopupNavigation();
      return () => null;
    },
  });
  app.mount(document.createElement('div'));
  if (!navigation) throw new Error('Navigation was not mounted');
  return navigation;
}

async function publish(candidates: MediaCandidate[]) {
  await browser.storage.session.set({ [MEDIA_SESSION_KEY]: { candidates } });
}

beforeEach(async () => {
  fakeBrowser.reset();
  const tab = await browser.tabs.create({ url: 'https://example.com/watch', active: true });
  if (tab.id === undefined) throw new Error('Missing test tab');
  tabId = tab.id;
  vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [tab]);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
});

describe('popup navigation', () => {
  it('opens the sniffer for current-page resources, including resources already sent', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async () =>
      response([
        mediaCandidate({ tabId, sentToDesktop: true }),
        mediaCandidate({ tabId, kind: 'fragment' }),
        mediaCandidate({ tabId, kind: 'embedded' }),
        mediaCandidate({ tabId: tabId + 1 }),
      ]),
    );
    const navigation = mount();
    expect(navigation.ready.value).toBe(false);
    await vi.waitFor(() => expect(navigation.ready.value).toBe(true));
    expect(navigation.view.value).toBe('media');
    expect(navigation.count.value).toBe(2);
  });

  it.each(['empty', 'player', 'other page'])('opens downloads for %s discoveries', async (kind) => {
    const items =
      kind === 'empty'
        ? []
        : [
            mediaCandidate({
              tabId: kind === 'player' ? tabId : tabId + 1,
              kind: kind === 'player' ? 'embedded' : 'hls',
            }),
          ];
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async () => response(items));
    const navigation = mount();
    await vi.waitFor(() => expect(navigation.ready.value).toBe(true));
    expect(navigation.view.value).toBe('downloads');
    expect(navigation.count.value).toBe(0);
  });

  it('updates the current-page count without changing the selected tab or polling', async () => {
    const message = vi
      .spyOn(browser.runtime, 'sendMessage')
      .mockImplementation(async () => response());
    const navigation = mount();
    await vi.waitFor(() => expect(navigation.ready.value).toBe(true));
    await publish([
      mediaCandidate({ tabId }),
      mediaCandidate({ tabId, kind: 'embedded' }),
      mediaCandidate({ tabId: tabId + 1 }),
    ]);
    await vi.waitFor(() => expect(navigation.count.value).toBe(1));
    expect(navigation.view.value).toBe('downloads');
    navigation.view.value = 'media';
    await publish([]);
    await vi.waitFor(() => expect(navigation.count.value).toBe(0));
    expect(navigation.view.value).toBe('media');
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer cache update when the initial list reply arrives late', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof response>>();
    const message = vi
      .spyOn(browser.runtime, 'sendMessage')
      .mockImplementation(() => pending.promise);
    const navigation = mount();
    await vi.waitFor(() => expect(message).toHaveBeenCalled());
    await publish([mediaCandidate({ tabId })]);
    await vi.waitFor(() => expect(navigation.count.value).toBe(1));
    pending.resolve(response());
    await vi.waitFor(() => expect(navigation.ready.value).toBe(true));
    expect(navigation.count.value).toBe(1);
    expect(navigation.view.value).toBe('media');
  });

  it('opens downloads on browser pages without requesting discovery', async () => {
    vi.mocked(browser.tabs.query).mockImplementation(async () => [
      {
        id: tabId,
        url: 'chrome://extensions',
        index: 0,
        active: true,
        pinned: false,
        highlighted: true,
        incognito: false,
        windowId: 1,
      },
    ]);
    const message = vi.spyOn(browser.runtime, 'sendMessage');
    const navigation = mount();
    await vi.waitFor(() => expect(navigation.ready.value).toBe(true));
    expect(navigation.view.value).toBe('downloads');
    expect(message).not.toHaveBeenCalled();
  });

  it('leaves downloads accessible if the discovery request fails', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue(new Error('Worker unavailable'));
    const navigation = mount();
    await vi.waitFor(() => expect(navigation.ready.value).toBe(true));
    expect(navigation.view.value).toBe('downloads');
  });

  it('stops receiving changes after the popup closes during initialization', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof response>>();
    const message = vi
      .spyOn(browser.runtime, 'sendMessage')
      .mockImplementation(() => pending.promise);
    const navigation = mount();
    await vi.waitFor(() => expect(message).toHaveBeenCalled());
    app?.unmount();
    app = undefined;
    await publish([mediaCandidate({ tabId })]);
    pending.resolve(response([mediaCandidate({ tabId })]));
    await pending.promise;
    expect(navigation.ready.value).toBe(false);
    expect(navigation.count.value).toBe(0);
  });
});
