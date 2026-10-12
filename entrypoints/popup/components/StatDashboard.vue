<script lang="ts" setup>
/**
 * The throughput band: speed in large figures, the task counts beside it, and
 * the last twenty seconds of traffic drawn behind them, full bleed, down to the
 * hairline that divides the band from the list.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { NIcon } from 'naive-ui';
import { ArrowUpOutline } from '@vicons/ionicons5';
import type { StatResponse } from '@/lib/api';
import { formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const props = defineProps<{ stat: StatResponse; disabled: boolean }>();

/** Twenty seconds of traffic span the band. */
const SPAN = 20_000;
/** The scene's viewBox: the trace rises from the floor to at most PEAK units. */
const HEIGHT = 40;
const FLOOR = HEIGHT - 0.5;
const PEAK = 20;
/** Columns the scene is drawn in, one per viewBox unit. */
const COLUMNS = 100;
const count = (value: string) => parseInt(value, 10) || 0;

interface Sample {
  at: number;
  down: number;
  up: number;
}
let history: Sample[] = [];
/**
 * The trace runs this far behind the clock, a little longer than one poll, so
 * every sample slides in from past the right edge and the scroll never stops.
 */
let lag = 1200;
let shownLag = lag;
/** The scale on screen, eased toward the peak so rescaling never jumps. */
let shown = 1;
/** 0 draws the idle swell, 1 the traffic; eased between so neither state cuts in. */
let presence = 0;
const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = ref({ down: '', up: '', line: '', presence: 0 });

/** A reading at any moment, on a smooth curve through the samples (cubic Hermite). */
function reading(at: number, key: 'down' | 'up'): number {
  const next = history.findIndex((sample) => sample.at > at);
  if (next <= 0) return (next === 0 ? history[0] : history.at(-1))?.[key] ?? 0;
  const [before, from, to, after] = [next - 2, next - 1, next, next + 1].map(
    (index) => history[Math.min(history.length - 1, Math.max(0, index))] as Sample,
  ) as [Sample, Sample, Sample, Sample];
  const span = to.at - from.at;
  const slope = (a: Sample, b: Sample) => ((b[key] - a[key]) / (b.at - a.at || 1)) * span;
  const s = (at - from.at) / span;
  const value =
    (2 * s ** 3 - 3 * s ** 2 + 1) * from[key] +
    (s ** 3 - 2 * s ** 2 + s) * slope(before, to) +
    (-2 * s ** 3 + 3 * s ** 2) * to[key] +
    (s ** 3 - s ** 2) * slope(from, after);
  return Math.max(0, value);
}

/** The idle swell: a slow wave drifting left, `period` units long and `height` tall. */
function swell(x: number, now: number, period: number, height: number, pace: number): number {
  return (height * (1 - Math.cos((2 * Math.PI * (x + (now / 1000) * pace)) / period))) / 2;
}

function outline(points: number[]): string {
  return points
    .map((y, column) => `${column ? 'L' : 'M'} ${(column * 100) / COLUMNS} ${y.toFixed(2)}`)
    .join(' ');
}

let frame = 0;
function draw(now: number) {
  const time = (x: number) => now - shownLag - ((100 - x) / 100) * SPAN;
  // Keep one sample past the left edge so the curve enters the band whole.
  while (history.length > 2 && (history[1]?.at ?? now) < time(0)) history.shift();
  const target = Math.max(1, ...history.map((sample) => sample.down)) * 1.15;
  // Rise quickly to fit a burst, settle slowly after it.
  shown += (target - shown) * (target > shown ? 0.2 : 0.05);
  shownLag += (lag - shownLag) * 0.05;
  const busy = count(props.stat.downloadSpeed) > 0 || count(props.stat.numActive) > 0;
  presence = reduced ? Number(busy) : presence + (Number(busy) - presence) * 0.05;
  const lift = (value: number) => Math.min(1, value / shown) * PEAK;
  const mix = (calm: number, value: number) => FLOOR - (calm + (value - calm) * presence);
  const down: number[] = [];
  const up: number[] = [];
  for (let column = 0; column <= COLUMNS; column++) {
    const x = (column * 100) / COLUMNS;
    down.push(mix(swell(x, now, 60, 3, 1.2), lift(reading(time(x), 'down'))));
    up.push(mix(swell(x, now, 40, 2, 0.8), lift(reading(time(x), 'up'))));
  }
  const line = outline(down);
  const close = ` L 100 ${HEIGHT} L 0 ${HEIGHT} Z`;
  scene.value = { down: line + close, up: outline(up) + close, line, presence };
  frame = reduced ? 0 : globalThis.requestAnimationFrame(draw);
}

watch(
  () => props.stat,
  (stat) => {
    const now = globalThis.performance.now();
    const sample = { at: now, down: count(stat.downloadSpeed), up: count(stat.uploadSpeed) };
    const last = history.at(-1);
    if (last) {
      lag = Math.min(4000, Math.max(400, (now - last.at) * 1.3));
      history.push(sample);
    } else {
      // The past is unknown on opening: the first reading spans the band at its true scale.
      shown = Math.max(1, sample.down) * 1.15;
      presence = Number(sample.down > 0 || count(stat.numActive) > 0);
      history = [{ ...sample, at: now - lag }];
    }
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
    <!-- Behind the figures: live traffic, easing into a slow swell while nothing moves. -->
    <svg
      class="band__scene"
      :viewBox="`0 0 100 ${HEIGHT}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="band-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--color-primary)" stop-opacity="0.2" />
          <stop offset="1" stop-color="var(--color-primary)" stop-opacity="0.05" />
        </linearGradient>
      </defs>
      <path class="band__up-area" :d="scene.up" />
      <path class="band__down-area" :d="scene.down" />
      <path class="band__line" :d="scene.line" :style="{ opacity: scene.presence }" />
    </svg>
  </section>
</template>

<style scoped>
/* No container: the band is part of the page, divided from the list by a hairline. */
.band {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 24px 20px;
  border-bottom: 1px solid var(--color-outline-variant);
  overflow: clip;
  font-variant-numeric: tabular-nums;
  transition: opacity 0.3s var(--m3-ease-emphasized);
}

.band--disabled {
  opacity: 0.5;
}

.band__speed,
.band__counts {
  position: relative;
  z-index: 1;
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

/* The scene fills the band and fades out toward the top, so figures stay clear. */
.band__scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  mask-image: linear-gradient(to top, #000 30%, transparent 90%);
}

.band__down-area {
  fill: url('#band-fill');
}

.band__up-area {
  fill: color-mix(in srgb, var(--color-primary) 9%, transparent);
}

.band__line {
  fill: none;
  stroke: color-mix(in srgb, var(--color-primary) 70%, transparent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

@media (prefers-reduced-motion: reduce) {
  .band,
  .band__figure {
    transition: none;
  }
}
</style>
