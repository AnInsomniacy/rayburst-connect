<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from '@/lib/validation';
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NSwitch,
  NSpin,
  NDropdown,
  NPopselect,
  NIcon,
  NTooltip,
} from 'naive-ui';
import {
  sendMediaCommand,
  type MediaCommand,
  type MediaItem,
  type MediaList,
} from '@/lib/media/messages';
import { mediaFailureKey, mediaSize } from '@/lib/media/presentation';
import {
  countMediaResources,
  groupMediaResources,
  isMediaResource,
  trackCollection,
} from '@/lib/media/resources';
import { useI18n } from '@/shared/i18n/engine';
import { usePolling } from '@/shared/use-polling';
import { MEDIA_SESSION_KEY, parseMediaSettings, parseDownloadSettings } from '@/lib/schema';
import { loadSnapshot } from '@/lib/storage';
import MediaSelection from './MediaSelection.vue';
import MediaTools from './MediaTools.vue';
import MediaPreview from './MediaPreview.vue';
import CollapsePanel from '@/shared/components/CollapsePanel.vue';
import {
  CopyOutline,
  DownloadOutline,
  ListOutline,
  PlayCircleOutline,
  OptionsOutline,
  EllipsisHorizontalOutline,
  RefreshOutline,
  SearchOutline,
  SwapVerticalOutline,
  OpenOutline,
  CheckmarkOutline,
  ChevronDownOutline,
  FilmOutline,
} from '@vicons/ionicons5';

const props = withDefaults(defineProps<{ active?: boolean; expanded?: boolean }>(), {
  active: true,
});
const { t, tSub, effectiveLocale } = useI18n();
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
const rowBusy = ref(new Set<string>());
const downloadIntent = ref('');
const preferences = ref(parseMediaSettings({}));
const loading = ref(true);
const toolsOpen = ref(false);
const preview = ref<MediaItem>();
/** Turns of the rescan icon; each click spins it once. */
const scanTurns = ref(0);
const selected = computed(() => state.value?.items.find((item) => item.id === selectedId.value));
const resourceCount = computed(() => countMediaResources(state.value?.items ?? []));
const hasFilter = computed(() => Boolean(query.value.trim()) || kind.value !== 'all');
/** Resources matching the search, before the type filter. */
const searched = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return (state.value?.items ?? []).filter(
    (item) =>
      isMediaResource(item) &&
      `${item.title} ${item.filename} ${item.url} ${item.mime}`.toLowerCase().includes(needle),
  );
});
const filtered = computed(() => {
  const values = searched.value.filter((item) => kind.value === 'all' || item.kind === kind.value);
  return values.sort((a, b) =>
    sort.value === 'size'
      ? (b.size ?? 0) - (a.size ?? 0)
      : sort.value === 'name'
        ? (a.filename || a.title).localeCompare(b.filename || b.title)
        : preferences.value.newestFirst
          ? b.firstSeen - a.firstSeen
          : a.firstSeen - b.firstSeen,
  );
});
/** Complete videos made of track files come first; their files show on request. */
const expandedGroups = ref(new Set<string>());
const groupKey = (item: MediaItem) => `${item.tabId}:${item.frameId}:${item.documentId}`;
type Row =
  | { key: string; item: MediaItem; member: boolean; group?: undefined }
  | { key: string; group: MediaItem[]; collection?: MediaItem; item?: undefined };
