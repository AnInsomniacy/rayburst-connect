/**
 * Single source of truth for every persisted data structure.
 *
 * Zod schemas define shape, validation, AND defaults. TypeScript types are
 * inferred, default constants are derived by parsing `{}` — nothing is
 * written twice.
 *
 * Every exported parse helper accepts `unknown` and never throws: invalid
 * fields collapse to their defaults, invalid array entries are dropped.
 */
import { z } from 'zod';
import { normalizeFileExtensionList } from './file-extensions';
import { MEDIA_FORMATS, MEDIA_MIMES } from './media/formats';
import {
  MediaProbeRequestSchema,
  MediaInputPlanSchema,
  MediaProbeSchema,
  MediaRequestContextSchema,
  MediaSelectionSchema,
} from './media/contracts';

// MV3 CSP forbids eval/new Function() in extension contexts; use zod's
// interpreted path instead of its JIT compiler.
z.config({ jitless: true });

// ─── Helpers ────────────────────────────────────────────

/** Make an object schema tolerate any garbage input by re-parsing `{}`. */
function lenient<S extends z.ZodType>(schema: S): z.ZodCatch<S> {
  return schema.catch(() => schema.parse({}) as z.output<S>);
}

/** Parse an array keeping only the entries that match `schema`. */
function filteredArray<S extends z.ZodType>(schema: S) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const result = schema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    );
}

// ─── Connection ─────────────────────────────────────────

const ConnectionConfigSchema = lenient(
  z.object({
    port: z.number().int().min(1024).max(65535).catch(29110),
    secret: z.string().catch(''),
  }),
);

export type ConnectionConfig = z.output<typeof ConnectionConfigSchema>;

// ─── Download Settings ──────────────────────────────────

const interceptOrSkip = z.enum(['intercept', 'skip']);

const resourceKind = z.enum(['hls', 'dash', 'file', 'fragment', 'subtitle', 'image', 'json']);
export const MediaSizeRuleSchema = z.object({
  operator: z.enum(['any', '>', '>=', '<', '<=', '=', '!=', 'between']).default('any'),
  value: z.number().finite().nonnegative().default(0),
  upper: z.number().finite().nonnegative().default(0),
  unit: z.enum(['B', 'KB', 'MB', 'GB']).default('KB'),
});
export const MediaTypeRuleSchema = z
  .object({
    value: z.string().trim().toLowerCase().min(1).max(128),
    kind: resourceKind,
    enabled: z.boolean(),
    size: MediaSizeRuleSchema.default(() => MediaSizeRuleSchema.parse({})),
  })
  .superRefine((rule, ctx) => {
    if (
      !/^(?:[a-z0-9][a-z0-9_+-]*|[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*))$/.test(rule.value)
    )
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid extension or MIME type' });
    if (rule.size.operator === 'between' && rule.size.upper < rule.size.value)
      ctx.addIssue({ code: 'custom', path: ['size', 'upper'], message: 'Invalid size range' });
  });
export const MediaRegexRuleSchema = z
  .object({
    id: z.uuid(),
    pattern: z.string().min(1).max(512),
    flags: z.string().max(6).default('i'),
    action: z.enum(['capture', 'ignore']),
    kind: resourceKind.default('file'),
    captureGroup: z.number().int().min(0).max(32).default(0),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    try {
      new RegExp(rule.pattern, rule.flags);
    } catch {
      ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Invalid regular expression' });
    }
  });
