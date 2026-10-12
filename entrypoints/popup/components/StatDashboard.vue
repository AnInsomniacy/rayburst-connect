<script lang="ts" setup>
/**
 * The throughput meter: current speeds over a live trace of the last
 * twenty seconds, and the task counts with the one bulk action that applies.
 */
import { computed, ref, watch } from 'vue';
import { NButton, NIcon } from 'naive-ui';
import { ArrowDownOutline, ArrowUpOutline, PauseOutline, PlayOutline } from '@vicons/ionicons5';
import type { StatResponse } from '@/lib/api';
import { formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const props = defineProps<{
  stat: StatResponse;
  disabled: boolean;
  bulk: 'pause' | 'resume' | null;
}>();
const emit = defineEmits<{ pauseAll: []; resumeAll: [] }>();

/** Samples at the popup's poll rate: forty make twenty seconds. */
const SAMPLES = 40;
const count = (value: string) => parseInt(value, 10) || 0;
const down = ref<number[]>(Array(SAMPLES).fill(0));
const up = ref<number[]>(Array(SAMPLES).fill(0));
watch(
  () => props.stat,
  (stat) => {
    down.value = [...down.value.slice(1), count(stat.downloadSpeed)];
    up.value = [...up.value.slice(1), count(stat.uploadSpeed)];
  },
  { immediate: true },
);

// Both traces share one scale, so upload reads as the smaller stream it is.
const peak = computed(() => Math.max(1, ...down.value, ...up.value));
function trace(samples: number[], closed: boolean): string {
  const points = samples.map(
    (value, index) =>
      `${((index / (SAMPLES - 1)) * 100).toFixed(2)} ${(40 - (value / peak.value) * 36).toFixed(2)}`,
  );
  return `M ${points.join(' L ')}${closed ? ' L 100 40 L 0 40 Z' : ''}`;
}
/** The attribute draws the trace; the CSS property lets supporting browsers morph it. */
const shape = (path: string) => ({ d: path, style: { d: `path('${path}')` } });

const counts = computed(() => [
  { key: 'active', label: i18n('popup_stat_active', 'Active'), value: count(props.stat.numActive) },
  {
    key: 'waiting',
    label: i18n('popup_stat_waiting', 'Waiting'),
    value: count(props.stat.numWaiting),
  },
  {
    key: 'stopped',
    label: i18n('popup_stat_stopped', 'Done'),
    value: count(props.stat.numStopped),
  },
]);
const downloading = computed(() => count(props.stat.downloadSpeed) > 0);
/** The trace opens with the first traffic and folds away once its history is quiet. */
const traced = computed(() => down.value.some(Boolean) || up.value.some(Boolean));
</script>

<template>
  <section
    :class="[
      'meter',
      { 'meter--live': downloading, 'meter--traced': traced, 'meter--disabled': disabled },
    ]"
  >
    <div class="meter__speeds">
      <span class="meter__down">
        <NIcon :size="16"><ArrowDownOutline /></NIcon>
        {{ formatSpeed(stat.downloadSpeed) }}
      </span>
      <span class="meter__up">
        <NIcon :size="12"><ArrowUpOutline /></NIcon>
        {{ formatSpeed(stat.uploadSpeed) }}
      </span>
    </div>
    <div class="meter__footer">
      <span class="meter__counts">
        <span
          v-for="item in counts"
          :key="item.key"
          :class="['meter__count', { 'meter__count--live': item.value > 0 }]"
        >
          {{ item.label }} <strong>{{ item.value }}</strong>
        </span>
      </span>
      <Transition name="pop" mode="out-in">
        <NButton
          v-if="bulk"
          :key="bulk"
          size="tiny"
          quaternary
          class="meter__bulk"
          :disabled="disabled"
          @click="bulk === 'pause' ? emit('pauseAll') : emit('resumeAll')"
        >
          <template #icon>
            <NIcon><PauseOutline v-if="bulk === 'pause'" /><PlayOutline v-else /></NIcon>
          </template>
          {{
            bulk === 'pause'
              ? i18n('popup_action_pause_all', 'Pause All')
              : i18n('popup_action_resume_all', 'Resume All')
          }}
        </NButton>
      </Transition>
    </div>
    <svg class="meter__trace" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <template v-if="down.some(Boolean)">
        <path class="meter__area" v-bind="shape(trace(down, true))" />
        <path class="meter__line" v-bind="shape(trace(down, false))" />
      </template>
      <path
        v-if="up.some(Boolean)"
        class="meter__line meter__line--up"
        v-bind="shape(trace(up, false))"
      />
    </svg>
  </section>
</template>

<style scoped>
.meter {
  display: grid;
  gap: 8px;
  margin: 0 12px;
  padding: 14px 14px 10px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--color-surface-well);
  font-variant-numeric: tabular-nums;
}

/* The trace is the meter's floor: full bleed, below the figures, never under them. */
.meter__trace {
  display: block;
  width: calc(100% + 28px);
  height: 0;
  margin: -8px -14px 0;
  transition:
    height 0.4s var(--m3-ease-emphasized),
    margin 0.4s var(--m3-ease-emphasized);
}

.meter--traced .meter__trace {
  height: 36px;
  margin: 0 -14px -10px;
}

.meter__area,
.meter__line {
  transition: d 0.5s linear;
}

.meter__area {
  fill: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.meter__line {
  fill: none;
  stroke: color-mix(in srgb, var(--color-primary) 55%, transparent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.meter__line--up {
  stroke: color-mix(in srgb, var(--color-on-surface) 22%, transparent);
  stroke-dasharray: 3 3;
}

.meter__speeds,
.meter__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meter__down {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-on-surface-variant);
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  transition: color 0.3s var(--m3-ease-emphasized);
}

.meter--live .meter__down {
  color: var(--color-primary);
}

.meter__up {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}

.meter__footer {
  min-height: 24px;
}

.meter__counts {
  display: flex;
  gap: 14px;
  color: var(--color-on-surface-variant);
  font-size: 12px;
  transition: opacity 0.3s var(--m3-ease-emphasized);
}

.meter__count strong {
  font-weight: 600;
  opacity: 0.6;
}

.meter__count--live strong {
  color: var(--color-on-surface);
  opacity: 1;
}

.meter--disabled .meter__counts {
  opacity: 0.45;
}

.meter__bulk {
  color: var(--color-on-surface-variant);
}

@media (prefers-reduced-motion: reduce) {
  .meter__trace,
  .meter__area,
  .meter__line {
    transition: none;
  }
}
</style>
