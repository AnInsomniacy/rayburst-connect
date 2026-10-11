/**
 * Downloads the user hands to the browser by holding Alt while clicking.
 *
 * Browser download items carry no tab, so a click is matched by the link it
 * hit. A click outside a link (a script-started download) matches any
 * download that begins within the window.
 */
export const BYPASS_WINDOW_MS = 5000;
const MAX_ENTRIES = 16;

interface Entry {
  url: string;
  until: number;
}

export class BrowserBypass {
  private entries: Entry[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Records an Alt-click; `url` is the clicked link, or empty. */
  add(url: string): void {
    const now = this.now();
    this.entries = [
      ...this.entries.filter((entry) => entry.until > now),
      { url, until: now + BYPASS_WINDOW_MS },
    ].slice(-MAX_ENTRIES);
  }

  /** Whether a download at any of `urls` should stay with the browser. */
  matches(urls: string[]): boolean {
    const now = this.now();
    this.entries = this.entries.filter((entry) => entry.until > now);
    return this.entries.some((entry) => !entry.url || urls.includes(entry.url));
  }
}

/** The message a content script sends for an Alt-click; null for anything else. */
export function parseBypassMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (record.type !== 'BYPASS_DOWNLOAD' || typeof record.url !== 'string') return null;
  if (!record.url) return '';
  try {
    const { protocol } = new URL(record.url);
    return protocol === 'http:' || protocol === 'https:' ? record.url : null;
  } catch {
    return null;
  }
}
