<script lang="ts" setup>
/**
 * Options page root.
 *
 * State model — one snapshot, one dirty flag:
 *   - `draft`  : the full StorageSnapshot the UI edits
 *   - `saved`  : the last persisted baseline
 *   - `staged` : when a factory reset or backup import is pending, ALL
 *                changes stay local until Save writes the whole snapshot
 *
 * Two persistence classes:
 *   - immediate (enabled, scope, media, site rules, uiPrefs) — written
 *     on change unless `staged`
 *   - draft-tracked (connection + behavior/rules details) — written on Save,
 *     compared through `draftView()` for the dirty flag
 */
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { NConfigProvider, NIcon, createDiscreteApi } from 'naive-ui';
import { GlobeOutline, OpenOutline } from '@vicons/ionicons5';
import {
  loadSnapshot,
  saveConnectionConfig,
  saveDiagnosticSettings,
  saveSiteRules,
  saveSnapshot,
  updateSettings,
  updateMediaSettings,
  updateUiPrefs,
} from '@/lib/storage';
import {
  createDefaultSnapshot,
  parseConnectionConfig,
  parseDiagnosticSettings,
  parseDiagnosticEvents,
  parseDownloadSettings,
  parseSiteRules,
  parseUiPrefs,
  type DownloadSettings,
  type MediaSettings,
  type DiagnosticEvent,
  type InterceptionScope,
  type SiteRule,
  type StorageSnapshot,
  type ThemePreference,
  type UiPrefs,
} from '@/lib/schema';
import { createSettingsBackup, parseSettingsBackup } from '@/lib/backup';
import { DesktopApiClient, checkConnection, type ConnectionStatus } from '@/lib/api';
import {
  hasCookieForwardingAccess,
  hasDownloadUiAccess,
  requestCookieForwardingAccess,
  requestDownloadUiAccess,
} from '@/lib/browser';
import { deepEqual, jsonClone } from '@/shared/json';
import { useAppTheme } from '@/shared/theme';
import { createI18n, I18N_KEY, useNaiveLocale } from '@/shared/i18n/engine';

import MediaSettingsSection from './components/MediaSettingsSection.vue';
import OptionsNav from './components/OptionsNav.vue';
import ConnectionSection from './components/ConnectionSection.vue';
import BehaviorSection from './components/BehaviorSection.vue';
import RulesSection from './components/RulesSection.vue';
import AppearanceSection from './components/AppearanceSection.vue';
import MaintenanceSection from './components/MaintenanceSection.vue';
import SettingsActionBar from './components/SettingsActionBar.vue';
import LanguageSection from './components/LanguageSection.vue';
import BrandLogo from '@/shared/components/BrandLogo.vue';

// ─── Theme + i18n ───────────────────────────────────────

const theme = useAppTheme();
const i18nCtx = createI18n('auto', { localeApi: browser.i18n });
provide(I18N_KEY, i18nCtx);
const { t: i18n, tEn: i18nEn, tSub: i18nSub, effectiveLocale } = i18nCtx;
const { naiveLocale, naiveDateLocale } = useNaiveLocale(effectiveLocale);

/** Bilingual display for the Language section title. */
function i18nBilingual(key: string, enFallback: string): string {
  const native = i18n(key, enFallback);
  const en = i18nEn(key, enFallback);
  return native === en ? native : `${native} / ${en}`;
}

const { message: toast } = createDiscreteApi(['message'], {
  configProviderProps: computed(() => ({
    theme: theme.naiveTheme.value,
    themeOverrides: theme.themeOverrides.value,
    locale: naiveLocale.value,
    dateLocale: naiveDateLocale.value,
    inlineThemeDisabled: true,
  })),
});

// ─── State ──────────────────────────────────────────────

/** Section ids in nav order — drives the directional switch animation. */
const SECTION_ORDER = [
  'connection',
  'behavior',
  'media',
  'rules',
  'appearance',
  'language',
  'diagnostics',
] as const;

const initialSection = new URL(window.location.href).hash.slice(1);
const activeSection = ref<string>(
  SECTION_ORDER.some((id) => id === initialSection) ? initialSection : 'connection',
);
// 'section-down' when moving toward a later tab, 'section-up' otherwise.
const sectionTransition = ref<'section-down' | 'section-up'>('section-down');

function selectSection(id: string): void {
  if (id === activeSection.value) return;
  const from = SECTION_ORDER.indexOf(activeSection.value as (typeof SECTION_ORDER)[number]);
  const to = SECTION_ORDER.indexOf(id as (typeof SECTION_ORDER)[number]);
  sectionTransition.value = to > from ? 'section-down' : 'section-up';
  activeSection.value = id;
}

