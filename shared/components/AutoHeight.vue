<script setup lang="ts">
/**
 * Animates its height to follow its content. A popup window sizes itself to
 * the document, so the window then grows and shrinks smoothly instead of
 * jumping when the content changes.
 */
import { onMounted, onUnmounted, ref } from 'vue';

const inner = ref<globalThis.HTMLElement>();
const height = ref<number>();
let observer: globalThis.ResizeObserver | undefined;

onMounted(() => {
  observer = new globalThis.ResizeObserver(([entry]) => {
    const size = entry?.borderBoxSize[0]?.blockSize;
    if (size !== undefined) height.value = size;
  });
  if (inner.value) observer.observe(inner.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="auto-height" :style="height === undefined ? undefined : { height: `${height}px` }">
    <div ref="inner" class="auto-height__inner"><slot /></div>
  </div>
</template>

<style scoped>
/* clip, not hidden: sticky descendants keep following the page scroller. */
.auto-height {
  overflow: clip;
  transition: height 240ms var(--m3-ease-emphasized);
}

.auto-height__inner {
  position: relative;
}
</style>
