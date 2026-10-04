import picomatch from 'picomatch';
import type { SiteRule } from './schema';

/** Site rules describe hosts. A pasted URL is an input convenience, not a glob. */
export function normalizeSitePattern(input: string): string | null {
  let value = input.trim().toLowerCase();
  try {
    if (value.includes('://')) value = new URL(value).hostname;
    else value = value.replace(/\/$/, '');
    if (!value || value.length > 253 || !/^[a-z0-9.*-]+$/.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/** First matching rule wins across the source page and resource hosts. */
export function matchSiteRule(rules: SiteRule[], urls: string[]): SiteRule['action'] | null {
  const hosts = new Set(
    urls.flatMap((value) => {
      try {
        return [new URL(value).hostname];
      } catch {
        return [];
      }
    }),
  );
  for (const rule of rules) {
    const pattern = normalizeSitePattern(rule.pattern);
    if (!pattern) continue;
    const matches = picomatch(pattern, { nocase: true });
    if ([...hosts].some((host) => matches(host))) return rule.action;
  }
  return null;
}