const rows = computed<Row[]>(() => {
  const entries = groupMediaResources(filtered.value);
  return [
    ...entries.filter((entry): entry is MediaItem[] => Array.isArray(entry)),
    ...entries.filter((entry): entry is MediaItem => !Array.isArray(entry)),
  ].flatMap((entry): Row[] => {
    if (!Array.isArray(entry)) return [{ key: entry.id, item: entry, member: false }];
    const key = groupKey(entry[0]!);
    return [
      { key, group: entry, collection: trackCollection(entry, state.value?.items ?? []) },
      ...(expandedGroups.value.has(key)
        ? entry.map((item) => ({ key: item.id, item, member: true }))
        : []),
    ];
  });
});
/** Rows a selection can reach; a collapsed complete video keeps its files out. */
const visibleItems = computed(() =>
  rows.value.flatMap((row) => (row.item && row.item.method === 'GET' ? [row.item] : [])),
);
/** What a batch action takes: the checked resources the filters show. */
const checkedItems = computed(() => filtered.value.filter((item) => checked.value.has(item.id)));
const allVisibleChecked = computed(
  () =>
    visibleItems.value.length > 0 && visibleItems.value.every((item) => checked.value.has(item.id)),
);
const someVisibleChecked = computed(() =>
  visibleItems.value.some((item) => checked.value.has(item.id)),
);
function toggleVisible() {
  const value = !allVisibleChecked.value;
  visibleItems.value.forEach((item) => toggle(item.id, value));
}
const mergeable = computed(() => {
  const items = filtered.value.filter((item) => checked.value.has(item.id));
  return (
    !allTabs.value &&
    items.length > 1 &&
    items.every(
      (item) =>
        ['file', 'fragment', 'subtitle'].includes(item.kind) &&
        item.method === 'GET' &&
        item.frameId === items[0]!.frameId &&
        item.documentId === items[0]!.documentId,
    )
  );
});
function toggleGroup(key: string) {
  const next = new Set(expandedGroups.value);
  if (!next.delete(key)) next.add(key);
  expandedGroups.value = next;
}
function groupSize(group: MediaItem[]) {
  return group.every((item) => item.size !== null)
    ? group.reduce((sum, item) => sum + (item.size ?? 0), 0)
    : null;
}
async function inspectTracks(group: MediaItem[], download = false) {
  const id = await merge(
    group.map((item) => item.id),
    false,
    group[0]!.tabId,
  );
  if (id && download && preferences.value.quickDownload) downloadIntent.value = id;
}
const scopes = computed(() => [
  { value: 'current', label: t('resources_current') },
  { value: 'all', label: t('resources_other') },
]);
const sorts = computed(() => [
  { value: 'time', label: t('resources_time') },
  { value: 'size', label: t('resources_size') },
  { value: 'name', label: t('resources_name') },
]);
const showFilters = computed(() => resourceCount.value >= 4 || hasFilter.value);
/** Types with their counts under the current search; the chosen one stays even at zero. */
const kinds = computed(() => {
  const counts = new Map<string, number>();
  for (const item of searched.value) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  if (kind.value !== 'all' && !counts.has(kind.value)) counts.set(kind.value, 0);
  return [['all', searched.value.length] as const, ...counts].map(([value, count]) => ({
    value,
    count,
    label:
      value === 'all'
        ? t('resources_all')
        : ['hls', 'dash', 'json'].includes(value)
          ? value.toUpperCase()
          : t(`resources_kind_${value}`),
  }));
});
/** One type needs no chips to choose it. */
const showKinds = computed(() => kinds.value.length > 2 || kind.value !== 'all');
const pending = computed(() =>
  Boolean(
    selected.value?.operation &&
    ['probing', 'submitting', 'cancelling'].includes(selected.value.operation.state),
  ),
);
let disposed = false;
let refreshing = false;
let refreshFailed = false;
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
    // A failed refresh is over once one succeeds; its notice must not outlive it.
    if (refreshFailed) error.value = '';
    refreshFailed = false;
    return true;
  } catch (cause) {
    error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
    refreshFailed = true;
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
  const id = 'candidateId' in value ? value.candidateId : undefined;
  if (id ? rowBusy.value.has(id) : busy.value) return;
  if (id) rowBusy.value = new Set([...rowBusy.value, id]);
  else busy.value = true;
  error.value = '';
  try {
    await sendMediaCommand(value);
    await refresh();
  } catch (cause) {
    error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
  } finally {
    if (id) {
      const next = new Set(rowBusy.value);
      next.delete(id);
      rowBusy.value = next;
    } else busy.value = false;
  }
}
async function select(item: MediaItem) {
  downloadIntent.value = '';
  selectedId.value = item.id;
  if (
    ['hls', 'dash', 'collection'].includes(item.kind) &&
    (!item.operation || ['submitted', 'cancelled', 'failed'].includes(item.operation.state))
  )
    await command({ type: 'MEDIA_PROBE', tabId: item.tabId, candidateId: item.id });
}
async function download(item: MediaItem) {
  if (rowBusy.value.has(item.id)) return;
  if (['hls', 'dash', 'collection'].includes(item.kind)) {
    await select(item);
    if (preferences.value.quickDownload) downloadIntent.value = item.id;
  } else await command({ type: 'MEDIA_DOWNLOAD_FILE', tabId: item.tabId, candidateId: item.id });
}
watch([downloadIntent, selected], async () => {
  const item = selected.value;
  if (!item || downloadIntent.value !== item.id || item.operation?.probe?.state !== 'ready') return;
  const presentation = item.operation.probe.presentation;
  downloadIntent.value = '';
  if (
    presentation.live ||
    presentation.tracks.filter((track) => ['video', 'muxed'].includes(track.type)).length > 1 ||
    presentation.tracks.filter((track) => track.type === 'audio').length > 1 ||
    presentation.tracks.some((track) => track.type === 'subtitle')
  )
    return;
  await command({
    type: 'MEDIA_SUBMIT',
    tabId: item.tabId,
    candidateId: item.id,
    selection: presentation.defaults,
  });
  if (selected.value?.operation?.state === 'submitted') selectedId.value = '';
});
function sourceName(item: MediaItem) {
  const value = item.filename || item.title || item.url;
  const characters = Array.from(value);
  return characters.length > 32
    ? {
        prefix: characters.slice(0, -16).join(''),
        suffix: characters.slice(-16).join(''),
        full: value,
      }
    : { prefix: value, suffix: '', full: value };
}
/** Secondary actions surface with the row's hover or focus; download always shows. */
function rowActions(item: MediaItem) {
  return [
    {
      key: 'copy',
      icon: CopyOutline,
      label: t('resources_copy'),
      secondary: true,
      run: () => copy(item.url),
    },
    ...(['hls', 'dash', 'collection'].includes(item.kind)
      ? [
          {
            key: 'inspect',
            icon: ListOutline,
            label: t('media_inspect'),
            secondary: true,
            run: () => select(item),
          },
        ]
      : []),
    ...(!['json', 'subtitle', 'embedded', 'collection'].includes(item.kind)
      ? [
          {
            key: 'preview',
            icon: PlayCircleOutline,
            label: t('resources_preview'),
            // An open preview keeps its control in reach.
            secondary: preview.value?.id !== item.id,
            run: () => {
              preview.value = preview.value?.id === item.id ? undefined : item;
            },
          },
        ]
      : []),
    {
      key: sent(item) ? 'downloaded' : 'download',
      icon: sent(item) ? CheckmarkOutline : DownloadOutline,
      label: t('media_download'),
      secondary: false,
      run: () => download(item),
    },
  ];
}
const footerTools = computed(() => [
  { key: 'scan', icon: RefreshOutline, label: t('media_scan'), run: rescan },
  ...(props.expanded
    ? []
    : [{ key: 'page', icon: OpenOutline, label: t('resources_expand'), run: openPage }]),
]);
function sent(item: MediaItem) {
  return item.sentToDesktop || item.operation?.state === 'submitted';
}
function rescan() {
  scanTurns.value += 1;
  if (tabId.value !== undefined) void command({ type: 'MEDIA_RESCAN', tabId: tabId.value });
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
  const items = checkedItems.value;
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
async function merge(ids: string[], sequence: boolean, tab = tabId.value) {
  if (tab === undefined || busy.value) return;
  busy.value = true;
  try {
    const result: unknown = await browser.runtime.sendMessage({
      type: 'MEDIA_MERGE',
      tabId: tab,
      ids,
      sequence,
    });
    if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
      await refresh();
      selectedId.value = result.id;
      return result.id;
    }
    error.value = 'media_unsupported';
  } finally {
    busy.value = false;
  }
}
function copy(url: string) {
  void navigator.clipboard.writeText(url);
}
const actions = computed(() => [
  ...(props.expanded ? [] : [{ key: 'sidebar', label: t('resources_sidebar') }]),
  { key: 'settings', label: t('media_settings_title') },
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
  if (value === 'sidebar') void openSidebar();
  else if (value === 'settings')
    void browser.tabs.create({ url: browser.runtime.getURL('/options.html') + '#media' });
  else if (value === 'all') visibleItems.value.forEach((item) => toggle(item.id, true));
  else if (value === 'invert')
    visibleItems.value.forEach((item) => toggle(item.id, !checked.value.has(item.id)));
  else if (value === 'merge' || value === 'sequence')
    void merge([...checked.value], value === 'sequence');
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
  if (area === 'local' && change.settings)
    preferences.value = parseDownloadSettings(change.settings.newValue).mediaDiscovery;
};
const activated: Parameters<typeof browser.tabs.onActivated.addListener>[0] = (info) => {
  if (props.expanded && !new URL(window.location.href).searchParams.has('tab')) {
    tabId.value = info.tabId;
    selectedId.value = '';
    void refresh();
  }
};
onMounted(async () => {
  preferences.value = (await loadSnapshot()).settings.mediaDiscovery;
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
    <NSpin v-if="loading" class="resource-state" size="small" />
    <NEmpty
      v-else-if="tabId === undefined"
      class="resource-state"
      :description="t('media_open_page')"
    />
    <template v-else>
      <div class="resource-head">
        <header class="resource-toolbar">
          <NPopselect
            :value="allTabs ? 'all' : 'current'"
            :options="scopes"
            trigger="click"
            @update:value="allTabs = $event === 'all'"
          >
            <NButton
              size="small"
              quaternary
              icon-placement="right"
              class="resource-picker"
              :aria-label="t('media_sources')"
            >
              {{ allTabs ? t('resources_other') : t('resources_current') }}
              <template #icon>
                <NIcon><ChevronDownOutline /></NIcon>
              </template>
            </NButton>
          </NPopselect>
          <span class="toolbar-space" />
          <NTooltip trigger="hover">
            <template #trigger>
              <NSwitch
                size="small"
                :value="state?.enabled"
                :aria-label="t('media_discover')"
                @update:value="command({ type: 'MEDIA_ENABLE', tabId, enabled: $event })"
              />
            </template>
            {{ t('media_discover') }}
          </NTooltip>
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
        <CollapsePanel :open="toolsOpen"
          ><div class="resource-tools">
            <MediaTools
              :tab-id="selected?.tabId ?? tabId"
              :source="selected"
              @created="refresh().then(() => (selectedId = $event))"
            /></div
        ></CollapsePanel>
      </div>
      <NAlert v-if="error" type="error" closable @close="error = ''">{{ t(error) }}</NAlert>
      <div class="resource-stage">
        <Transition :name="selected ? 'media-forward' : 'media-back'">
          <MediaSelection
            v-if="selected"
            :key="selected.id"
            :item="selected"
            :busy="busy || rowBusy.has(selected.id)"
            @back="
              selectedId = '';
              downloadIntent = '';
            "
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
            <!-- Filters earn their space once the list is long enough to need them. -->
            <CollapsePanel :open="showFilters">
              <div class="resource-filters">
                <NInput
                  v-model:value="query"
                  class="resource-search"
                  size="small"
                  clearable
                  :placeholder="t('media_filter')"
                  :aria-label="t('media_filter')"
                >
                  <template #prefix>
                    <NIcon><SearchOutline /></NIcon>
                  </template>
                </NInput>
                <NPopselect v-model:value="sort" :options="sorts" trigger="click">
                  <NButton
                    size="small"
                    quaternary
                    icon-placement="right"
                    class="resource-picker"
                    :aria-label="t('resources_sort')"
                  >
                    {{ sorts.find((option) => option.value === sort)?.label }}
                    <template #icon>
                      <NIcon><SwapVerticalOutline /></NIcon>
                    </template>
                  </NButton>
                </NPopselect>
              </div>
              <div
                v-if="showKinds"
                class="resource-kinds"
                role="radiogroup"
                :aria-label="t('resources_type')"
              >
                <button
                  v-for="option in kinds"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="kind === option.value"
                  :class="['resource-kind', { 'resource-kind--active': kind === option.value }]"
                  @click="kind = option.value"
                >
                  {{ option.label }}<span class="resource-kind-count">{{ option.count }}</span>
                </button>
              </div>
            </CollapsePanel>
            <div
              v-if="visibleItems.length > 1 || expanded || allTabs || hasFilter"
              class="resource-list-head"
            >
              <NCheckbox
                v-if="visibleItems.length > 1"
                :checked="allVisibleChecked"
                :indeterminate="!allVisibleChecked && someVisibleChecked"
                :aria-label="t('resources_select_all')"
                @update:checked="toggleVisible"
              />
              <span class="resource-summary">{{
                tSub('sniffer_results', [String(filtered.length), String(resourceCount)])
              }}</span>
            </div>
            <div :class="['resource-list', { 'scroll-fade': !expanded }]">
              <template v-for="row in rows" :key="row.key">
                <article v-if="row.group" class="resource-row resource-row--tracks">
                  <span class="resource-tracks-icon" aria-hidden="true"
                    ><NIcon :size="18"><FilmOutline /></NIcon
                  ></span>
                  <button class="resource-title" @click="inspectTracks(row.group)">
                    <strong :title="row.group[0]!.title">{{
                      row.group[0]!.title || t('media_complete_video')
                    }}</strong>
                    <span
                      >{{ t('media_complete_video') }} ·
                      {{ tSub('media_tracks', [String(row.group.length)]) }} ·
                      {{
                        mediaSize(groupSize(row.group), effectiveLocale, t('media_size_unknown'))
                      }}</span
                    >
                    <small v-if="allTabs">{{ row.group[0]!.title }}</small>
                    <small v-if="row.collection?.operation?.error">{{
                      t(mediaFailureKey(row.collection.operation.error))
                    }}</small>
                    <small v-else-if="row.collection && sent(row.collection)">{{
                      t('media_submitted')
                    }}</small>
                  </button>
                  <div class="row-actions">
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <NButton
                          size="small"
                          quaternary
                          circle
                          :aria-label="t('media_track_files')"
                          :aria-expanded="expandedGroups.has(row.key)"
                          @click="toggleGroup(row.key)"
                        >
                          <template #icon
                            ><NIcon
                              class="resource-expand"
                              :class="{ 'resource-expand--open': expandedGroups.has(row.key) }"
                              ><ChevronDownOutline /></NIcon
                          ></template>
                        </NButton>
                      </template>
                      {{ t('media_track_files') }}
                    </NTooltip>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <NButton
                          size="small"
                          quaternary
                          circle
                          type="primary"
                          :aria-label="t('media_download')"
                          :loading="busy"
                          @click="inspectTracks(row.group, true)"
                        >
                          <template #icon
                            ><NIcon
                              ><Transition name="icon-swap"
                                ><CheckmarkOutline
                                  v-if="row.collection && sent(row.collection)" /><DownloadOutline
                                  v-else /></Transition></NIcon
                          ></template>
                        </NButton>
                      </template>
                      {{ t('media_download') }}
                    </NTooltip>
                  </div>
                </article>
                <article
                  v-else-if="row.item"
                  :class="['resource-row', { 'resource-row--member': row.member }]"
                >
                  <NCheckbox
                    :checked="checked.has(row.item.id)"
                    :disabled="row.item.method !== 'GET'"
                    :aria-label="row.item.filename || row.item.title"
                    @update:checked="toggle(row.item.id, $event)"
                  />
                  <button class="resource-title" @click="select(row.item)">
                    <strong :title="sourceName(row.item).full"
                      ><span class="name-prefix">{{ sourceName(row.item).prefix }}</span
                      ><span class="name-suffix">{{ sourceName(row.item).suffix }}</span></strong
                    >
                    <span
                      >{{
                        ['hls', 'dash'].includes(row.item.kind)
                          ? row.item.kind.toUpperCase()
                          : t(`resources_kind_${row.item.kind}`)
                      }}
                      <template v-if="!['hls', 'dash'].includes(row.item.kind)">
                        ·
                        {{
                          mediaSize(row.item.size, effectiveLocale, t('media_size_unknown'))
                        }}</template
                      ></span
                    >
                    <small v-if="allTabs">{{ row.item.title }}</small>
                    <small v-if="row.item.downloadError || row.item.operation?.error">{{
                      t(
                        mediaFailureKey(
                          row.item.downloadError || row.item.operation?.error || 'operation_failed',
                        ),
                      )
                    }}</small>
                    <small
                      v-else-if="
                        row.item.sentToDesktop || row.item.operation?.state === 'submitted'
                      "
                      >{{ t('media_submitted') }}</small
                    >
                  </button>
                  <div class="row-actions">
                    <NTooltip
                      v-for="rowAction in rowActions(row.item)"
                      :key="rowAction.key"
                      trigger="hover"
                    >
                      <template #trigger>
                        <NButton
                          size="small"
                          quaternary
                          circle
                          :type="
                            rowAction.key === 'download' || rowAction.key === 'downloaded'
                              ? 'primary'
                              : 'default'
                          "
                          :class="{ 'row-action--secondary': rowAction.secondary }"
                          :aria-label="rowAction.label"
                          :loading="rowAction.key === 'download' && rowBusy.has(row.item.id)"
                          :disabled="rowAction.key === 'download' && row.item.method !== 'GET'"
                          @click="rowAction.run()"
                        >
                          <template #icon
                            ><NIcon
                              ><Transition name="icon-swap"
                                ><component
                                  :is="rowAction.icon"
                                  :key="rowAction.key" /></Transition></NIcon
                          ></template>
                        </NButton>
                      </template>
                      {{ rowAction.label }}
                    </NTooltip>
                  </div>
                </article>
                <MediaPreview
                  v-if="row.item && preview?.id === row.item.id"
                  :item="row.item"
                  @close="preview = undefined"
                />
              </template>
              <NEmpty v-if="!filtered.length" :description="t('media_none')" />
            </div>
            <footer class="resource-actions">
              <NDropdown trigger="click" :options="actions" @select="action"
                ><NButton size="small" quaternary circle :aria-label="t('resources_tools')"
                  ><template #icon
                    ><NIcon><EllipsisHorizontalOutline /></NIcon></template></NButton
              ></NDropdown>
              <NTooltip v-for="tool in footerTools" :key="tool.key" trigger="hover"
                ><template #trigger
                  ><NButton
                    size="small"
                    quaternary
                    circle
                    :aria-label="tool.label"
                    @click="tool.run()"
                    ><template #icon
                      ><NIcon
                        :class="{ 'resource-scan': tool.key === 'scan' }"
                        :style="
                          tool.key === 'scan'
                            ? { transform: `rotate(${scanTurns}turn)` }
                            : undefined
                        "
                        ><component :is="tool.icon" /></NIcon></template></NButton></template
                >{{ tool.label }}</NTooltip
              >
              <span class="toolbar-space" />
              <!-- The right side always holds the batch download; checked rows enable it. -->
              <TransitionGroup tag="div" name="pop" class="resource-batch">
                <NButton
                  v-if="mergeable"
                  key="merge"
                  size="small"
                  secondary
                  type="primary"
                  :disabled="busy"
                  @click="merge([...checked], false)"
                  >{{ t('resources_merge') }}</NButton
                >
                <NButton
                  v-if="visibleItems.length > 1 || checkedItems.length"
                  key="download"
                  size="small"
                  type="primary"
                  :loading="busy"
                  :disabled="!checkedItems.length"
                  @click="batch('download')"
                  >{{ t('media_download') }} · {{ checkedItems.length }}</NButton
                >
              </TransitionGroup>
            </footer>
          </div></Transition
        >
      </div>
    </template>
  </section>
</template>
<style scoped>
.resource-summary {
  color: var(--color-on-surface-variant);
  font-size: 12px;
}

.resource-list-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;
  padding: 0 4px 6px;
}

.resource-kinds {
  display: flex;
  gap: 6px;
  padding-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.resource-kind {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-outline-variant);
  border-radius: 999px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.resource-kind:hover {
  background: var(--color-surface-container-high);
}

.resource-kind--active {
  border-color: transparent;
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}

.resource-kind-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.72;
}

.resources {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
  min-width: 0;
}
/* In the popup the list scrolls on its own, keeping the window within its limit. */
.resources:not(.expanded) .resource-list {
  max-height: 264px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.resources:not(.expanded) .resource-tools {
  max-height: 240px;
  overflow-y: auto;
}
.resource-state {
  margin: 24px auto;
}
.resource-tools {
  padding-top: 12px;
}
.resource-scan {
  transition: transform 0.5s var(--m3-ease-emphasized);
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
}
.resource-catalog {
  display: flex;
  flex-direction: column;
}
.resource-filters {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 8px;
}
.resource-filters > .n-input {
  flex: 1;
  min-width: 0;
}
/* A quiet well rather than a boxed field; the focus ring still marks entry. */
.resource-search {
  border-radius: 10px;
  background-color: var(--color-surface-well);
}
.resource-search :deep(.n-input__border) {
  border-color: transparent;
}
/* Text pickers read as labels until hovered. */
.resource-picker {
  padding-inline: 8px;
  color: var(--color-on-surface-variant);
  font-weight: 500;
}
.resource-batch {
  display: flex;
  gap: 6px;
}
.resource-list {
  display: grid;
  align-content: start;
  gap: 2px;
}
.resource-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 6px 8px 10px;
  border-radius: 12px;
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;
  transition: background-color 0.2s var(--m3-ease-emphasized);
}
.resource-row:hover {
  background: var(--color-surface-well);
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
.row-actions {
  display: flex;
  flex-shrink: 0;
}
.row-actions .n-button {
  width: 32px;
  height: 32px;
}
/* In the popup a row shows only its download until it is hovered or focused. */
.resources:not(.expanded) .row-actions .row-action--secondary {
  width: 0;
  opacity: 0;
  pointer-events: none;
  transition:
    width 0.2s var(--m3-ease-emphasized),
    opacity 0.15s var(--m3-ease-emphasized);
}
.resources:not(.expanded) .resource-row:is(:hover, :focus-within) .row-action--secondary {
  width: 32px;
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .resources:not(.expanded) .row-actions .row-action--secondary {
    width: 32px;
    opacity: 1;
    pointer-events: auto;
  }
}
.resource-title strong {
  display: flex;
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
/* A complete video made of track files, and its files when expanded. */
.resource-row--tracks {
  background: color-mix(in srgb, var(--color-primary-container) 26%, transparent);
}
.resource-row--tracks:hover {
  background: color-mix(in srgb, var(--color-primary-container) 40%, transparent);
}
.resource-row--tracks .resource-title strong {
  display: block;
}
.resource-tracks-icon {
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  width: 16px;
  color: var(--color-primary);
}
.resource-row--member {
  padding-inline-start: 20px;
  animation: resource-member-in 0.2s var(--m3-ease-emphasized);
}
@keyframes resource-member-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
.resource-expand {
  transition: transform 0.2s var(--m3-ease-emphasized);
}
.resource-expand--open {
  transform: rotate(180deg);
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
  .resources.expanded {
    padding: 8px 16px;
  }
}
.resource-title strong span {
  font: inherit;
  color: inherit;
}
.name-prefix {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name-suffix {
  flex-shrink: 0;
}
</style>
