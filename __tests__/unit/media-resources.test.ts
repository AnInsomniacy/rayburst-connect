import { describe, expect, it } from 'vitest';
import { detectMedia } from '@/lib/media/detection';
import { countMediaResources, groupMediaResources, trackCollection } from '@/lib/media/resources';
import { emptyMediaInput } from '@/lib/media/contracts';
import type { MediaCandidate } from '@/lib/schema';

type Item = Pick<
  MediaCandidate,
  'id' | 'tabId' | 'frameId' | 'documentId' | 'url' | 'kind' | 'method' | 'ranged' | 'input'
>;

function item(id: string, fields: Partial<Item> = {}): Item {
  return {
    id,
    tabId: 1,
    frameId: 0,
    documentId: 'doc',
    url: `https://cdn.example.com/${id}.m4s`,
    kind: 'fragment',
    method: 'GET',
    ranged: true,
    ...fields,
  };
}

describe('track files', () => {
  it('marks resources the player reads in byte ranges', () => {
    const url = 'https://cdn.example.com/video-1-30216.m4s';
    expect(
      detectMedia({
        url,
        status: 206,
        contentRange: 'bytes 0-1023/3200000',
        evidence: 'network',
      }),
    ).toMatchObject({ kind: 'fragment', size: 3_200_000, ranged: true });
    expect(
      detectMedia({ url, status: 200, length: '1024', evidence: 'network' }),
    ).not.toHaveProperty('ranged');
  });

  it('lists a document’s track files as one complete video, first in place', () => {
    const page = item('page', { kind: 'file', ranged: undefined });
    const video = item('video');
    const audio = item('audio');
    expect(groupMediaResources([page, video, audio])).toEqual([page, [video, audio]]);
    expect(countMediaResources([page, video, audio])).toBe(2);
  });

  it('keeps single track files, numbered segments and other documents apart', () => {
    const lone = item('lone');
    const segment = item('segment', { ranged: undefined });
    const other = item('other', { documentId: 'second' });
    expect(groupMediaResources([lone, segment, other])).toEqual([lone, segment, other]);
  });

  it('leaves track files alone when the document has a manifest', () => {
    const manifest = item('manifest', { kind: 'dash', ranged: undefined });
    const tracks = [item('video'), item('audio')];
    expect(groupMediaResources([manifest, ...tracks])).toEqual([manifest, ...tracks]);
  });

  it('folds the combined download made from a group into that group', () => {
    const video = item('video');
    const audio = item('audio');
    const input = emptyMediaInput();
    input.tracks = [video, audio].map((track) => ({
      id: track.id,
      type: 'video' as const,
      urls: [track.url],
    }));
    const combined = item('combined', {
      kind: 'collection',
      url: 'https://rayburst.invalid/collection/1',
      ranged: undefined,
      input,
    });
    const unrelated = item('unrelated', {
      kind: 'collection',
      url: 'https://rayburst.invalid/collection/2',
      ranged: undefined,
      input: { ...input, tracks: [{ id: 'x', type: 'video', urls: ['https://other/x.mp4'] }] },
    });
    const items = [video, audio, combined, unrelated];
    expect(groupMediaResources(items)).toEqual([[video, audio], unrelated]);
    expect(trackCollection([video, audio], items)).toBe(combined);
  });
});
