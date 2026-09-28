/**
 * URL filename extraction utility.
 *
 * Extracts a usable filename from a URL using two strategies:
 *   1. Content-Disposition query parameter (cloud drive presigned URLs)
 *   2. URL pathname basename (standard download URLs)
 *
 * Cloud storage providers (Aliyun OSS, AWS S3, GCS) embed the real
 * filename in a `response-content-disposition` query parameter when
 * the URL pathname is a hash or UUID. This is standard for Quark,
 * Baidu, 115, and Aliyun Drive presigned URLs.
 */
import contentDisposition from 'content-disposition';
import { decodeMimeWords } from 'lettercoder';
import sanitizeFilename from 'sanitize-filename';

interface ParsedContentDisposition {
  type: string;
  filename?: string;
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127 && (code < 128 || code > 159);
    })
    .join('');
}

export function normalizeFilename(filename: string): string {
  const basename = filename.trim().replace(/^.*[/\\]/, '');
  const stripped = stripControlCharacters(basename).replace(/[. ]+$/, '');
  return sanitizeFilename(stripped, { replacement: '_' })
    .trim()
    .replace(/[. ]+$/, '');
}

/**
 * Decode RFC 2047 MIME encoded-words when servers put them in filename fields.
 *
 * RFC 6266 prefers `filename*` for HTTP, but some mail/CDN download endpoints
 * still emit `filename="=?UTF-8?B?...?="`. Keep malformed values unchanged so
 * filename extraction remains best-effort and never blocks routing.
 */
export function decodeMimeEncodedWords(value: string): string {
  if (!value.includes('=?')) return value;

  try {
    const decoded = decodeMimeWords(value);
    return decoded || value;
  } catch {
    return value;
  }
}

/**
 * Extract a filename from a URL.
 *
 * Priority:
 *   1. `response-content-disposition` query param (RFC 6266 parse)
 *   2. `content-disposition` query param (alternative key)
 *   3. URL pathname basename (must contain a file extension)
 *
 * @example
 * // Standard URL → pathname extraction
 * extractFilenameFromUrl('https://cdn.example.com/files/app-v2.0.zip?token=abc')
 * // → 'app-v2.0.zip'
 *
 * @example
 * // Cloud drive presigned URL → Content-Disposition extraction
 * extractFilenameFromUrl('https://dl-pc-zb.pds.quark.cn/hash123?response-content-disposition=...')
 * // → '无常幽鬼全关V0.1.xmgic'
 *
 * @returns The decoded filename, or null if no filename can be determined.
 */
export function extractFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Priority 1: Content-Disposition query parameter (cloud drive presigned URLs)
    const raw =
      parsed.searchParams.get('response-content-disposition') ??
      parsed.searchParams.get('content-disposition');
    const cdFilename = raw ? extractFilenameFromContentDisposition(raw) : null;
    if (cdFilename) return cdFilename;

    // Priority 2: URL pathname basename
    const decoded = decodeURIComponent(parsed.pathname);
    const basename = decoded.split('/').pop();
    // Filter out empty segments and bare directory paths
    if (!basename || basename === '/' || !basename.includes('.')) {
      return null;
    }
    return basename;
  } catch {
    return null;
  }
}

export function extractFilenameFromContentDisposition(header: string): string | null {
  return parseContentDispositionHeader(header)?.filename ?? null;
}

/** Cookies can only be collected for network schemes. */
export function isCookieCollectableUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseContentDispositionHeader(header: string): ParsedContentDisposition | null {
  try {
    // The parser accepts HTTP bytes. Some browser/query APIs already decoded UTF-8.
    const bytes = Array.from(header).some((char) => char.charCodeAt(0) > 255)
      ? Array.from(new TextEncoder().encode(header), (byte) => String.fromCharCode(byte)).join('')
      : header;
    const { type, parameters } = contentDisposition.parse(bytes);
    const filename = parameters.filename;
    // Firefox can expose a legacy filename as one character per original byte.
    // Never reinterpret RFC 8187 values, MIME encoded words, or decoded Unicode.
    let decoded = filename ? decodeMimeEncodedWords(filename) : undefined;
    if (
      decoded &&
      decoded === filename &&
      !/;\s*filename\*\s*=/i.test(header) &&
      Array.from(decoded).every((char) => char.charCodeAt(0) <= 255)
    ) {
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
        );
      } catch {
        // A genuine Latin-1 name remains unchanged.
      }
    }
    return {
      type: type.toLowerCase(),
      ...(decoded ? { filename: decoded } : {}),
    };
  } catch {
    return null;
  }
}
