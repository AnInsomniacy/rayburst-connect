import type { DownloadCandidate } from './orchestrator';
import { normalizeFilename, parseContentDispositionHeader } from './url';

interface FirefoxResponseHeader {
  name?: string;
  value?: string;
}

interface FirefoxResponseDetails {
  url: string;
  method: string;
  type: string;
  statusCode: number;
  incognito?: boolean;
  originUrl?: string;
  documentUrl?: string;
  responseHeaders?: FirefoxResponseHeader[];
}

function headerValue(headers: FirefoxResponseHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name)?.value?.trim() ?? '';
}

function contentLength(headers: FirefoxResponseHeader[] | undefined): number {
  const value = Number.parseInt(headerValue(headers, 'content-length'), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

const NON_DOWNLOAD_APPLICATION_MIMES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/json',
  'application/pdf',
  'application/wasm',
  'application/x-www-form-urlencoded',
]);
const WEB_DOCUMENT_MIMES = new Set([
  'application/xhtml+xml',
  'application/xml',
  'text/html',
  'text/xml',
]);

function baseMime(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

function isBinaryMime(value: string): boolean {
  const mime = baseMime(value);
  if (mime === 'binary/octet-stream') return true;
  if (!mime.startsWith('application/')) return false;
  if (NON_DOWNLOAD_APPLICATION_MIMES.has(mime) || WEB_DOCUMENT_MIMES.has(mime)) return false;
  return !mime.endsWith('+json') && !mime.endsWith('+xml');
}

function hasExplicitDownloadIntent(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const downloadValue = (parsed.searchParams.get('dl') ?? '').toLowerCase();
    return (
      path.endsWith('/download') ||
      path.includes('/download/') ||
      parsed.searchParams.has('download') ||
      parsed.searchParams.has('attachment') ||
      parsed.searchParams.has('filename') ||
      parsed.searchParams.has('response-content-disposition') ||
      parsed.searchParams.get('export') === 'download' ||
      ['1', 'true', 'yes', 'download'].includes(downloadValue)
    );
  } catch {
    return false;
  }
}

export function parseFirefoxDownloadResponse(
  details: FirefoxResponseDetails,
): DownloadCandidate | null {
  if (details.method !== 'GET') return null;
  if (details.type !== 'main_frame' && details.type !== 'sub_frame') return null;
  if (details.statusCode < 200 || details.statusCode >= 300) return null;

  const disposition = parseContentDispositionHeader(
    headerValue(details.responseHeaders, 'content-disposition'),
  );
  const mime = headerValue(details.responseHeaders, 'content-type');
  const isAttachment = disposition?.type === 'attachment';
  if (!isAttachment && WEB_DOCUMENT_MIMES.has(baseMime(mime))) return null;
  if (!isAttachment && !isBinaryMime(mime) && !hasExplicitDownloadIntent(details.url)) return null;

  const filename = disposition?.filename ? normalizeFilename(disposition.filename) : '';
  const size = contentLength(details.responseHeaders);

  return {
    incognito: details.incognito,
    url: details.url,
    finalUrl: details.url,
    filename,
    ...(filename ? { filenameSource: 'content-disposition' as const } : {}),
    fileSize: size,
    totalBytes: size,
    mime,
    referrer: details.originUrl || details.documentUrl || '',
  };
}
