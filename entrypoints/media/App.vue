<script setup lang="ts">
import { onMounted, onUnmounted, provide } from 'vue';
import { browser } from 'wxt/browser';
import { NConfigProvider } from 'naive-ui';
import { createI18n, I18N_KEY, useNaiveLocale } from '@/shared/i18n/engine';
import { useAppTheme } from '@/shared/theme';
import { parseUiPrefs, type UiPrefs } from '@/lib/schema';
import MediaPanel from '../popup/components/MediaPanel.vue';

const props = defineProps<{ prefs: UiPrefs }>();
const i18n = createI18n(props.prefs.locale, { localeApi: browser.i18n });
provide(I18N_KEY, i18n);
const { naiveLocale, naiveDateLocale } = useNaiveLocale(i18n.effectiveLocale);
const theme = useAppTheme();

function configure(value: unknown) {
  const prefs = parseUiPrefs(value);
  i18n.setLocale(prefs.locale);
  theme.setMode(prefs.theme);
  theme.setColorScheme(prefs.colorScheme);
  document.documentElement.lang = i18n.effectiveLocale.value.replace('_', '-');
  document.documentElement.dir = ['ar', 'fa'].includes(i18n.effectiveLocale.value) ? 'rtl' : 'ltr';
}
const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
  if (area === 'local' && changes.uiPrefs) configure(changes.uiPrefs.newValue);
};
configure(props.prefs);
onMounted(() => {
  browser.storage.onChanged.addListener(changed);
});
onUnmounted(() => {
  browser.storage.onChanged.removeListener(changed);
});
</script>

<template>
  <NConfigProvider
    :theme="theme.naiveTheme.value"
    :theme-overrides="theme.themeOverrides.value"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <MediaPanel expanded />
  </NConfigProvider>
</template>

<style scoped>
:global(body) {
  margin: 0;
  padding: 12px 0;
  min-width: 0;
}
</style>
