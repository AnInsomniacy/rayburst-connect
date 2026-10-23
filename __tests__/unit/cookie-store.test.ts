import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { tabCookieStoreId } from '@/lib/browser';

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
