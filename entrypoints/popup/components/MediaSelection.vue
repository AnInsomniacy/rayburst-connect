<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NAlert,
  NEmpty,
  NButton,
  NForm,
  NFormItem,
  NInputNumber,
  NSelect,
  NSpace,
  NSpin,
} from 'naive-ui';
import type { MediaItem } from '@/lib/media/messages';
import { selectionError, type MediaSelection } from '@/lib/media/contracts';
import {
  mediaFailureKey,
  mediaTrackLabel,
  mediaSize,
  mediaDuration,
} from '@/lib/media/presentation';
import { useI18n } from '@/shared/i18n/engine';
const { t: i18n, effectiveLocale } = useI18n();

const props = defineProps<{ item: MediaItem; busy: boolean; frame?: boolean }>();
const emit = defineEmits<{
  inspect: [];
  downloadFile: [];
  refresh: [];
  cancel: [];
  submit: [selection: MediaSelection];
  back: [];
  advanced: [];
}>();
const operation = computed(() => props.item.operation);
const presentation = computed(() =>
  operation.value?.probe?.state === 'ready' ? operation.value.probe.presentation : null,
);
const form = ref<MediaSelection | null>(null);
let formProbeId = '';
watch(
  presentation,
  (value) => {
    if (value && operation.value && formProbeId !== operation.value.probeId) {
      form.value = { ...value.defaults };
      formProbeId = operation.value.probeId;
    }
  },
  { immediate: true },
);
const videoOptions = computed(
  () =>
    presentation.value?.tracks
      .filter((track) => ['video', 'muxed'].includes(track.type))
      .map((track) => ({
        label:
          props.item.kind === 'collection'
            ? i18n('resources_kind_collection')
            : mediaTrackLabel(track, effectiveLocale.value, i18n('media_includes_audio')),
        value: track.id,
      })) ?? [],
);
const audioOptions = computed(
  () =>
    presentation.value?.tracks
      .filter((track) => {
        const video = presentation.value?.tracks.find((item) => item.id === form.value?.videoId);
        if (video?.type === 'muxed') return track.id === video.id;
        return track.type === 'audio' || (!video && track.type === 'muxed');
      })
      .map((track) => ({
        label:
          props.item.kind === 'collection'
            ? i18n('resources_kind_collection')
            : mediaTrackLabel(track, effectiveLocale.value, i18n('media_includes_audio')),
        value: track.id,
      })) ?? [],
);
const subtitleOptions = computed(
  () =>
    presentation.value?.tracks
      .filter((track) => track.type === 'subtitle')
      .map((track) => ({
        label:
          props.item.kind === 'collection'
            ? i18n('resources_kind_collection')
            : mediaTrackLabel(track, effectiveLocale.value, i18n('media_includes_audio')),
        value: track.id,
      })) ?? [],
);
const formatOptions = computed(
  () =>
    presentation.value?.formats.map((value) => ({
      label: value.toUpperCase(),
      value,
    })) ?? [],
);
watch(
  () => form.value?.videoId,
  (id) => {
    if (!form.value?.audioId || !presentation.value) return;
    const video = presentation.value.tracks.find((track) => track.id === id);
    const audio = presentation.value.tracks.find((track) => track.id === form.value?.audioId);
    if (video?.type === 'muxed') form.value.audioId = video.id;
    else if (video && audio?.type === 'muxed') {
      form.value.audioId =
        presentation.value.tracks.find((track) => track.type === 'audio')?.id ?? null;
    }
  },
);
watch(
  () => form.value?.format,
  (format) => {
    if (format === 'vtt' && form.value) {
      form.value.videoId = null;
      form.value.audioId = null;
      form.value.subtitleId ??= subtitleOptions.value[0]?.value ?? null;
    }
  },
);
const invalid = computed(() =>
  presentation.value && form.value ? selectionError(presentation.value, form.value) : null,
);
const pending = computed(
  () => operation.value && ['probing', 'submitting', 'cancelling'].includes(operation.value.state),
);
const canInspect = computed(
  () =>
    ['hls', 'dash', 'collection'].includes(props.item.kind) &&
    (!operation.value || ['failed', 'cancelled'].includes(operation.value.state)),
);
const unsupported = computed(() => props.item.kind === 'embedded' || props.item.method !== 'GET');
function submit() {
  if (form.value && !invalid.value) emit('submit', { ...form.value });
}
</script>

