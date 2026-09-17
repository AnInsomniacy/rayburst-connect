<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NSelect,
  NSwitch,
  NSpin,
  NDropdown,
  NIcon,
  NTooltip,
  NTag,
} from 'naive-ui';
import {
  sendMediaCommand,
  type MediaCommand,
  type MediaItem,
  type MediaList,
} from '@/lib/media/messages';
import { mediaFailureKey, mediaSize } from '@/lib/media/presentation';
import { useI18n } from '@/shared/i18n/engine';
import { usePolling } from '@/shared/use-polling';
import { MEDIA_SESSION_KEY } from '@/lib/schema';
import MediaSelection from './MediaSelection.vue';
import MediaTools from './MediaTools.vue';
import MediaPreview from './MediaPreview.vue';
import CollapsePanel from '@/shared/components/CollapsePanel.vue';
import {
  CopyOutline,
  PlayCircleOutline,
  OptionsOutline,
  EllipsisHorizontalOutline,
  RefreshOutline,
  OpenOutline,
  AlbumsOutline,
} from '@vicons/ionicons5';

const props = withDefaults(defineProps<{ active?: boolean; expanded?: boolean }>(), {
  active: true,
});
const { t, effectiveLocale } = useI18n();
const state = ref<MediaList | null>(null);
const tabId = ref<number>();
const allTabs = ref(false);
const query = ref('');
const kind = ref('all');
const sort = ref('time');
const selectedId = ref('');
const checked = ref(new Set<string>());
const error = ref('');
const busy = ref(false);
const loading = ref(true);
const toolsOpen = ref(false);
const preview = ref<MediaItem>();
const selected = computed(() => state.value?.items.find((item) => item.id === selectedId.value));
const filtered = computed(() => {
  const needle = query.value.toLowerCase();
  const values = (state.value?.items ?? []).filter(
    (item) =>
      item.kind !== 'embedded' &&
      (kind.value === 'all' || item.kind === kind.value) &&
      `${item.title} ${item.filename} ${item.url} ${item.mime}`.toLowerCase().includes(needle),
  );
  return values.sort((a, b) =>
    sort.value === 'size'
      ? (b.size ?? 0) - (a.size ?? 0)
      : sort.value === 'name'
        ? (a.filename || a.title).localeCompare(b.filename || b.title)
        : b.lastSeen - a.lastSeen,
  );
});
const kinds = computed(() =>
  [
    'all',
    ...new Set(
      state.value?.items.filter((item) => item.kind !== 'embedded').map((item) => item.kind),
    ),
  ].map((value) => ({
    value,
    label:
      value === 'all'
        ? t('resources_all')
        : ['hls', 'dash', 'json'].includes(value)
          ? value.toUpperCase()
          : t(`resources_kind_${value}`),
  })),
);
const pending = computed(() =>
  Boolean(
    selected.value?.operation &&
    ['probing', 'submitting', 'cancelling'].includes(selected.value.operation.state),
  ),
);
let disposed = false;
let refreshing = false;
async function refresh() {
  if (disposed || props.active === false || tabId.value === undefined || refreshing) return true;
  refreshing = true;
  try {
    if (pending.value && selected.value)
      await sendMediaCommand({
        type: 'MEDIA_POLL',
        tabId: selected.value.tabId,
        candidateId: selected.value.id,
      });
    state.value = await sendMediaCommand({
      type: 'MEDIA_LIST',
      tabId: allTabs.value ? -1 : tabId.value,
    });
    const ids = new Set(state.value.items.map((item) => item.id));
    checked.value = new Set([...checked.value].filter((id) => ids.has(id)));
    return true;
  } catch (cause) {
    error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
    return false;
  } finally {
    refreshing = false;
    loading.value = false;
  }
}
const poller = usePolling({ fn: refresh, baseIntervalMs: 1500, maxIntervalMs: 10000 });
watch(pending, (value) => (value ? poller.start() : poller.stop()));
watch([allTabs, () => props.active], () => {
  selectedId.value = '';
  void refresh();
});
async function command(value: MediaCommand) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await sendMediaCommand(value);
    await refresh();
  } catch (cause) {
    error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
  } finally {
    busy.value = false;
  }
}
async function select(item: MediaItem) {
  selectedId.value = item.id;
  if (
    ['hls', 'dash', 'collection'].includes(item.kind) &&
    (!item.operation || ['submitted', 'cancelled', 'failed'].includes(item.operation.state))
  )
    await command({ type: 'MEDIA_PROBE', tabId: item.tabId, candidateId: item.id });
}
function toggle(id: string, value: boolean) {
  const item = state.value?.items.find((candidate) => candidate.id === id);
  if (value && (!item || item.kind === 'embedded' || item.method !== 'GET')) return;
  const next = new Set(checked.value);
  if (value) next.add(id);
  else next.delete(id);
  checked.value = next;
}
async function batch(action: 'download' | 'copy' | 'clear') {
  const items = filtered.value.filter((item) => checked.value.has(item.id));
  if (action === 'copy') {
    await navigator.clipboard.writeText(items.map((item) => item.url).join('\n'));
    return;
  }
  if (action === 'download') {
    busy.value = true;
    error.value = '';
    try {
      const result: unknown = await browser.runtime.sendMessage({
        type: 'MEDIA_BATCH',
        tabId: tabId.value,
        ids: items.map((item) => item.id),
      });
      if (result && typeof result === 'object' && 'error' in result)
        throw new Error(String(result.error));
      z.object({ ok: z.literal(true) }).parse(result);
      await refresh();
    } catch (cause) {
      error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
    } finally {
      busy.value = false;
    }
  } else
    for (const item of items)
      await command({ type: 'MEDIA_CLEAR', tabId: item.tabId, candidateId: item.id });
}
async function merge(sequence: boolean) {
  if (tabId.value === undefined) return;
  busy.value = true;
  try {
    const result: unknown = await browser.runtime.sendMessage({
      type: 'MEDIA_MERGE',
      tabId: tabId.value,
      ids: [...checked.value],
      sequence,
    });
    if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
      await refresh();
      selectedId.value = result.id;
    } else error.value = 'media_unsupported';
  } finally {
    busy.value = false;
  }
}
function copy(url: string) {
  void navigator.clipboard.writeText(url);
}
const actions = computed(() => [
  { key: 'all', label: t('resources_select_all') },
  { key: 'invert', label: t('resources_invert') },
  { key: 'copy', label: t('resources_copy'), disabled: !checked.value.size },
  { key: 'merge', label: t('resources_merge'), disabled: !checked.value.size || allTabs.value },
  {
    key: 'sequence',
    label: t('resources_sequence'),
    disabled: !checked.value.size || allTabs.value,
  },
  { key: 'clear', label: t('media_clear'), disabled: !checked.value.size },
]);
function action(value: string) {
  if (value === 'all') filtered.value.forEach((item) => toggle(item.id, true));
  else if (value === 'invert')
    filtered.value.forEach((item) => toggle(item.id, !checked.value.has(item.id)));
  else if (value === 'merge' || value === 'sequence') void merge(value === 'sequence');
  else if (value === 'copy' || value === 'clear') void batch(value);
}
async function openPage() {
  await browser.tabs.create({ url: browser.runtime.getURL('/media.html') + `?tab=${tabId.value}` });
}
async function openSidebar() {
  if (import.meta.env.FIREFOX) {
    const sidebar: unknown = Reflect.get(browser, 'sidebarAction');
    if (
      sidebar &&
      typeof sidebar === 'object' &&
      'open' in sidebar &&
      typeof sidebar.open === 'function'
    )
      await sidebar.open();
  } else if (tabId.value !== undefined) await browser.sidePanel.open({ tabId: tabId.value });
}
const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (change, area) => {
  if (area === 'session' && change[MEDIA_SESSION_KEY]) void refresh();
};
const activated: Parameters<typeof browser.tabs.onActivated.addListener>[0] = (info) => {
  if (props.expanded && !new URL(window.location.href).searchParams.has('tab')) {
    tabId.value = info.tabId;
    selectedId.value = '';
    void refresh();
  }
};
onMounted(async () => {
  const supplied = Number(new URL(window.location.href).searchParams.get('tab'));
  const tab =
    supplied > 0
      ? await browser.tabs.get(supplied)
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (disposed) return;
  if (tab?.id !== undefined && tab.url?.startsWith('http')) tabId.value = tab.id;
  await refresh();
  loading.value = false;
  browser.storage.onChanged.addListener(changed);
  browser.tabs.onActivated.addListener(activated);
});
onUnmounted(() => {
  disposed = true;
  poller.stop();
  browser.storage.onChanged.removeListener(changed);
  browser.tabs.onActivated.removeListener(activated);
});
</script>
<template>
  <section class="resources" :class="{ expanded }" :aria-busy="busy || loading">
    <NSpin v-if="loading" size="small" />
    <NEmpty v-else-if="tabId === undefined" :description="t('media_open_page')" />
    <template v-else>
      <header class="resource-toolbar">
        <NSelect
          :value="allTabs ? 'all' : 'current'"
          size="small"
          :consistent-menu-width="false"
          :options="[
            { value: 'current', label: t('resources_current') },
            { value: 'all', label: t('resources_other') },
          ]"
          :aria-label="t('media_sources')"
          @update:value="allTabs = $event === 'all'"
        />
        <NTag size="small" round :bordered="false">{{
          state?.items.filter((item) => item.kind !== 'embedded').length ?? 0
        }}</NTag>
        <span class="toolbar-space" />
        <NSwitch
          size="small"
          :value="state?.enabled"
          :aria-label="t('media_discover')"
          @update:value="command({ type: 'MEDIA_ENABLE', tabId, enabled: $event })"
        />
        <NTooltip
          ><template #trigger
            ><NButton
              size="small"
              quaternary
              circle
              :aria-label="t('resources_tools')"
              :aria-expanded="toolsOpen"
              @click="toolsOpen = !toolsOpen"
              ><template #icon
                ><NIcon><OptionsOutline /></NIcon></template></NButton></template
          >{{ t('resources_tools') }}</NTooltip
        >
      </header>
      <NAlert v-if="error" type="error" closable @close="error = ''">{{ t(error) }}</NAlert>
      <CollapsePanel :open="toolsOpen"
        ><MediaTools
          :tab-id="selected?.tabId ?? tabId"
          :source="selected"
          @created="refresh().then(() => (selectedId = $event))"
      /></CollapsePanel>
      <div class="resource-stage">
        <Transition :name="selected ? 'media-forward' : 'media-back'">
          <MediaSelection
            v-if="selected"
            :key="selected.id"
            :item="selected"
            :busy="busy"
            @back="selectedId = ''"
            @advanced="toolsOpen = true"
            @inspect="
              command({ type: 'MEDIA_PROBE', tabId: selected.tabId, candidateId: selected.id })
            "
            @refresh="refresh"
            @cancel="
              command({ type: 'MEDIA_CANCEL', tabId: selected.tabId, candidateId: selected.id })
            "
            @download-file="
              command({
                type: 'MEDIA_DOWNLOAD_FILE',
                tabId: selected.tabId,
                candidateId: selected.id,
              })
            "
            @submit="
              command({
                type: 'MEDIA_SUBMIT',
                tabId: selected.tabId,
                candidateId: selected.id,
                selection: $event,
              })
            "
          />
          <div v-else key="catalog" class="resource-catalog">
            <div class="resource-filters">
              <NInput
                v-model:value="query"
                clearable
                :placeholder="t('media_filter')"
                :aria-label="t('media_filter')"
              />
              <NSelect v-model:value="kind" :options="kinds" :aria-label="t('resources_type')" />
              <NSelect
                v-model:value="sort"
                :options="[
                  { value: 'time', label: t('resources_time') },
                  { value: 'size', label: t('resources_size') },
                  { value: 'name', label: t('resources_name') },
                ]"
                :aria-label="t('resources_sort')"
              />
            </div>
            <div class="resource-list">
              <article v-for="item in filtered" :key="item.id" class="resource-row">
                <NCheckbox
                  :checked="checked.has(item.id)"
                  :disabled="item.kind === 'embedded' || item.method !== 'GET'"
                  :aria-label="item.filename || item.title"
                  @update:checked="toggle(item.id, $event)"
                />
                <button class="resource-title" @click="select(item)">
                  <strong>{{ item.filename || item.title || item.url }}</strong>
                  <span
                    >{{
                      ['hls', 'dash'].includes(item.kind)
                        ? item.kind.toUpperCase()
                        : t(`resources_kind_${item.kind}`)
                    }}
                    · {{ mediaSize(item.size, effectiveLocale, t('media_size_unknown')) }}</span
                  >
                  <small v-if="allTabs">{{ item.title }}</small>
                  <small v-if="item.downloadError || item.operation?.error">{{
                    t(
                      mediaFailureKey(
                        item.downloadError || item.operation?.error || 'operation_failed',
                      ),
                    )
                  }}</small>
                  <small v-else-if="item.sentToDesktop || item.operation?.state === 'submitted'">{{
                    t('media_submitted')
                  }}</small>
                  <small v-else-if="item.kind === 'embedded'">{{ t('media_waiting') }}</small>
                </button>
                <NButton
                  size="small"
                  quaternary
                  circle
                  :aria-label="t('resources_copy')"
                  @click="copy(item.url)"
                  ><template #icon
                    ><NIcon><CopyOutline /></NIcon></template
                ></NButton>
                <NButton
                  size="small"
                  quaternary
                  circle
                  :aria-label="t('resources_preview')"
                  @click="preview = preview?.id === item.id ? undefined : item"
                  ><template #icon
                    ><NIcon><PlayCircleOutline /></NIcon></template
                ></NButton>
              </article>
              <NEmpty v-if="!filtered.length" :description="t('media_none')" />
            </div>
            <MediaPreview v-if="preview" :item="preview" />
            <footer class="resource-actions">
              <NDropdown trigger="click" :options="actions" @select="action"
                ><NButton size="small" quaternary circle :aria-label="t('resources_tools')"
                  ><template #icon
                    ><NIcon><EllipsisHorizontalOutline /></NIcon></template></NButton
              ></NDropdown>
              <NButton
                size="small"
                quaternary
                circle
                :aria-label="t('media_scan')"
                @click="command({ type: 'MEDIA_RESCAN', tabId })"
                ><template #icon
                  ><NIcon><RefreshOutline /></NIcon></template
              ></NButton>
              <NButton
                v-if="!expanded"
                size="small"
                quaternary
                circle
                :aria-label="t('resources_sidebar')"
                @click="openSidebar"
                ><template #icon
                  ><NIcon><AlbumsOutline /></NIcon></template
              ></NButton>
              <NButton
                v-if="!expanded"
                size="small"
                quaternary
                circle
                :aria-label="t('resources_expand')"
                @click="openPage"
                ><template #icon
                  ><NIcon><OpenOutline /></NIcon></template
              ></NButton>
              <span class="toolbar-space" />
              <NButton
                size="small"
                :disabled="!checked.size || busy"
                type="primary"
                :loading="busy"
                @click="batch('download')"
                >{{ t('media_download')
                }}<span v-if="checked.size"> ({{ checked.size }})</span></NButton
              >
            </footer>
          </div></Transition
        >
      </div>
    </template>
  </section>
