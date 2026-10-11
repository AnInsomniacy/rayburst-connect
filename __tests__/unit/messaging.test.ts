import { describe, expect, it, vi } from 'vitest';
import { respondWith } from '@/lib/messaging';

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