const canControlDownloadUi = !import.meta.env.FIREFOX;
const extensionVersion = browser.runtime.getManifest().version;

const draft = ref<StorageSnapshot>(createDefaultSnapshot());
const saved = ref<StorageSnapshot>(createDefaultSnapshot());
const diagnosticEvents = ref<DiagnosticEvent[]>([]);
const staged = ref<null | 'factory-reset' | 'backup-import'>(null);

/** The draft-tracked (Save/Discard) subset of a snapshot. */
function draftView(s: StorageSnapshot) {
  const { enabled: _e, interceptionScope: _s, mediaDiscovery: _m, ...tracked } = s.settings;
  return { connection: s.connection, diagnostics: s.diagnostics, ...tracked };
}

const isDirty = computed(
  () => staged.value !== null || !deepEqual(draftView(draft.value), draftView(saved.value)),
);

// ─── Immediate Persistence ──────────────────────────────

/** Persist an immediate-class change; staged mode keeps it local. */
async function persistImmediate(persist: () => Promise<void>, revert?: () => void): Promise<void> {
  if (staged.value) return;
  try {
    await persist();
  } catch {
    revert?.();
    toast.error(i18n('options_save_error', 'Failed to save settings'));
  }
}

async function handleMediaChange(patch: Partial<MediaSettings>): Promise<void> {
  const previous = draft.value.settings.mediaDiscovery;
  draft.value.settings.mediaDiscovery = { ...previous, ...patch };
  await persistImmediate(
    () => updateMediaSettings(patch),
    () => {
      draft.value.settings.mediaDiscovery = previous;
    },
  );
}

async function handleEnabledChange(value: boolean): Promise<void> {
  const previous = draft.value.settings.enabled;
  draft.value.settings.enabled = value;
  await persistImmediate(
    () => updateSettings({ enabled: value }),
    () => {
      draft.value.settings.enabled = previous;
    },
  );
}

async function handleInterceptionScopeChange(value: Partial<InterceptionScope>): Promise<void> {
  const previous = { ...draft.value.settings.interceptionScope };
  draft.value.settings.interceptionScope = { ...previous, ...value };
  await persistImmediate(
    () => updateSettings({ interceptionScope: draft.value.settings.interceptionScope }),
    () => {
      draft.value.settings.interceptionScope = previous;
    },
  );
}

function handleAddSiteRule(rule: Omit<SiteRule, 'id'>): void {
  draft.value.siteRules.push({ id: `rule-${Date.now()}`, ...rule });
  void persistImmediate(() => saveSiteRules(draft.value.siteRules));
}

function handleRemoveSiteRule(id: string): void {
  draft.value.siteRules = draft.value.siteRules.filter((rule) => rule.id !== id);
  void persistImmediate(() => saveSiteRules(draft.value.siteRules));
}

function handleThemeChange(value: string): void {
  draft.value.uiPrefs.theme = value as ThemePreference;
  theme.setMode(draft.value.uiPrefs.theme);
  void persistImmediate(() => updateUiPrefs({ theme: draft.value.uiPrefs.theme }));
}

function handleColorSchemeChange(value: string): void {
  const colorScheme = parseUiPrefs({ colorScheme: value }).colorScheme;
  draft.value.uiPrefs.colorScheme = colorScheme;
  theme.setColorScheme(colorScheme);
  void persistImmediate(() => updateUiPrefs({ colorScheme }));
}

function handleLocaleChange(value: string): void {
  draft.value.uiPrefs.locale = value;
  i18nCtx.setLocale(value);
  void persistImmediate(() => updateUiPrefs({ locale: value }));
}

async function handleClearDiagnosticLog(): Promise<void> {
  try {
    const response: unknown = await browser.runtime.sendMessage({ type: 'CLEAR_DIAGNOSTICS' });
    if (
      response !== null &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true
    ) {
      diagnosticEvents.value = [];
      return;
    }
  } catch {
    // The shared error message below covers transport and persistence failures.
  }
  toast.error(i18n('options_diagnostics_clear_error', 'Failed to clear diagnostic events'));
}

async function getDiagnosticEvents(): Promise<DiagnosticEvent[]> {
  const response: unknown = await browser.runtime.sendMessage({ type: 'GET_DIAGNOSTICS' });
  if (response === null || typeof response !== 'object' || !('events' in response)) {
    throw new Error('Diagnostic journal unavailable');
  }
  return parseDiagnosticEvents(response.events);
}

