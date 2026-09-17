import type { MediaCandidate } from '../schema';

/** Player placeholders are discovery hints, not resource entries. */
export function isMediaResource(item: Pick<MediaCandidate, 'kind'>): boolean {
  return item.kind !== 'embedded';
}

export function countMediaResources(
  items: readonly Pick<MediaCandidate, 'tabId' | 'kind'>[],
  tabId?: number,
): number {
  return items.filter(
    (item) => (tabId === undefined || item.tabId === tabId) && isMediaResource(item),
  ).length;
}
