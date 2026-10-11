import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';

/**
 * Delivers a runtime message the way Chromium before 148 does: a listener's
 * return value only matters when it is `true`, and the reply comes from the
 * first `sendResponse` call. Promises returned by listeners are ignored.
 */
export async function sendRuntimeMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<unknown> {
  let respond!: (response: unknown) => void;
  const reply = new Promise<unknown>((resolve) => (respond = resolve));
  const trigger = fakeBrowser.runtime.onMessage.trigger as (
    ...args: unknown[]
  ) => Promise<unknown[]>;
  const results = await trigger(message, sender, respond);
  return results.includes(true) ? reply : undefined;
}
