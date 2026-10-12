<script lang="ts" setup>
/**
 * The throughput strip: speeds over a faint trace of the last twenty seconds
 * on one half, the task counts on the other.
 */
import { computed, ref, watch } from 'vue';
import { NIcon } from 'naive-ui';
import { ArrowDownOutline, ArrowUpOutline } from '@vicons/ionicons5';
import type { StatResponse } from '@/lib/api';
import { formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const props = defineProps<{ stat: StatResponse; disabled: boolean }>();

/** Samples at the popup's poll rate: forty make twenty seconds. */
const SAMPLES = 40;
const count = (value: string) => parseInt(value, 10) || 0;
const down = ref<number[]>(Array(SAMPLES).fill(0));
watch(
  () => props.stat,
  (stat) => {
    down.value = [...down.value.slice(1), count(stat.downloadSpeed)];
  },
  { immediate: true },
);

const traced = computed(() => down.value.some(Boolean));
function trace(closed: boolean): string {
  const peak = Math.max(1, ...down.value);
  const points = down.value.map(
    (value, index) =>
      `${((index / (SAMPLES - 1)) * 100).toFixed(2)} ${(40 - (value / peak) * 34).toFixed(2)}`,
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
</script>

<template>
  <section :class="['meter', { 'meter--live': downloading, 'meter--disabled': disabled }]">
    <div class="meter__speeds">
      <svg
        :class="['meter__trace', { 'meter__trace--shown': traced }]"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path class="meter__area" v-bind="shape(trace(true))" />
        <path class="meter__line" v-bind="shape(trace(false))" />
      </svg>
      <span class="meter__down">
        <NIcon :size="15"><ArrowDownOutline /></NIcon>
        {{ formatSpeed(stat.downloadSpeed) }}
      </span>
      <span class="meter__up">
        <NIcon :size="11"><ArrowUpOutline /></NIcon>
        {{ formatSpeed(stat.uploadSpeed) }}
      </span>
    </div>
    <ul class="meter__counts">
      <li
        v-for="item in counts"
        :key="item.key"
        :class="['meter__count', `meter__count--${item.key}`, { 'meter__count--some': item.value }]"
      >
        <strong>{{ item.value }}</strong>
        <span>{{ item.label }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* Two equal halves: how fast, and how many. */
.meter {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 0 12px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-surface-well);
  font-variant-numeric: tabular-nums;
  transition: opacity 0.3s var(--m3-ease-emphasized);
}

.meter--disabled {
  opacity: 0.5;
}

.meter__speeds {
  position: relative;
  display: grid;
  align-content: center;
  gap: 2px;
  min-width: 0;
  padding: 11px 14px;
}

.meter__trace {
  position: absolute;
  inset: auto 0 0;
  width: 100%;
  height: 70%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.6s var(--m3-ease-emphasized);
}

.meter__trace--shown {
  opacity: 1;
}

.meter__area,
.meter__line {
  transition: d 0.5s linear;
}

.meter__area {
  fill: color-mix(in srgb, var(--color-primary) 9%, transparent);
}

.meter__line {
  fill: none;
  stroke: color-mix(in srgb, var(--color-primary) 40%, transparent);
  stroke-width: 1.25;
  vector-effect: non-scaling-stroke;
}

.meter__down,
.meter__up {
  position: relative;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
}

.meter__down {
  gap: 5px;
  color: var(--color-on-surface-variant);
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.25;
  transition: color 0.3s var(--m3-ease-emphasized);
}

.meter--live .meter__down {
  color: var(--color-primary);
}

.meter__up {
  gap: 5px;
  padding-inline-start: 2px;
  color: var(--color-on-surface-variant);
  font-size: 11px;
}

.meter__counts {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: center;
  margin: 0;
  padding: 0 6px;
  list-style: none;
}

/* A short rule between the halves, inset from the strip's edges. */
.meter__counts::before {
  content: '';
  position: absolute;
  inset-block: 16px;
  inset-inline-start: 0;
  width: 1px;
  background: color-mix(in srgb, var(--color-outline-variant) 80%, transparent);
}

.meter__count {
  display: grid;
  justify-items: center;
  gap: 1px;
  color: var(--color-on-surface-variant);
}

.meter__count strong {
  color: color-mix(in srgb, var(--color-on-surface-variant) 55%, transparent);
  font-size: 17px;
  font-weight: 650;
  line-height: 1.3;
  transition: color 0.3s var(--m3-ease-emphasized);
}

.meter__count span {
  font-size: 11px;
}

.meter__count--some strong {
  color: var(--color-on-surface);
}

.meter__count--active.meter__count--some strong {
  color: var(--color-primary);
}

@media (prefers-reduced-motion: reduce) {
  .meter,
  .meter__trace,
  .meter__area,
  .meter__line {
    transition: none;
  }
}
</style>
