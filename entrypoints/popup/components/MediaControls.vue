<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from '@/lib/validation';
import { NButton, NIcon, NSelect, NSlider, NTooltip } from 'naive-ui';
import {
  BrowsersOutline,
  CameraOutline,
  ExpandOutline,
  Pause,
  Play,
  RepeatOutline,
  VolumeHighOutline,
  VolumeMuteOutline,
} from '@vicons/ionicons5';
import { useI18n } from '@/shared/i18n/engine';
import { usePolling } from '@/shared/use-polling';
import CollapsePanel from '@/shared/components/CollapsePanel.vue';
import type { PlayerCommandSchema } from '@/lib/media/player-controls';

const props = defineProps<{ tabId: number; active: boolean }>();
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
type Player = z.infer<typeof PlayerSchema> & { frameId: number };
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const players = ref<Player[]>([]);
const selected = ref('');
const failed = ref(false);
/** Set while a slider sends its value; polling must not move the thumb back. */
let adjustment: ReturnType<typeof setTimeout> | undefined;
let settling = 0;
const current = computed(() =>
  players.value.find((player) => `${player.frameId}:${player.id}` === selected.value),
);
/** The last player shown, kept while its panel collapses. */
const shown = ref<Player>();
watch(current, (player) => {
  if (player) shown.value = player;
});
const rates = computed(() => {
  const rate = current.value?.rate ?? 1;
  return RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b);
});

/** A readable name for a player: blob sources name only their page. */
function playerName(player: Player, index: number) {
  const raw = player.source.replace(/^blob:/, '');
  try {
    const url = new URL(raw);
    const file = player.source.startsWith('blob:')
      ? ''
      : decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return `${index + 1}. ${file || url.hostname}`;
  } catch {
    return `${index + 1}. ${player.source || player.id}`;
  }
}
const options = computed(() =>
  players.value.map((player, index) => ({
    value: `${player.frameId}:${player.id}`,
    label: playerName(player, index),
  })),
);
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

async function refresh() {
  const response: unknown = await browser.runtime.sendMessage({
    type: 'MEDIA_PLAYER',
    tabId: props.tabId,
    command: { action: 'list' },
  });
  const frames = z
    .array(z.object({ frameId: z.number(), players: z.array(PlayerSchema) }))
    .safeParse(response);
  if (!frames.success) return false;
  if (Date.now() < settling) return true;
  players.value = frames.data.flatMap((frame) =>
    frame.players.map((player) => ({ ...player, frameId: frame.frameId })),
  );
  if (!current.value) {
    const first = players.value[0];
    selected.value = first ? `${first.frameId}:${first.id}` : '';
  }
  return true;
}
async function act(command: z.infer<typeof PlayerCommandSchema>) {
  failed.value = false;
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: 'MEDIA_PLAYER',
      tabId: props.tabId,
      frameId: current.value?.frameId,
      command,
    });
    if (response !== true) failed.value = true;
    settling = 0;
    await refresh();
  } catch {
    failed.value = true;
  }
}
function adjust(action: 'volume' | 'time', value: number) {
  const player = current.value;
  if (!player) return;
  player[action] = value;
  settling = Date.now() + 800;
  clearTimeout(adjustment);
  adjustment = setTimeout(() => {
    void act({ action, id: player.id, value });
  }, 80);
}

