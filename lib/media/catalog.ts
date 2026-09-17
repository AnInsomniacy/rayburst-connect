import { browser } from 'wxt/browser';
import {
  MEDIA_SESSION_KEY,
  MEDIA_MAX_CANDIDATES,
  MEDIA_MAX_PER_TAB,
  MEDIA_RETENTION_MS,
  MediaSessionSchema,
  type MediaCandidate,
  type MediaSession,
} from '../schema';
import { mediaIdentity } from './detection';

/** One writer owns the session catalogue. A worker restart restores its committed snapshot. */
export function createMediaCatalog() {
  let session: MediaSession | undefined;
  let committed = '';
  let queue: Promise<unknown> = Promise.resolve();

  function transact<T>(action: (state: MediaSession) => T | Promise<T>, write = false): Promise<T> {
    const work = queue.then(async () => {
      if (!session) {
        const saved = await browser.storage.session.get(MEDIA_SESSION_KEY);
        const parsed = MediaSessionSchema.safeParse(saved[MEDIA_SESSION_KEY]);
        session = parsed.success
          ? parsed.data
          : { candidates: [], operations: [], contexts: [], keys: [] };
        committed = JSON.stringify(session);
      }
      if (!write) return structuredClone(await action(session));
      // Mutate a copy: failed persistence must not become visible as committed state.
      const next = structuredClone(session);
      const result = await action(next);
      if (write) {
        prune(next);
        const validated = MediaSessionSchema.parse(next);
        const encoded = JSON.stringify(validated);
        if (encoded !== committed) {
          await browser.storage.session.set({ [MEDIA_SESSION_KEY]: validated });
          committed = encoded;
        }
        session = validated;
      }
      return result;
    });
    queue = work.catch(() => undefined);
    return work;
  }

  function prune(state: MediaSession) {
    const cutoff = Date.now() - MEDIA_RETENTION_MS;
    state.keys = state.keys.filter((key) => key.capturedAt >= cutoff).slice(-256);
    const activeIds = new Set(
      state.operations
        .filter(
          (operation) =>
            ['probing', 'ready', 'submitting', 'cancelling'].includes(operation.state) &&
            operation.createdAt >= cutoff,
        )
        .map((operation) => operation.candidateId),
    );
    state.candidates = state.candidates
      .filter((item) => item.lastSeen >= cutoff || activeIds.has(item.id))
      .sort(
        (a, b) =>
          Number(activeIds.has(b.id)) - Number(activeIds.has(a.id)) || b.lastSeen - a.lastSeen,
      )
      .slice(0, MEDIA_MAX_CANDIDATES);
    const counts = new Map<number, number>();
    state.candidates = state.candidates.filter((item) => {
      const count = (counts.get(item.tabId) ?? 0) + 1;
      counts.set(item.tabId, count);
      return count <= MEDIA_MAX_PER_TAB;
    });
    const ids = new Set(state.candidates.map((item) => item.id));
    state.operations = state.operations.filter((operation) => ids.has(operation.candidateId));
    state.contexts = state.contexts
      .filter((context) => context.capturedAt >= cutoff)
      .sort((a, b) => b.capturedAt - a.capturedAt)
      .slice(0, 128);
    const bytes = () => new TextEncoder().encode(JSON.stringify(state)).byteLength;
    // Leave headroom inside the browser's 10 MB session quota for other extension data.
    while (bytes() > 6 * 1024 * 1024 && state.contexts.length) state.contexts.pop();
    while (bytes() > 6 * 1024 * 1024 && state.candidates.length) {
      const removable = state.candidates.findLastIndex(
        (item) =>
          !state.operations.some(
            (operation) =>
              operation.candidateId === item.id &&
              ['probing', 'ready', 'submitting', 'cancelling'].includes(operation.state),
          ),
      );
      if (removable < 0) break;
      const [removed] = state.candidates.splice(removable, 1);
      state.operations = state.operations.filter(
        (operation) => operation.candidateId !== removed?.id,
      );
    }
  }

  const observations = new Map<string, MediaCandidate>();
  let flush: Promise<void> | undefined;
  async function run<T>(
    action: (state: MediaSession) => T | Promise<T>,
    write = false,
  ): Promise<T> {
    await flush;
    return transact(action, write);
  }
  function merge(existing: MediaCandidate, incoming: MediaCandidate) {
    const { id, firstSeen, context, input } = existing;
    if (incoming.evidence === 'network' || existing.evidence !== 'network')
      Object.assign(existing, incoming);
    Object.assign(existing, {
      id,
      firstSeen,
      lastSeen: Math.max(existing.lastSeen, incoming.lastSeen),
      title: incoming.title || existing.title,
      pageUrl: incoming.pageUrl,
      context: incoming.context ?? context,
      input: incoming.input ?? input,
    });
    if (incoming.input?.manifests.length) existing.kind = incoming.kind;
  }
  function observe(candidate: MediaCandidate): Promise<void> {
    const identity = mediaIdentity(candidate);
    const pending = observations.get(identity);
    if (pending) merge(pending, candidate);
    else observations.set(identity, structuredClone(candidate));
    flush ??= new Promise<void>((resolve) => setTimeout(resolve, 80)).then(async () => {
      const batch = [...observations.values()];
      observations.clear();
      flush = undefined;
      await transact((state) => {
        for (const candidate of batch) {
          const existing = state.candidates.find(
            (item) => mediaIdentity(item) === mediaIdentity(candidate),
          );
          if (!existing) {
            state.candidates.push(candidate);
            continue;
          }
          merge(existing, candidate);
        }
      }, true);
    });
    return flush;
  }

  async function remove(tabId: number, candidateId?: string): Promise<void> {
    await run((state) => {
      state.candidates = state.candidates.filter(
        (item) => item.tabId !== tabId || (candidateId !== undefined && item.id !== candidateId),
      );
      if (!candidateId) state.keys = state.keys.filter((key) => key.tabId !== tabId);
      if (!candidateId) state.contexts = state.contexts.filter((item) => item.tabId !== tabId);
    }, true);
  }

  return { run, observe, remove };
}
export type MediaCatalog = ReturnType<typeof createMediaCatalog>;
