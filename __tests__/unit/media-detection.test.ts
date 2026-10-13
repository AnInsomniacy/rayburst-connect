import { describe, expect, it } from 'vitest';
import { detectMedia, mediaFileName, mediaIdentity, mediaUrl } from '@/lib/media/detection';
import { MediaPresentationSchema, selectionError } from '@/lib/media/contracts';
import { captureMediaContext } from '@/lib/media/request-context';
import { parseMediaSettings } from '@/lib/schema';
import { mediaPresentation, mediaSelection } from '../fixtures/media';

describe('passive media classification', () => {
  it('recognizes extensionless manifests by MIME and keeps signed URL bytes intact', () => {
    const url = 'https://cdn.example.com/asset?signature=a%2fb+%20&x=1&x=2#player';
    expect(
      detectMedia({ url, mime: 'Application/Dash+Xml; charset=utf-8', evidence: 'network' }),
    ).toMatchObject({ kind: 'dash', url: url.split('#')[0] });
    expect(
      detectMedia({ url: 'https://cdn.example.com/master.M3U8?token=1', evidence: 'resource' })
        ?.kind,
    ).toBe('hls');
  });
  it('classifies fragments while rejecting HTML errors, failures and non-network addresses', () => {
    for (const url of [
      'https://example.com/1.ts',
      'https://example.com/1.m4s',
      'https://example.com/key.key',
    ]) {
      expect(detectMedia({ url, mime: 'video/mp4', evidence: 'network' })).toMatchObject({
        kind: 'fragment',
      });
    }
    expect(
      detectMedia({ url: 'https://example.com/video.mp4', mime: 'text/html', evidence: 'network' }),
    ).toBeNull();
    expect(
      detectMedia({ url: 'https://example.com/video.mp4', status: 403, evidence: 'network' }),
    ).toBeNull();
    for (const url of [
      'file:///private.mp4',
      'javascript:alert(1)',
      'https://user:password@example.com/video.mp4',
      'data:video/mp4,secret',
    ])
      expect(mediaUrl(url)).toBeNull();
  });
  it('uses total resource length for range responses and does not confuse a chunk length with file size', () => {
    const source = {
      url: 'https://example.com/video.mp4',
      evidence: 'network' as const,
      status: 206,
      length: '1024',
    };
    expect(detectMedia(source)?.size).toBeNull();
    expect(detectMedia({ ...source, contentRange: 'bytes 0-1023/5242880' })?.size).toBe(5242880);
    expect(
      detectMedia({ ...source, status: 200, length: '9999999999999999999999' })?.size,
    ).toBeNull();
  });
  it('uses standard Content-Disposition and distinguishes in-page references', () => {
    expect(
      detectMedia({
        url: 'https://example.com/asset',
        evidence: 'network',
        disposition: "attachment; filename*=UTF-8''video%20one.mp4",
      })?.filename,
    ).toBe('video one.mp4');
    expect(detectMedia({ url: 'blob:https://example.com/id', evidence: 'element' })?.kind).toBe(
      'embedded',
    );
    expect(detectMedia({ url: 'blob:https://example.com/id', evidence: 'resource' })).toBeNull();
  });
  it('keeps the same URL isolated by tab, frame, and document', () => {
    const input = {
      tabId: 1,
      frameId: 0,
      documentId: 'one',
      url: 'https://example.com/master.m3u8',
    };
    const identities = [
      input,
      { ...input, tabId: 2 },
      { ...input, frameId: 1 },
      { ...input, documentId: 'two' },
    ].map(mediaIdentity);
    expect(new Set(identities).size).toBe(4);
  });
});

