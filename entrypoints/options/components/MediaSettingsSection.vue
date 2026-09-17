<script setup lang="ts">
import {
  NButton,
  NDynamicTags,
  NFormItem,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTabPane,
  NTabs,
} from 'naive-ui';
import { parseMediaSettings, type MediaSettings } from '@/lib/schema';
import { useI18n } from '@/shared/i18n/engine';
import MediaTypeRules from './MediaTypeRules.vue';
import MediaRegexRules from './MediaRegexRules.vue';
defineProps<{ value: MediaSettings; staged: boolean }>();
const emit = defineEmits<{ change: [patch: Partial<MediaSettings>] }>();
const { t } = useI18n();
</script>
<template>
  <div class="settings-section media-settings">
    <NFormItem class="settings-row" :show-feedback="false" :label="t('media_discover')">
      <NSwitch :value="value.enabled" @update:value="emit('change', { enabled: $event })" />
    </NFormItem>
    <p class="settings-hint">{{ t('media_settings_capture_hint') }}</p>
    <NTabs type="line" animated>
      <NTabPane name="extensions" :tab="t('options_file_extension_list_label')">
        <MediaTypeRules
          :value="value.extensions"
          @update:value="emit('change', { extensions: $event })"
        />
      </NTabPane>
      <NTabPane name="mime" tab="MIME">
        <MediaTypeRules
          mime
          :value="value.mimeTypes"
          @update:value="emit('change', { mimeTypes: $event })"
        />
      </NTabPane>
      <NTabPane name="regex" :tab="t('media_settings_regex')">
        <MediaRegexRules
          :value="value.regexRules"
          @update:value="emit('change', { regexRules: $event })"
        />
      </NTabPane>
      <NTabPane name="behavior" :tab="t('media_settings_behavior')">
        <NFormItem class="settings-row" :show-feedback="false" :label="t('resources_preserve')"
          ><NSwitch
            :value="value.preserveOnNavigation"
            @update:value="emit('change', { preserveOnNavigation: $event })"
        /></NFormItem>
        <NFormItem class="settings-row" :show-feedback="false" :label="t('media_settings_newest')"
          ><NSwitch
            :value="value.newestFirst"
            @update:value="emit('change', { newestFirst: $event })"
        /></NFormItem>
        <NFormItem class="settings-row" :show-feedback="false" :label="t('media_settings_quick')"
          ><NSwitch
            :value="value.quickDownload"
            @update:value="emit('change', { quickDownload: $event })"
        /></NFormItem>
        <p class="settings-hint">{{ t('media_settings_quick_hint') }}</p>
        <NFormItem class="settings-row" :show-feedback="false" :label="t('media_settings_deep')"
          ><NSwitch
            :value="value.alwaysDeepSearch"
            @update:value="emit('change', { alwaysDeepSearch: $event })"
        /></NFormItem>
        <p class="settings-hint">{{ t('media_settings_deep_hint') }}</p>
        <NFormItem :label="t('options_site_rules_label')"
          ><NSelect
            :value="value.siteMode"
            :options="
              ['exclude', 'include'].map((mode) => ({
                value: mode,
                label: t(`media_settings_${mode}`),
              }))
            "
            @update:value="emit('change', { siteMode: $event })"
        /></NFormItem>
        <NDynamicTags
          :max="100"
          :value="value.excludedHosts"
          :input-props="{ placeholder: '*.example.com' }"
          @update:value="emit('change', { excludedHosts: $event })"
        />
      </NTabPane>
    </NTabs>
    <footer class="media-settings-footer">
      <span class="settings-hint">{{
        t(staged ? 'options_changes_indicator' : 'media_settings_autosave')
      }}</span>
      <NPopconfirm @positive-click="emit('change', parseMediaSettings({}))">
        <template #trigger
          ><NButton>{{ t('media_settings_restore') }}</NButton></template
        >
        {{ t('media_settings_restore_hint') }}
      </NPopconfirm>
    </footer>
  </div>
</template>
<style scoped>
.media-settings {
  min-width: 0;
}
.media-settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 20px;
}
</style>
