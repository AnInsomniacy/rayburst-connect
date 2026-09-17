<script setup lang="ts">
import { computed, h, ref } from 'vue';
import {
  NAlert,
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  type DataTableColumns,
} from 'naive-ui';
import { MediaRegexRuleSchema, type MediaRegexRule } from '@/lib/schema';
import { testMediaRegex } from '@/lib/media/rules';
import { jsonClone } from '@/shared/json';
import { useI18n } from '@/shared/i18n/engine';
const props = defineProps<{ value: MediaRegexRule[] }>();
const emit = defineEmits<{ 'update:value': [value: MediaRegexRule[]] }>();
const { t } = useI18n();
const editor = ref<MediaRegexRule>();
const error = ref(false);
const testUrl = ref('');
const result = computed(() => {
  if (!editor.value || !testUrl.value) return '';
  const parsed = MediaRegexRuleSchema.safeParse(editor.value);
  if (!parsed.success) return t('media_settings_invalid_rule');
  try {
    const match = testMediaRegex(parsed.data, testUrl.value);
    return match
      ? match.action === 'ignore'
        ? t('media_settings_ignore')
        : match.url
      : t('media_settings_no_match');
  } catch {
    return t('media_settings_invalid_rule');
  }
});
function open(rule?: MediaRegexRule) {
  editor.value = rule
    ? jsonClone(rule)
    : {
        id: window.crypto.randomUUID(),
        pattern: '',
        flags: 'i',
        action: 'capture',
        kind: 'file',
        captureGroup: 0,
        enabled: true,
      };
  error.value = false;
}
function save() {
  const parsed = MediaRegexRuleSchema.safeParse(editor.value);
  if (
    !parsed.success ||
    (props.value.length >= 100 && !props.value.some((rule) => rule.id === editor.value?.id))
  ) {
    error.value = true;
    return;
  }
  const next = props.value.slice();
  const index = next.findIndex((item) => item.id === parsed.data.id);
  if (index < 0) next.push(parsed.data);
  else next[index] = parsed.data;
  emit('update:value', next);
  editor.value = undefined;
}
const columns = computed<DataTableColumns<MediaRegexRule>>(() => [
  {
    title: t('media_settings_pattern'),
    key: 'pattern',
    minWidth: 170,
    ellipsis: { tooltip: true },
  },
  {
    title: t('media_settings_action'),
    key: 'action',
    width: 100,
    render: (row) => t(`media_settings_${row.action}`),
  },
  {
    title: t('media_settings_enabled'),
    key: 'enabled',
    width: 85,
    render: (row) =>
      h(NSwitch, {
        value: row.enabled,
        size: 'small',
        'aria-label': row.pattern,
        'onUpdate:value': (enabled: boolean) =>
          emit(
            'update:value',
            props.value.map((item) => (item.id === row.id ? { ...item, enabled } : item)),
          ),
      }),
  },
  {
    title: '',
    key: 'actions',
    width: 140,
    render: (row) =>
      h(
        NSpace,
        { size: 4 },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: () => open(row) },
              { default: () => t('media_settings_edit') },
            ),
            h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                onClick: () =>
                  emit(
                    'update:value',
                    props.value.filter((item) => item.id !== row.id),
                  ),
              },
              { default: () => t('media_settings_remove') },
            ),
          ],
        },
      ),
  },
]);
</script>
<template>
  <div class="regex-rules">
    <p class="settings-hint">{{ t('media_settings_regex_hint') }}</p>
    <NButton :disabled="value.length >= 100" @click="open()">{{ t('options_add_rule') }}</NButton>
    <NDataTable
      :columns="columns"
      :data="value"
      :row-key="(row: MediaRegexRule) => row.id"
      :scroll-x="500"
      :pagination="{ pageSize: 10 }"
      size="small"
    />
    <NModal
      :show="Boolean(editor)"
      preset="card"
      :title="t('media_settings_regex')"
      style="width: min(560px, calc(100vw - 32px))"
      @update:show="!$event && (editor = undefined)"
    >
      <NForm v-if="editor" label-placement="top" @submit.prevent="save">
        <NAlert v-if="error" type="error">{{ t('media_settings_invalid_rule') }}</NAlert>
        <NFormItem :label="t('media_settings_pattern')"
          ><NInput v-model:value="editor.pattern" placeholder="\.m3u8(?:\?|$)"
        /></NFormItem>
        <NFormItem :label="t('media_settings_flags')"
          ><NInput v-model:value="editor.flags" placeholder="i"
        /></NFormItem>
        <NFormItem :label="t('media_settings_action')"
          ><NSelect
            v-model:value="editor.action"
            :options="
              ['capture', 'ignore'].map((value) => ({ value, label: t(`media_settings_${value}`) }))
            "
        /></NFormItem>
        <template v-if="editor.action === 'capture'">
          <NFormItem :label="t('resources_type')"
            ><NSelect
              v-model:value="editor.kind"
              :options="
                ['hls', 'dash', 'file', 'fragment', 'subtitle', 'image', 'json'].map((value) => ({
                  value,
                  label: ['hls', 'dash', 'json'].includes(value)
                    ? value.toUpperCase()
                    : t(`resources_kind_${value}`),
                }))
              "
          /></NFormItem>
          <NFormItem :label="t('media_settings_group')"
            ><NInputNumber v-model:value="editor.captureGroup" :min="0" :max="32" :precision="0"
          /></NFormItem>
        </template>
        <NFormItem :label="t('media_settings_test_url')"
          ><NInput v-model:value="testUrl" placeholder="https://example.com/video"
        /></NFormItem>
        <NAlert v-if="result" :show-icon="false">{{ result }}</NAlert>
        <NSpace justify="end"
          ><NButton @click="editor = undefined">{{ t('media_cancel') }}</NButton
          ><NButton type="primary" attr-type="submit">{{ t('options_save') }}</NButton></NSpace
        >
      </NForm>
    </NModal>
  </div>
</template>
<style scoped>
.regex-rules {
  display: grid;
  gap: 16px;
}
</style>
