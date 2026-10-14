<script lang="ts" setup>
/**
 * Popup root: connection status, live speed/task dashboard, quick actions.
 *
 * Data flows from the desktop HTTP API via visibility-aware polling with
 * exponential backoff. Theme, locale, and settings sync live through
 * browser.storage.onChanged.
 */
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { NButton, NConfigProvider, NIcon, NSkeleton, NSpin, NTab, NTabs } from 'naive-ui';
import { AlertCircleOutline, PauseOutline, PlayOutline, RocketOutline } from '@vicons/ionicons5';
import {
  DesktopApiClient,
  checkConnection,
  type DesktopIdentity,
  type DesktopTask,
  type StatResponse,
} from '@/lib/api';
import { legacyDesktopName } from '@/lib/legacy';
import AutoHeight from '@/shared/components/AutoHeight.vue';
import LegacyDesktopNotice from '@/shared/components/LegacyDesktopNotice.vue';
import UnsupportedDesktop from '@/shared/components/UnsupportedDesktop.vue';
import {
  loadDesktopMemory,
  loadSnapshot,
  rememberDesktop,
  updateDesktopMemory,
  updateSettings,
} from '@/lib/storage';
import {
  isActivationErrorCode,
  parseDesktopActionResponse,
  type DesktopAction,
  type DesktopActionResponse,
} from '@/lib/desktop';
import {
  DEFAULT_CONNECTION_CONFIG,
  parseConnectionConfig,
  parseDesktopMemory,
  parseDownloadSettings,
  parseUiPrefs,
} from '@/lib/schema';
import { usePolling } from '@/shared/use-polling';
import { useAppTheme } from '@/shared/theme';
import { createI18n, I18N_KEY, useNaiveLocale } from '@/shared/i18n/engine';

import PopupHeader from './components/PopupHeader.vue';
import StatDashboard from './components/StatDashboard.vue';
import TaskList from './components/TaskList.vue';
import MediaPanel from './components/MediaPanel.vue';
import ResourceCount from './components/ResourceCount.vue';
import { usePopupNavigation } from './use-navigation';

// ─── i18n + Theme ───────────────────────────────────────

const i18nCtx = createI18n('auto', { localeApi: browser.i18n });
provide(I18N_KEY, i18nCtx);
const { t: i18n, tSub: i18nSub, effectiveLocale } = i18nCtx;
const { naiveLocale, naiveDateLocale } = useNaiveLocale(effectiveLocale);
const theme = useAppTheme();

// ─── State ──────────────────────────────────────────────

type PopupPhase = 'initializing' | 'disconnected' | 'launching' | 'connected' | 'failed';

const phase = ref<PopupPhase>('initializing');
const version = ref<string | null>(null);
const errorType = ref<string | null>(null);
/** The connected desktop; older ones lack the task list. */
const desktop = ref<DesktopIdentity | null>(null);
const legacyDesktop = computed(() => desktop.value && legacyDesktopName(desktop.value));
/** The older desktop whose update notice was closed; a different one shows it again. */
const noticeDismissed = ref<string | null>(null);
const openLink = ref(false);
/** The last start failed before the desktop could even be reached. */
const activationFailed = ref(false);
const connectionPort = ref(DEFAULT_CONNECTION_CONFIG.port);
const globalStat = ref<StatResponse | null>(null);
const tasks = ref<DesktopTask[]>([]);
const enabled = ref(true);
const opening = ref(false);
const checking = ref(false);
const { view, count: resourceCount, ready: navigationReady } = usePopupNavigation();
const settingsReady = ref(false);
/** The popup opens once the first check settles, so it does not reshape right away. */
const firstCheckDone = ref(false);
/** The media tab mounts on first visit and then stays alive. */
const mediaVisited = ref(false);
watch(
  view,
  (value) => {
    if (value === 'media') mediaVisited.value = true;
  },
  { immediate: true },
);
// Older desktops report counts only; their waiting tasks include paused ones.
const canPauseAll = computed(() =>
  legacyDesktop.value
    ? Number(globalStat.value?.numActive) > 0
    : tasks.value.some((task) => task.status === 'active' || task.status === 'waiting'),
);
const canResumeAll = computed(() =>
  legacyDesktop.value
    ? !canPauseAll.value && Number(globalStat.value?.numWaiting) > 0
    : tasks.value.some((task) => task.status === 'paused'),
);
const tabTransition = computed(() => (view.value === 'media' ? 'tab-forward' : 'tab-back'));
const apiClient = new DesktopApiClient({ ...DEFAULT_CONNECTION_CONFIG });
let stopPolling: (() => void) | null = null;
let stopStorageListener: (() => void) | null = null;

