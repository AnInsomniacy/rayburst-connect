<script lang="ts" setup>
/** Global stat dashboard for the popup. */
import { computed } from 'vue';
import { NIcon } from 'naive-ui';
import {
  ArrowDownOutline,
  ArrowUpOutline,
  FlashOutline,
  TimeOutline,
  CheckmarkDoneOutline,
} from '@vicons/ionicons5';
import type { StatResponse } from '@/lib/api';
import { formatSpeed } from '@/lib/format';

import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const props = defineProps<{
  stat: StatResponse;
  disabled: boolean;
}>();

/* ── Derived State ──────────────────────────────────────────────── */

const numActive = computed(() => parseInt(props.stat.numActive, 10) || 0);
const numWaiting = computed(() => parseInt(props.stat.numWaiting, 10) || 0);
const numStopped = computed(() => parseInt(props.stat.numStopped, 10) || 0);
const isIdle = computed(() => numActive.value === 0);
</script>

<template>
  <div class="stat-dash">
    <!-- ── Speed Row (side-by-side) ───────────────────────── -->
    <div :class="['stat-dash__speed', { 'stat-dash__speed--idle': isIdle }]">
      <div class="stat-dash__speed-col stat-dash__speed-col--dl">
        <NIcon :size="16" class="stat-dash__speed-icon">
          <ArrowDownOutline />
        </NIcon>
        <span class="stat-dash__speed-value">{{ formatSpeed(stat.downloadSpeed) }}</span>
      </div>
      <div class="stat-dash__speed-divider" />
      <div class="stat-dash__speed-col stat-dash__speed-col--ul">
        <NIcon :size="13" class="stat-dash__speed-icon">
          <ArrowUpOutline />
        </NIcon>
        <span class="stat-dash__speed-value">{{ formatSpeed(stat.uploadSpeed) }}</span>
      </div>
    </div>

    <!-- ── Task Counts ─────────────────────────────────────── -->
    <div :class="['stat-dash__counts', { 'stat-dash__counts--disabled': props.disabled }]">
      <div class="stat-dash__count stat-dash__count--active">
        <NIcon :size="13"><FlashOutline /></NIcon>
        <span class="stat-dash__count-label">{{ i18n('popup_stat_active', 'Active') }}</span>
        <span class="stat-dash__count-value">{{ numActive }}</span>
      </div>
      <div class="stat-dash__count stat-dash__count--waiting">
        <NIcon :size="13"><TimeOutline /></NIcon>
        <span class="stat-dash__count-label">{{ i18n('popup_stat_waiting', 'Waiting') }}</span>
        <span class="stat-dash__count-value">{{ numWaiting }}</span>
      </div>
      <div class="stat-dash__count stat-dash__count--stopped">
        <NIcon :size="13"><CheckmarkDoneOutline /></NIcon>
        <span class="stat-dash__count-label">{{ i18n('popup_stat_stopped', 'Done') }}</span>
        <span class="stat-dash__count-value">{{ numStopped }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-dash {
  padding: 0 16px;
}

/* ── Speed Row ────────────────────────────────────────────────── */

.stat-dash__speed {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 18px 0 14px;
  transition: opacity 0.4s cubic-bezier(0.2, 0, 0, 1);
}

.stat-dash__speed--idle {
  opacity: 0.4;
}

.stat-dash__speed-col {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

.stat-dash__speed-col--dl {
  color: var(--color-primary);
}

.stat-dash__speed-col--dl .stat-dash__speed-value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.stat-dash__speed-col--ul {
  color: var(--color-on-surface-variant);
}

.stat-dash__speed-col--ul .stat-dash__speed-value {
  font-size: 14px;
  font-weight: 500;
}

.stat-dash__speed-icon {
  flex-shrink: 0;
}

.stat-dash__speed-divider {
  width: 1px;
  height: 24px;
  background: var(--color-outline-variant);
  flex-shrink: 0;
}

/* ── Task Counts ──────────────────────────────────────────────── */

.stat-dash__counts {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 10px 0;
  border-top: 1px solid var(--color-outline-variant);
}

.stat-dash__count {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.stat-dash__count--active {
  color: var(--color-primary);
}

.stat-dash__count--waiting {
  color: var(--color-warning);
}

.stat-dash__count--stopped {
  color: var(--color-success);
}

.stat-dash__count-label {
  font-weight: 500;
}

.stat-dash__count-value {
  font-weight: 700;
  font-size: 14px;
  min-width: 16px;
  text-align: center;
}

.stat-dash__counts--disabled {
  opacity: 0.35;
  pointer-events: none;
  transition: opacity 0.4s cubic-bezier(0.2, 0, 0, 1);
}
</style>
