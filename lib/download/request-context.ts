export interface RequestHeader {
  name: string;
  value: string;
}

interface RawRequestHeader {
  name?: string;
  value?: string;
}

export interface RequestHeaderContext {
  url: string;
  originalUrl?: string;
  /** Method of the request's first hop; a redirect may change it to GET. */
  originalMethod?: string;
  method?: string;
  cookieStoreId?: string;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  createdAt: number;
  cookie?: string;
  referer?: string;
  userAgent?: string;
  requestHeaders: RequestHeader[];
}

type RequestHeaderMatchSource = 'finalUrl' | 'url';
export type RequestHeaderMatchReason = 'matched' | 'not-found' | 'expired' | 'ambiguous';

export interface RequestHeaderMatchResult {
  originalUrl?: string;
  /**
   * The request method, also when the match is ambiguous: a non-GET there
   * means one of the candidates is, and the browser keeps the download.
   */
  method?: string;
  matched: boolean;
  reason: RequestHeaderMatchReason;
  context?: RequestHeaderContext;
  source?: RequestHeaderMatchSource;
}

interface CaptureRequestHeaderContextInput {
  url: string;
  method?: string;
  cookieStoreId?: string;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  requestHeaders?: RawRequestHeader[];
  now?: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 512;

const CANONICAL_REQUEST_HEADERS = new Map<string, string>([
  ['accept', 'Accept'],
  ['accept-language', 'Accept-Language'],
  ['sec-ch-ua', 'Sec-CH-UA'],
  ['sec-ch-ua-mobile', 'Sec-CH-UA-Mobile'],
  ['sec-ch-ua-platform', 'Sec-CH-UA-Platform'],
  ['sec-fetch-dest', 'Sec-Fetch-Dest'],
  ['sec-fetch-mode', 'Sec-Fetch-Mode'],
  ['sec-fetch-site', 'Sec-Fetch-Site'],
  ['sec-fetch-user', 'Sec-Fetch-User'],
  ['upgrade-insecure-requests', 'Upgrade-Insecure-Requests'],
  ['dnt', 'DNT'],
  ['origin', 'Origin'],
]);

const USER_AGENT_HEADER = 'user-agent';
const REFERER_HEADER = 'referer';
const COOKIE_HEADER = 'cookie';

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function isNonGet(method: string | undefined): method is string {
  return Boolean(method) && method!.toUpperCase() !== 'GET';
}

function sanitizeHeaderValue(value: string): string {
  return Array.from(value.replace(/[\r\n]+/g, ' '))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 32 || code > 31;
    })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function cloneContext(context: RequestHeaderContext): RequestHeaderContext {
  return {
    ...context,
    url: context.url,
    createdAt: context.createdAt,
    ...(context.cookie ? { cookie: context.cookie } : {}),
    ...(context.referer ? { referer: context.referer } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    requestHeaders: context.requestHeaders.map((header) => ({ ...header })),
  };
}

export function captureRequestHeaderContext(
  input: CaptureRequestHeaderContextInput,
): RequestHeaderContext | null {
  const requestHeaders: RequestHeader[] = [];
  let cookie: string | undefined;
  let userAgent: string | undefined;
  let referer: string | undefined;

  for (const header of input.requestHeaders ?? []) {
    if (!header.name || header.value == null) continue;

    const normalizedName = header.name.trim().toLowerCase();

    const value = sanitizeHeaderValue(header.value);
    if (!value) continue;

    if (normalizedName === COOKIE_HEADER) {
      cookie = value;
      continue;
    }

    if (normalizedName === USER_AGENT_HEADER) {
      userAgent = value;
      continue;
    }

    if (normalizedName === REFERER_HEADER) {
      referer = value;
      continue;
    }

    const canonicalName = CANONICAL_REQUEST_HEADERS.get(normalizedName);
    if (!canonicalName) continue;

    requestHeaders.push({ name: canonicalName, value });
  }

  if (!input.method && !cookie && !userAgent && !referer && requestHeaders.length === 0) {
    return null;
  }

  return {
    url: input.url,
    method: input.method,
    cookieStoreId: input.cookieStoreId,
    tabId: input.tabId,
    frameId: input.frameId,
    documentId: input.documentId,
    createdAt: input.now ?? Date.now(),
    ...(cookie ? { cookie } : {}),
    ...(referer ? { referer } : {}),
    ...(userAgent ? { userAgent } : {}),
    requestHeaders,
  };
}

export class RequestHeaderContextStore {
  private readonly byUrl = new Map<string, RequestHeaderContext>();
  private readonly requests = new Map<
    string,
    { url: string; method?: string; createdAt: number }
  >();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  remember(context: RequestHeaderContext, requestId?: string): void {
    this.prune();
    if (requestId) {
      const first = this.requests.get(requestId);
      context = {
        ...context,
        originalUrl: first?.url ?? context.url,
        originalMethod: first ? first.method : context.method,
      };
      this.requests.set(requestId, {
        url: context.originalUrl!,
        method: context.originalMethod,
        createdAt: context.createdAt,
      });
      while (this.requests.size > this.maxEntries)
        this.requests.delete(this.requests.keys().next().value!);
    }
    const key = JSON.stringify([
      canonicalUrl(context.url),
      context.tabId,
      context.frameId,
      context.documentId,
    ]);
    this.byUrl.set(key, cloneContext(context));
    this.evictOverflow();
  }

  match(input: { url: string; finalUrl?: string }): RequestHeaderMatchResult {
    return this.findMatch(input, true);
  }

  peek(input: { url: string; finalUrl?: string }): RequestHeaderMatchResult {
    return this.findMatch(input, false);
  }

  /**
   * The request a browser download started with, and its headers. The
   * browser's own URL wins over a possibly incomplete redirect trace, except
   * that Chromium names the page itself when the page leaves with
   * location.replace(): a final request that was never redirected started the
   * download (#711).
   */
  download(item: { url: string; finalUrl?: string }): RequestHeaderMatchResult {
    const landed = item.finalUrl || item.url;
    const final = this.peek({ url: landed });
    const fetched = final.context;
    // A form POST answered with a redirect that the browser followed with a
    // GET: the GET serves the file and can be repeated, while the POST cannot
    // without its body (#110, #117). A 307 or 308 keeps the POST and stays in
    // the browser.
    if (
      fetched?.originalUrl &&
      canonicalUrl(fetched.originalUrl) !== canonicalUrl(fetched.url) &&
      isNonGet(fetched.originalMethod) &&
      fetched.method?.toUpperCase() === 'GET'
    ) {
      return { ...final, originalUrl: landed };
    }
    let originalUrl = fetched?.originalUrl ?? item.url;
    if (item.finalUrl && item.url !== item.finalUrl) {
      const direct =
        fetched?.originalUrl !== undefined &&
        canonicalUrl(fetched.originalUrl) === canonicalUrl(fetched.url);
      originalUrl = direct ? item.finalUrl : item.url;
    }
    return { ...this.peek({ url: originalUrl }), originalUrl };
  }

  private findMatch(
    input: { url: string; finalUrl?: string },
    consume: boolean,
  ): RequestHeaderMatchResult {
    const now = this.now();
    const candidates: Array<{ url: string; source: RequestHeaderMatchSource }> = [];
    if (input.finalUrl) candidates.push({ url: input.finalUrl, source: 'finalUrl' });
    candidates.push({ url: input.url, source: 'url' });
    const seen = new Set<string>();
    let sawExpiredCandidate = false;

    for (const { url, source } of candidates) {
      const key = canonicalUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);

      const matches = [...this.byUrl.entries()].filter(
        ([, context]) => canonicalUrl(context.url) === key,
      );
      const fresh = matches.filter(([entryKey, context]) => {
        if (context.createdAt >= now - this.ttlMs) return true;
        this.byUrl.delete(entryKey);
        sawExpiredCandidate = true;
        return false;
      });
      if (fresh.length > 1) {
        // The credentials cannot be told apart, but a candidate that was not
        // a GET is reason enough to leave the download to the browser.
        const method = fresh.map(([, context]) => context.method).find(isNonGet);
        return { matched: false, reason: 'ambiguous', ...(method ? { method } : {}) };
      }
      const match = fresh[0];
      if (!match) continue;
      const [entryKey, context] = match;
      if (consume) this.byUrl.delete(entryKey);
      return {
        matched: true,
        reason: 'matched',
        ...(context.method ? { method: context.method } : {}),
        context: cloneContext(context),
        source,
      };
    }

    this.prune(now);
    return { matched: false, reason: sawExpiredCandidate ? 'expired' : 'not-found' };
  }

  private prune(now: number = this.now()): void {
    const cutoff = now - this.ttlMs;
    for (const [id, request] of this.requests)
      if (request.createdAt < cutoff) this.requests.delete(id);
    for (const [url, context] of this.byUrl) {
      if (context.createdAt < cutoff) {
        this.byUrl.delete(url);
      }
    }
  }

  clear(tabId?: number): void {
    if (tabId === undefined) this.requests.clear();
    for (const [key, context] of this.byUrl) {
      if (tabId === undefined || context.tabId === tabId) this.byUrl.delete(key);
    }
  }

  private evictOverflow(): void {
    while (this.byUrl.size > this.maxEntries) {
      let oldestUrl: string | undefined;
      let oldestTs = Number.POSITIVE_INFINITY;
      for (const [url, context] of this.byUrl) {
        if (context.createdAt < oldestTs) {
          oldestTs = context.createdAt;
          oldestUrl = url;
        }
      }
      if (!oldestUrl) return;
      this.byUrl.delete(oldestUrl);
    }
  }
}
