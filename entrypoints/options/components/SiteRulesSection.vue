<script lang="ts" setup>
/** Site rules management section. */
import { ref, computed } from 'vue';
import { NInput, NSelect, NButton, NTag, NIcon, NEmpty } from 'naive-ui';
import { CloseOutline, AddOutline } from '@vicons/ionicons5';
import type { SiteRule } from '@/lib/schema';
import { normalizeSitePattern } from '@/lib/site-rules';

defineProps<{
  rules: SiteRule[];
}>();

const emit = defineEmits<{
  add: [rule: Omit<SiteRule, 'id'>];
  remove: [id: string];
}>();

import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const newPattern = ref('');
const normalizedPattern = computed(() => normalizeSitePattern(newPattern.value));
const newAction = ref<SiteRule['action']>('always-intercept');

const actionOptions = computed(() => [
  { label: i18n('options_rule_always_intercept', 'Always Intercept'), value: 'always-intercept' },
  { label: i18n('options_rule_always_skip', 'Always Skip'), value: 'always-skip' },
  { label: i18n('options_rule_use_global', 'Use Global'), value: 'use-global' },
]);

const ACTION_TYPE_MAP: Record<SiteRule['action'], 'success' | 'error' | 'default'> = {
  'always-intercept': 'success',
  'always-skip': 'error',
  'use-global': 'default',
};

function actionLabel(action: SiteRule['action']): string {
  const map: Record<SiteRule['action'], [key: string, fallback: string]> = {
    'always-intercept': ['options_rule_always_intercept', 'Always Intercept'],
    'always-skip': ['options_rule_always_skip', 'Always Skip'],
    'use-global': ['options_rule_use_global', 'Use Global'],
  };
  const [key, fallback] = map[action];
  return i18n(key, fallback);
}

function handleAdd(): void {
  if (!normalizedPattern.value) return;
  emit('add', { pattern: normalizedPattern.value, action: newAction.value });
  newPattern.value = '';
}
</script>

<template>
  <div class="section">
    <!-- Rule List -->
    <Transition name="fade" mode="out-in">
      <div v-if="rules.length" key="list" class="rule-list">
        <TransitionGroup name="list-item" tag="div" class="rule-list__inner">
          <div v-for="rule in rules" :key="rule.id" class="rule-item">
            <code class="rule-item__pattern">{{ rule.pattern }}</code>
            <div class="rule-item__actions">
              <NTag :type="ACTION_TYPE_MAP[rule.action]" size="small" round>
                {{ actionLabel(rule.action) }}
              </NTag>
              <button type="button" class="rule-item__remove" @click="emit('remove', rule.id)">
                <NIcon :size="14"><CloseOutline /></NIcon>
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>
      <NEmpty
        v-else
        key="empty"
        size="small"
        :description="i18n('options_rules_empty', 'No rules configured.')"
        style="margin-bottom: 16px"
      />
    </Transition>

    <!-- Add Rule Form -->
    <div class="rule-add">
      <NInput
        v-model:value="newPattern"
        :status="newPattern && !normalizedPattern ? 'error' : undefined"
        placeholder="*.github.com"
        style="flex: 1; font-family: var(--font-mono)"
        @keydown.enter="handleAdd"
      />
      <NSelect v-model:value="newAction" :options="actionOptions" style="width: 170px" />
      <NButton type="primary" :disabled="!normalizedPattern" @click="handleAdd">
        <template #icon>
          <NIcon :size="16"><AddOutline /></NIcon>
        </template>
        {{ i18n('options_add_rule', 'Add') }}
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.rule-list {
  margin-bottom: 16px;
}

.rule-list__inner {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--color-surface-container-high);
  border-radius: 10px;
  transition: background-color 0.15s cubic-bezier(0.2, 0, 0, 1);
}

.rule-item:hover {
  background: var(--color-surface-container-highest);
}

.rule-item__pattern {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-primary);
  font-weight: 500;
}

.rule-item__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rule-item__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--color-on-surface-variant);
  cursor: pointer;
  /* Release: spring-back (emphasized-decelerate) */
  transition:
    color 0.15s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.15s cubic-bezier(0.2, 0, 0, 1),
    transform 0.35s cubic-bezier(0.05, 0.7, 0.1, 1);
}

.rule-item__remove:hover {
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
}

.rule-item__remove:active {
  transform: scale(0.85);
  /* Press: fast compress (emphasized) */
  transition:
    color 0.15s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.15s cubic-bezier(0.2, 0, 0, 1),
    transform 0.15s cubic-bezier(0.2, 0, 0, 1);
}

.rule-add {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
