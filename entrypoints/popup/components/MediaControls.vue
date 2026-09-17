<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { NAlert, NButton, NCheckbox, NInputNumber, NSelect, NSlider, NSpace } from 'naive-ui';
import { useI18n } from '@/shared/i18n/engine';
import type { PlayerCommandSchema } from '@/lib/media/player-controls';
const props = defineProps<{ tabId: number }>();
const { t } = useI18n();
const PlayerSchema = z.object({
  id: z.number(),
  source: z.string(),
  paused: z.boolean(),
  duration: z.number(),
  time: z.number(),
  rate: z.number(),
  volume: z.number(),
  muted: z.boolean(),
  loop: z.boolean(),
  video: z.boolean(),
});
const players = ref<(z.infer<typeof PlayerSchema> & { frameId: number })[]>([]);
const selected = ref('');
const error = ref(false);
let adjustment: ReturnType<typeof setTimeout> | undefined;
function adjust(action: 'volume' | 'time', value: number) {
  const player = current.value;
  if (!player) return;
  player[action] = value;
  clearTimeout(adjustment);
  adjustment = setTimeout(() => {
    void act({ action, id: player.id, value });
  }, 80);
}
const current = computed(() =>
  players.value.find((player) => `${player.frameId}:${player.id}` === selected.value),
);
async function refresh() {
  const response: unknown = await browser.runtime.sendMessage({
    type: 'MEDIA_PLAYER',
    tabId: props.tabId,
    command: { action: 'list' },
  });
  const frames = z
    .array(z.object({ frameId: z.number(), players: z.array(PlayerSchema) }))
    .safeParse(response);
  if (!frames.success) return;
  players.value = frames.data.flatMap((frame) =>
    frame.players.map((player) => ({ ...player, frameId: frame.frameId })),
  );
  if (!current.value && players.value[0])
    selected.value = `${players.value[0].frameId}:${players.value[0].id}`;
}
async function act(command: z.infer<typeof PlayerCommandSchema>) {
  error.value = false;
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: 'MEDIA_PLAYER',
      tabId: props.tabId,
      frameId: current.value?.frameId,
      command,
    });
    if (response !== true) error.value = true;
    await refresh();
  } catch {
    error.value = true;
  }
}
onMounted(refresh);
watch(
  () => props.tabId,
  () => {
    clearTimeout(adjustment);
    void refresh();
  },
);
watch(selected, () => clearTimeout(adjustment));
onUnmounted(() => clearTimeout(adjustment));
</script>
<template>
  <section class="controls">
    <NAlert v-if="error" type="info">{{ t('media_unsupported') }}</NAlert>
    <NSelect
      v-model:value="selected"
      :options="
        players.map((player) => ({
          value: `${player.frameId}:${player.id}`,
          label: player.source || `${player.frameId}:${player.id}`,
        }))
      "
      :placeholder="t('media_none')"
      :aria-label="t('resources_controls')"
    />
    <template v-if="current">
      <NSpace>
        <NButton
          size="small"
          @click="act({ action: current.paused ? 'play' : 'pause', id: current.id })"
          >{{ t(current.paused ? 'resources_play' : 'resources_pause') }}</NButton
        >
        <NButton
          v-if="current.video"
          size="small"
          @click="act({ action: 'pip', id: current.id })"
          >{{ t('resources_pip') }}</NButton
        >
        <NButton
          v-if="current.video"
          size="small"
          @click="act({ action: 'fullscreen', id: current.id })"
          >{{ t('resources_fullscreen') }}</NButton
        >
        <NButton
          v-if="current.video"
          size="small"
          @click="act({ action: 'screenshot', id: current.id })"
          >{{ t('resources_screenshot') }}</NButton
        >
      </NSpace>
      <label
        >{{ t('resources_speed')
        }}<NInputNumber
          :value="current.rate"
          :min="0.25"
          :max="16"
          :step="0.25"
          @update:value="act({ action: 'rate', id: current.id, value: $event ?? 1 })"
      /></label>
      <label
        >{{ t('resources_volume')
        }}<NSlider
          :value="current.volume"
          :aria-label="t('resources_volume')"
          :min="0"
          :max="1"
          :step="0.01"
          @update:value="adjust('volume', $event)"
      /></label>
      <label v-if="current.duration"
        >{{ t('resources_time')
        }}<NSlider
          :value="current.time"
          :aria-label="t('resources_time')"
          :min="0"
          :max="current.duration"
          @update:value="adjust('time', $event)"
      /></label>
      <NSpace
        ><NCheckbox
          :checked="current.loop"
          @update:checked="act({ action: 'loop', id: current.id, value: $event })"
          >{{ t('resources_loop') }}</NCheckbox
        ><NCheckbox
          :checked="current.muted"
          @update:checked="act({ action: 'muted', id: current.id, value: $event })"
          >{{ t('resources_mute') }}</NCheckbox
        ></NSpace
      >
    </template>
  </section>
</template>
<style scoped>
.controls {
  padding: 8px 0;
  display: grid;
  gap: 12px;
}
label {
  display: grid;
  gap: 8px;
  font-size: 12px;
}
</style>
