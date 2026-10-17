<script lang="ts" setup>
/** Popup task list: progress of each download with pause, resume and show-in-folder. */
import { computed, type Component } from 'vue';
import { NButton, NIcon } from 'naive-ui';
import {
  AlertCircleOutline,
  CloudDownloadOutline,
  FolderOpenOutline,
  PauseOutline,
  PlayOutline,
} from '@vicons/ionicons5';
import type { DesktopTask } from '@/lib/api';
import { formatBytes, formatSpeed } from '@/lib/format';
import { useI18n } from '@/shared/i18n/engine';

type TaskEvent = 'pause' | 'resume' | 'reveal';

const props = defineProps<{ tasks: DesktopTask[] }>();
const emit = defineEmits<{ pause: [gid: string]; resume: [gid: string]; reveal: [gid: string] }>();
const { t: i18n } = useI18n();

const rows = computed(() =>
  props.tasks.map((task) => ({
    task,
    detail: detail(task),
    percent: percent(task),
    action: action(task),
  })),
);

function action(task: DesktopTask): { event: TaskEvent; icon: Component; label: string } | null {
  switch (task.status) {
    case 'active':
    case 'waiting':
      return { event: 'pause', icon: PauseOutline, label: i18n('popup_task_pause', 'Pause') };
    case 'paused':
      return { event: 'resume', icon: PlayOutline, label: i18n('popup_task_resume', 'Resume') };
    case 'complete':
      return {
        event: 'reveal',
        icon: FolderOpenOutline,
        label: i18n('popup_task_reveal', 'Show in folder'),
      };
    default:
      return null;
  }
}

function run(event: TaskEvent, gid: string): void {
  if (event === 'pause') emit('pause', gid);
  else if (event === 'resume') emit('resume', gid);
  else emit('reveal', gid);
}

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
  <TransitionGroup v-if="rows.length > 0" tag="ul" name="task" class="task-list">
    <li
      v-for="row in rows"
      :key="row.task.gid"
      :class="['task-row', `task-row--${row.task.status}`]"
    >
      <div class="task-row__text">
        <span class="task-row__name" :title="row.task.name">{{ row.task.name }}</span>
        <span class="task-row__detail" :title="row.detail">{{ row.detail }}</span>
        <span class="task-row__bar" aria-hidden="true">
          <span class="task-row__fill" :style="{ width: `${row.percent}%` }" />
        </span>
      </div>
      <NButton
        v-if="row.action"
        quaternary
        circle
        size="tiny"
        :title="row.action.label"
        :aria-label="row.action.label"
        @click="run(row.action.event, row.task.gid)"
      >
        <template #icon>
          <NIcon>
            <Transition name="icon-swap">
              <component :is="row.action.icon" :key="row.action.event" />
            </Transition>
          </NIcon>
        </template>
      </NButton>
      <NIcon v-else :size="16" class="task-row__error" :title="row.detail">
        <AlertCircleOutline />
      </NIcon>
    </li>
  </TransitionGroup>
  <div v-else class="task-list-empty">
    <NIcon :size="18"><CloudDownloadOutline /></NIcon>
    <p>{{ i18n('popup_tasks_empty', 'No downloads yet') }}</p>
  </div>
</template>

<style scoped>
.task-list {
  position: relative;
  display: grid;
  gap: 2px;
  margin: 0 12px;
  padding: 0;
  list-style: none;
}

.task-move,
.task-enter-active,
.task-leave-active {
  transition:
    transform 240ms var(--m3-ease-emphasized),
    opacity 180ms ease;
}

.task-enter-from,
.task-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.task-leave-active {
  position: absolute;
  inset-inline: 0;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px 8px 12px;
  border-radius: 12px;
  transition: background-color 0.2s var(--m3-ease-emphasized);
}

.task-row:hover {
  background: var(--color-surface-well);
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
  transition:
    width 0.3s ease-out,
    background-color 0.2s ease;
}

.task-row--complete .task-row__fill {
  background: color-mix(in srgb, var(--color-success) 75%, transparent);
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 12px;
  padding: 10px 0 2px;
  color: var(--color-on-surface-variant);
  font-size: 12px;
}

.task-list-empty .n-icon {
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .task-row__fill,
  .task-move,
  .task-enter-active,
  .task-leave-active {
    transition: none;
  }
}
</style>
