/**
 * Typed, schema-validated persistence over `browser.storage.local`.
 *
 * Reads are repaired through zod (corrupt fields collapse to defaults) and
 * writes are re-parsed, which both validates and strips Vue reactivity
 * proxies / extra properties before they hit extension storage.
 */
import { storage } from 'wxt/utils/storage';
import {
  parseConnectionConfig,
  parseDiagnosticSettings,
  parseDiagnosticEvents,
  parseDownloadSettings,
  parseSiteRules,
  parseSnapshot,
  parseUiPrefs,
  type ConnectionConfig,
  type DiagnosticSettings,
  type DiagnosticEvent,
  type DownloadSettings,
  parseMediaSettings,
  type MediaSettings,
  type SiteRule,
  type StorageSnapshot,
  type UiPrefs,
} from './schema';

const SETTINGS_STORAGE_KEYS = [
  'connection',
  'settings',
  'siteRules',
  'uiPrefs',
  'diagnostics',
] as const;
const DIAGNOSTIC_STORAGE_KEY = 'diagnosticLog' as const;
type StorageKey = (typeof SETTINGS_STORAGE_KEYS)[number] | typeof DIAGNOSTIC_STORAGE_KEY;

const local = (key: StorageKey) => `local:${key}` as const;

// ─── Reads ──────────────────────────────────────────────

export async function loadSnapshot(): Promise<StorageSnapshot> {
  const entries = await Promise.all(
    SETTINGS_STORAGE_KEYS.map(async (key) => [key, await storage.getItem(local(key))] as const),
  );
  return parseSnapshot(Object.fromEntries(entries));
}

export async function loadDiagnosticEvents(): Promise<DiagnosticEvent[]> {
  return parseDiagnosticEvents(await storage.getItem(local(DIAGNOSTIC_STORAGE_KEY)));
}

async function loadSettings(): Promise<DownloadSettings> {
  return parseDownloadSettings(await storage.getItem(local('settings')));
}

export async function loadUiPrefs(): Promise<UiPrefs> {
  return parseUiPrefs(await storage.getItem(local('uiPrefs')));
}

// ─── Writes (validated + normalized on the way in) ──────

export async function saveConnectionConfig(config: ConnectionConfig): Promise<void> {
  await storage.setItem(local('connection'), parseConnectionConfig(config));
}

async function saveSettings(settings: DownloadSettings): Promise<void> {
  await storage.setItem(local('settings'), parseDownloadSettings(settings));
}

export async function updateSettings(patch: Partial<DownloadSettings>): Promise<void> {
  await navigator.locks.request('rayburst-settings', async () => {
    await saveSettings({ ...(await loadSettings()), ...patch });
  });
}

/** Native Web Locks serialize read/modify/write across the popup, options and worker. */
export async function updateMediaSettings(patch: Partial<MediaSettings>): Promise<void> {
  await navigator.locks.request('rayburst-settings', async () => {
    const settings = await loadSettings();
    await saveSettings({
      ...settings,
      mediaDiscovery: parseMediaSettings({ ...settings.mediaDiscovery, ...patch }),
    });
  });
}

export async function saveSiteRules(rules: SiteRule[]): Promise<void> {
  await storage.setItem(local('siteRules'), parseSiteRules(rules));
}

async function saveUiPrefs(prefs: UiPrefs): Promise<void> {
  await storage.setItem(local('uiPrefs'), parseUiPrefs(prefs));
}

export async function saveDiagnosticSettings(settings: DiagnosticSettings): Promise<void> {
  await storage.setItem(local('diagnostics'), parseDiagnosticSettings(settings));
}

export async function updateUiPrefs(patch: Partial<UiPrefs>): Promise<void> {
  await saveUiPrefs({ ...(await loadUiPrefs()), ...patch });
}

export async function saveDiagnosticEvents(events: DiagnosticEvent[]): Promise<void> {
  await storage.setItem(local(DIAGNOSTIC_STORAGE_KEY), parseDiagnosticEvents(events));
}

export async function saveSnapshot(snapshot: StorageSnapshot): Promise<void> {
  const validated = parseSnapshot(snapshot);
  await navigator.locks.request('rayburst-settings', () =>
    storage.setItems(
      SETTINGS_STORAGE_KEYS.map((key) => ({ key: local(key), value: validated[key] })),
    ),
  );
}
