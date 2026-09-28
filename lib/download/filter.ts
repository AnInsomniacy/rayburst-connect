/**
 * Download interception filter pipeline.
 *
 * Each stage inspects the candidate and returns a terminal verdict
 * ('intercept' | 'skip') or null to defer to the next stage. When every
 * stage defers, the download is intercepted.
 *
 * Order: enabled → self-trigger → scope → scheme → browser-ownership → site-rule →
 * file-extension → minimum-size.
 */
import { matchSiteRule } from '../site-rules';
import type { DownloadSettings, SiteRule } from '@/lib/schema';
import { matchesFileExtension, resolveFileExtension } from '@/lib/file-extensions';
import { extractFilenameFromUrl } from './url';

const INTERCEPTABLE_SCHEMES = ['http:', 'https:'] as const;

export interface FilterContext {
  url: string;
  finalUrl: string;
  filename: string;
  fileSize: number; // -1 = unknown
  totalBytes: number; // -1 = unknown
  mimeType: string;
  tabUrl: string;
  byExtensionId?: string;
  requestMethod?: string;
  incognito?: boolean;
}

type FilterVerdict = 'intercept' | 'skip';

interface FilterStage {
  readonly name: string;
  evaluate: (ctx: FilterContext, config: DownloadSettings) => FilterVerdict | null;
}

interface FilterPipelineResult {
  verdict: FilterVerdict;
  /** Stage that produced the terminal verdict; null when all stages passed. */
  stageName: string | null;
}

// ─── Stage Helpers ──────────────────────────────────────

function baseMime(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase();
}

const TORRENT_MIMES = new Set([
  'application/x-bittorrent',
  'application/x-torrent',
  'application/torrent',
]);

/** MIME types that represent documents rather than downloadable files. */
const DOCUMENT_MIMES = new Set([
  'text/html',
  'text/xml',
  'application/xhtml+xml',
  'application/xml',
  'multipart/related',
]);

function isTorrentDescriptor(ctx: FilterContext): boolean {
  if (TORRENT_MIMES.has(baseMime(ctx.mimeType))) return true;
  return [ctx.filename, extractFilenameFromUrl(ctx.finalUrl), extractFilenameFromUrl(ctx.url)]
    .filter((value): value is string => Boolean(value))
    .some((filename) =>
      filename
        .trim()
        .replace(/^.*[/\\]/, '')
        .toLowerCase()
        .endsWith('.torrent'),
    );
}

// ─── Stages ─────────────────────────────────────────────

const enabled: FilterStage = {
  name: 'enabled',
  evaluate: (_ctx, config) => (config.enabled ? null : 'skip'),
};

/** Skip downloads triggered by another extension (including ourselves). */
const selfTrigger: FilterStage = {
  name: 'self-trigger',
  evaluate: (ctx) => (ctx.byExtensionId ? 'skip' : null),
};

const interceptionScope: FilterStage = {
  name: 'interception-scope',
  evaluate: (_ctx, config) => (config.interceptionScope.browserDownloads ? null : 'skip'),
};

/** Only HTTP and HTTPS downloads can be handed to the maintained engine. */
const scheme: FilterStage = {
  name: 'scheme',
  evaluate: (ctx) => {
    try {
      const protocol = new URL(ctx.url).protocol;
      return (INTERCEPTABLE_SCHEMES as readonly string[]).includes(protocol) ? null : 'skip';
    } catch {
      return 'skip';
    }
  },
};

/** User matching rules cannot make a browser-bound operation replayable. */
const browserOwnership: FilterStage = {
  name: 'browser-ownership',
  evaluate: (ctx) => {
    if (ctx.incognito || (ctx.requestMethod && ctx.requestMethod !== 'GET')) return 'skip';
    if (DOCUMENT_MIMES.has(baseMime(ctx.mimeType))) return 'skip';
    const name = ctx.filename || extractFilenameFromUrl(ctx.finalUrl) || '';
    // Complete-page saves do not expose a reliable public save-mode flag.
    if (/\.(?:html?|xhtml|mhtml?|xml)$/i.test(name)) return 'skip';
    return null;
  },
};

/**
 * Per-site glob rules, matched against the page origin and both download
 * URLs (pre/post redirect). First matching rule wins.
 */
function siteRule(getRules: () => SiteRule[]): FilterStage {
  return {
    name: 'site-rule',
    evaluate: (ctx) => {
      const action = matchSiteRule(getRules(), [ctx.tabUrl, ctx.url, ctx.finalUrl]);
      return action === 'always-intercept' ? 'intercept' : action === 'always-skip' ? 'skip' : null;
    },
  };
}

/**
 * User-defined file extension rule. Metadata-only by design — content
 * sniffing belongs in the desktop app.
 */
const fileExtensionRule: FilterStage = {
  name: 'file-extension-rule',
  evaluate: (ctx, config) => {
    const settings = config.fileExtensionRule;
    if (!settings.enabled) return null;

    const extension = resolveFileExtension([
      ctx.filename,
      extractFilenameFromUrl(ctx.finalUrl),
      extractFilenameFromUrl(ctx.url),
    ]);
    if (!extension) return settings.unknownAction;

    return settings.extensions.some((item) => matchesFileExtension(extension, item))
      ? settings.listedAction
      : null;
  },
};

/**
 * Skip downloads smaller than the configured minimum. Unknown sizes (-1)
 * follow the explicit user preference. Torrent descriptors are always tiny
 * and always pass.
 */
const minimumFileSize: FilterStage = {
  name: 'minimum-file-size',
  evaluate: (ctx, config) => {
    const settings = config.minimumFileSize;
    if (!settings.enabled || settings.sizeMb <= 0) return null;
    if (isTorrentDescriptor(ctx)) return null;

    const knownSize =
      ctx.totalBytes >= 0 ? ctx.totalBytes : ctx.fileSize >= 0 ? ctx.fileSize : null;
    if (knownSize === null) return settings.unknownSizeAction === 'skip' ? 'skip' : null;
    return knownSize < settings.sizeMb * 1024 * 1024 ? 'skip' : null;
  },
};

// ─── Pipeline ───────────────────────────────────────────

export function createFilterPipeline(getRules: () => SiteRule[]): FilterStage[] {
  return [
    enabled,
    selfTrigger,
    interceptionScope,
    scheme,
    browserOwnership,
    siteRule(getRules),
    fileExtensionRule,
    minimumFileSize,
  ];
}

export function evaluateFilterPipeline(
  ctx: FilterContext,
  config: DownloadSettings,
  stages: FilterStage[],
): FilterPipelineResult {
  for (const stage of stages) {
    const verdict = stage.evaluate(ctx, config);
    if (verdict !== null) return { verdict, stageName: stage.name };
  }
  return { verdict: 'intercept', stageName: null };
}
