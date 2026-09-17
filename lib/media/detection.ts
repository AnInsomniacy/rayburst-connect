/** Passive hints identify candidates. Only the native probe confirms a presentation. */
import {
  extractFilenameFromContentDisposition,
  extractFilenameFromUrl,
  normalizeFilename,
} from '../download/url';
import type { MediaCandidate } from '../schema';

import { MEDIA_FORMATS, MEDIA_MIMES, matchesMime } from './formats';

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
  const format = MEDIA_FORMATS.find((item) => item.extension === extension);
  const type = MEDIA_MIMES.find((item) => matchesMime(item.mime, mime));
  const kind =
    type?.kind === 'hls' || type?.kind === 'dash'
      ? type.kind
      : (format?.kind ?? type?.kind ?? (input.elementType ? 'file' : undefined));
  if (!kind) return null;
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
