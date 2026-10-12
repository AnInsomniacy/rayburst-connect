<script lang="ts" setup>
/** Global speed and task counts for the popup: two speed halves over three count thirds. */
import { computed } from 'vue';
import { NIcon } from 'naive-ui';
import { ArrowDownOutline, ArrowUpOutline } from '@vicons/ionicons5';
import type { StatResponse } from '@/lib/api';
import { formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const props = defineProps<{
  stat: StatResponse;
  disabled: boolean;
}>();

const count = (value: string) => parseInt(value, 10) || 0;
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
const uploading = computed(() => count(props.stat.uploadSpeed) > 0);
</script>

<template>
  <section :class="['stat-card', { 'stat-card--disabled': disabled }]">
    <div class="stat-card__speeds">
      <span :class="['stat-card__speed', { 'stat-card__speed--live': downloading }]">
        <NIcon :size="16"><ArrowDownOutline /></NIcon>
        {{ formatSpeed(stat.downloadSpeed) }}
      </span>
      <span
        :class="[
          'stat-card__speed',
          'stat-card__speed--up',
          { 'stat-card__speed--live': uploading },
        ]"
      >
        <NIcon :size="16"><ArrowUpOutline /></NIcon>
        {{ formatSpeed(stat.uploadSpeed) }}
      </span>
    </div>
    <div class="stat-card__counts">
      <span
        v-for="item in counts"
        :key="item.key"
        :class="[
          'stat-card__count',
          `stat-card__count--${item.key}`,
          { 'stat-card__count--live': item.value > 0 },
        ]"
      >
        <strong>{{ item.value }}</strong>
        {{ item.label }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.stat-card {
  margin: 4px 12px 8px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-surface-container-low);
  font-variant-numeric: tabular-nums;
}

/* Two halves, split by a hairline. */
.stat-card__speeds {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.stat-card__speed {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px 8px 14px;
  color: var(--color-on-surface-variant);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  transition: color 0.3s var(--m3-ease-emphasized);
}

.stat-card__speed--up {
  border-inline-start: 1px solid var(--color-outline-variant);
}

.stat-card__speed--live {
  color: var(--color-primary);
}

.stat-card__speed--up.stat-card__speed--live {
  color: var(--color-tertiary);
}

/* Three thirds on a slightly deeper tone. */
.stat-card__counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 10px 8px 12px;
  background: color-mix(in srgb, var(--color-on-surface) 3%, transparent);
  transition: opacity 0.3s var(--m3-ease-emphasized);
}

.stat-card__count {
  display: grid;
  justify-items: center;
  gap: 2px;
  color: var(--color-on-surface-variant);
  font-size: 11px;
}

.stat-card__count strong {
  color: var(--color-on-surface-variant);
  font-size: 15px;
  font-weight: 600;
  opacity: 0.6;
  transition:
    color 0.3s var(--m3-ease-emphasized),
    opacity 0.3s var(--m3-ease-emphasized);
}

.stat-card__count--live strong {
  color: var(--color-on-surface);
  opacity: 1;
}

.stat-card__count--active.stat-card__count--live strong {
  color: var(--color-primary);
}

.stat-card--disabled .stat-card__counts {
  opacity: 0.45;
}
</style>