</template>
<style scoped>
.resources {
  display: grid;
  gap: 12px;
  padding: 4px 16px 12px;
  max-height: 540px;
  overflow: auto;
}
.resources.expanded {
  max-height: none;
  max-width: 1120px;
  margin: auto;
  padding: 16px 24px;
}
.resource-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 36px;
}
.resource-toolbar > .n-select {
  width: 150px;
}
.toolbar-space {
  flex: 1;
}
.resource-stage {
  position: relative;
  min-height: 160px;
}
.resource-catalog {
  display: grid;
  gap: 12px;
}
.resource-filters {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 100px 110px;
  gap: 8px;
}
.resource-list {
  display: grid;
  gap: 2px;
}
.resource-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid var(--color-outline-variant);
  content-visibility: auto;
  contain-intrinsic-size: auto 64px;
}
.resource-title {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
  text-align: start;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.resource-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}
.resource-title span,
.resource-title small {
  font-size: 12px;
  color: var(--color-on-surface-variant);
}
.resource-title:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 4px;
  border-radius: var(--radius-sm);
}
.resource-row:has(.n-checkbox--checked) {
  background: color-mix(in srgb, var(--color-primary-container) 30%, transparent);
}
.resource-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  position: sticky;
  bottom: 0;
  padding: 8px 0 0;
  background: var(--color-surface);
}
@media (max-width: 440px) {
  .resource-filters {
    grid-template-columns: 1fr 1fr;
  }
  .resource-filters > :first-child {
    grid-column: 1/-1;
  }
  .resources.expanded {
    padding: 8px 16px;
  }
}
</style>
