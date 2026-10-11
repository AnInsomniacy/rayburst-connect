<script lang="ts" setup>
/** Popup task list: progress of each download with pause, resume and show-in-folder. */
import { NButton, NIcon } from 'naive-ui';
import {
  AlertCircleOutline,
  FolderOpenOutline,
  PauseOutline,
  PlayOutline,
} from '@vicons/ionicons5';
import type { DesktopTask } from '@/lib/api';
import { formatBytes, formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

defineProps<{ tasks: DesktopTask[]; busy: string | null }>();
const emit = defineEmits<{ pause: [gid: string]; resume: [gid: string]; reveal: [gid: string] }>();
const { t: i18n } = useI18n();

function percent(task: DesktopTask): number {
  const total = parseInt(task.totalLength, 10);
  const done = parseInt(task.completedLength, 10);
  if (task.status === 'complete') return 100;
  if (!(total > 0) || !(done > 0)) return 0;
  return Math.min(100, (done / total) * 100);
}

function progress(task: DesktopTask): string {
  const total = parseInt(task.totalLength, 10);
  const done = formatBytes(task.completedLength);
  return total > 0 ? `${done} / ${formatBytes(total)}` : done;
}

function detail(task: DesktopTask): string {
  switch (task.status) {
    case 'active':
      return `${progress(task)} · ${formatSpeed(task.downloadSpeed)}`;
    case 'waiting':
      return `${i18n('popup_task_waiting', 'Waiting')} · ${progress(task)}`;
    case 'paused':
      return `${i18n('popup_task_paused', 'Paused')} · ${progress(task)}`;
    case 'complete':
      return formatBytes(task.totalLength);
    default:
      return task.errorMessage || i18n('popup_task_failed', 'Failed');
  }
}
</script>

<template>
  <ul v-if="tasks.length > 0" class="task-list">
    <li v-for="task in tasks" :key="task.gid" :class="['task-row', `task-row--${task.status}`]">
      <div class="task-row__text">
        <span class="task-row__name" :title="task.name">{{ task.name }}</span>
        <span class="task-row__detail" :title="detail(task)">{{ detail(task) }}</span>
        <span class="task-row__bar" aria-hidden="true">
          <span class="task-row__fill" :style="{ width: `${percent(task)}%` }" />
        </span>
      </div>
      <NButton
        v-if="task.status === 'active' || task.status === 'waiting'"
        quaternary
        circle
        size="tiny"
        :loading="busy === task.gid"
        :title="i18n('popup_task_pause', 'Pause')"
        :aria-label="i18n('popup_task_pause', 'Pause')"
        @click="emit('pause', task.gid)"
      >
        <template #icon>
          <NIcon><PauseOutline /></NIcon>
        </template>
      </NButton>
      <NButton
        v-else-if="task.status === 'paused'"
        quaternary
        circle
        size="tiny"
        :loading="busy === task.gid"
        :title="i18n('popup_task_resume', 'Resume')"
        :aria-label="i18n('popup_task_resume', 'Resume')"
        @click="emit('resume', task.gid)"
      >
        <template #icon>
          <NIcon><PlayOutline /></NIcon>
        </template>
      </NButton>
      <NButton
        v-else-if="task.status === 'complete'"
        quaternary
        circle
        size="tiny"
        :loading="busy === task.gid"
        :title="i18n('popup_task_reveal', 'Show in folder')"
        :aria-label="i18n('popup_task_reveal', 'Show in folder')"
        @click="emit('reveal', task.gid)"
      >
        <template #icon>
          <NIcon><FolderOpenOutline /></NIcon>
        </template>
      </NButton>
      <NIcon v-else :size="16" class="task-row__error" :title="detail(task)">
        <AlertCircleOutline />
      </NIcon>
    </li>
  </ul>
  <p v-else class="task-list-empty">{{ i18n('popup_tasks_empty', 'No downloads yet') }}</p>
</template>

<style scoped>
.task-list {
  max-height: 220px;
  margin: 0 12px;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border-top: 1px solid var(--color-outline-variant);
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 2px;
  border-bottom: 1px solid var(--color-outline-variant);
}

.task-row__text {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.task-row__name,
.task-row__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row__name {
  font-size: 12px;
  font-weight: 500;
}

.task-row__detail {
  color: var(--color-on-surface-variant);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.task-row__bar {
  height: 3px;
  margin-top: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-on-surface) 10%, transparent);
}

.task-row__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.3s ease-out;
}

.task-row--complete .task-row__fill {
  background: var(--color-tertiary);
}

.task-row--paused .task-row__fill,
.task-row--waiting .task-row__fill {
  background: var(--color-outline);
}

.task-row--error .task-row__detail,
.task-row__error {
  color: var(--color-error);
}

.task-row__error {
  flex-shrink: 0;
  margin: 0 3px;
}

.task-list-empty {
  margin: 4px 16px 0;
  color: var(--color-on-surface-variant);
  font-size: 11px;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .task-row__fill {
    transition: none;
  }
}
</style>
