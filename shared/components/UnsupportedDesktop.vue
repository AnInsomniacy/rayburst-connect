<script setup lang="ts">
/** Shared recovery for unsupported desktops in the popup and connection settings. */
import { NButton, NIcon } from 'naive-ui';
import { InformationCircleOutline } from '@vicons/ionicons5';
import { useI18n } from '@/shared/i18n/engine';

defineProps<{ error: string; version: string | null; checking?: boolean }>();
defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="unsupported-desktop" role="status" aria-live="polite">
    <NIcon :size="18" class="unsupported-desktop__icon"><InformationCircleOutline /></NIcon>
    <div class="unsupported-desktop__content">
      <p class="unsupported-desktop__title">
        {{
          t(
            error === 'MotrixNextUnsupportedError'
              ? 'connection_legacy_title'
              : 'connection_unsupported_title',
          )
        }}
      </p>
      <p>{{ t('connection_upgrade_hint') }}</p>
      <div class="unsupported-desktop__actions">
        <span v-if="version" class="unsupported-desktop__version">v{{ version }}</span>
        <NButton
          size="small"
          text
          type="primary"
          tag="a"
          href="https://github.com/AnInsomniacy/rayburst/releases"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('connection_get_rayburst') }}
        </NButton>
        <NButton size="small" quaternary :loading="checking" @click="$emit('retry')">
          {{ t('connection_check_again') }}
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unsupported-desktop {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-on-surface-variant);
  font-size: 12px;
  line-height: 1.5;
}
.unsupported-desktop__icon {
  flex-shrink: 0;
  color: var(--color-warning);
}
.unsupported-desktop__content {
  min-width: 0;
  flex: 1;
}
.unsupported-desktop__title {
  color: var(--color-on-surface);
  font-weight: 600;
}
.unsupported-desktop p {
  margin: 0;
}
.unsupported-desktop__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 8px;
}
.unsupported-desktop__version {
  margin-inline-end: auto;
}
</style>