export const MediaSettingsSchema = lenient(
  z.object({
    enabled: z.boolean().catch(true),
    extensions: z
      .array(MediaTypeRuleSchema)
      .max(200)
      .refine(
        (rules) =>
          rules.every((rule) => !rule.value.includes('/')) &&
          new Set(rules.map((rule) => rule.value)).size === rules.length,
      )
      .catch(() =>
        MEDIA_FORMATS.map(({ extension, kind, enabled }) =>
          MediaTypeRuleSchema.parse({ value: extension, kind, enabled }),
        ),
      ),
    mimeTypes: z
      .array(MediaTypeRuleSchema)
      .max(100)
      .refine(
        (rules) =>
          rules.every((rule) => rule.value.includes('/')) &&
          new Set(rules.map((rule) => rule.value)).size === rules.length,
      )
      .catch(() =>
        MEDIA_MIMES.map(({ mime, kind, enabled }) =>
          MediaTypeRuleSchema.parse({ value: mime, kind, enabled }),
        ),
      ),
    regexRules: z.array(MediaRegexRuleSchema).max(100).catch([]),
    excludedHosts: z.array(z.string().trim().min(1).max(512)).max(100).catch([]),
    siteMode: z.enum(['exclude', 'include']).catch('exclude'),
    preserveOnNavigation: z.boolean().catch(false),
    alwaysDeepSearch: z.boolean().catch(false),
    quickDownload: z.boolean().catch(true),
    newestFirst: z.boolean().catch(false),
  }),
);
export type MediaSettings = z.output<typeof MediaSettingsSchema>;
export type MediaTypeRule = z.output<typeof MediaTypeRuleSchema>;
export type MediaRegexRule = z.output<typeof MediaRegexRuleSchema>;
export const parseMediaSettings = (input: unknown): MediaSettings =>
  MediaSettingsSchema.parse(input);

const DownloadSettingsSchema = lenient(
  z.object({
    enabled: z.boolean().catch(true),
    mediaDiscovery: MediaSettingsSchema,
    hideDownloadBar: z.boolean().catch(false),
    desktopUnavailable: lenient(
      z.object({
        action: z.enum(['launch', 'browser']).catch('launch'),
        startupTimeoutSeconds: z.number().int().min(1).max(60).catch(15),
      }),
    ),
    forwardRequestHeaders: z.boolean().catch(true),
    forwardCookies: z.boolean().catch(true),
    duplicateGuard: lenient(
      z.object({
        enabled: z.boolean().catch(true),
        windowSeconds: z.number().int().min(1).max(300).catch(10),
      }),
    ),
    minimumFileSize: lenient(
      z.object({
        enabled: z.boolean().catch(false),
        sizeMb: z.number().min(0).catch(5),
        unknownSizeAction: interceptOrSkip.catch('intercept'),
      }),
    ),
    fileExtensionRule: lenient(
      z.object({
        enabled: z.boolean().catch(false),
        extensions: z.array(z.string()).transform(normalizeFileExtensionList).catch([]),
        listedAction: interceptOrSkip.catch('skip'),
        unknownAction: interceptOrSkip.catch('intercept'),
      }),
    ),
    interceptionScope: lenient(
      z.object({
        browserDownloads: z.boolean().catch(true),
        magnet: z.boolean().catch(true),
        ed2k: z.boolean().catch(true),
        thunder: z.boolean().catch(true),
      }),
    ),
  }),
);

export type DownloadSettings = z.output<typeof DownloadSettingsSchema>;
export type DesktopUnavailableSettings = DownloadSettings['desktopUnavailable'];
export type DesktopUnavailableAction = DesktopUnavailableSettings['action'];
export type DuplicateDownloadGuardSettings = DownloadSettings['duplicateGuard'];
export type MinimumFileSizeSettings = DownloadSettings['minimumFileSize'];
export type FileExtensionRuleSettings = DownloadSettings['fileExtensionRule'];
export type FileExtensionRuleAction = FileExtensionRuleSettings['listedAction'];
export type InterceptionScope = DownloadSettings['interceptionScope'];

// ─── Site Rules ─────────────────────────────────────────

const SiteRuleSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  action: z.enum(['always-intercept', 'always-skip', 'use-global']),
});

export type SiteRule = z.output<typeof SiteRuleSchema>;

const SiteRulesSchema = filteredArray(SiteRuleSchema);

// ─── UI Preferences ─────────────────────────────────────

const UiPrefsSchema = lenient(
  z.object({
    theme: z.enum(['system', 'light', 'dark']).catch('system'),
    colorScheme: z
      .enum([
        'rayburst',
        'amber',
        'space',
        'mint',
        'rose',
        'coral',
        'glacier',
        'evergreen',
        'graphite',
        'sakura',
      ])
      .catch('rayburst'),
    locale: z.string().catch('auto'),
  }),
);

export type UiPrefs = z.output<typeof UiPrefsSchema>;
export type ThemePreference = UiPrefs['theme'];

// ─── Diagnostics ────────────────────────────────────────

export const DIAGNOSTIC_EVENT_LIMIT_MIN = 10;
export const DIAGNOSTIC_EVENT_LIMIT_MAX = 500;

