<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NButton, NCheckbox, NInput, NInputNumber, NSelect, NSpace } from 'naive-ui';
import { loadSnapshot, updateSettings } from '@/lib/storage';
import type { DownloadSettings } from '@/lib/schema';
import { useI18n } from '@/shared/i18n/engine';
const { t } = useI18n();
const rules = ref<DownloadSettings['mediaDiscovery']['rules']>([]);
const preserve = ref(false);
async function save() {
  const settings = (await loadSnapshot()).settings;
  await updateSettings({
    mediaDiscovery: {
      ...settings.mediaDiscovery,
      rules: rules.value,
      preserveOnNavigation: preserve.value,
    },
  });
}
onMounted(async () => {
  const settings = (await loadSnapshot()).settings;
  rules.value = settings.mediaDiscovery.rules;
  preserve.value = settings.mediaDiscovery.preserveOnNavigation;
});
</script>
<template>
  <section>
    <NCheckbox v-model:checked="preserve" @update:checked="save">{{
      t('resources_preserve')
    }}</NCheckbox>
    <div v-for="(rule, index) in rules" :key="index" class="rule">
      <NCheckbox v-model:checked="rule.enabled" :aria-label="rule.pattern" @update:checked="save" />
      <NSelect
        v-model:value="rule.field"
        :aria-label="t('resources_type')"
        :options="[
          { value: 'url', label: 'URL' },
          { value: 'mime', label: 'MIME' },
          { value: 'extension', label: t('options_file_extension_list_label') },
        ]"
        @update:value="save"
      />
      <NInput
        v-model:value="rule.pattern"
        placeholder="Regex"
        :aria-label="t('options_section_rules')"
        @blur="save"
      />
      <NInputNumber
        v-model:value="rule.minimumBytes"
        :min="0"
        :precision="0"
        :aria-label="t('resources_size')"
        @blur="save"
        ><template #suffix>B</template></NInputNumber
      >
      <NSelect
        v-model:value="rule.kind"
        :options="
          ['hls', 'dash', 'file', 'subtitle', 'image', 'json', 'ignore'].map((value) => ({
            value,
            label: ['hls', 'dash', 'json'].includes(value)
              ? value.toUpperCase()
              : value === 'ignore'
                ? t('options_file_extension_action_skip')
                : t(`resources_kind_${value}`),
          }))
        "
        @update:value="save"
      />
      <NButton
        size="small"
        :aria-label="`${t('options_diagnostics_clear')}: ${rule.pattern}`"
        @click="
          rules.splice(index, 1);
          save();
        "
        >×</NButton
      >
    </div>
    <NSpace
      ><NButton
        size="small"
        @click="
          rules.push({ pattern: '', field: 'url', minimumBytes: 0, kind: 'file', enabled: false })
        "
        >{{ t('options_add_rule') }}</NButton
      ><NButton size="small" @click="save">{{ t('options_save') }}</NButton></NSpace
    >
  </section>
</template>
<style scoped>
.rule {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  margin: 8px 0;
}
</style>
