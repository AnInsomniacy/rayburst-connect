import type { DownloadSettings, MediaCandidate, MediaCapturedContext } from '../schema';

const TRANSPORT_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'range',
  'accept-encoding',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
]);

/** Native Headers validates names and values. Transport and conditional headers belong to libcurl. */
export function captureMediaContext(
  url: string,
  raw: { name?: string; value?: string }[],
  settings: Pick<DownloadSettings, 'forwardCookies' | 'forwardRequestHeaders'>,
): MediaCapturedContext {
  const headers = new Headers();
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const header of raw) {
    const name = header.name?.toLowerCase().trim();
    const value = header.value;
    if (
      !name ||
      name.length > 128 ||
      value == null ||
      TRANSPORT_HEADERS.has(name) ||
      name.startsWith('proxy-') ||
      name.startsWith('if-')
    )
      continue;
    if (name === 'cookie' ? !settings.forwardCookies : !settings.forwardRequestHeaders) continue;
    if (
      value.length > 8192 ||
      Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 && code !== 9) || code === 127;
      }) ||
      headers.has(name)
    )
      continue;
    const length = encoder.encode(name + value).byteLength;
    if (bytes + length > 16_384 || [...headers].length >= 32) break;
    try {
      headers.set(name, value);
    } catch {
      continue;
    }
    bytes += length;
  }
  return {
    url,
    capturedAt: Date.now(),
    headers: [...headers].map(([name, value]) => ({ name, value })),
  };
}

/** Replay observed headers from the source frame; do not synthesize another cookie context. */
export function submissionContext(
  candidate: MediaCandidate,
  settings: DownloadSettings,
): MediaCapturedContext {
  return {
    ...captureMediaContext(
      candidate.url,
      candidate.context?.headers ?? [],
      candidate.evidence === 'capture'
        ? { forwardCookies: false, forwardRequestHeaders: true }
        : settings,
    ),
    capturedAt: candidate.context?.capturedAt ?? Date.now(),
  };
}

/** Ordinary files keep the existing download pipeline and its own API contract. */
export function fileRequestContext(candidate: MediaCandidate, settings: DownloadSettings) {
  const context = submissionContext(candidate, settings);
  const value = (name: string) => context.headers.find((header) => header.name === name)?.value;
  return {
    url: candidate.url,
    tabId: candidate.tabId,
    frameId: candidate.frameId,
    documentId: candidate.documentId,
    createdAt: context.capturedAt,
    cookie: value('cookie'),
    referer: value('referer'),
    userAgent: value('user-agent'),
    requestHeaders: context.headers.filter(
      (header) => !['cookie', 'referer', 'user-agent'].includes(header.name),
    ),
  };
}