// ─── Data Fetching ──────────────────────────────────────

async function fetchData(): Promise<boolean> {
  try {
    const result = await checkConnection(apiClient);
    version.value = result.version;
    errorType.value = result.status === 'disconnected' ? result.error : null;
    if (result.status === 'connected') {
      const { status: _status, stat, ...identity } = result;
      desktop.value = identity;
      void rememberDesktop(identity).catch(() => undefined);
      globalStat.value = stat;
      phase.value = 'connected';
      await refreshTasks();
      return true;
    }
    desktop.value = null;
    if (phase.value !== 'launching' && phase.value !== 'failed') {
      phase.value = 'disconnected';
    }
    return false;
  } catch {
    if (phase.value !== 'launching' && phase.value !== 'failed') phase.value = 'disconnected';
    return false;
  }
}

/** How long a clicked pause or resume shows before the desktop confirms it. */
const PENDING_STATUS_MS = 3000;

/**
 * Statuses shown from a click until the desktop reports a change, so the
 * icon swaps at once and polls in between cannot flip it back.
 */
const pendingStatus = new Map<string, { from: string; to: string; until: number }>();
const controlling = new Set<string>();

function applyPending(list: DesktopTask[]): DesktopTask[] {
  return list.map((task) => {
    const pending = pendingStatus.get(task.gid);
    if (!pending) return task;
    if (task.status !== pending.from || Date.now() > pending.until) {
      pendingStatus.delete(task.gid);
      return task;
    }
    return { ...task, status: pending.to };
  });
}

/** Keeps the last list when the desktop is briefly busy. */
async function refreshTasks(): Promise<void> {
  if (legacyDesktop.value) {
    tasks.value = [];
    return;
  }
  try {
    tasks.value = applyPending((await apiClient.getTasks()).tasks);
  } catch {
    // The next poll retries.
  }
}

// ─── Actions ────────────────────────────────────────────

async function controlTask(gid: string, action: 'pause' | 'resume' | 'reveal'): Promise<void> {
  if (controlling.has(gid)) return;
  controlling.add(gid);
  const task = tasks.value.find((candidate) => candidate.gid === gid);
  if (task && action !== 'reveal') {
    // A resumed task queues first; the desktop reports when it starts.
    const to = action === 'pause' ? 'paused' : 'waiting';
    pendingStatus.set(gid, { from: task.status, to, until: Date.now() + PENDING_STATUS_MS });
    tasks.value = applyPending(tasks.value);
  }
  try {
    if (action === 'pause') await apiClient.pauseTask(gid);
    else if (action === 'resume') await apiClient.resumeTask(gid);
    else await apiClient.revealTask(gid);
  } catch {
    // The list shows the state the desktop reports next.
    pendingStatus.delete(gid);
  } finally {
    controlling.delete(gid);
  }
  await refreshTasks();
}

async function pauseAll(): Promise<void> {
  await sendBackgroundCommand('PAUSE_ALL');
  await fetchData();
}

async function resumeAll(): Promise<void> {
  await sendBackgroundCommand('RESUME_ALL');
  await fetchData();
}

function openSettings(): void {
  void browser.runtime.openOptionsPage();
}

async function launchApp(): Promise<void> {
  phase.value = 'launching';
  activationFailed.value = false;
  try {
    const response = await sendDesktopAction('START_DESKTOP');
    if (!response.ok) {
      if (response.error === 'ApiCompatibilityError' || response.error.startsWith('ApiEngine'))
        errorType.value = response.error;
      activationFailed.value = isActivationErrorCode(response.error);
      phase.value = 'failed';
      return;
    }
    if (!(await fetchData())) phase.value = 'failed';
  } catch {
    phase.value = 'failed';
  }
}

