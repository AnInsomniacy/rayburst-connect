<script setup lang="ts">
/**
 * Update notice for an older desktop that still works: a closable strip in
 * the popup, a standing card in the connection settings.
 */
import { NButton, NIcon } from 'naive-ui';
import { ArrowUpCircleOutline, CloseOutline, DownloadOutline } from '@vicons/ionicons5';
import { useI18n } from '@/shared/i18n/engine';

withDefaults(
  defineProps<{
    /** The desktop and its version, e.g. "Motrix Next 3.9.9". */
    name: string;
    layout?: 'popup' | 'card';
  }>(),
  { layout: 'card' },
);
defineEmits<{ dismiss: [] }>();
const { t, tSub } = useI18n();
</script>

<template>
  <div :class="['legacy-notice', `legacy-notice--${layout}`]" role="note">
    <span class="legacy-notice__badge">
      <NIcon :size="layout === 'popup' ? 16 : 18"><ArrowUpCircleOutline /></NIcon>
    </span>
    <div class="legacy-notice__copy">
      <p class="legacy-notice__title">{{ t('connection_legacy_title') }}</p>
      <p class="legacy-notice__hint">{{ tSub('connection_legacy_hint', [name]) }}</p>
    </div>
    <NButton
      class="legacy-notice__action"
      :size="layout === 'popup' ? 'tiny' : 'small'"
      secondary
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
    <NButton
      v-if="layout === 'popup'"
      class="legacy-notice__close"
      size="tiny"
      quaternary
      circle
      :aria-label="t('connection_legacy_dismiss')"
      :title="t('connection_legacy_dismiss')"
      @click="$emit('dismiss')"
    >
      <template #icon>
        <NIcon><CloseOutline /></NIcon>
      </template>
    </NButton>
  </div>
</template>

<style scoped>
.legacy-notice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 10px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  color: var(--color-on-surface-variant);
  line-height: 1.5;
}
.legacy-notice__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
}
.legacy-notice__copy {
  min-width: 0;
}
.legacy-notice__copy p {
  margin: 0;
}
.legacy-notice__title {
  color: var(--color-on-surface);
  font-weight: 600;
}

/* ── Popup: the close button sits in the corner, the link under the text ── */
.legacy-notice--popup {
  grid-template-areas:
    'badge copy close'
    'badge action close';
  align-items: start;
  row-gap: 6px;
  padding: 10px 6px 10px 10px;
  font-size: 11px;
}
.legacy-notice--popup .legacy-notice__badge {
  grid-area: badge;
  width: 28px;
  height: 28px;
}
.legacy-notice--popup .legacy-notice__copy {
  grid-area: copy;
}
.legacy-notice--popup .legacy-notice__title {
  font-size: 12px;
}
.legacy-notice--popup .legacy-notice__action {
  grid-area: action;
  justify-self: start;
}
.legacy-notice--popup .legacy-notice__close {
  grid-area: close;
  margin-top: -2px;
}

/* ── Settings card: the link at the end of the row ── */
.legacy-notice--card {
  column-gap: 12px;
  padding: 12px 14px;
  font-size: 12px;
}
.legacy-notice--card .legacy-notice__badge {
  width: 32px;
  height: 32px;
}
.legacy-notice--card .legacy-notice__title {
  font-size: 13px;
}
</style>