const DiagnosticSettingsSchema = lenient(
  z.object({
    maxEvents: z
      .number()
      .int()
      .min(DIAGNOSTIC_EVENT_LIMIT_MIN)
      .max(DIAGNOSTIC_EVENT_LIMIT_MAX)
      .catch(100),
  }),
);

export type DiagnosticSettings = z.output<typeof DiagnosticSettingsSchema>;

export const DIAGNOSTIC_MESSAGE_MAX_LENGTH = 240;
export const DIAGNOSTIC_CONTEXT_KEY_MAX_LENGTH = 64;
export const DIAGNOSTIC_CONTEXT_VALUE_MAX_LENGTH = 512;
export const DIAGNOSTIC_CONTEXT_MAX_FIELDS = 12;

const DiagnosticCodeSchema = z.enum([
  'api_auth_failed',
  'api_unreachable',
  'download_delegated',
  'download_skipped',
  'download_restored_to_browser',
  'download_restore_failed',
  'download_delivery_failed',
  'download_duplicate_blocked',
  'download_cancel_failed',
  'download_handler_failed',
  'media_discovery_failed',
  'firefox_interception_failed',
  'desktop_activation_failed',
  'cookie_collect_failed',
  'permission_granted',
  'permission_revoked',
  'permission_check_failed',
  'extension_installed',
  'extension_updated',
  'config_load_failed',
  'download_bar_failed',
  'notification_failed',
  'context_menu_failed',
]);

export type DiagnosticCode = z.output<typeof DiagnosticCodeSchema>;

const DiagnosticContextValueSchema = z.union([
  z.string().max(DIAGNOSTIC_CONTEXT_VALUE_MAX_LENGTH),
  z.number().finite(),
  z.boolean(),
]);

const DiagnosticEventSchema = z.strictObject({
  id: z.string().min(1).max(96),
  ts: z.number().finite().nonnegative(),
  level: z.enum(['info', 'warn', 'error']),
  code: DiagnosticCodeSchema,
  message: z.string().min(1).max(DIAGNOSTIC_MESSAGE_MAX_LENGTH),
  context: z
    .record(z.string().min(1).max(DIAGNOSTIC_CONTEXT_KEY_MAX_LENGTH), DiagnosticContextValueSchema)
    .refine((value) => Object.keys(value).length <= DIAGNOSTIC_CONTEXT_MAX_FIELDS)
    .optional(),
});

export type DiagnosticEvent = z.output<typeof DiagnosticEventSchema>;
export type DiagnosticLevel = DiagnosticEvent['level'];

const DiagnosticEventsSchema = filteredArray(DiagnosticEventSchema);

// ─── Composite Snapshot ─────────────────────────────────

const StorageSnapshotSchema = lenient(
  z.object({
    connection: ConnectionConfigSchema,
    settings: DownloadSettingsSchema,
    siteRules: SiteRulesSchema,
    uiPrefs: UiPrefsSchema,
    diagnostics: DiagnosticSettingsSchema,
  }),
);

export type StorageSnapshot = z.output<typeof StorageSnapshotSchema>;

export const SETTINGS_BACKUP_KIND = 'rayburst-connect-settings';

export const SettingsBackupSchema = z.strictObject({
  kind: z.literal(SETTINGS_BACKUP_KIND),
  schemaVersion: z.literal(4),
  extensionVersion: z.string().min(1),
  exportedAt: z.iso.datetime(),
  settings: StorageSnapshotSchema.unwrap().extend({
    connection: ConnectionConfigSchema.unwrap().extend({ secret: z.string() }),
  }),
});

// ─── Defaults (derived, never hand-written) ─────────────

export const DEFAULT_CONNECTION_CONFIG: Readonly<ConnectionConfig> = ConnectionConfigSchema.parse(
  {},
);
export const DEFAULT_DOWNLOAD_SETTINGS: Readonly<DownloadSettings> = DownloadSettingsSchema.parse(
  {},
);
export const DEFAULT_UI_PREFS: Readonly<UiPrefs> = UiPrefsSchema.parse({});
export const DEFAULT_DIAGNOSTIC_SETTINGS: Readonly<DiagnosticSettings> =
  DiagnosticSettingsSchema.parse({});

/** Build a fresh, fully-defaulted mutable snapshot. */
export function createDefaultSnapshot(): StorageSnapshot {
  return StorageSnapshotSchema.parse({});
}

