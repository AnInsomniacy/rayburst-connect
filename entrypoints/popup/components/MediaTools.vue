<script setup lang="ts">
import { mediaFailureKey } from '@/lib/media/presentation';
import type { MediaItem } from '@/lib/media/messages';
import MediaControls from './MediaControls.vue';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from '@/lib/validation';
import { NAlert, NButton, NCheckbox, NIcon, NInput, NSelect, NSwitch, NTooltip } from 'naive-ui';
import {
  ChevronDownOutline,
  FolderOpenOutline,
  LayersOutline,
  OpenOutline,
  ScanOutline,
  VideocamOutline,
} from '@vicons/ionicons5';
import { useI18n } from '@/shared/i18n/engine';
import CollapsePanel from '@/shared/components/CollapsePanel.vue';
import { emptyMediaInput, MediaInputPlanSchema } from '@/lib/media/contracts';
import { type MediaTool } from '@/lib/media/tools';
const props = withDefaults(defineProps<{ tabId: number; source?: MediaItem; active?: boolean }>(), {
  source: undefined,
  active: true,
});
const emit = defineEmits<{ created: [id: string] }>();
const { t } = useI18n();
const CAPTURES = [
  { value: 'deep', icon: ScanOutline },
  { value: 'cache', icon: LayersOutline },
  { value: 'video', icon: VideocamOutline },
] as const;
type Capture = (typeof CAPTURES)[number]['value'];
const mode = ref('stop');
const choice = ref<Capture>('deep');
const reload = ref(true);
const busy = ref(false);
const automatic = ref(false);
const mobile = ref(false);
const error = ref('');
const importOpen = ref(false);
const url = ref('');
const title = ref('');
const content = ref('');
const kind = ref<'hls' | 'dash' | 'collection'>('hls');
const key = ref('');
const iv = ref('');
const keys = ref<{ key: string; url: string }[]>([]);
const testKeys = ref(false);
const manifestFile = ref<InstanceType<typeof window.HTMLInputElement>>();
const keyFile = ref<InstanceType<typeof window.HTMLInputElement>>();
watch(
  () => props.source,
  (source) => {
    if (!source) return;
    url.value = source.url;
    title.value = source.title || source.filename;
    if (['hls', 'dash', 'collection'].includes(source.kind))
      kind.value = source.kind as 'hls' | 'dash' | 'collection';
    content.value =
      source.input?.manifests.find((manifest) => manifest.url === source.url)?.content ?? '';
  },
  { immediate: true },
);
async function send(command: MediaTool) {
  const result: unknown = await browser.runtime.sendMessage(command);
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(typeof result.error === 'string' ? result.error : 'operation_failed');
  return result;
}
async function refresh() {
  const result = z
    .object({
      mode: z.string(),
      automatic: z.boolean(),
      mobile: z.boolean(),
      keys: z.array(z.object({ key: z.string(), url: z.string() })),
    })
    .parse(await send({ type: 'MEDIA_TOOLS', tabId: props.tabId }));
  automatic.value = result.automatic;
  mobile.value = result.mobile;
  mode.value = result.mode;
  if (CAPTURES.some((capture) => capture.value === result.mode))
    choice.value = result.mode as Capture;
  keys.value = result.keys;
}
async function tool(value: Capture | 'stop') {
  busy.value = true;
  error.value = '';
  try {
    await send({
      type: 'MEDIA_MODE',
      tabId: props.tabId,
      mode: value,
      reload: reload.value && ['deep', 'cache'].includes(value),
    });
    mode.value = value;
  } catch (cause) {
    error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
  } finally {
    busy.value = false;
  }
}
async function behavior(type: 'MEDIA_AUTOMATIC' | 'MEDIA_MOBILE', enabled: boolean) {
  try {
    await send({ type, tabId: props.tabId, enabled });
  } catch (cause) {
    error.value = mediaFailureKey(cause instanceof Error ? cause.message : 'operation_failed');
  }
}
function hex(value: string) {
  const trimmed = value.trim().replace(/^0x/i, '');
  if (/^[a-f\d]{32}$/i.test(trimmed)) return trimmed.toLowerCase();
  const bytes = Uint8Array.from(window.atob(trimmed), (char) => char.charCodeAt(0));
  if (bytes.length !== 16) throw new Error('media_invalid');
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function loadFile(event: InstanceType<typeof window.Event>, isKey = false) {
  const input = event.target as InstanceType<typeof window.HTMLInputElement>;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (isKey) {
    if (file.size !== 16) {
      error.value = 'media_invalid';
      return;
    }
    key.value = Array.from(new Uint8Array(await file.arrayBuffer()), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  } else if (file.size <= 512 * 1024) content.value = await file.text();
}
async function inspect() {
  busy.value = true;
  error.value = '';
  try {
    const parsedUrl = new URL(url.value.trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('media_invalid');
    const input = props.source?.input
      ? MediaInputPlanSchema.parse(props.source.input)
      : emptyMediaInput();
    input.keys = [];
    if (kind.value === 'collection' && content.value.trim())
      input.tracks = [
        {
          id: 'sequence',
          type: 'muxed',
          urls: content.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => new URL(line, parsedUrl).href),
        },
      ];
    else if (content.value.trim())
      input.manifests = [{ url: url.value.trim(), content: content.value }];
    const overrideIv = iv.value.trim() ? hex(iv.value) : '';
    if (key.value.trim()) input.keys.push({ url: '', key: hex(key.value), iv: overrideIv });
    else if (testKeys.value)
      input.keys = keys.value
        .slice(0, 64)
        .map((value) => ({ url: '', key: value.key, iv: overrideIv }));
    const result = z.object({ id: z.uuid() }).parse(
      await send({
        type: 'MEDIA_IMPORT',
        title: title.value,
        tabId: props.tabId,
        frameId: props.source?.frameId,
        url: url.value.trim(),
        kind: kind.value,
        input,
      }),
    );
    emit('created', result.id);
  } catch {
    error.value = 'media_invalid';
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void refresh().catch(() => undefined);
  browser.storage.onChanged.addListener(changed);
});
const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
  const value = changes.mediaTools;
  const modeOf = (raw: unknown) =>
    z
      .record(z.string(), z.object({ mode: z.string() }))
      .catch({})
      .parse(raw)[String(props.tabId)]?.mode;
  if (area === 'session' && value && modeOf(value.newValue) !== modeOf(value.oldValue))
    void refresh().catch(() => undefined);
};
watch(
  () => props.tabId,
  () => {
    void refresh().catch(() => undefined);
  },
);
onUnmounted(() => browser.storage.onChanged.removeListener(changed));
function pick(value: Capture) {
  if (mode.value === 'stop') choice.value = value;
}
function openSettings() {
  void browser.tabs.create({ url: browser.runtime.getURL('/options.html') + '#media' });
}
</script>
<template>
  <section class="media-tools">
    <NAlert v-if="error" type="error" closable @close="error = ''">{{ t(error) }}</NAlert>

    <!-- Capture: the one control that changes how the page is read. -->
    <div class="capture" :class="{ 'capture--live': mode !== 'stop' }">
      <div class="capture__modes" role="radiogroup" :aria-label="t('resources_tools')">
        <button
          v-for="capture in CAPTURES"
          :key="capture.value"
          type="button"
          role="radio"
          :aria-checked="choice === capture.value"
          :disabled="mode !== 'stop' && mode !== capture.value"
          :class="[
            'capture__mode',
            {
              'capture__mode--chosen': choice === capture.value,
              'capture__mode--live': mode === capture.value,
            },
          ]"
          :title="t(`resources_${capture.value}_hint`)"
          @click="pick(capture.value)"
        >
          <span class="capture__icon"
            ><NIcon :size="18"><component :is="capture.icon" /></NIcon
            ><span v-if="mode === capture.value" class="capture__pulse" aria-hidden="true"
          /></span>
          <span class="capture__name">{{ t(`resources_${capture.value}`) }}</span>
          <span class="capture__hint">{{ t(`resources_${capture.value}_hint`) }}</span>
        </button>
      </div>
      <div class="capture__run">
        <NCheckbox
          v-if="['deep', 'cache'].includes(choice)"
          v-model:checked="reload"
          size="small"
          :disabled="mode !== 'stop'"
          >{{ t('resources_reload') }}</NCheckbox
        >
        <span class="capture__space" />
        <NButton
          size="small"
          :type="mode === 'stop' ? 'primary' : 'error'"
          :secondary="mode !== 'stop'"
          :loading="busy"
          @click="tool(mode === 'stop' ? choice : 'stop')"
          >{{ t(mode === 'stop' ? 'resources_start' : 'resources_stop') }}</NButton
        >
      </div>
    </div>

    <MediaControls class="tool-block" :tab-id="tabId" :active="active" />

    <div class="tool-block">
      <button
        type="button"
        class="disclosure"
        :aria-expanded="importOpen"
        @click="importOpen = !importOpen"
      >
        <h3 class="tool-title">{{ t('resources_import') }}</h3>
        <NIcon class="disclosure__chevron" :class="{ 'disclosure__chevron--open': importOpen }"
          ><ChevronDownOutline
        /></NIcon>
      </button>
      <CollapsePanel :open="importOpen">
        <form class="import" @submit.prevent="inspect">
          <label class="field">
            <span>{{ t('resources_name') }}</span>
            <NInput v-model:value="title" size="small" />
          </label>
          <div class="import__pair">
            <label class="field">
              <span>{{ t('resources_url') }}</span>
              <NInput v-model:value="url" size="small" placeholder="https://…" />
            </label>
            <label class="field field--type">
              <span>{{ t('resources_type') }}</span>
              <NSelect
                v-model:value="kind"
                size="small"
                :consistent-menu-width="false"
                :options="[
                  { value: 'hls', label: 'HLS' },
                  { value: 'dash', label: 'DASH' },
                  { value: 'collection', label: t('resources_sequence') },
                ]"
              />
            </label>
          </div>
          <div class="field">
            <span class="field__head"
              >{{ t('resources_manifest') }}
              <NButton text size="tiny" type="primary" @click="manifestFile?.click()">
                <template #icon
                  ><NIcon><FolderOpenOutline /></NIcon
                ></template>
                {{ t('resources_open_file') }}
              </NButton></span
            >
            <NInput
              v-model:value="content"
              type="textarea"
              size="small"
              :aria-label="t('resources_manifest')"
              :autosize="{ minRows: 3, maxRows: 8 }"
            />
            <input
              ref="manifestFile"
              class="file"
              type="file"
              tabindex="-1"
              accept=".m3u8,.m3u,.mpd,.txt"
              :aria-label="t('resources_manifest')"
              @change="loadFile($event)"
            />
          </div>
          <div class="import__pair">
            <div class="field">
              <span class="field__head"
                >{{ t('resources_key') }}
                <NTooltip trigger="hover">
                  <template #trigger>
                    <NButton
                      text
                      size="tiny"
                      type="primary"
                      :aria-label="t('resources_open_file')"
                      @click="keyFile?.click()"
                    >
                      <template #icon
                        ><NIcon><FolderOpenOutline /></NIcon
                      ></template>
                    </NButton>
                  </template>
                  {{ t('resources_open_file') }}
                </NTooltip></span
              >
              <NInput
                v-model:value="key"
                size="small"
                type="password"
                show-password-on="click"
                placeholder="Hex / Base64"
                :aria-label="t('resources_key')"
              />
              <input
                ref="keyFile"
                class="file"
                type="file"
                tabindex="-1"
                :aria-label="t('resources_key')"
                @change="loadFile($event, true)"
              />
            </div>
            <label class="field">
              <span>IV</span>
              <NInput v-model:value="iv" size="small" placeholder="Hex / Base64" />
            </label>
          </div>
          <NCheckbox v-model:checked="testKeys" size="small" :disabled="Boolean(key)"
            >{{ t('resources_test_keys') }} ({{ keys.length }})</NCheckbox
          >
          <div class="import__actions">
            <NButton size="small" quaternary @click="refresh">{{ t('media_scan') }}</NButton>
            <NButton size="small" attr-type="submit" type="primary" :loading="busy">{{
              t('media_inspect')
            }}</NButton>
          </div>
        </form>
      </CollapsePanel>
    </div>

    <div class="tool-block switches">
      <label class="switch">
        <span>{{ t('resources_auto') }}</span>
        <NSwitch
          v-model:value="automatic"
          size="small"
          @update:value="behavior('MEDIA_AUTOMATIC', $event)"
        />
      </label>
      <label class="switch">
        <span>{{ t('resources_mobile') }}</span>
        <NSwitch
          v-model:value="mobile"
          size="small"
          @update:value="behavior('MEDIA_MOBILE', $event)"
        />
      </label>
    </div>

    <NButton text size="small" class="settings-link" @click="openSettings">
      {{ t('media_settings_title') }}
      <template #icon
        ><NIcon><OpenOutline /></NIcon
      ></template>
    </NButton>
  </section>
