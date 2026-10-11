import type { Browser } from 'wxt/browser';

/** Handles one runtime message; `undefined` leaves it for another listener. */
export type MessageHandler = (
  message: unknown,
  sender: Browser.runtime.MessageSender,
) => Promise<unknown> | undefined;

/**
 * Adapts an asynchronous handler to the response callback every supported
 * browser implements. Chromium honors promises returned from onMessage
 * listeners only from version 148; earlier Chromium browsers resolve the
 * sender with `undefined`. Keeping the channel open with `true` and replying
 * through `sendResponse` works everywhere.
 */
export function respondWith(handler: MessageHandler) {
  return (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): true | undefined => {
    const result = handler(message, sender);
    if (!result) return undefined;
    result.then(sendResponse, (error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  };
}
