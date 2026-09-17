/** Format hints and initial capture policy share one catalogue. */
export type ResourceKind = 'file' | 'hls' | 'dash' | 'fragment' | 'subtitle' | 'image' | 'json';

export const MEDIA_FORMATS: { extension: string; kind: ResourceKind; enabled: boolean }[] = [
  ...['m3u8', 'm3u'].map((extension) => ({ extension, kind: 'hls' as const, enabled: true })),
  { extension: 'mpd', kind: 'dash', enabled: true },
  ...[
    'mp4',
    'm4v',
    'mov',
    'webm',
    'mkv',
    'mp3',
    'm4a',
    'ogg',
    'oga',
    'opus',
    'wav',
    'flac',
    'flv',
    'hlv',
    'f4v',
    'avi',
    'wmv',
    'wma',
    'asf',
    'mpeg',
    'mpg',
    'ogv',
    'weba',
    '3gp',
    'aac',
  ].map((extension) => ({ extension, kind: 'file' as const, enabled: true })),
  ...['m4s', 'm4f', 'cmfv', 'cmfa'].map((extension) => ({
    extension,
    kind: 'fragment' as const,
    enabled: true,
  })),
  { extension: 'ts', kind: 'fragment', enabled: false },
  { extension: 'key', kind: 'fragment', enabled: false },
  ...['srt', 'vtt', 'ass', 'ssa', 'ttml'].map((extension) => ({
    extension,
    kind: 'subtitle' as const,
    enabled: false,
  })),
  ...['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].map((extension) => ({
    extension,
    kind: 'image' as const,
    enabled: false,
  })),
  { extension: 'json', kind: 'json', enabled: false },
];

export const MEDIA_MIMES: { mime: string; kind: ResourceKind; enabled: boolean }[] = [
  ...[
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
    'application/mpegurl',
    'application/octet-stream-m3u8',
    'audio/mpegurl',
    'audio/x-mpegurl',
  ].map((mime) => ({ mime, kind: 'hls' as const, enabled: true })),
  { mime: 'application/dash+xml', kind: 'dash', enabled: true },
  { mime: 'video/mp2t', kind: 'fragment', enabled: false },
  ...['video/iso.segment', 'audio/iso.segment', 'application/m4s'].map((mime) => ({
    mime,
    kind: 'fragment' as const,
    enabled: true,
  })),
  ...['text/vtt', 'application/ttml+xml', 'application/x-subrip'].map((mime) => ({
    mime,
    kind: 'subtitle' as const,
    enabled: false,
  })),
  { mime: 'application/json', kind: 'json', enabled: false },
  { mime: 'image/*', kind: 'image', enabled: false },
  { mime: 'application/ogg', kind: 'file', enabled: true },
  { mime: 'audio/*', kind: 'file', enabled: true },
  { mime: 'video/*', kind: 'file', enabled: true },
];

export function matchesMime(pattern: string, mime: string): boolean {
  return pattern === mime || (pattern.endsWith('/*') && mime.startsWith(pattern.slice(0, -1)));
}