</template>
<style scoped>
.media-tools {
  container: tools / inline-size;
  display: grid;
  gap: 4px;
}
/* Every block below the capture reads as a quiet section of the same sheet. */
.tool-block {
  padding: 12px 4px;
  border-top: 1px solid var(--color-outline-variant);
}
:deep(.tool-title) {
  margin: 0;
  color: var(--color-on-surface);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}

.capture {
  display: grid;
  gap: 10px;
  padding: 4px 0 12px;
}
.capture__modes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.capture__mode {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 4px;
  min-width: 0;
  padding: 10px 10px 11px;
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-on-surface);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    background-color 0.18s var(--m3-ease-emphasized),
    border-color 0.18s var(--m3-ease-emphasized),
    opacity 0.18s var(--m3-ease-emphasized);
}
.capture__mode:hover:not(:disabled) {
  border-color: var(--color-outline);
}
.capture__mode:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.capture__mode:disabled {
  cursor: default;
  opacity: 0.45;
}
.capture__mode--chosen {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary-container) 55%, var(--color-surface));
}
.capture__mode--chosen:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-primary-container);
}
.capture__icon {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-full);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  transition:
    background-color 0.18s var(--m3-ease-emphasized),
    color 0.18s var(--m3-ease-emphasized);
}
.capture__mode--chosen .capture__icon {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.capture__name {
  max-width: 100%;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.capture__hint {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-on-surface-variant);
  font-size: 11.5px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
/* A running capture marks its mode the way a recorder marks a take. */
.capture__pulse {
  position: absolute;
  top: -1px;
  inset-inline-end: -1px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-surface);
  border-radius: var(--radius-full);
  background: var(--color-error);
}
.capture__pulse::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  background: var(--color-error);
  animation: capture-pulse 1.6s var(--m3-ease-emphasized-decel) infinite;
}
@keyframes capture-pulse {
  from {
    opacity: 0.55;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(2.4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .capture__pulse::after {
    animation: none;
  }
}
.capture__run {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.capture__space {
  flex: 1;
}
/* Narrow panels keep the three modes on one row; their hints move to tooltips. */
@container tools (max-width: 360px) {
  .capture__hint {
    display: none;
  }
  .capture__mode {
    justify-items: center;
    padding: 8px 4px;
    text-align: center;
  }
  .capture__name {
    font-size: 12px;
    font-weight: 500;
  }
}

.disclosure {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.disclosure:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 4px;
  border-radius: var(--radius-sm);
}
.disclosure__chevron {
  margin-inline-start: auto;
  color: var(--color-on-surface-variant);
  transition: transform 0.2s var(--m3-ease-emphasized);
}
.disclosure__chevron--open {
  transform: rotate(180deg);
}
.import {
  display: grid;
  gap: 10px;
  padding-top: 10px;
}
.import__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.import__pair:has(.field--type) {
  grid-template-columns: minmax(0, 1fr) 112px;
}
.field {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
.field__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.file {
  display: none;
}
.import__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.switches {
  display: grid;
  gap: 4px;
}
.switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  font-size: 13px;
  cursor: pointer;
}
.settings-link {
  justify-self: start;
  margin: 4px 4px 0;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
</style>
