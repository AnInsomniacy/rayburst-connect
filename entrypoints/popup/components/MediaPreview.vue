<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { NAlert, NInput, NQrCode, NButton } from 'naive-ui';
import type { MediaItem } from '@/lib/media/messages';
import { useI18n } from '@/shared/i18n/engine';
const props = defineProps<{ item: MediaItem }>();
const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();
const container = ref<InstanceType<typeof window.HTMLElement>>();
const video = ref<InstanceType<typeof window.HTMLVideoElement>>();
const error = ref(false);
let dispose: (() => Promise<void> | void) | undefined;
let revision = 0;
async function load() {
  const current = ++revision;
  await dispose?.();
  dispose = undefined;
  error.value = false;
  const element = video.value;
  if (!element) return;
  element.removeAttribute('src');
  element.load();
  try {
    if (
      ['hls', 'dash'].includes(props.item.kind) &&
      !(props.item.kind === 'hls' && element.canPlayType('application/vnd.apple.mpegurl'))
    ) {
      const { default: shaka } = await import('shaka-player');
      if (current !== revision) return;
      shaka.polyfill.installAll();
      const player = new shaka.Player();
      dispose = () => player.destroy();
      player.addEventListener('error', () => {
        error.value = true;
      });
      await player.attach(element);
      await player.load(props.item.url);
    } else if (/\.(?:flv|ts)(?:\?|$)/i.test(props.item.url)) {
      const { default: mpegts } = await import('mpegts.js');
      if (current !== revision) return;
      const player = mpegts.createPlayer(
        { type: /\.flv(?:\?|$)/i.test(props.item.url) ? 'flv' : 'mpegts', url: props.item.url },
        { enableWorker: false },
      );
      dispose = () => player.destroy();
      player.on(mpegts.Events.ERROR, () => {
        error.value = true;
      });
      player.attachMediaElement(element);
      player.load();
    } else element.src = props.item.url;
    if (current === revision) void element.play().catch(() => undefined);
  } catch {
    error.value = true;
  }
}
watch(() => props.item.id, load, { flush: 'post' });
onMounted(() => {
  void load();
  container.value?.scrollIntoView({ block: 'nearest' });
});
onUnmounted(() => {
  revision++;
  video.value?.pause();
  video.value?.removeAttribute('src');
  video.value?.load();
  void dispose?.();
});
</script>
<template>
  <section ref="container" class="preview">
    <NButton size="small" quaternary @click="emit('close')">{{
      t('media_settings_close_preview')
    }}</NButton>
    <NAlert v-if="error" type="info" :show-icon="false">{{
      t('resources_preview_unavailable')
    }}</NAlert>
    <video
      v-if="!['image', 'json', 'embedded', 'subtitle'].includes(item.kind)"
      ref="video"
      controls
      preload="metadata"
      @error="error = true"
    />
    <img v-else-if="item.kind === 'image'" :src="item.url" :alt="item.filename" />
    <details>
      <summary>{{ t('resources_url') }}</summary>
      <NInput :value="item.url" readonly type="textarea" :aria-label="t('resources_url')" />
      <NQrCode v-if="item.url.length < 1500" :value="item.url" :size="100" />
    </details>
  </section>
</template>
<style scoped>
.preview {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-outline-variant);
  border-radius: 8px;
}
.preview video,
.preview img {
  width: 100%;
  max-height: 360px;
}
</style>
