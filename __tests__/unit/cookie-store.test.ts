import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { partitionedTabCookies, tabCookieStoreId } from '@/lib/browser';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tab cookie store', () => {
  it('finds the store of a private or container tab', async () => {
    const stores: Browser.cookies.CookieStore[] = [
      { id: '0', tabIds: [1, 2] },
      { id: '1', tabIds: [7] },
    ];
    // The callback overload types the spy as returning void.
    vi.spyOn(browser.cookies, 'getAllCookieStores').mockResolvedValue(stores as never);
    expect(await tabCookieStoreId(7)).toBe('1');
    expect(await tabCookieStoreId(2)).toBe('0');
    expect(await tabCookieStoreId(9)).toBeUndefined();
  });

  it('does not look up requests without a tab', async () => {
    const getStores = vi.spyOn(browser.cookies, 'getAllCookieStores');
    expect(await tabCookieStoreId(undefined)).toBeUndefined();
    expect(await tabCookieStoreId(-1)).toBeUndefined();
    expect(getStores).not.toHaveBeenCalled();
  });
});

describe('partitioned tab cookies', () => {
  const cookie = (name: string, path: string) => ({ name, path }) as Browser.cookies.Cookie;
  // The test browser does not implement Chromium's partition lookup.
  const cookies = browser.cookies as { getPartitionKey?: unknown };
  const stubPartitionKey = (lookup: () => Promise<unknown>) => {
    cookies.getPartitionKey = vi.fn(lookup);
  };
  afterEach(() => {
    delete cookies.getPartitionKey;
  });

  it('adds the cookies partitioned under the tab, longest path first', async () => {
    stubPartitionKey(async () => ({ partitionKey: { topLevelSite: 'https://site.example' } }));
    const getAll = vi
      .spyOn(browser.cookies, 'getAll')
      .mockImplementation((async (details: Browser.cookies.GetAllDetails) =>
        details.partitionKey
          ? [cookie('partitioned', '/files/')]
          : [cookie('ordinary', '/')]) as never);
    const found = await partitionedTabCookies(
      { url: 'https://cdn.example/a.zip' },
      { tabId: 3, frameId: 0 },
    );
    expect(found.map((item) => item.name)).toEqual(['partitioned', 'ordinary']);
    expect(getAll).toHaveBeenCalledWith({
      url: 'https://cdn.example/a.zip',
      partitionKey: { topLevelSite: 'https://site.example' },
    });
  });

  it('keeps the ordinary cookies when the tab has no usable partition', async () => {
    stubPartitionKey(async () => {
      throw new Error('PartitionKey requested is not serializable.');
    });
    vi.spyOn(browser.cookies, 'getAll').mockResolvedValue([cookie('ordinary', '/')] as never);
    const found = await partitionedTabCookies({ url: 'https://cdn.example/a.zip' }, { tabId: 3 });
    expect(found.map((item) => item.name)).toEqual(['ordinary']);
  });

  it('keeps the ordinary cookies when the partition is not readable', async () => {
    stubPartitionKey(async () => ({ partitionKey: { topLevelSite: 'chrome-extension://other' } }));
    vi.spyOn(browser.cookies, 'getAll').mockImplementation((async (
      details: Browser.cookies.GetAllDetails,
    ) => {
      if (details.partitionKey) throw new Error('No host permissions for cookies');
      return [cookie('ordinary', '/')];
    }) as never);
    const found = await partitionedTabCookies({ url: 'https://cdn.example/a.zip' }, { tabId: 3 });
    expect(found.map((item) => item.name)).toEqual(['ordinary']);
  });
});