// The position moves while a player runs; the list follows it while the tools show.
const poller = usePolling({
  fn: () => refresh().catch(() => false),
  baseIntervalMs: 1000,
  maxIntervalMs: 8000,
});
watch(
  () => [props.active, props.tabId] as const,
  ([active]) => {
    clearTimeout(adjustment);
    poller.stop();
    if (active) poller.start();
    else void refresh().catch(() => undefined);
  },
  { immediate: true },
);
watch(selected, () => clearTimeout(adjustment));
onUnmounted(() => {
  poller.stop();
  clearTimeout(adjustment);
});
</script>
<template>
  <section class="player" :aria-label="t('resources_controls')">
    <header class="player__head">
      <h3 class="tool-title">{{ t('resources_controls') }}</h3>
      <NSelect
        v-if="players.length > 1"
        v-model:value="selected"
        class="player__pick"
        size="tiny"
        :consistent-menu-width="false"
        :options="options"
        :aria-label="t('resources_controls')"
      />
      <span v-else-if="current" class="player__name" :title="current.source">{{
        options[0]?.label.replace(/^1\. /, '')
      }}</span>
    </header>
    <p v-if="!players.length" class="player__empty">{{ t('resources_no_player') }}</p>
    <CollapsePanel :open="Boolean(current)">
      <div v-if="shown" class="player__body">
        <div class="transport">
          <NButton
            circle
            type="primary"
            class="transport__play"
            :aria-label="t(shown.paused ? 'resources_play' : 'resources_pause')"
            @click="act({ action: shown.paused ? 'play' : 'pause', id: shown.id })"
          >
            <template #icon
              ><NIcon :size="18"
                ><Transition name="icon-swap"
                  ><Play v-if="shown.paused" key="play" /><Pause
                    v-else
                    key="pause" /></Transition></NIcon
            ></template>
          </NButton>
          <span class="transport__clock"
            >{{ clock(shown.time)
            }}<span v-if="shown.duration"> / {{ clock(shown.duration) }}</span></span
          >
          <span class="transport__space" />
          <NTooltip
            v-for="tool in [
              {
                key: 'loop',
                icon: RepeatOutline,
                label: t('resources_loop'),
                on: shown.loop,
                run: () => act({ action: 'loop', id: shown!.id, value: !shown!.loop }),
              },
              ...(shown.video
                ? [
                    {
                      key: 'pip',
                      icon: BrowsersOutline,
                      label: t('resources_pip'),
                      on: false,
                      run: () => act({ action: 'pip', id: shown!.id }),
                    },
                    {
                      key: 'fullscreen',
                      icon: ExpandOutline,
                      label: t('resources_fullscreen'),
                      on: false,
                      run: () => act({ action: 'fullscreen', id: shown!.id }),
                    },
                    {
                      key: 'screenshot',
                      icon: CameraOutline,
                      label: t('resources_screenshot'),
                      on: false,
                      run: () => act({ action: 'screenshot', id: shown!.id }),
                    },
                  ]
                : []),
            ]"
            :key="tool.key"
            trigger="hover"
          >
            <template #trigger>
              <NButton
                quaternary
                circle
                size="small"
                :class="{ 'transport__tool--on': tool.on }"
                :aria-label="tool.label"
                :aria-pressed="tool.key === 'loop' ? tool.on : undefined"
                @click="tool.run()"
              >
                <template #icon
                  ><NIcon><component :is="tool.icon" /></NIcon
                ></template>
              </NButton>
            </template>
            {{ tool.label }}
          </NTooltip>
        </div>
        <NSlider
          v-if="shown.duration"
          class="player__seek"
          :value="shown.time"
          :min="0"
          :max="shown.duration"
          :step="0.1"
          :format-tooltip="clock"
          :aria-label="t('resources_time')"
          @update:value="adjust('time', $event)"
        />
        <div class="player__row">
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton
                quaternary
                circle
                size="small"
                :aria-label="t('resources_mute')"
                :aria-pressed="shown.muted"
                @click="act({ action: 'muted', id: shown.id, value: !shown.muted })"
              >
                <template #icon
                  ><NIcon
                    ><Transition name="icon-swap"
                      ><VolumeMuteOutline
                        v-if="shown.muted || !shown.volume"
                        key="muted" /><VolumeHighOutline v-else key="volume" /></Transition></NIcon
                ></template>
              </NButton>
            </template>
            {{ t('resources_mute') }}
          </NTooltip>
          <NSlider
            class="player__volume"
            :value="shown.muted ? 0 : shown.volume"
            :min="0"
            :max="1"
            :step="0.01"
            :format-tooltip="(value: number) => `${Math.round(value * 100)}%`"
            :aria-label="t('resources_volume')"
            @update:value="adjust('volume', $event)"
          />
        </div>
        <div class="player__row" role="radiogroup" :aria-label="t('resources_speed')">
          <span class="player__label">{{ t('resources_speed') }}</span>
          <div class="rates">
            <button
              v-for="rate in rates"
              :key="rate"
              type="button"
              role="radio"
              :aria-checked="shown.rate === rate"
              :class="['rate', { 'rate--on': shown.rate === rate }]"
              @click="act({ action: 'rate', id: shown.id, value: rate })"
            >
              {{ rate }}×
            </button>
          </div>
        </div>
        <p v-if="failed" class="player__failed" role="status">{{ t('media_unsupported') }}</p>
      </div>
    </CollapsePanel>
  </section>
</template>
<style scoped>
.player {
  display: grid;
  gap: 6px;
}
.player__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.player__pick {
  width: auto;
  min-width: 0;
  max-width: 60%;
  margin-inline-start: auto;
}
.player__name {
  min-width: 0;
  margin-inline-start: auto;
  overflow: hidden;
  color: var(--color-on-surface-variant);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player__empty {
  margin: 0;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
.player__body {
  display: grid;
  gap: 4px;
  padding-top: 4px;
}
.transport {
  display: flex;
  align-items: center;
  gap: 2px;
}
.transport__play {
  width: 36px;
  height: 36px;
  margin-inline-end: 8px;
}
.transport__clock {
  color: var(--color-on-surface-variant);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.transport__space {
  flex: 1;
}
.transport__tool--on {
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}
.player__seek {
  margin: 2px 0 4px;
}
.player__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.player__volume {
  flex: 1;
  margin-inline-end: 6px;
}
.player__label {
  flex: none;
  width: 32px;
  padding-inline-start: 4px;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}
.rates {
  display: flex;
  flex: 1;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-full);
  background: var(--color-surface-container);
}
.rate {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color 0.15s var(--m3-ease-emphasized),
    color 0.15s var(--m3-ease-emphasized);
}
.rate:hover {
  color: var(--color-on-surface);
}
.rate--on {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-card);
}
.rate:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.player__failed {
  margin: 0;
  color: var(--color-error);
  font-size: 12px;
}
</style>
