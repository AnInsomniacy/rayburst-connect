<script setup lang="ts">
import { mediaFailureKey } from '@/lib/media/presentation';
import type { MediaItem } from '@/lib/media/messages';
import MediaControls from './MediaControls.vue';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NCheckbox,
  NCollapse,
  NCollapseItem,
} from 'naive-ui';
import { useI18n } from '@/shared/i18n/engine';
import { emptyMediaInput, MediaInputPlanSchema } from '@/lib/media/contracts';
import { type MediaTool } from '@/lib/media/tools';
const props = defineProps<{ tabId: number; source?: MediaItem }>();
const emit = defineEmits<{ created: [id: string] }>();
const { t } = useI18n();
const mode = ref('stop');
const choice = ref<'deep' | 'cache' | 'video' | 'screen' | 'rtc'>('deep');
const reload = ref(true);
const busy = ref(false);
const automatic = ref(false);
const mobile = ref(false);
const error = ref('');
const url = ref('');
const title = ref('');
const content = ref('');
const kind = ref<'hls' | 'dash' | 'collection'>('hls');
const key = ref('');
const iv = ref('');
const keys = ref<{ key: string; url: string }[]>([]);
const testKeys = ref(false);
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
  keys.value = result.keys;
}
async function tool(value: 'deep' | 'cache' | 'video' | 'screen' | 'rtc' | 'stop') {
  busy.value = true;
  error.value = '';
  try {
    await send({
      type: 'MEDIA_MODE',
      tabId: props.tabId,
      mode: value,
      reload: reload.value && ['deep', 'cache', 'rtc'].includes(value),
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
  const file = (event.target as InstanceType<typeof window.HTMLInputElement>).files?.[0];
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
</script>
<template>
  <section class="media-tools">
    <NAlert v-if="error" type="error">{{ t(error) }}</NAlert>
    <div class="capture-choice">
      <NSelect
        v-model:value="choice"
        size="small"
        :disabled="mode !== 'stop'"
        :aria-label="t('resources_tools')"
        :options="
          (['deep', 'cache', 'video', 'screen', 'rtc'] as const).map((value) => ({
            value,
            label: t(`resources_${value}`),
          }))
        "
      />
      <NButton
        size="small"
        :type="mode === 'stop' ? 'primary' : 'default'"
        :loading="busy"
        @click="tool(mode === 'stop' ? choice : 'stop')"
        >{{ t(mode === 'stop' ? 'resources_start' : 'resources_stop') }}</NButton
      >
    </div>
    <NCheckbox
      v-if="['deep', 'cache', 'rtc'].includes(choice)"
      v-model:checked="reload"
      :disabled="mode !== 'stop'"
      >{{ t('resources_reload') }}</NCheckbox
    >
    <NAlert v-if="mode !== 'stop'" type="info" :show-icon="false">{{
      t(`resources_${mode}`)
    }}</NAlert>
    <NCollapse accordion>
      <NCollapseItem name="import" :title="t('resources_import')">
        <NForm label-placement="top" @submit.prevent="inspect">
          <NFormItem :label="t('resources_name')"><NInput v-model:value="title" /></NFormItem>
          <NFormItem :label="t('resources_url')"
            ><NInput v-model:value="url" placeholder="https://…"
          /></NFormItem>
          <NFormItem :label="t('resources_type')"
            ><NSelect
              v-model:value="kind"
              :options="[
                { value: 'hls', label: 'HLS' },
                { value: 'dash', label: 'DASH' },
                { value: 'collection', label: t('resources_sequence') },
              ]"
          /></NFormItem>
          <NFormItem :label="t('resources_manifest')"
            ><NInput v-model:value="content" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }"
          /></NFormItem>
          <input
            type="file"
            accept=".m3u8,.m3u,.mpd,.txt"
            :aria-label="t('resources_manifest')"
            @change="loadFile($event)"
          />
          <NFormItem :label="t('resources_key')"
            ><NInput
              v-model:value="key"
              type="password"
              show-password-on="click"
              placeholder="Hex / Base64"
          /></NFormItem>
          <input type="file" :aria-label="t('resources_key')" @change="loadFile($event, true)" />
          <NFormItem label="IV"><NInput v-model:value="iv" placeholder="Hex / Base64" /></NFormItem>
          <NCheckbox v-model:checked="testKeys" :disabled="Boolean(key)"
            >{{ t('resources_test_keys') }} ({{ keys.length }})</NCheckbox
          >
          <NSpace justify="end"
            ><NButton size="small" @click="refresh">{{ t('media_scan') }}</NButton
            ><NButton attr-type="submit" type="primary" :loading="busy">{{
              t('media_inspect')
            }}</NButton></NSpace
          >
        </NForm>
      </NCollapseItem>
      <NCollapseItem name="controls" :title="t('resources_controls')"
        ><MediaControls :tab-id="tabId"
      /></NCollapseItem>
      <NCollapseItem name="behavior" :title="t('options_section_behavior')">
        <NSpace vertical>
          <NCheckbox
            v-model:checked="automatic"
            @update:checked="behavior('MEDIA_AUTOMATIC', $event)"
            >{{ t('resources_auto') }}</NCheckbox
          >
          <NCheckbox v-model:checked="mobile" @update:checked="behavior('MEDIA_MOBILE', $event)">{{
            t('resources_mobile')
          }}</NCheckbox>
        </NSpace>
      </NCollapseItem>
    </NCollapse>
    <NButton
      quaternary
      @click="browser.tabs.create({ url: browser.runtime.getURL('/options.html') + '#media' })"
      >{{ t('media_settings_title') }}</NButton
    >
  </section>
</template>
<style scoped>
.media-tools {
  display: grid;
  gap: 12px;
  padding: 12px 0 16px;
  border-bottom: 1px solid var(--color-outline-variant);
}
.capture-choice {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}
.n-form {
  padding-top: 4px;
}
.n-form-item {
  margin: 0;
}
input[type='file'] {
  max-width: 100%;
  margin-bottom: 12px;
  font: inherit;
}
</style>