// ─── Permission-gated Toggles ───────────────────────────

async function handleHideDownloadBarChange(value: boolean): Promise<void> {
  if (!value || !canControlDownloadUi) {
    draft.value.settings.hideDownloadBar = false;
    return;
  }
  if (await requestDownloadUiAccess().catch(() => false)) {
    draft.value.settings.hideDownloadBar = true;
    return;
  }
  draft.value.settings.hideDownloadBar = false;
  toast.warning(
    i18n(
      'options_permission_download_ui_denied',
      'Grant download UI permission to hide the browser download bar.',
    ),
  );
}

async function handleForwardCookiesChange(value: boolean): Promise<void> {
  if (!value) {
    draft.value.settings.forwardCookies = false;
    return;
  }
  if (await requestCookieForwardingAccess().catch(() => false)) {
    draft.value.settings.forwardCookies = true;
    return;
  }
  draft.value.settings.forwardCookies = false;
  toast.warning(
    i18n(
      'options_permission_cookies_denied',
      'Grant cookie and site permissions to forward cookies to Rayburst.',
    ),
  );
}

// ─── Save / Discard ─────────────────────────────────────

async function handleSave(): Promise<void> {
  try {
    if (staged.value) {
      await saveSnapshot(draft.value);
      staged.value = null;
    } else {
      await saveConnectionConfig(draft.value.connection);
      await saveDiagnosticSettings(draft.value.diagnostics);
      const {
        enabled: _e,
        interceptionScope: _s,
        mediaDiscovery: _m,
        ...tracked
      } = draft.value.settings;
      await updateSettings({
        ...tracked,
        hideDownloadBar: canControlDownloadUi && tracked.hideDownloadBar,
      });
    }
    saved.value = jsonClone(draft.value);
    toast.success(i18n('options_save_success', 'Settings saved'));
  } catch {
    toast.error(i18n('options_save_error', 'Failed to save settings'));
  }
}

async function handleDiscard(): Promise<void> {
  if (staged.value) {
    staged.value = null;
    await loadFromStorage();
  } else {
    draft.value = jsonClone(saved.value);
  }
  applyUiSideEffects(draft.value.uiPrefs);
  toast.info(i18n('options_discard_success', 'Changes restored'));
}

// ─── Staged Snapshots (factory reset / backup import) ───

function stageSnapshot(snapshot: StorageSnapshot, mode: 'factory-reset' | 'backup-import'): void {
  draft.value = snapshot;
  staged.value = mode;
  applyUiSideEffects(snapshot.uiPrefs);
}

function stageFactoryReset(): void {
  stageSnapshot(createDefaultSnapshot(), 'factory-reset');
  toast.info(i18n('options_factory_reset_ready', 'Defaults ready to save'));
}

async function importSettingsBackup(file: globalThis.File): Promise<void> {
  try {
    const snapshot = parseSettingsBackup(await file.text());
    stageSnapshot(snapshot, 'backup-import');
    toast.info(i18n('options_settings_backup_imported', 'Settings imported. Review and save.'));
  } catch {
    toast.error(i18n('options_settings_backup_invalid', 'Invalid backup file'));
  }
}

// ─── Backup / Diagnostics Export ────────────────────────

function downloadJson(filename: string, data: unknown): void {
  // A data URI avoids waking the service worker for an extension-owned blob download.
  const json = JSON.stringify(data, null, 2);
  const a = document.createElement('a');
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  a.download = filename;
  a.click();
}

