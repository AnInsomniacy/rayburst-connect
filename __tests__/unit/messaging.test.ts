import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { respondWith, sendToTab } from '@/lib/messaging';

const sender = { id: 'extension' };

describe('respondWith', () => {
  it('keeps the channel open and replies through sendResponse', async () => {
    const sendResponse = vi.fn();
    const listener = respondWith(async () => ({ ok: true }));
    expect(listener({}, sender, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  it('reports a rejected handler as a failed response', async () => {
    const sendResponse = vi.fn();
    const listener = respondWith(async () => {
      throw new Error('desktop unavailable');
    });
    expect(listener({}, sender, sendResponse)).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'desktop unavailable' }),
    );
  });

  it('leaves unhandled messages to other listeners', () => {
    const sendResponse = vi.fn();
    expect(respondWith(() => undefined)({}, sender, sendResponse)).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('sendToTab', () => {
  afterEach(() => vi.restoreAllMocks());

  it('injects the content script into a tab opened before the extension, then delivers', async () => {
    const send = vi
      .spyOn(browser.tabs, 'sendMessage')
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce(undefined);
    const inject = vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue(undefined);
    await sendToTab(7, { type: 'MEDIA_RESCAN' });
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 7, allFrames: true },
      files: ['/content-scripts/content.js'],
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never injects a second copy when the script answered with a failure', async () => {
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('player gone'));
    const inject = vi.spyOn(browser.scripting, 'executeScript');
    await expect(sendToTab(7, { type: 'MEDIA_PLAYER' }, 0)).rejects.toThrow('player gone');
    expect(inject).not.toHaveBeenCalled();
  });
});
