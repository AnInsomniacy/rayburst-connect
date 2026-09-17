<script setup lang="ts">
import { computed, h, ref } from 'vue';
import {
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
  NAlert,
  type DataTableColumns,
} from 'naive-ui';
import { MediaTypeRuleSchema, type MediaTypeRule } from '@/lib/schema';
import { jsonClone } from '@/shared/json';
import { useI18n } from '@/shared/i18n/engine';
const props = defineProps<{ value: MediaTypeRule[]; mime?: boolean }>();
const emit = defineEmits<{ 'update:value': [value: MediaTypeRule[]] }>();
const { t } = useI18n();
const query = ref('');
const editor = ref<MediaTypeRule>();
const original = ref<string>();
const error = ref(false);
const kinds = ['hls', 'dash', 'file', 'fragment', 'subtitle', 'image', 'json'] as const;
const kindLabel = (value: string) =>
  ['hls', 'dash', 'json'].includes(value) ? value.toUpperCase() : t(`resources_kind_${value}`);
const rows = computed(() =>
  props.value.filter((row) => row.value.includes(query.value.toLowerCase())),
);
function open(row?: MediaTypeRule) {
  original.value = row?.value;
  editor.value = row
    ? jsonClone(row)
    : MediaTypeRuleSchema.parse({ value: 'new', kind: 'file', enabled: true });
  if (!row) editor.value.value = '';
  error.value = false;
}
function save() {
  if (!editor.value) return;
  const parsed = MediaTypeRuleSchema.safeParse(editor.value);
  const pattern = props.mime
    ? /^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/
    : /^[a-z0-9][a-z0-9_+-]*$/;
  if (
    (!original.value && props.value.length >= (props.mime ? 100 : 200)) ||
    !parsed.success ||
    !pattern.test(parsed.data.value) ||
    props.value.some((row) => row.value === parsed.data.value && row.value !== original.value) ||
    (parsed.data.size.operator === 'between' && parsed.data.size.upper < parsed.data.size.value)
  ) {
    error.value = true;
    return;
  }
  const next = props.value.filter((row) => row.value !== original.value);
  const index = props.value.findIndex((row) => row.value === original.value);
  next.splice(index < 0 ? next.length : index, 0, parsed.data);
  emit('update:value', next);
  editor.value = undefined;
}
const columns = computed<DataTableColumns<MediaTypeRule>>(() => [
  {
    title: props.mime ? 'MIME' : t('options_file_extension_list_label'),
    key: 'value',
    minWidth: 145,
  },
  { title: t('resources_type'), key: 'kind', width: 105, render: (row) => kindLabel(row.kind) },
  {
    title: t('resources_size'),
    key: 'size',
    width: 145,
    render: ({ size }) =>
      size.operator === 'any'
        ? t('media_settings_any_size')
        : `${size.operator === 'between' ? `${size.value}–${size.upper}` : `${size.operator} ${size.value}`} ${size.unit}`,
  },
  {
    title: t('media_settings_capture'),
    key: 'enabled',
    width: 85,
    render: (row) =>
      h(NSwitch, {
        size: 'small',
        value: row.enabled,
        'aria-label': `${t('media_settings_capture')}: ${row.value}`,
        'onUpdate:value': (enabled: boolean) =>
          emit(
            'update:value',
            props.value.map((item) => (item.value === row.value ? { ...item, enabled } : item)),
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
                    props.value.filter((item) => item.value !== row.value),
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
  <div class="media-type-rules">
    <NSpace justify="space-between">
      <NInput
        v-model:value="query"
        clearable
        :placeholder="t('media_filter')"
        :aria-label="t('media_filter')"
      />
      <NButton :disabled="value.length >= (mime ? 100 : 200)" @click="open()">{{
        t('options_add_rule')
      }}</NButton>
    </NSpace>
    <NDataTable
      :columns="columns"
      :data="rows"
      :row-key="(row: MediaTypeRule) => row.value"
      :pagination="{ pageSize: 10 }"
      :scroll-x="620"
      size="small"
    />
    <NModal
      :show="Boolean(editor)"
      preset="card"
      :title="t('media_settings_edit')"
      style="width: min(560px, calc(100vw - 32px))"
      @update:show="!$event && (editor = undefined)"
    >
      <NForm v-if="editor" label-placement="top" @submit.prevent="save">
        <NAlert v-if="error" type="error">{{ t('media_settings_invalid_rule') }}</NAlert>
        <NFormItem :label="mime ? 'MIME' : t('options_file_extension_list_label')"
          ><NInput v-model:value="editor.value" :placeholder="mime ? 'video/*' : 'mp4'"
        /></NFormItem>
        <NFormItem :label="t('resources_type')"
          ><NSelect
            v-model:value="editor.kind"
            :options="kinds.map((value) => ({ value, label: kindLabel(value) }))"
        /></NFormItem>
        <NFormItem :label="t('resources_size')">
          <NSpace>
            <NSelect
              v-model:value="editor.size.operator"
              style="width: 150px"
              :options="
                ['any', '>', '>=', '<', '<=', '=', '!=', 'between'].map((value) => ({
                  value,
                  label:
                    value === 'any'
                      ? t('media_settings_any_size')
                      : value === 'between'
                        ? t('media_settings_between')
                        : value,
                }))
              "
            />
            <template v-if="editor.size.operator !== 'any'">
              <NInputNumber
                v-model:value="editor.size.value"
                :min="0"
                :show-button="false"
                style="width: 100px"
                :aria-label="t('resources_size')"
              />
              <NInputNumber
                v-if="editor.size.operator === 'between'"
                v-model:value="editor.size.upper"
                :min="editor.size.value"
                :show-button="false"
                style="width: 100px"
                :aria-label="t('media_settings_upper')"
              />
              <NSelect
                v-model:value="editor.size.unit"
                style="width: 80px"
                :options="['B', 'KB', 'MB', 'GB'].map((value) => ({ value, label: value }))"
              />
            </template>
          </NSpace>
        </NFormItem>
        <NSpace justify="end"
          ><NButton @click="editor = undefined">{{ t('media_cancel') }}</NButton
          ><NButton type="primary" attr-type="submit">{{ t('options_save') }}</NButton></NSpace
        >
      </NForm>
    </NModal>
  </div>
</template>
<style scoped>
.media-type-rules {
  display: grid;
  gap: 16px;
}
</style>
