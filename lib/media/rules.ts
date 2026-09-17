import picomatch from 'picomatch';
import type { MediaSettings, MediaRegexRule, MediaTypeRule } from '../schema';
import { detectMedia, mediaUrl, type MediaObservation } from './detection';
import { matchesMime } from './formats';

export function mediaSiteAllowed(settings: MediaSettings, pageUrl: string): boolean {
  if (!settings.enabled) return false;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }
  const listed = settings.excludedHosts.some((pattern) =>
    picomatch(pattern)(pattern.includes('://') ? pageUrl : url.hostname),
  );
  return settings.siteMode === 'include' ? listed : !listed;
}

export function matchesSize(rule: MediaTypeRule['size'], bytes: number | null): boolean {
  if (rule.operator === 'any' || bytes === null) return true;
  const factor = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[rule.unit];
  const value = rule.value * factor;
  switch (rule.operator) {
    case '>':
      return bytes > value;
    case '>=':
      return bytes >= value;
    case '<':
      return bytes < value;
    case '<=':
      return bytes <= value;
    case '=':
      return bytes === value;
    case '!=':
      return bytes !== value;
    case 'between':
      return bytes >= value && bytes <= rule.upper * factor;
  }
}

export function testMediaRegex(rule: MediaRegexRule, url: string) {
  const match = new RegExp(rule.pattern, rule.flags).exec(url);
  if (!match) return null;
  if (rule.action === 'ignore') return { action: 'ignore' as const, url };
  const captured = rule.captureGroup ? match[rule.captureGroup] : url;
  if (!captured) return null;
  // Preserve signed absolute URLs. Resolve relative captures with the native URL API.
  const resolved = /^https?:\/\//i.test(captured) ? captured : new URL(captured, url).href;
  const valid = mediaUrl(resolved);
  return valid && !valid.startsWith('blob:') ? { action: 'capture' as const, url: valid } : null;
}

/** Explicit rules override type policy; disabled extensions never fall through to MIME. */
export function selectMedia(input: MediaObservation, settings: MediaSettings) {
  const detected = detectMedia(input);
  if (!mediaUrl(input.url)) return null;
  if (input.status !== undefined && ![200, 206, 304].includes(input.status)) return null;
  if (detected?.kind === 'embedded') return detected;
  for (const rule of settings.regexRules) {
    if (!rule.enabled) continue;
    const match = testMediaRegex(rule, input.url);
    if (!match) continue;
    if (match.action === 'ignore') return null;
    const source = detectMedia({ ...input, url: match.url, elementType: 'video' });
    return source ? { ...source, kind: rule.kind } : null;
  }
  const mime = (input.mime?.split(';')[0] ?? '').trim().toLowerCase();
  const filename = detected?.filename || new URL(input.url).pathname.split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const rule =
    settings.extensions.find((item) => item.value === extension) ??
    settings.mimeTypes.find((item) => item.value === mime) ??
    settings.mimeTypes.find((item) => matchesMime(item.value, mime));
  if (rule) {
    if (!rule.enabled) return null;
    const source = detected ?? detectMedia({ ...input, elementType: 'video' });
    return source && matchesSize(rule.size, source.size) ? { ...source, kind: rule.kind } : null;
  }
  return input.elementType ? detected : null;
}