// ─── Parse Helpers ──────────────────────────────────────

export const parseConnectionConfig = (input: unknown): ConnectionConfig =>
  ConnectionConfigSchema.parse(input);
export const parseDownloadSettings = (input: unknown): DownloadSettings =>
  DownloadSettingsSchema.parse(input);
export const parseSiteRules = (input: unknown): SiteRule[] => SiteRulesSchema.parse(input);
export const parseUiPrefs = (input: unknown): UiPrefs => UiPrefsSchema.parse(input);
export const parseDiagnosticSettings = (input: unknown): DiagnosticSettings =>
  DiagnosticSettingsSchema.parse(input);
export const parseDiagnosticEvents = (input: unknown): DiagnosticEvent[] =>
  DiagnosticEventsSchema.parse(input);
export const parseSnapshot = (input: unknown): StorageSnapshot =>
  StorageSnapshotSchema.parse(input);

// Media URLs and credentials are session data, never settings or backup data.
export const MEDIA_SESSION_KEY = 'mediaSession';
export const MEDIA_MAX_CANDIDATES = 2048;
export const MEDIA_MAX_PER_TAB = 1000;
export const MEDIA_RETENTION_MS = 30 * 60_000;
export const MediaCapturedContextSchema = MediaRequestContextSchema.extend({
  capturedAt: z.number().int().nonnegative(),
});
export type MediaCapturedContext = z.infer<typeof MediaCapturedContextSchema>;
export const MediaCandidateSchema = z.strictObject({
  id: z.uuid(),
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  documentId: z.string().max(512),
  frameUrl: z.string().max(16_384),
  pageUrl: z.string().max(16_384),
  url: z.string().max(16_384),
  kind: z.enum([
    'file',
    'hls',
    'dash',
    'embedded',
    'fragment',
    'subtitle',
    'image',
    'json',
    'collection',
  ]),
  title: z.string().max(512),
  filename: z.string().max(255),
  mime: z.string().max(128),
  size: z.number().int().nonnegative().nullable(),
  method: z.string().max(16),
  evidence: z.enum(['network', 'element', 'resource', 'script', 'capture']),
  input: MediaInputPlanSchema.optional(),
  variant: z.string().max(64).optional(),
  firstSeen: z.number().nonnegative(),
  lastSeen: z.number().nonnegative(),
  context: MediaCapturedContextSchema.optional(),
  sentToDesktop: z.boolean().optional(),
  downloadError: z.string().max(128).optional(),
});
export const MediaOperationSchema = z.strictObject({
  candidateId: z.uuid(),
  connectionKey: z.string().max(128),
  request: MediaProbeRequestSchema,
  createdAt: z.number().nonnegative(),
  state: z.enum([
    'probing',
    'ready',
    'submitting',
    'submitted',
    'cancelling',
    'cancelled',
    'failed',
  ]),
  probe: MediaProbeSchema.optional(),
  submissionId: z.uuid().optional(),
  selection: MediaSelectionSchema.optional(),
  gid: z.string().max(128).optional(),
  error: z.string().max(64).optional(),
});
export const MediaScopedContextSchema = MediaCapturedContextSchema.extend({
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  documentId: z.string().max(512),
  frameUrl: z.string().max(16_384),
  pageUrl: z.string().max(16_384),
});
export const MediaKeySchema = z.strictObject({
  tabId: z.number().int(),
  frameId: z.number().int(),
  key: z.string().regex(/^[a-f0-9]{32}$/i),
  url: z.string().max(16384),
  capturedAt: z.number(),
});
export const MediaSessionSchema = z.strictObject({
  keys: z.array(MediaKeySchema).max(256).default([]),
  candidates: z.array(MediaCandidateSchema).max(MEDIA_MAX_CANDIDATES),
  operations: z.array(MediaOperationSchema).max(MEDIA_MAX_CANDIDATES),
  contexts: z.array(MediaScopedContextSchema).max(128),
});
export type MediaCandidate = z.infer<typeof MediaCandidateSchema>;
export type MediaOperation = z.infer<typeof MediaOperationSchema>;
export type MediaSession = z.infer<typeof MediaSessionSchema>;
export type MediaScopedContext = z.infer<typeof MediaScopedContextSchema>;
