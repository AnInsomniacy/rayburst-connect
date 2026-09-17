import type { DownloadSettings } from '../schema';

/** Rules classify observations; ordinary download interception keeps its own policy. */
export function matchMediaRule(
  rules: DownloadSettings['mediaDiscovery']['rules'],
  source: { url: string; mime?: string; size?: number | null },
) {
  for (const rule of rules) {
    if (!rule.enabled || (rule.minimumBytes && (source.size ?? 0) < rule.minimumBytes)) continue;
    try {
      const value =
        rule.field === 'mime'
          ? (source.mime ?? '')
          : rule.field === 'extension'
            ? (new URL(source.url).pathname.split('/').pop()?.split('.').slice(1).pop() ?? '')
            : source.url;
      if (new RegExp(rule.pattern, 'i').test(value)) return rule.kind;
    } catch {
      /* An invalid user expression cannot interrupt discovery. */
    }
  }
  return undefined;
}
