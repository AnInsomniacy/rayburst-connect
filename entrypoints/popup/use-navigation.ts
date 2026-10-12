import { onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import { z } from '@/lib/validation';
import { MEDIA_SESSION_KEY, MediaCandidateSchema } from '@/lib/schema';
import { sendMediaCommand } from '@/lib/media/messages';
import { countMediaResources } from '@/lib/media/resources';

// Read only the fields needed to count list entries; nothing here is retained.
const summarySchema = z.object({
  candidates: z.array(
    MediaCandidateSchema.pick({
      tabId: true,
      frameId: true,
      documentId: true,
      url: true,
      kind: true,
      method: true,
      ranged: true,
      input: true,
    }).strip(),
  ),
});

export function usePopupNavigation() {
  const view = ref<'downloads' | 'media'>('downloads');
  const count = ref(0);
  const ready = ref(false);
  let tabId: number | undefined;
  let disposed = false;
  let updated = false;
  // A tab the user picks while discovery is still loading is never overridden.
  let chosen = false;
  const stopChoosing = watch(view, () => {
    chosen = true;
  });

  const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== 'session' || !changes[MEDIA_SESSION_KEY] || tabId === undefined) return;
    const result = summarySchema.safeParse(changes[MEDIA_SESSION_KEY].newValue);
    count.value = result.success ? countMediaResources(result.data.candidates, tabId) : 0;
    updated = true;
  };

  onMounted(async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (disposed || tab?.id === undefined || !/^https?:\/\//.test(tab.url ?? '')) return;
      tabId = tab.id;
      browser.storage.onChanged.addListener(changed);
      // The existing list command removes stale documents before choosing the initial tab.
      const list = await sendMediaCommand({ type: 'MEDIA_LIST', tabId });
      if (disposed) return;
      if (!updated) count.value = countMediaResources(list.items, tabId);
    } catch {
      // Download controls remain available if discovery cannot be read.
    } finally {
      if (!disposed) {
        stopChoosing();
        if (!chosen) view.value = count.value > 0 ? 'media' : 'downloads';
        ready.value = true;
      }
    }
  });

  onUnmounted(() => {
    disposed = true;
    stopChoosing();
    browser.storage.onChanged.removeListener(changed);
  });

  return { view, count, ready };
}
