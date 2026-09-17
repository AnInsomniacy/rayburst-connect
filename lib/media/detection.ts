/** Passive hints identify candidates. Only the native probe confirms a presentation. */
import {
  extractFilenameFromContentDisposition,
  extractFilenameFromUrl,
  normalizeFilename,
} from '../download/url';
import type { MediaCandidate } from '../schema';

const HLS_MIMES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/mpegurl',
  'application/octet-stream-m3u8',
  'audio/mpegurl',
  'audio/x-mpegurl',
]);
const DASH_MIME = 'application/dash+xml';
const SEGMENT_EXTENSIONS = new Set(['ts', 'm4s', 'm4f', 'cmfv', 'cmfa', 'key']);
const FILE_EXTENSIONS = new Set([
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
  'f4v',
  'avi',
  'wmv',
  'asf',
  'mpeg',
  'mpg',
  'ogv',
  'weba',
  '3gp',
  'aac',
]);
const DOCUMENT_MIMES = new Set(['text/html', 'application/xhtml+xml']);

export interface MediaObservation {
  url: string;
  mime?: string;
  disposition?: string;
  length?: string;
  contentRange?: string;
  method?: string;
  status?: number;
  evidence: MediaCandidate['evidence'];
  elementType?: 'video' | 'audio';
}

/** Preserve signed query bytes and ordering; fragments are not part of an HTTP request. */
export function mediaUrl(value: string): string | null {
  if (value.length > 16_384) return null;
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:', 'blob:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return null;
    return value.split('#', 1)[0] ?? null;
  } catch {
    return null;
  }
}

export function detectMedia(
  input: MediaObservation,
): Pick<
  MediaCandidate,
  'url' | 'kind' | 'filename' | 'mime' | 'size' | 'method' | 'evidence'
> | null {
  const url = mediaUrl(input.url);
  if (!url || (input.status !== undefined && ![200, 206, 304].includes(input.status))) return null;
  if (url.startsWith('blob:')) {
    return input.evidence === 'element'
      ? {
          url,
          kind: 'embedded',
          filename: '',
          mime: '',
          size: null,
          method: 'GET',
          evidence: input.evidence,
        }
      : null;
  }
  const mime = (input.mime?.split(';')[0] ?? '').trim().toLowerCase().slice(0, 128);
  if (DOCUMENT_MIMES.has(mime)) return null;
  const filename = normalizeFilename(
    (input.disposition && extractFilenameFromContentDisposition(input.disposition)) ||
      extractFilenameFromUrl(url) ||
      '',
  );
  const path = new URL(url).pathname;
  const extension = (filename || path).split('.').pop()?.toLowerCase() ?? '';
  let kind: MediaCandidate['kind'];
  if (HLS_MIMES.has(mime) || ['m3u8', 'm3u'].includes(extension)) kind = 'hls';
  else if (mime === DASH_MIME || extension === 'mpd') kind = 'dash';
  else if (
    SEGMENT_EXTENSIONS.has(extension) ||
    ['video/mp2t', 'video/iso.segment', 'audio/iso.segment'].includes(mime)
  )
    kind = 'fragment';
  else if (
    ['vtt', 'srt', 'ass', 'ssa', 'ttml'].includes(extension) ||
    ['text/vtt', 'application/ttml+xml', 'application/x-subrip'].includes(mime)
  )
    kind = 'subtitle';
  else if (mime.startsWith('image/') && input.evidence === 'script') kind = 'image';
  else if (mime === 'application/json' && input.evidence === 'script') kind = 'json';
  else {
    if (!FILE_EXTENSIONS.has(extension) && !/^(video|audio)\//.test(mime) && !input.elementType)
      return null;
    kind = 'file';
  }
  const total = input.contentRange?.match(/^bytes \d+-\d+\/(\d+)$/i)?.[1];
  const rawSize = total ?? (input.status === 206 ? undefined : input.length);
  const size = rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : NaN;
  return {
    url,
    kind,
    filename,
    mime,
    size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    method: (input.method || 'GET').toUpperCase().slice(0, 16),
    evidence: input.evidence,
  };
}

export function mediaIdentity(
  candidate: Pick<MediaCandidate, 'tabId' | 'frameId' | 'documentId' | 'url' | 'variant'>,
): string {
  return JSON.stringify([
    candidate.tabId,
    candidate.frameId,
    candidate.documentId,
    candidate.url,
    candidate.variant ?? '',
  ]);
}

export function hostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

export function mediaOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

/** Fragments are credential evidence for their own origin, not separate downloadable titles. */
export function isMediaFragment(url: string, mime = ''): boolean {
  try {
    return (
      /\.(ts|m4s|m4f|cmfv|cmfa|aac|key)$/i.test(new URL(url).pathname) ||
      ['video/mp2t', 'video/iso.segment', 'audio/iso.segment'].includes(
        mime.split(';')[0]?.trim().toLowerCase() ?? '',
      )
    );
  } catch {
    return false;
  }
}