<template>
  <section class="media-selection" :aria-label="i18n('media_options')" :aria-busy="busy">
    <NButton size="small" :quaternary="frame" @click="emit('back')">{{
      i18n('media_back')
    }}</NButton>
    <NButton
      v-if="['hls', 'dash'].includes(item.kind)"
      size="small"
      quaternary
      @click="emit('advanced')"
      >{{ i18n('resources_key') }} / {{ i18n('resources_manifest') }}</NButton
    >
    <h3 id="media-options-heading" tabindex="-1">
      {{ item.filename || item.title || i18n('media_source') }}
    </h3>
    <p class="media-meta">
      {{ item.kind === 'embedded' ? i18n('media_waiting') : item.kind.toUpperCase() }} ·
      {{ mediaSize(item.size, effectiveLocale, i18n('media_size_unknown')) }}
    </p>
    <NAlert v-if="unsupported" type="info" :show-icon="false">
      {{ item.kind === 'embedded' ? i18n('media_waiting') : i18n('media_unsupported') }}
    </NAlert>
    <NAlert v-if="operation?.error" type="error" :show-icon="false" role="alert">{{
      i18n(mediaFailureKey(operation.error))
    }}</NAlert>
    <div v-if="pending" class="media-progress" role="status" aria-live="polite">
      <NSpin v-if="!operation?.error" size="small" />
      <span>{{
        operation?.state === 'submitting'
          ? i18n('media_confirming')
          : operation?.state === 'cancelling'
            ? i18n('media_cancelling')
            : i18n('media_loading')
      }}</span>
    </div>
    <NAlert
      v-if="operation?.state === 'submitted' || item.sentToDesktop"
      type="success"
      :show-icon="false"
      role="status"
    >
      {{ i18n('media_submitted') }}
    </NAlert>
    <NAlert v-if="operation?.state === 'cancelled'" type="info" :show-icon="false">{{
      i18n('media_cancelled')
    }}</NAlert>

    <NForm
      v-if="presentation && form && operation?.state === 'ready'"
      label-placement="top"
      :disabled="busy"
      @submit.prevent="submit"
    >
      <p class="media-meta">
        {{
          presentation.live
            ? i18n('media_live')
            : presentation.durationMs === null
              ? i18n('media_duration_unknown')
              : mediaDuration(presentation.durationMs, effectiveLocale)
        }}
      </p>
      <NFormItem :label="i18n('media_video')">
        <NSelect
          v-model:value="form.videoId"
          :options="videoOptions"
          clearable
          :placeholder="i18n('media_no_video')"
          :aria-label="i18n('media_video')"
          ><template #empty><NEmpty :description="i18n('media_none')" /></template
        ></NSelect>
      </NFormItem>
      <NFormItem :label="i18n('media_audio')">
        <NSelect
          v-model:value="form.audioId"
          :options="audioOptions"
          :disabled="busy"
          clearable
          :placeholder="i18n('media_no_audio')"
          :aria-label="i18n('media_audio')"
          ><template #empty><NEmpty :description="i18n('media_none')" /></template
        ></NSelect>
      </NFormItem>
      <NFormItem :label="i18n('media_subtitles')">
        <NSelect
          v-model:value="form.subtitleId"
          :options="subtitleOptions"
          clearable
          :placeholder="i18n('media_no_subtitles')"
          :aria-label="i18n('media_subtitles')"
          ><template #empty><NEmpty :description="i18n('media_none')" /></template
        ></NSelect>
      </NFormItem>
      <NFormItem :label="i18n('media_format')">
        <NSelect
          v-model:value="form.format"
          :options="formatOptions"
          :aria-label="i18n('media_format')"
          ><template #empty><NEmpty :description="i18n('media_none')" /></template
        ></NSelect>
      </NFormItem>
      <NFormItem
        v-if="!presentation.live && presentation.kind !== 'collection'"
        :label="i18n('resources_start_time')"
      >
        <NInputNumber
          :value="form.startTimeSeconds ?? 0"
          :min="0"
          :max="31536000"
          :precision="0"
          @update:value="form.startTimeSeconds = $event ?? 0"
        />
      </NFormItem>
      <NFormItem
        v-if="!presentation.live && presentation.kind !== 'collection'"
        :label="i18n('resources_end_time')"
      >
        <NInputNumber
          :value="form.endTimeSeconds ?? 0"
          :min="0"
          :max="31536000"
          :precision="0"
          @update:value="form.endTimeSeconds = $event ?? 0"
        />
      </NFormItem>
      <NFormItem v-if="presentation.live" :label="i18n('media_record_limit')">
        <NInputNumber
          :value="form.recordTimeSeconds"
          :min="0"
          :max="31536000"
          :precision="0"
          :aria-label="i18n('media_record_limit')"
          @update:value="form.recordTimeSeconds = $event ?? 0"
        />
      </NFormItem>
      <p v-if="presentation.live" class="media-meta">
        {{ i18n('media_record_hint') }}
      </p>
      <NAlert v-if="invalid" type="warning" :show-icon="false" role="alert">{{
        i18n('media_invalid')
      }}</NAlert>
      <NSpace justify="end">
        <NButton :disabled="busy" @click="emit('cancel')">{{ i18n('media_cancel') }}</NButton>
        <NButton
          attr-type="submit"
          type="primary"
          :disabled="busy || Boolean(invalid)"
          :loading="busy"
          >{{ presentation.live ? i18n('media_record') : i18n('media_download') }}</NButton
        >
      </NSpace>
    </NForm>
    <NButton
      v-else-if="
        ['file', 'fragment', 'subtitle', 'image', 'json'].includes(item.kind) &&
        !item.sentToDesktop &&
        !unsupported
      "
      type="primary"
      :loading="busy"
      @click="emit('downloadFile')"
      >{{ i18n('media_download') }} · {{ i18n('media_original') }}</NButton
    >
    <NSpace
      v-else-if="
        !['file', 'fragment', 'subtitle', 'image', 'json'].includes(item.kind) &&
        !unsupported &&
        operation?.state !== 'submitted'
      "
      justify="end"
    >
      <NButton v-if="pending" :disabled="busy" @click="emit('cancel')">{{
        i18n('media_cancel')
      }}</NButton>
      <NButton v-if="pending && operation?.error" :loading="busy" @click="emit('refresh')">{{
        i18n('media_retry')
      }}</NButton>
      <NButton v-if="canInspect" type="primary" :loading="busy" @click="emit('inspect')">{{
        i18n('media_inspect')
      }}</NButton>
    </NSpace>
    <p v-if="canInspect && !unsupported" class="media-meta">
      {{ i18n('media_inspect_hint') }}
    </p>
  </section>
</template>

<style scoped>
.media-selection {
  display: grid;
  gap: 12px;
}
h3 {
  font-size: 15px;
  overflow-wrap: anywhere;
  line-height: 1.45;
}
.media-meta {
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
.media-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  min-height: 48px;
}
.n-form {
  display: grid;
  gap: 8px;
}
.n-form-item {
  margin: 0;
}
.n-input-number {
  width: 100%;
}
</style>
