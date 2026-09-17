<script lang="ts" setup>
/** Left-rail navigation for the Options page. */
import { NIcon } from 'naive-ui';
import {
  LinkOutline,
  SettingsOutline,
  ListOutline,
  VideocamOutline,
  ColorPaletteOutline,
  GlobeOutline,
  ConstructOutline,
} from '@vicons/ionicons5';
import { useI18n } from '@/shared/i18n/engine';

defineProps<{
  active: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();

const { t, tEn } = useI18n();

// Bilingual helper for the Language tab — always shows native + English
function bilingual(key: string, enFallback: string): string {
  const native = t(key, enFallback);
  const en = tEn(key, enFallback);
  return native === en ? native : `${native} / ${en}`;
}

const sections = [
  {
    id: 'connection',
    icon: LinkOutline,
    label: () => t('options_section_connection', 'Connection'),
  },
  {
    id: 'behavior',
    icon: SettingsOutline,
    label: () => t('options_section_behavior', 'Download'),
  },
  { id: 'media', icon: VideocamOutline, label: () => t('sniffer_tab') },
  { id: 'rules', icon: ListOutline, label: () => t('options_section_rules', 'Rules') },
  {
    id: 'appearance',
    icon: ColorPaletteOutline,
    label: () => t('options_section_appearance', 'Appearance'),
  },
  {
    id: 'language',
    icon: GlobeOutline,
    label: () => bilingual('options_section_language', 'Language'),
  },
  {
    id: 'diagnostics',
    icon: ConstructOutline,
    label: () => t('options_section_maintenance', 'Maintenance'),
  },
];
</script>

<template>
  <nav class="options-nav">
    <button
      v-for="s in sections"
      :key="s.id"
      type="button"
      :class="['nav-item', { 'nav-item--active': active === s.id }]"
      @click="emit('select', s.id)"
    >
      <NIcon :size="18" class="nav-item__icon"><component :is="s.icon" /></NIcon>
      <span class="nav-item__label">{{ s.label() }}</span>
    </button>
  </nav>
</template>

<style scoped>
.options-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  flex: 1;
  min-width: 150px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.15s cubic-bezier(0.2, 0, 0, 1),
    color 0.15s cubic-bezier(0.2, 0, 0, 1);
}

.nav-item:hover {
  background: color-mix(in srgb, var(--color-on-surface) 6%, transparent);
  color: var(--color-on-surface);
}

.nav-item--active {
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}

.nav-item--active:hover {
  background: var(--color-primary-container);
  filter: brightness(0.96);
}

.nav-item__icon {
  flex-shrink: 0;
}

.nav-item__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Responsive: collapse to icon-only on narrow viewports ─── */
@media (max-width: 640px) {
  .options-nav {
    flex-direction: row;
    width: 100%;
    overflow-x: auto;
    padding: 6px 12px;
    gap: 4px;
  }

  .nav-item {
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    font-size: 11px;
    min-width: 64px;
    align-items: center;
  }
}
</style>