function exportSettingsBackup(): void {
  try {
    const backup = createSettingsBackup(draft.value, {
      extensionVersion,
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`rayburst-connect-settings-backup-${date}.json`, backup);
    toast.success(i18n('options_settings_backup_exported', 'Backup exported'));
  } catch {
    toast.error(i18n('options_settings_backup_export_error', 'Failed to export backup'));
  }
}

async function exportDiagnosticReport(): Promise<void> {
  try {
    const { connection, settings, siteRules, uiPrefs, diagnostics } = draft.value;
    const [diagnosticLog, permissions] = await Promise.all([
      getDiagnosticEvents(),
      browser.permissions.getAll(),
    ]);
    downloadJson(`rayburst-diagnostic-${Date.now()}.json`, {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      extension: {
        id: browser.runtime.id,
        version: extensionVersion,
        manifestVersion: browser.runtime.getManifest().manifest_version,
      },
      browser: { userAgent: navigator.userAgent, language: navigator.language },
      permissions,
      config: { connection: { port: connection.port }, settings, siteRules, uiPrefs, diagnostics },
      diagnosticLog,
    });
  } catch {
    toast.error(i18n('options_diagnostics_export_error', 'Failed to export diagnostic report'));
  }
}

// ─── Connection Test ────────────────────────────────────

const connectionStatus = ref<ConnectionStatus>('disconnected');
const connectionVersion = ref<string | null>(null);
const connectionError = ref<string | null>(null);
const testingConnection = ref(false);

async function testConnection(): Promise<void> {
  if (testingConnection.value) return;
  testingConnection.value = true;

  const client = new DesktopApiClient(draft.value.connection);
  // Minimum 600ms so the loading state doesn't flash on fast local checks.
  const [result] = await Promise.all([
    checkConnection(client),
    new Promise((r) => setTimeout(r, 600)),
  ]);

  connectionStatus.value = result.status;
  connectionVersion.value = result.version;
  connectionError.value = result.status === 'disconnected' ? result.error : null;
  testingConnection.value = false;
}

// ─── Load + Live Sync ───────────────────────────────────

function applyUiSideEffects(prefs: UiPrefs): void {
  theme.setMode(prefs.theme);
  theme.setColorScheme(prefs.colorScheme);
  i18nCtx.setLocale(prefs.locale);
}

/** Reflect actually-granted permissions in permission-gated toggles. */
async function gatePermissions(settings: DownloadSettings): Promise<void> {
  settings.hideDownloadBar =
    canControlDownloadUi &&
    settings.hideDownloadBar &&
    (await hasDownloadUiAccess().catch(() => false));
  settings.forwardCookies =
    settings.forwardCookies && (await hasCookieForwardingAccess().catch(() => false));
}

async function loadFromStorage(): Promise<void> {
  const [data, events] = await Promise.all([loadSnapshot(), getDiagnosticEvents().catch(() => [])]);
  await gatePermissions(data.settings);
  draft.value = data;
  saved.value = jsonClone(data);
  diagnosticEvents.value = events;
  applyUiSideEffects(data.uiPrefs);
}

let stopStorageListener: (() => void) | null = null;

function bindStorageChanges(): void {
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'local') return;

    if (changes.diagnosticLog?.newValue) {
      diagnosticEvents.value = parseDiagnosticEvents(changes.diagnosticLog.newValue);
    }

    if (staged.value) return;

    if (changes.connection?.newValue && !isDirty.value) {
      const connection = parseConnectionConfig(changes.connection.newValue);
      draft.value.connection = connection;
      saved.value.connection = jsonClone(connection);
    }

    if (changes.settings?.newValue) {
      const settings = parseDownloadSettings(changes.settings.newValue);
      void gatePermissions(settings).then(() => {
        // Immediate-class fields always follow storage; draft-tracked fields
        // only when there are no unsaved local edits.
        const dirty = isDirty.value;
        saved.value.settings = jsonClone(settings);
        if (dirty) {
          draft.value.settings.enabled = settings.enabled;
          draft.value.settings.interceptionScope = settings.interceptionScope;
          draft.value.settings.mediaDiscovery = settings.mediaDiscovery;
        } else {
          draft.value.settings = jsonClone(settings);
        }
      });
    }

    if (changes.siteRules?.newValue) {
      draft.value.siteRules = parseSiteRules(changes.siteRules.newValue);
      saved.value.siteRules = jsonClone(draft.value.siteRules);
    }

    if (changes.uiPrefs?.newValue) {
      const prefs = parseUiPrefs(changes.uiPrefs.newValue);
      draft.value.uiPrefs = prefs;
      saved.value.uiPrefs = jsonClone(prefs);
      applyUiSideEffects(prefs);
    }

    if (changes.diagnostics?.newValue && !isDirty.value) {
      const diagnostics = parseDiagnosticSettings(changes.diagnostics.newValue);
      draft.value.diagnostics = diagnostics;
      saved.value.diagnostics = jsonClone(diagnostics);
    }
  };

  browser.storage.onChanged.addListener(listener);
  stopStorageListener = () => browser.storage.onChanged.removeListener(listener);
}

// ─── Lifecycle ──────────────────────────────────────────

function onBeforeUnload(e: globalThis.BeforeUnloadEvent): void {
  if (isDirty.value) e.preventDefault();
}

watch(isDirty, (dirty) => {
  if (dirty) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
});