describe('media boundary validation', () => {
  it('keeps available source credentials but drops injected and transport-owned headers', () => {
    const headers = captureMediaContext(
      'https://example.com/media',
      [
        { name: 'Authorization', value: 'Bearer secret' },
        { name: 'X-Playback-Token', value: 'opaque' },
        { name: 'Cookie', value: 'sid=one' },
        { name: 'Range', value: 'bytes=0-100' },
        { name: 'If-None-Match', value: 'etag' },
        { name: 'Host', value: 'evil.example' },
        { name: 'Referer', value: 'https://example.com/\r\nX-Injected: true' },
      ],
      { forwardCookies: true, forwardRequestHeaders: true },
    ).headers;
    expect(Object.fromEntries(headers.map((header) => [header.name, header.value]))).toEqual({
      authorization: 'Bearer secret',
      cookie: 'sid=one',
      'x-playback-token': 'opaque',
    });
    expect(
      captureMediaContext('https://example.com/media', headers, {
        forwardCookies: false,
        forwardRequestHeaders: false,
      }).headers,
    ).toEqual([]);
  });
  it('rejects duplicate native track IDs, unknown defaults, and invalid combinations', () => {
    const presentation = mediaPresentation();
    expect(MediaPresentationSchema.safeParse(presentation).success).toBe(true);
    expect(
      MediaPresentationSchema.safeParse({
        ...presentation,
        tracks: [...presentation.tracks, presentation.tracks[0]],
      }).success,
    ).toBe(false);
    expect(
      MediaPresentationSchema.safeParse({
        ...presentation,
        defaults: { ...mediaSelection, videoId: '1080' },
      }).success,
    ).toBe(false);
    expect(
      selectionError(presentation, { ...mediaSelection, recordTimeSeconds: 30 }),
    ).not.toBeNull();
    expect(
      selectionError(presentation, { ...mediaSelection, videoId: null, audioId: null }),
    ).not.toBeNull();
    const muxed = {
      ...presentation,
      tracks: presentation.tracks.map((track) =>
        track.id === 'video-1080' ? { ...track, type: 'muxed' as const } : track,
      ),
    };
    expect(selectionError(muxed, mediaSelection)).not.toBeNull();
    expect(selectionError(muxed, { ...mediaSelection, audioId: null })).toBeNull();
    expect(selectionError(muxed, { ...mediaSelection, audioId: 'video-1080' })).toBeNull();
    expect(
      selectionError(muxed, { ...mediaSelection, videoId: null, audioId: 'video-1080' }),
    ).toBeNull();
  });
});

describe('sniffed file names', () => {
  it('names a file without one after its page, with the extension its type implies', () => {
    expect(mediaFileName({ filename: '', title: '深夜偷吃火鸡面 | 抖音', mime: 'video/mp4' })).toBe(
      '深夜偷吃火鸡面 _ 抖音.mp4',
    );
    expect(mediaFileName({ filename: '', title: 'AC/DC live', mime: 'audio/mpeg' })).toBe(
      'AC DC live.mp3',
    );
    expect(mediaFileName({ filename: 'v0d00fg10000', title: 'x', mime: 'video/mp4' })).toBe(
      'v0d00fg10000.mp4',
    );
    expect(mediaFileName({ filename: '', title: 'Release v1.2', mime: 'video/webm' })).toBe(
      'Release v1.2.webm',
    );
  });

  it('keeps names that already carry an extension or whose type is unknown', () => {
    expect(mediaFileName({ filename: 'clip.webm', title: 'x', mime: 'video/mp4' })).toBe(
      'clip.webm',
    );
    expect(mediaFileName({ filename: 'data', title: 'x', mime: 'application/octet-stream' })).toBe(
      'data',
    );
  });

  it('can name files after their page, keeping the file extension', () => {
    const file = { filename: '407814-1080p.mp4', title: 'Trip: Day 1 | Site', mime: 'video/mp4' };
    expect(mediaFileName(file, 'title')).toBe('Trip_ Day 1 _ Site.mp4');
    expect(mediaFileName({ ...file, mime: '' }, 'title')).toBe('Trip_ Day 1 _ Site.mp4');
    expect(mediaFileName({ ...file, title: '' }, 'title')).toBe('407814-1080p.mp4');
    expect(mediaFileName(file)).toBe('407814-1080p.mp4');
    expect(parseMediaSettings({ nameFrom: 'url' }).nameFrom).toBe('file');
  });
});
