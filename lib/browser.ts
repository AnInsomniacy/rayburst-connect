/**
 * Thin, typed helpers over `browser.*` APIs: permissions, context
 * menu definitions, notifications, and external protocol links.
 */
import { browser, type Browser } from 'wxt/browser';
import type { InterceptionScope } from './schema';

// ─── Permissions ───────────────────────────────

const COOKIE_FORWARDING_PERMISSION: Browser.permissions.Permissions = {
  permissions: ['cookies'],
  origins: ['https://*/*', 'http://*/*'],
};

const DOWNLOAD_UI_PERMISSION: Browser.permissions.Permissions = {
  permissions: ['downloads.ui'],
};

export const hasCookieForwardingAccess = (): Promise<boolean> =>
  browser.permissions.contains(COOKIE_FORWARDING_PERMISSION);

export const hasDownloadUiAccess = (): Promise<boolean> =>
  browser.permissions.contains(DOWNLOAD_UI_PERMISSION);

export const requestDownloadUiAccess = (): Promise<boolean> =>
  browser.permissions.request(DOWNLOAD_UI_PERMISSION);

// ─── Cookies ───────────────────────────────────────────

/**
 * The cookie store a tab reads from. A private window or a Firefox container
 * has its own; `undefined` when the tab is unknown or already gone.
 */
export async function tabCookieStoreId(tabId: number | undefined): Promise<string | undefined> {
  if (tabId === undefined || tabId < 0) return undefined;
  const stores = await browser.cookies.getAllCookieStores();
  return stores.find((store) => store.tabIds.includes(tabId))?.id;
}

// ─── Context Menu ───────────────────────────────────────

export const CONTEXT_MENU_ID = 'download-with-rayburst';
export const CONTEXT_MENU_CONTEXTS = ['link', 'image', 'audio', 'video'] as const;

/**
 * Extract the downloadable URL from context menu click info.
 * Prefers the link target, falls back to the media source.
 */
export function extractContextMenuUrl(info: { linkUrl?: string; srcUrl?: string }): string | null {
  return info.linkUrl ?? info.srcUrl ?? null;
}

// ─── Notifications ──────────────────────────────────────

export function buildDuplicateDownloadNotification(title: string, message: string) {
  return {
    id: `duplicate-download-${Date.now()}`,
    options: { type: 'basic', title, message, iconUrl: 'icon/128.png' } as const,
  };
}

// ─── External Protocol Links (magnet / ed2k / thunder) ──

const EXTERNAL_PROTOCOLS = [
  'magnet',
  'ed2k',
  'thunder',
] as const satisfies readonly (keyof InterceptionScope)[];

export type ExternalProtocol = (typeof EXTERNAL_PROTOCOLS)[number];
export type ExternalProtocolDisposition = 'handled' | 'browser';

interface ExternalProtocolLink {
  protocol: ExternalProtocol;
  url: string;
}

export function isExternalProtocol(value: string): value is ExternalProtocol {
  return (EXTERNAL_PROTOCOLS as readonly string[]).includes(value);
}

function findExternalProtocolLink(target: EventTarget | null): ExternalProtocolLink | null {
  if (!(target instanceof Element)) return null;
  const href = target.closest('a[href]')?.getAttribute('href');
  if (!href) return null;
  const protocol = EXTERNAL_PROTOCOLS.find((candidate) => href.startsWith(`${candidate}:`));
  return protocol ? { protocol, url: href } : null;
}

interface ExternalProtocolClickHandlerDeps {
  shouldIntercept: (link: ExternalProtocolLink) => boolean;
  sendProtocol: (link: ExternalProtocolLink) => Promise<ExternalProtocolDisposition>;
  openInBrowser: (url: string) => void;
}

/** DOM click handler that routes protocol links to the background worker. */
export function createExternalProtocolClickHandler(deps: ExternalProtocolClickHandlerDeps) {
  return (event: MouseEvent): void => {
    const link = findExternalProtocolLink(event.target);
    if (!link || !deps.shouldIntercept(link)) return;

    event.preventDefault();
    event.stopPropagation();
    void deps
      .sendProtocol(link)
      .then((disposition) => {
        if (disposition === 'browser') deps.openInBrowser(link.url);
      })
      .catch(() => {});
  };
}