function dismissNotice(): void {
  noticeDismissed.value = legacyDesktop.value;
  void updateDesktopMemory({ noticeDismissed: noticeDismissed.value }).catch(() => undefined);
}

/** Allows starting through the desktop's link, then tries again. */
async function launchThroughLink(): Promise<void> {
  try {
    const { settings } = await loadSnapshot();
    await updateSettings({
      desktopUnavailable: { ...settings.desktopUnavailable, openLink: true },
    });
  } catch {
    return;
  }
  openLink.value = true;
  await launchApp();
}

async function checkAgain(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  try {
    await fetchData();
  } finally {
    checking.value = false;
  }
}

async function openApp(): Promise<void> {
  opening.value = true;
  try {
    await sendDesktopAction('OPEN_DESKTOP');
  } finally {
    opening.value = false;
  }
}

async function sendDesktopAction(type: DesktopAction): Promise<DesktopActionResponse> {
  return parseDesktopActionResponse(await browser.runtime.sendMessage({ type }));
}

async function sendBackgroundCommand(type: 'PAUSE_ALL' | 'RESUME_ALL'): Promise<boolean> {
  const response: unknown = await browser.runtime.sendMessage({ type });
  return (
    response !== null && typeof response === 'object' && 'ok' in response && response.ok === true
  );
}

/** Toggle interception; the background worker reacts via storage.onChanged. */
async function toggleEnabled(): Promise<void> {
  enabled.value = !enabled.value;
  try {
    await updateSettings({ enabled: enabled.value });
  } catch {
    enabled.value = !enabled.value; // revert — keep UI in sync with storage
  }
}

// ─── Live Sync ──────────────────────────────────────────

function bindStorageChanges(): void {
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'local') return;

    if (changes.settings?.newValue) {
      const settings = parseDownloadSettings(changes.settings.newValue);
      enabled.value = settings.enabled;
      openLink.value = settings.desktopUnavailable.openLink;
    }
    if (changes.connection?.newValue) {
      const connection = parseConnectionConfig(changes.connection.newValue);
      connectionPort.value = connection.port;
      apiClient.updateConfig(connection);
      void fetchData();
    }
    if (changes.desktop?.newValue) {
      noticeDismissed.value = parseDesktopMemory(changes.desktop.newValue).noticeDismissed;
    }
    if (changes.uiPrefs?.newValue) {
      const prefs = parseUiPrefs(changes.uiPrefs.newValue);
      theme.setMode(prefs.theme);
      theme.setColorScheme(prefs.colorScheme);
      i18nCtx.setLocale(prefs.locale);
    }
  };

  browser.storage.onChanged.addListener(listener);
  stopStorageListener = () => browser.storage.onChanged.removeListener(listener);
}

// ─── Lifecycle ──────────────────────────────────────────

onMounted(async () => {
  const [data, memory] = await Promise.all([loadSnapshot(), loadDesktopMemory()]);
  noticeDismissed.value = memory.noticeDismissed;
  enabled.value = data.settings.enabled;
  openLink.value = data.settings.desktopUnavailable.openLink;
  theme.setMode(data.uiPrefs.theme);
  theme.setColorScheme(data.uiPrefs.colorScheme);
  i18nCtx.setLocale(data.uiPrefs.locale);
  connectionPort.value = data.connection.port;
  apiClient.updateConfig(data.connection);
  bindStorageChanges();
  settingsReady.value = true;

  // A desktop that is slow to answer shows the checking state after a second.
  setTimeout(() => (firstCheckDone.value = true), 1000);
  const poller = usePolling({
    fn: () => fetchData().finally(() => (firstCheckDone.value = true)),
    baseIntervalMs: 500,
    maxIntervalMs: 5000,
  });
  poller.start();
  stopPolling = () => poller.stop();
});

