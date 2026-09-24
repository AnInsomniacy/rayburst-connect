<script lang="ts" setup>
/** Connection settings section. */
import { computed } from 'vue';
import { NFormItem, NInput, NInputNumber, NButton, NTag, NIcon } from 'naive-ui';
import { CheckmarkCircleOutline, CloseCircleOutline } from '@vicons/ionicons5';
import { isCompatibilityErrorName, type ConnectionStatus } from '@/lib/api';
import UnsupportedDesktop from '@/shared/components/UnsupportedDesktop.vue';
import { DEFAULT_CONNECTION_CONFIG } from '@/lib/schema';

const props = defineProps<{
  port: number;
  secret: string;
  status: ConnectionStatus;
  version: string | null;
  error: string | null;
  testing: boolean;
}>();

const emit = defineEmits<{
  'update:port': [value: number];
  'update:secret': [value: string];
  test: [];
}>();

import { useI18n } from '@/shared/i18n/engine';

const { t: i18n } = useI18n();

const isConnected = computed(() => props.status === 'connected');

/** Map API error names to translated messages. */
const ERROR_I18N: Record<string, [key: string, fallback: string]> = {
  ApiUnreachableError: ['error_api_unreachable', 'Cannot connect to Rayburst'],
  ApiAuthError: ['error_api_auth', 'API secret is incorrect'],
  ApiTimeoutError: ['error_api_timeout', 'Connection timed out'],
  ApiEngineStartingError: ['error_engine_starting', 'Rayburst engine is starting'],
  ApiEngineUnavailableError: ['error_engine_unavailable', 'Rayburst engine is unavailable'],
  UnknownError: ['error_unknown', 'An unknown error occurred'],
};

const errorMessage = computed(() => {
  if (!props.error) return null;
  const entry = ERROR_I18N[props.error] ?? ERROR_I18N.UnknownError!;
  return i18n(entry[0], entry[1]);
});
</script>

<template>
  <div class="section">
    <div class="section__grid">
      <NFormItem :show-feedback="false" :label="i18n('options_api_port_label', 'API Port')">
        <NInputNumber
          :value="port"
          :min="1024"
          :max="65535"
          style="width: 140px"
          @update:value="
            (v: number | null) => emit('update:port', v ?? DEFAULT_CONNECTION_CONFIG.port)
          "
        />
      </NFormItem>
      <NFormItem :show-feedback="false" :label="i18n('options_api_secret_label', 'API Secret')">
        <NInput
          :value="secret"
          type="password"
          show-password-on="click"
          :placeholder="i18n('options_api_secret_placeholder', 'Paste from desktop app')"
          style="width: 280px"
          @update:value="(v: string) => emit('update:secret', v)"
        />
      </NFormItem>
    </div>

    <div class="section__row">
      <NButton type="primary" :loading="testing" @click="emit('test')">
        <Transition :name="testing ? 'text-swap' : 'text-swap-reverse'" mode="out-in">
          <span v-if="testing" key="testing">
            {{ i18n('options_testing_connection', 'Testing...') }}
          </span>
          <span v-else key="idle">
            {{ i18n('options_test_connection', 'Test Connection') }}
          </span>
        </Transition>
      </NButton>

      <Transition name="fade" mode="out-in">
        <span
          v-if="isConnected && version"
          key="ok"
          class="section__feedback section__feedback--ok"
        >
          <NIcon :size="16"><CheckmarkCircleOutline /></NIcon>
          {{ i18n('options_connection_success_prefix', 'Connected · Rayburst') }}
          <NTag size="small" round>v{{ version }}</NTag>
        </span>
        <span
          v-else-if="error && !isCompatibilityErrorName(error)"
          key="err"
          class="section__feedback section__feedback--err"
        >
          <NIcon :size="16"><CloseCircleOutline /></NIcon>
          {{ errorMessage }}
        </span>
      </Transition>
    </div>
    <Transition name="fade" mode="out-in">
      <UnsupportedDesktop
        v-if="error && isCompatibilityErrorName(error)"
        :error="error"
        :version="version"
        :checking="testing"
        class="section__compatibility"
        @retry="emit('test')"
      />
    </Transition>
  </div>
</template>

<style scoped>
.section__compatibility {
  margin-top: 16px;
}
.section__grid {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.section__row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.section__feedback {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.section__feedback--ok {
  color: var(--color-success);
}

.section__feedback--err {
  color: var(--color-error);
}
</style>
