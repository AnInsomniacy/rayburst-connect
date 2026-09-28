<script setup lang="ts">
/** Current-site download policy, backed by the existing ordered rules. */
import { computed, onMounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import { NButton, NIcon, NPopover } from 'naive-ui';
import { GlobeOutline } from '@vicons/ionicons5';
import { loadSnapshot, saveSiteRules } from '@/lib/storage';
import { matchSiteRule } from '@/lib/site-rules';
import { useI18n } from '@/shared/i18n/engine';

const { t } = useI18n();
const host = ref('');
const excluded = ref(false);
const busy = ref(false);
const error = ref('');
const label = computed(() => t(excluded.value ? 'popup_site_allow' : 'popup_site_exclude'));

onMounted(async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    host.value = url.hostname;
    excluded.value = matchSiteRule((await loadSnapshot()).siteRules, [url.href]) === 'always-skip';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

async function toggle() {
  busy.value = true;
  error.value = '';
  try {
    await navigator.locks.request('site-rules', async () => {
      const { siteRules } = await loadSnapshot();
      const id = `current-site:${host.value}`;
      await saveSiteRules([
        { id, pattern: host.value, action: excluded.value ? 'always-intercept' : 'always-skip' },
        ...siteRules.filter((rule) => rule.id !== id),
      ]);
    });
    excluded.value = !excluded.value;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <NPopover v-if="host" trigger="click" placement="bottom-end" :width="260">
    <template #trigger>
      <NButton
        quaternary
        circle
        size="small"
        :aria-label="t('popup_site_rules')"
        :type="excluded ? 'warning' : 'default'"
      >
        <NIcon :size="18"><GlobeOutline /></NIcon>
      </NButton>
    </template>
    <div class="site-rule">
      <strong>{{ host }}</strong>
      <NButton secondary size="small" :loading="busy" @click="toggle">{{ label }}</NButton>
      <span v-if="error" role="alert">{{ error }}</span>
    </div>
  </NPopover>
</template>

<style scoped>
.site-rule {
  display: grid;
  gap: 12px;
  max-height: 240px;
  overflow: auto;
  overflow-wrap: anywhere;
}
</style>