onMounted(() => {
  void loadFromStorage();
  bindStorageChanges();
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
  stopStorageListener?.();
});
</script>

<template>
  <NConfigProvider
    :theme="theme.naiveTheme.value"
    :theme-overrides="theme.themeOverrides.value"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    inline-theme-disabled
  >
    <div class="options-root">
      <!-- ── Header ──────────────────────────────────────────── -->
      <header class="options-header">
        <div class="options-header__brand">
          <div class="options-header__icon">
            <BrandLogo />
          </div>
          <div>
            <h1 class="options-header__title">
              {{ i18n('options_header_title', 'Rayburst Connect') }}
            </h1>
            <p class="options-header__subtitle">
              {{ i18n('options_header_subtitle', 'Extension Settings') }}
            </p>
          </div>
        </div>
        <a
          class="options-website"
          href="https://rayburst.pages.dev/#connect"
          target="_blank"
          rel="noopener noreferrer"
        >
          <NIcon :size="18" aria-hidden="true"><GlobeOutline /></NIcon>
          <span>{{ i18n('options_website', 'Website') }}</span>
          <NIcon :size="14" aria-hidden="true"><OpenOutline /></NIcon>
        </a>
      </header>

      <!-- ── Body: Nav + Content ─────────────────────────────── -->
      <div class="options-body">
        <OptionsNav :active="activeSection" @select="selectSection" />

        <main class="options-content">
          <Transition :name="sectionTransition" mode="out-in">
            <!-- Connection -->
            <div v-if="activeSection === 'connection'" key="connection" class="section-wrapper">
              <h2 class="section-title">{{ i18n('options_section_connection', 'Connection') }}</h2>
              <div class="card">
                <ConnectionSection
                  :port="draft.connection.port"
                  :secret="draft.connection.secret"
                  :status="connectionStatus"
                  :version="connectionVersion"
                  :error="connectionError"
                  :testing="testingConnection"
                  @update:port="draft.connection.port = $event"
                  @update:secret="draft.connection.secret = $event"
                  @test="testConnection"
                />
              </div>
            </div>

            <!-- Behavior -->
            <div v-else-if="activeSection === 'behavior'" key="behavior" class="section-wrapper">
              <h2 class="section-title">
                {{ i18n('options_section_behavior', 'Download') }}
              </h2>
              <div class="card">
                <BehaviorSection
                  :enabled="draft.settings.enabled"
                  :interception-scope="draft.settings.interceptionScope"
                  :hide-download-bar="draft.settings.hideDownloadBar"
                  :can-control-download-ui="canControlDownloadUi"
                  :desktop-unavailable="draft.settings.desktopUnavailable"
                  :forward-request-headers="draft.settings.forwardRequestHeaders"
                  :forward-cookies="draft.settings.forwardCookies"
                  @update:enabled="handleEnabledChange"
                  @update:scope="handleInterceptionScopeChange"
                  @update:hide-download-bar="handleHideDownloadBarChange"
                  @update:desktop-unavailable="
                    draft.settings.desktopUnavailable = {
                      ...draft.settings.desktopUnavailable,
                      ...$event,
                    }
                  "
                  @update:forward-request-headers="draft.settings.forwardRequestHeaders = $event"
                  @update:forward-cookies="handleForwardCookiesChange"
                />
              </div>
            </div>

            <!-- Rules -->
            <div v-else-if="activeSection === 'rules'" key="rules" class="section-wrapper">
              <h2 class="section-title">{{ i18n('options_section_rules', 'Rules') }}</h2>
              <div class="card">
                <RulesSection
                  :duplicate-guard="draft.settings.duplicateGuard"
                  :minimum-file-size="draft.settings.minimumFileSize"
                  :file-extension-rule="draft.settings.fileExtensionRule"
                  :site-rules="draft.siteRules"
                  @update:duplicate-guard="
                    draft.settings.duplicateGuard = { ...draft.settings.duplicateGuard, ...$event }
                  "
                  @update:minimum-file-size="
                    draft.settings.minimumFileSize = {
                      ...draft.settings.minimumFileSize,
                      ...$event,
                    }
                  "
                  @update:file-extension-rule="
                    draft.settings.fileExtensionRule = {
                      ...draft.settings.fileExtensionRule,
                      ...$event,
                    }
                  "
                  @add-site-rule="handleAddSiteRule"
                  @remove-site-rule="handleRemoveSiteRule"
                />
              </div>
            </div>

            <div v-else-if="activeSection === 'media'" key="media" class="section-wrapper">
              <h2 class="section-title">{{ i18n('sniffer_tab') }}</h2>
              <div class="card">
                <MediaSettingsSection
                  :value="draft.settings.mediaDiscovery"
                  :staged="staged !== null"
                  @change="handleMediaChange"
                />
              </div>
            </div>

            <!-- Appearance -->
            <div
              v-else-if="activeSection === 'appearance'"
              key="appearance"
              class="section-wrapper"
            >
              <h2 class="section-title">{{ i18n('options_section_appearance', 'Appearance') }}</h2>
              <div class="card">
                <AppearanceSection
                  :theme="draft.uiPrefs.theme"
                  :color-scheme="draft.uiPrefs.colorScheme"
                  @update:theme="handleThemeChange"
                  @update:color-scheme="handleColorSchemeChange"
                />
              </div>
            </div>

            <!-- Language -->
            <div v-else-if="activeSection === 'language'" key="language" class="section-wrapper">
              <h2 class="section-title">
                {{ i18nBilingual('options_section_language', 'Language') }}
              </h2>
              <div class="card">
                <LanguageSection
                  :locale="draft.uiPrefs.locale"
                  @update:locale="handleLocaleChange"
                />
              </div>
            </div>

            <!-- Maintenance -->
            <div
              v-else-if="activeSection === 'diagnostics'"
              key="maintenance"
              class="section-wrapper"
            >
              <h2 class="section-title">
                {{ i18n('options_section_maintenance', 'Maintenance') }}
              </h2>
              <div class="card">
                <MaintenanceSection
                  :events="diagnosticEvents"
                  :max-diagnostic-events="draft.diagnostics.maxEvents"
                  @update:max-diagnostic-events="draft.diagnostics.maxEvents = $event"
                  @export-settings="exportSettingsBackup"
                  @import-settings="importSettingsBackup"
                  @reset-settings="stageFactoryReset"
                  @clear-diagnostics="handleClearDiagnosticLog"
                  @export-diagnostics="exportDiagnosticReport"
                />
              </div>
            </div>
          </Transition>
          <SettingsActionBar :is-dirty="isDirty" @save="handleSave" @discard="handleDiscard" />
        </main>
      </div>

      <!-- ── Footer ──────────────────────────────────────────── -->
      <footer class="options-footer">
        <p>{{ i18n('brand_tagline', 'Redefining the companion browser extension') }}</p>
        {{ i18nSub('options_footer', [extensionVersion], `Rayburst Connect v${extensionVersion}`) }}
      </footer>
    </div>
  </NConfigProvider>
