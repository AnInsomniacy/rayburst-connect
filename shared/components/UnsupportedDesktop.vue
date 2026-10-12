<script setup lang="ts">
/**
 * Shared recovery for unsupported desktops: a full page in the popup, a card
 * in the connection settings.
 */
import { NButton, NIcon } from 'naive-ui';
import { ArrowUpCircleOutline, DownloadOutline, RefreshOutline } from '@vicons/ionicons5';
import { useI18n } from '@/shared/i18n/engine';

withDefaults(
  defineProps<{
    error: string;
    version: string | null;
    checking?: boolean;
    layout?: 'page' | 'card';
  }>(),
  { checking: false, layout: 'card' },
);
defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<template>
  <div
    :class="['unsupported-desktop', `unsupported-desktop--${layout}`]"
    role="status"
    aria-live="polite"
  >
    <div class="unsupported-desktop__body">
      <span class="unsupported-desktop__badge">
        <NIcon :size="layout === 'page' ? 24 : 18"><ArrowUpCircleOutline /></NIcon>
      </span>
      <div class="unsupported-desktop__copy">
        <p class="unsupported-desktop__title">
          {{
            t(
              error === 'MotrixNextUnsupportedError'
                ? 'connection_legacy_title'
                : 'connection_unsupported_title',
            )
          }}
        </p>
        <p class="unsupported-desktop__hint">{{ t('connection_upgrade_hint') }}</p>
        <span v-if="version" class="unsupported-desktop__version">v{{ version }}</span>
      </div>
    </div>
    <div class="unsupported-desktop__actions">
      <NButton
        :size="layout === 'page' ? 'tiny' : 'small'"
        quaternary
        :loading="checking"
        @click="$emit('retry')"
      >
        <template #icon>
          <NIcon><RefreshOutline /></NIcon>
        </template>
        {{ t('connection_check_again') }}
      </NButton>
      <NButton
        :size="layout === 'page' ? 'tiny' : 'small'"
        type="primary"
        tag="a"
        href="https://github.com/AnInsomniacy/rayburst/releases"
        target="_blank"
        rel="noopener noreferrer"
      >
        <template #icon>
          <NIcon><DownloadOutline /></NIcon>
        </template>
        {{ t('connection_get_rayburst') }}
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.unsupported-desktop {
  color: var(--color-on-surface-variant);
  font-size: 12px;
  line-height: 1.5;
}
.unsupported-desktop p {
  margin: 0;
}
.unsupported-desktop__badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
  color: var(--color-warning);
}
.unsupported-desktop__title {
  color: var(--color-on-surface);
  font-weight: 600;
}
.unsupported-desktop__version {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-surface-container-high);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.unsupported-desktop__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

/* ── Popup page: centred like the launching state, actions in the footer ── */
.unsupported-desktop--page {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  width: 100%;
  min-height: 160px;
}
.unsupported-desktop--page .unsupported-desktop__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 20px 4px;
  text-align: center;
}
.unsupported-desktop--page .unsupported-desktop__badge {
  width: 44px;
  height: 44px;
}
.unsupported-desktop--page .unsupported-desktop__copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.unsupported-desktop--page .unsupported-desktop__title {
  font-size: 14px;
}
.unsupported-desktop--page .unsupported-desktop__hint {
  font-size: 11px;
}
.unsupported-desktop--page .unsupported-desktop__version {
  margin-top: 6px;
}
.unsupported-desktop--page .unsupported-desktop__actions {
  padding: 12px;
}

/* ── Settings card ── */
.unsupported-desktop--card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-warning) 6%, transparent);
}
.unsupported-desktop--card .unsupported-desktop__body {
  display: flex;
  flex: 1 1 240px;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.unsupported-desktop--card .unsupported-desktop__badge {
  width: 32px;
  height: 32px;
}
.unsupported-desktop--card .unsupported-desktop__version {
  margin-top: 4px;
}
.unsupported-desktop--card .unsupported-desktop__actions {
  margin-inline-start: auto;
}
</style>
