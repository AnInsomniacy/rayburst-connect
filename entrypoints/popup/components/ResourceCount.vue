<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ count: number; label: string }>();
const target = computed(() => Math.min(props.count, 100));
const displayed = ref(target.value);
const direction = ref('count-up');
let rolling = false;

function roll(): void {
  if (rolling || target.value === displayed.value) return;
  direction.value = target.value > displayed.value ? 'count-up' : 'count-down';
  rolling = true;
  displayed.value = target.value;
}

function finishRoll(): void {
  rolling = false;
  // Finish the current roll, then use the latest count without queuing intermediate values.
  roll();
}

watch(target, roll);
</script>

<template>
  <span
    class="resource-count"
    :class="{ 'resource-count--empty': count === 0 }"
    :title="label"
    dir="ltr"
  >
    <span class="resource-count__viewport" aria-hidden="true">
      <Transition :name="direction" @after-enter="finishRoll">
        <span :key="displayed" class="resource-count__value">{{
          displayed > 99 ? '99+' : displayed
        }}</span>
      </Transition>
    </span>
    <span class="resource-count__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.resource-count {
  position: relative;
  display: inline-grid;
  inline-size: calc(3ch + 12px);
  padding-inline: 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  transition:
    background-color 220ms var(--m3-ease-emphasized),
    color 220ms var(--m3-ease-emphasized);
}

.resource-count--empty {
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
}

.resource-count__viewport {
  display: grid;
  block-size: 20px;
  overflow: hidden;
}

.resource-count__value {
  grid-area: 1 / 1;
}

.count-up-enter-active,
.count-up-leave-active,
.count-down-enter-active,
.count-down-leave-active {
  transition:
    transform 220ms var(--m3-ease-emphasized),
    opacity 220ms var(--m3-ease-emphasized);
}

.count-up-enter-from,
.count-down-leave-to {
  opacity: 0;
  transform: translateY(60%);
}

.count-up-leave-to,
.count-down-enter-from {
  opacity: 0;
  transform: translateY(-60%);
}

.resource-count__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .resource-count,
  .resource-count__value {
    transition: none;
  }

  .resource-count__value {
    transform: none;
    opacity: 1;
  }

  .count-up-leave-active,
  .count-down-leave-active {
    visibility: hidden;
  }
}
</style>
