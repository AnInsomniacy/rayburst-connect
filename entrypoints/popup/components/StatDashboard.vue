<script lang="ts" setup>
/**
 * The throughput band: speed in large figures, the task counts beside it, and
 * the last twenty seconds of traffic as a full-bleed floor that flattens into
 * a hairline when nothing moves.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { NIcon } from 'naive-ui';
import { ArrowUpOutline } from '@vicons/ionicons5';
import type { StatResponse } from '@/lib/api';
import { formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const props = defineProps<{ stat: StatResponse; disabled: boolean }>();

/** Samples at the popup's poll rate: forty make twenty seconds. */
const SAMPLES = 40;
const STEP = 100 / (SAMPLES - 1);
const count = (value: string) => parseInt(value, 10) || 0;
/** One sample more than fits: the newest waits past the right edge and slides in. */
let samples: number[] = Array(SAMPLES + 1).fill(0);
let sampledAt = globalThis.performance.now();
let period = 500;
/** The scale on screen, eased toward the samples' peak so rescaling never jumps. */
let shown = 1;
const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
const paths = ref({ line: '', area: '' });

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
function curve(points: [number, number][]): string {
  const at = (index: number) => points[Math.min(points.length - 1, Math.max(0, index))] ?? [0, 0];
  let path = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index++) {
    const [before, from, to, after] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    // Control points stay above the baseline, so the curve never dips under zero.
    const c1 = Math.min(31.5, from[1] + (to[1] - before[1]) / 6);
    const c2 = Math.min(31.5, to[1] - (after[1] - from[1]) / 6);
    path += ` C ${(from[0] + STEP / 3).toFixed(2)} ${c1.toFixed(2)} ${(to[0] - STEP / 3).toFixed(2)} ${c2.toFixed(2)} ${to[0].toFixed(2)} ${to[1].toFixed(2)}`;
  }
  return path;
}

let frame = 0;
function draw(now: number) {
  const target = Math.max(1, ...samples) * 1.15;
  // Rise quickly to fit a burst, settle slowly after it.
  shown += (target - shown) * (target > shown ? 0.2 : 0.05);
  const progress = reduced ? 1 : Math.min(1, (now - sampledAt) / period);
  const offset = -progress * STEP;
  const points = samples.map((value, index): [number, number] => [
    index * STEP + offset,
    31.5 - (value / shown) * 27,
  ]);
  const line = curve(points);
  const right = (points.at(-1)?.[0] ?? 100).toFixed(2);
  paths.value = { line, area: `${line} L ${right} 32 L ${offset.toFixed(2)} 32 Z` };
  const settled = Math.abs(target - shown) < target * 0.01;
  const flat = samples.every((value) => value === 0);
  frame = progress < 1 || !settled || !flat ? globalThis.requestAnimationFrame(draw) : 0;
}

watch(
  () => props.stat,
  (stat) => {
    const now = globalThis.performance.now();
    // The scroll lasts as long as the poll actually took, so it neither stalls nor skips.
    period = Math.min(3000, Math.max(250, now - sampledAt));
    sampledAt = now;
    samples = [...samples.slice(1), count(stat.downloadSpeed)];
    if (!frame) frame = globalThis.requestAnimationFrame(draw);
  },
  { immediate: true },
);
onUnmounted(() => globalThis.cancelAnimationFrame(frame));

/** Figures and unit set apart, so the number carries the weight. */
const speed = computed(() => {
  const [figure = '0', unit = ''] = formatSpeed(props.stat.downloadSpeed).split(' ');
  return { figure, unit };
});
const live = computed(() => count(props.stat.downloadSpeed) > 0);
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
</script>

<template>
  <section :class="['band', { 'band--live': live, 'band--disabled': disabled }]">
    <div class="band__speed">
      <p class="band__figure">
        <span>{{ speed.figure }}</span>
        <small>{{ speed.unit }}</small>
      </p>
      <p class="band__up">
        <NIcon :size="10"><ArrowUpOutline /></NIcon>
        {{ formatSpeed(stat.uploadSpeed) }}
      </p>
    </div>
    <dl class="band__counts">
      <div
        v-for="item in counts"
        :key="item.key"
        :class="['band__count', `band__count--${item.key}`, { 'band__count--some': item.value }]"
      >
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
    <svg class="band__trace" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="band-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--color-primary)" stop-opacity="0.18" />
          <stop offset="1" stop-color="var(--color-primary)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="band__area" :d="paths.area" />
      <path class="band__line" :d="paths.line" />
    </svg>
  </section>
</template>

<style scoped>
/* No container: the band is part of the page, divided from the list by its own trace. */
.band {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 24px 30px;
  font-variant-numeric: tabular-nums;
  transition: opacity 0.3s var(--m3-ease-emphasized);
}

.band--disabled {
  opacity: 0.5;
}

.band__speed {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.band__figure {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: color-mix(in srgb, var(--color-on-surface) 38%, transparent);
  line-height: 1;
  white-space: nowrap;
  transition: color 0.4s var(--m3-ease-emphasized);
}

.band__figure span {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.035em;
}

.band__figure small {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.band--live .band__figure {
  color: var(--color-on-surface);
}

.band--live .band__figure small {
  color: var(--color-primary);
}

.band__up {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-on-surface-variant);
  font-size: 11px;
}

/* Counts read as a quiet legend: label above, figure below, right-aligned. */
.band__counts {
  display: flex;
  gap: 18px;
  margin: 0;
  padding-bottom: 1px;
}

.band__count {
  display: grid;
  justify-items: end;
  gap: 5px;
}

.band__count dt {
  color: var(--color-on-surface-variant);
  font-size: 11px;
  line-height: 1;
}

.band__count dd {
  margin: 0;
  color: color-mix(in srgb, var(--color-on-surface) 30%, transparent);
  font-size: 17px;
  font-weight: 600;
  line-height: 1;
  transition: color 0.3s var(--m3-ease-emphasized);
}

.band__count--some dd {
  color: var(--color-on-surface);
}

.band__count--active.band__count--some dd {
  color: var(--color-primary);
}

/* The floor: full bleed, the trace rising out of a hairline. */
.band__trace {
  position: absolute;
  inset: auto 0 0;
  width: 100%;
  height: 22px;
  overflow: visible;
  pointer-events: none;
}

.band__area {
  fill: url('#band-fill');
}

.band__line {
  fill: none;
  stroke: color-mix(in srgb, var(--color-outline-variant) 90%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  transition: stroke 0.4s var(--m3-ease-emphasized);
}

.band--live .band__line {
  stroke: color-mix(in srgb, var(--color-primary) 70%, transparent);
  stroke-width: 1.5;
}

@media (prefers-reduced-motion: reduce) {
  .band,
  .band__figure,
  .band__line {
    transition: none;
  }
}
</style>
