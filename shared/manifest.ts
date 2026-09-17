import type { UserManifest } from 'wxt';

import identity from '../browser-identity.json';

export const CHROMIUM_EXTENSION_ID = identity.chromiumId;
export const CHROMIUM_EXTENSION_PUBLIC_KEY = identity.chromiumPublicKey;

const REQUIRED_PERMISSIONS = [
  'downloads',
  'storage',
  'contextMenus',
  'notifications',
  'webRequest',
  'webNavigation',
  'alarms',
  'cookies',
  'nativeMessaging',
  'scripting',
  'declarativeNetRequest',
  'tabs',
] as const;
const FIREFOX_REQUIRED_PERMISSIONS = [
  ...REQUIRED_PERMISSIONS,
  'webRequestBlocking',
  'webRequestFilterResponse',
] as const;
const LOOPBACK_HOST_PERMISSIONS = ['http://127.0.0.1/*', 'http://localhost/*'] as const;
const BROAD_DOWNLOAD_ORIGINS = ['https://*/*', 'http://*/*'] as const;

export function buildExtensionManifest(browser: string) {
  const optionalPermissions: UserManifest['optional_permissions'] =
    browser === 'firefox' ? [] : ['downloads.ui'];
  const permissions =
    browser === 'firefox'
      ? [...FIREFOX_REQUIRED_PERMISSIONS]
      : [...REQUIRED_PERMISSIONS, 'sidePanel'];

  const manifest = {
    ...(browser !== 'firefox' ? { minimum_chrome_version: '132' } : {}),
    // One session writer; private resources remain scoped by native tab/document/store IDs.
    incognito: 'spanning' as const,
    name: '__MSG_ext_name__',
    description: '__MSG_ext_description__',
    default_locale: 'en',
    ...(browser !== 'firefox' ? { key: CHROMIUM_EXTENSION_PUBLIC_KEY } : {}),
    permissions,
    optional_permissions: optionalPermissions,
    host_permissions: [...LOOPBACK_HOST_PERMISSIONS, ...BROAD_DOWNLOAD_ORIGINS],
    optional_host_permissions: [],
    ...(browser === 'firefox'
      ? { sidebar_action: { default_panel: 'media.html', default_title: 'Rayburst' } }
      : { side_panel: { default_path: 'media.html' } }),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: identity.firefoxId,
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['browsingActivity', 'websiteContent', 'authenticationInfo'],
              },
            },
          },
        }
      : {}),
  };
  return manifest satisfies UserManifest;
}
