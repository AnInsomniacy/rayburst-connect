<script lang="ts" setup>
/** Popup header component. */
import { NIcon, NSwitch } from 'naive-ui';
import { SettingsOutline } from '@vicons/ionicons5';
import type { ConnectionStatus } from '@/lib/api';
import { useI18n } from '@/shared/i18n/engine';
import BrandLogo from '@/shared/components/BrandLogo.vue';

const props = defineProps<{
  status: ConnectionStatus | 'launching' | 'checking';
  version: string | null;
  enabled: boolean;
}>();

const emit = defineEmits<{
  settings: [];
  'toggle-enabled': [];
}>();

const { t: i18n } = useI18n();
</script>

<template>
  <header class="popup-header">
    <div class="popup-header__brand">
      <BrandLogo class="popup-header__logo" />
      <span
        class="popup-header__badge"
        :class="{
          'popup-header__badge--ok': status === 'connected',
          'popup-header__badge--pending': status === 'launching' || status === 'checking',
          'popup-header__badge--err': status === 'disconnected',
        }"
      >
        <Transition name="text-swap" mode="out-in">
          <span :key="status" class="popup-header__badge-text">
            {{
              status === 'connected'
                ? i18n('popup_status_connected', 'Connected')
                : status === 'launching'
                  ? i18n('popup_status_launching', 'Starting')
                  : status === 'checking'
                    ? i18n('popup_status_checking')
                    : i18n('popup_status_disconnected', 'Disconnected')
            }}
          </span>
        </Transition>
      </span>
      <span v-if="version" class="popup-header__version">v{{ version }}</span>
    </div>
    <div class="popup-header__controls">
      <!-- Interception toggle — NSwitch + contextual label -->
      <div class="popup-header__toggle">
        <span class="popup-header__toggle-crossfade">
          <span
            :class="[
              'popup-header__toggle-label',
              'popup-header__toggle-label--on',
              { 'popup-header__toggle-label--active': props.enabled },
            ]"
          >
            {{ i18n('popup_toggle_enabled', 'Intercepting') }}
          </span>
          <span
            :class="[
              'popup-header__toggle-label',
              'popup-header__toggle-label--off',
              { 'popup-header__toggle-label--active': !props.enabled },
            ]"
          >
            {{ i18n('popup_toggle_disabled', 'Paused') }}
          </span>
        </span>
        <NSwitch :value="props.enabled" size="small" @update:value="emit('toggle-enabled')" />
      </div>
      <!-- Settings gear -->
      <button
        type="button"
        class="popup-header__settings"
        :title="i18n('popup_action_settings', 'Settings')"
        @click="emit('settings')"
      >
        <NIcon :size="18"><SettingsOutline /></NIcon>
      </button>
    </div>
  </header>
</template>

<style scoped>
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
}

.popup-header__brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.popup-header__logo {
  color: var(--color-primary);
  flex-shrink: 0;
}

.popup-header__badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  transition:
    color 0.2s var(--m3-ease-emphasized),
    background-color 0.2s var(--m3-ease-emphasized);
}

.popup-header__badge-text {
  display: inline-block;
}

.popup-header__badge--ok {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
}

.popup-header__badge--err {
  background: color-mix(in srgb, var(--color-error) 12%, transparent);
  color: var(--color-error);
}

.popup-header__badge--pending {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}

.popup-header__version {
  font-size: 11px;
  color: var(--color-on-surface-variant);
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

/* ── Header Controls Group ────────────────────────────────── */
.popup-header__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Interception Toggle ──────────────────────────────────── */
.popup-header__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Cross-fade container: sized by the wider label, children overlap */
.popup-header__toggle-crossfade {
  position: relative;
  display: inline-grid;
}

.popup-header__toggle-crossfade > .popup-header__toggle-label {
  grid-area: 1 / 1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  user-select: none;
  transition:
    opacity 0.42s cubic-bezier(0.2, 0, 0, 1),
    transform 0.42s cubic-bezier(0.2, 0, 0, 1);
}

/* Inactive labels: hidden + shifted */
.popup-header__toggle-label--on:not(.popup-header__toggle-label--active) {
  opacity: 0;
  transform: translateY(-6px);
  pointer-events: none;
}

.popup-header__toggle-label--off:not(.popup-header__toggle-label--active) {
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
}

/* Active labels: visible + centered */
.popup-header__toggle-label--active {
  opacity: 1;
  transform: translateY(0);
}

.popup-header__toggle-label--on {
  color: var(--color-success);
}

.popup-header__toggle-label--off {
  color: var(--color-on-surface-variant);
}

/* ── Settings button ──────────────────────────────────────── */
.popup-header__settings {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--color-on-surface-variant);
  border-radius: 50%;
  cursor: pointer;
  /* Release: spring-back (emphasized-decelerate) */
  transition:
    color 0.15s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.15s cubic-bezier(0.2, 0, 0, 1),
    transform 0.35s cubic-bezier(0.05, 0.7, 0.1, 1);
}

.popup-header__settings:hover {
  color: var(--color-on-surface);
  background: color-mix(in srgb, var(--color-on-surface) 8%, transparent);
}

.popup-header__settings:active {
  transform: scale(0.92);
  /* Press: fast compress (emphasized) */
  transition:
    color 0.15s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.15s cubic-bezier(0.2, 0, 0, 1),
    transform 0.15s cubic-bezier(0.2, 0, 0, 1);
}
</style>