</template>

<style scoped>
.options-root {
  min-height: 100vh;
  background: var(--color-surface);
  color: var(--color-on-surface);
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
}

/* ── Header ──────────────────────────────────────────────────── */
.options-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 24px;
  padding: 28px 32px 16px;
  border-bottom: 1px solid var(--color-outline-variant);
  background: var(--color-surface-container-low);
}

.options-header__brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.options-website {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 16px;
  color: var(--color-on-surface-variant);
  background: var(--color-surface);
  border: 1px solid var(--color-outline-variant);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  border-radius: 10px;
}

.options-website:hover {
  border-color: var(--color-primary);
  background: var(--color-surface-container-high);
}

.options-website:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

.options-header__icon {
  color: var(--color-primary);
}

.options-header__title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-on-surface);
}

.options-header__subtitle {
  font-size: 13px;
  color: var(--color-on-surface-variant);
  margin-top: 1px;
}

/* ── Body: dual-pane layout ──────────────────────────────────── */
.options-body {
  display: flex;
  flex: 1;
  width: 100%;
  margin: 0 auto;
  padding: 16px 24px;
}

.options-content {
  flex: 3;
  min-width: 0;
  padding: 8px 32px 32px 16px;
  border-left: 1px solid var(--color-outline-variant);
}

/* ── Footer ──────────────────────────────────────────────────── */
.options-footer {
  text-align: center;
  font-size: 12px;
  color: var(--color-on-surface-variant);
  opacity: 0.5;
  padding: 16px;
  border-top: 1px solid var(--color-outline-variant);
}

.options-footer p {
  margin: 0 0 6px;
  text-wrap: balance;
}

/* ── Responsive: ≤640px → stacked layout ─────────────────────── */
@media (max-width: 640px) {
  .options-body {
    flex-direction: column;
    padding: 0;
  }

  .options-content {
    padding: 16px;
  }

  .options-header {
    padding: 20px 16px 12px;
  }
}
</style>
