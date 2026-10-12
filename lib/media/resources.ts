import type { MediaCandidate } from '../schema';

type Listed = Pick<
  MediaCandidate,
  'tabId' | 'frameId' | 'documentId' | 'url' | 'kind' | 'method' | 'ranged' | 'input'
>;

/** An input plan holds at most this many tracks. */
const MAX_TRACKS = 32;

/** Player placeholders are discovery hints, not resource entries. */
export function isMediaResource(item: Pick<MediaCandidate, 'kind'>): boolean {
  return item.kind !== 'embedded';
}

/**
 * A whole audio or video track that the player reads in byte ranges, such as
 * an on-demand DASH file. Numbered segments arrive whole and do not qualify.
 */
export function isTrackFile(item: Listed): boolean {
  return item.kind === 'fragment' && item.ranged === true && item.method === 'GET';
}

/**
 * Lists a document's track files as one complete video: separate video and
 * audio tracks mean little alone. A document with a manifest keeps them
 * apart, since the manifest already describes the presentation.
 */
export function groupMediaResources<T extends Listed>(items: readonly T[]): (T | T[])[] {
  const document = (item: T) => `${item.tabId}:${item.frameId}:${item.documentId}`;
  const manifests = new Set(
    items.filter((item) => item.kind === 'hls' || item.kind === 'dash').map(document),
  );
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!isTrackFile(item) || manifests.has(document(item))) continue;
    const group = groups.get(document(item)) ?? [];
    if (group.length < MAX_TRACKS) group.push(item);
    groups.set(document(item), group);
  }
  const entries: (T | T[])[] = [];
  for (const item of items) {
    if (!isMediaResource(item)) continue;
    const group = groups.get(document(item));
    if (!group || group.length < 2) entries.push(item);
    else if (group[0] === item) entries.push(group);
    else if (!isTrackFile(item) && !trackCollection(group, [item])) entries.push(item);
  }
  return entries;
}

/** The latest combined download made from a group's track files, if any. */
export function trackCollection<T extends Listed>(
  group: readonly Listed[],
  items: readonly T[],
): T | undefined {
  const urls = new Set(group.map((item) => item.url));
  return items.findLast((item) => {
    const tracks = item.input?.tracks ?? [];
    return (
      item.kind === 'collection' &&
      item.tabId === group[0]?.tabId &&
      item.documentId === group[0]?.documentId &&
      tracks.length > 0 &&
      tracks.every((track) => track.urls.every((url) => urls.has(url)))
    );
  });
}

export function countMediaResources(items: readonly Listed[], tabId?: number): number {
  return groupMediaResources(items.filter((item) => tabId === undefined || item.tabId === tabId))
    .length;
}