onUnmounted(() => {
  stopPolling?.();
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
    <div class="popup-root" :dir="['ar', 'fa'].includes(effectiveLocale) ? 'rtl' : 'ltr'">
      <div class="popup-content">
        <div
          v-if="!settingsReady || !navigationReady || !firstCheckDone"
          class="popup-skeleton"
          aria-busy="true"
        >
          <div class="popup-skeleton__header">
            <NSkeleton width="64px" height="24px" />
            <NSkeleton width="84px" height="18px" round />
            <span class="popup-skeleton__spacer" />
            <NSkeleton width="96px" height="20px" round />
          </div>
          <div class="popup-skeleton__body">
            <NSkeleton height="108px" :sharp="false" />
            <NSkeleton height="108px" :sharp="false" />
          </div>
          <div class="popup-skeleton__footer">
            <NSkeleton width="140px" height="24px" :sharp="false" />
          </div>
        </div>

        <template v-else>
          <PopupHeader
            :status="
              phase === 'initializing'
                ? 'checking'
                : phase === 'connected'
                  ? 'connected'
                  : phase === 'launching'
                    ? 'launching'
                    : 'disconnected'
            "
            :version="version"
            :enabled="enabled"
            @settings="openSettings"
            @toggle-enabled="toggleEnabled"
          />

          <NTabs v-model:value="view" type="segment" size="small" class="popup-tabs">
            <NTab name="downloads" :tab="i18n('media_downloads')" />
            <NTab name="media">
              <span class="sniffer-tab">
                <span>{{ i18n('sniffer_tab') }}</span>
                <ResourceCount
                  :count="resourceCount"
                  :label="i18nSub('sniffer_page_count', [String(resourceCount)])"
                />
              </span>
            </NTab>
          </NTabs>

          <AutoHeight>
            <Transition :name="tabTransition">
              <div v-show="view === 'downloads'">
                <Transition name="phase-switch" mode="out-in">
                  <section
                    v-if="phase === 'initializing'"
                    key="initializing"
                    class="popup-page popup-skeleton"
                    aria-busy="true"
                  >
                    <div class="popup-skeleton__body">
                      <NSkeleton height="108px" :sharp="false" />
                      <NSkeleton height="108px" :sharp="false" />
                    </div>
                  </section>
                  <section
                    v-else-if="errorType === 'ApiCompatibilityError'"
                    key="unsupported"
                    class="popup-page popup-unsupported"
                  >
                    <UnsupportedDesktop
                      layout="page"
                      :version="version"
                      :checking="checking"
                      @retry="checkAgain"
                    />
                  </section>
                  <section
                    v-else-if="phase === 'launching'"
                    key="launching"
                    class="popup-page popup-launching"
                  >
                    <div class="popup-launching__content">
                      <NSpin size="large" />
                      <div class="popup-launching__copy" role="status" aria-live="polite">
                        <h2>{{ i18n('popup_launching_title', 'Starting Rayburst') }}</h2>
                        <p>
                          {{
                            i18n(
                              'popup_launching_hint',
                              'Waiting for the desktop app to become ready…',
                            )
                          }}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section
                    v-else-if="phase === 'connected' && globalStat"
                    key="connected"
                    class="popup-page"
                  >
                    <StatDashboard :stat="globalStat" :disabled="!enabled" />
                    <Transition name="pop">
                      <LegacyDesktopNotice
                        v-if="legacyDesktop && legacyDesktop !== noticeDismissed"
                        layout="popup"
                        :name="legacyDesktop"
                        class="popup-legacy"
                        @dismiss="dismissNotice"
                      />
                    </Transition>
                    <TaskList
                      v-if="!legacyDesktop"
                      :tasks="tasks"
                      @pause="(gid) => controlTask(gid, 'pause')"
                      @resume="(gid) => controlTask(gid, 'resume')"
                      @reveal="(gid) => controlTask(gid, 'reveal')"
                    />
                    <!-- The bulk action that applies shares the footer with opening the app. -->
                    <TransitionGroup tag="div" name="pop" class="popup-actions popup-actions--open">
                      <NButton
                        v-if="canPauseAll || canResumeAll"
                        :key="canPauseAll ? 'pause' : 'resume'"
                        size="small"
                        secondary
                        :disabled="!enabled"
                        @click="canPauseAll ? pauseAll() : resumeAll()"
                      >
                        <template #icon>
                          <NIcon><PauseOutline v-if="canPauseAll" /><PlayOutline v-else /></NIcon>
                        </template>
                        {{
                          canPauseAll
                            ? i18n('popup_action_pause_all', 'Pause All')
                            : i18n('popup_action_resume_all', 'Resume All')
                        }}
                      </NButton>
                      <NButton
                        key="open"
                        size="small"
                        secondary
                        type="primary"
                        :loading="opening"
                        @click="openApp"
                      >
                        <template #icon>
                          <NIcon><RocketOutline /></NIcon>
                        </template>
                        {{ i18n('popup_action_open', 'Open Rayburst') }}
                      </NButton>
                    </TransitionGroup>
                  </section>

                  <section v-else :key="phase" class="popup-page popup-unavailable">
                    <div class="popup-banner popup-banner--error">
                      <NIcon :size="16" class="popup-banner__icon">
                        <AlertCircleOutline />
                      </NIcon>
                      <div
                        v-if="
                          errorType === 'ApiEngineStartingError' ||
                          errorType === 'ApiEngineUnavailableError'
                        "
                      >
                        <p class="popup-banner__title">
                          {{
                            errorType === 'ApiEngineStartingError'
                              ? i18n('error_engine_starting', 'Rayburst engine is starting')
                              : i18n('error_engine_unavailable', 'Rayburst engine is unavailable')
                          }}
                        </p>
                        <p class="popup-banner__hint">
                          {{
                            i18n(
                              'error_engine_hint',
                              'Open Rayburst to check the engine, then reconnect.',
                            )
                          }}
                        </p>
                      </div>
                      <div v-else-if="phase === 'failed'">
                        <p class="popup-banner__title">
                          {{ i18n('popup_launch_failed_title', 'Could not start Rayburst') }}
                        </p>
                        <p class="popup-banner__hint">
                          {{
                            activationFailed && !openLink
                              ? i18n(
                                  'popup_launch_link_hint',
                                  'The browser can start Rayburst through a link instead.',
                                )
                              : i18n(
                                  'popup_launch_failed_hint',
                                  'Check that Rayburst is installed and its API settings are correct.',
                                )
                          }}
                        </p>
                      </div>
                      <div v-else-if="errorType === 'ApiAuthError'">
                        <p class="popup-banner__title">
                          {{ i18n('popup_error_auth', 'API secret mismatch') }}
                        </p>
                        <p class="popup-banner__hint">
                          {{
                            i18n(
                              'popup_error_auth_hint',
                              'Check that the API secret in Settings matches your Rayburst configuration.',
                            )
                          }}
                        </p>
                      </div>
                      <div v-else-if="errorType === 'ApiTimeoutError'">
                        <p class="popup-banner__title">
                          {{ i18n('popup_error_timeout', 'Connection timed out') }}
                        </p>
                        <p class="popup-banner__hint">
                          {{
                            i18nSub(
                              'popup_error_timeout_hint',
                              [String(connectionPort)],
                              `Check your network or firewall settings. API port: ${connectionPort}`,
                            )
                          }}
                        </p>
                      </div>
                      <div v-else>
                        <p class="popup-banner__title">
                          {{ i18n('popup_error_unreachable', 'Cannot connect to Rayburst') }}
                        </p>
                        <p class="popup-banner__hint">
                          {{
                            i18nSub(
                              'popup_error_unreachable_hint',
                              [String(connectionPort)],
                              `Make sure Rayburst is running. API port: ${connectionPort}`,
                            )
                          }}
                        </p>
                      </div>
                    </div>
                    <div class="popup-actions popup-actions--unavailable">
                      <NButton
                        v-if="
                          errorType === 'ApiEngineStartingError' ||
                          errorType === 'ApiEngineUnavailableError'
                        "
                        size="small"
                        secondary
                        :loading="opening"
                        @click="openApp"
                        >{{ i18n('popup_action_open', 'Open Rayburst') }}</NButton
                      >
                      <NButton
                        v-if="phase === 'failed' && activationFailed && !openLink"
                        size="small"
                        secondary
                        @click="launchThroughLink"
                        >{{ i18n('popup_action_launch_link', 'Start Through a Link') }}</NButton
                      >
                      <NButton
                        size="small"
                        type="primary"
                        @click="errorType?.startsWith('ApiEngine') ? checkAgain() : launchApp()"
                      >
                        <template #icon>
                          <NIcon><RocketOutline /></NIcon>
                        </template>
                        {{
                          phase === 'failed' || errorType?.startsWith('ApiEngine')
                            ? i18n('popup_action_retry', 'Try Again')
                            : i18n('popup_action_launch', 'Launch Rayburst')
                        }}
                      </NButton>
                    </div>
                  </section>
                </Transition>
              </div>
            </Transition>
            <Transition :name="tabTransition">
              <div v-if="mediaVisited" v-show="view === 'media'">
                <MediaPanel :active="view === 'media'" />
              </div>
            </Transition>
          </AutoHeight>
        </template>
      </div>
    </div>
  </NConfigProvider>
</template>

<style scoped>
.popup-unsupported {
  display: flex;
}
.popup-legacy {
  margin: 0 12px;
}
.sniffer-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.popup-root {
  --tab-shift: 24px;
  width: 100%;
  display: flex;
  max-height: 600px;
  overflow: hidden;
  background: var(--color-surface);
  color: var(--color-on-surface);
  font-family: var(--font-sans);
}

.popup-root[dir='rtl'] {
  --tab-shift: -24px;
}

.popup-content {
  min-width: 0;
  width: 100%;
  overflow: auto;
  overscroll-behavior: contain;
}

/* The leaving pane floats over the entering one, so the height animates
 * straight to the new pane while both slide. */
.tab-forward-leave-active,
.tab-back-leave-active {
  position: absolute;
  inset: 0 0 auto;
}

.tab-forward-enter-active,
.tab-forward-leave-active,
.tab-back-enter-active,
.tab-back-leave-active {
  transition:
    transform 240ms var(--m3-ease-emphasized),
    opacity 180ms ease;
}

.tab-forward-enter-from,
.tab-back-leave-to {
  opacity: 0;
  transform: translateX(var(--tab-shift));
}

.tab-forward-leave-to,
.tab-back-enter-from {
  opacity: 0;
  transform: translateX(calc(-1 * var(--tab-shift)));
}

/* ── Skeleton ─────────────────────────────────────────────────── */
.popup-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.popup-skeleton__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.popup-skeleton__spacer {
  flex: 1;
}

.popup-skeleton__body {
  display: flex;
  gap: 8px;
  flex: 1;
}

.popup-skeleton__body :deep(.n-skeleton) {
  flex: 1;
}

.popup-skeleton__footer {
  display: flex;
  justify-content: flex-end;
}

.popup-launching {
  padding: 28px 20px;
  text-align: center;
}

.popup-launching__content {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
}

.popup-launching__copy h2 {
  font-size: 14px;
  font-weight: 600;
}

.popup-launching__copy p {
  margin-top: 2px;
  color: var(--color-on-surface-variant);
  font-size: 11px;
}

.popup-unavailable {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.popup-unavailable > .popup-banner {
  align-self: center;
  width: calc(100% - 24px);
  margin: 0 12px;
}

/* ── Disconnected Banner ─────────────────────────────────────── */
.popup-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 4px 16px 8px;
  padding: 10px 12px;
  border-radius: 10px;
}

.popup-banner--error {
  background: color-mix(in srgb, var(--color-error) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-error) 20%, transparent);
}

.popup-banner__icon {
  color: var(--color-error);
  flex-shrink: 0;
  margin-top: 1px;
}

.popup-banner__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-error);
}

.popup-banner__hint {
  font-size: 11px;
  color: var(--color-on-surface-variant);
  margin-top: 2px;
}

/* ── Actions ─────────────────────────────────────────────────── */
.popup-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  position: relative;
  gap: 8px;
  padding: 8px 12px 12px;
}

/* One spacing rhythm: 12px gutters, 8px between blocks, 12px at both ends. */
.popup-tabs {
  padding: 0 12px 8px;
}

.popup-page {
  display: grid;
  gap: 8px;
}

/* Footer buttons share its width evenly, connected or not. */
.popup-actions > .n-button {
  flex: 1;
}

/* A leaving button steps out of the row so the other can widen. */
.popup-actions > .pop-leave-active {
  position: absolute;
}
</style>
