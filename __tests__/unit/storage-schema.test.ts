import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONNECTION_CONFIG,
  DEFAULT_DIAGNOSTIC_SETTINGS,
  DEFAULT_DOWNLOAD_SETTINGS,
  DEFAULT_UI_PREFS,
  parseConnectionConfig,
  parseDesktopMemory,
  parseDiagnosticSettings,
  parseDiagnosticEvents,
  parseDownloadSettings,
  parseSiteRules,
  parseSnapshot,
  parseUiPrefs,
} from '@/lib/schema';

describe('persisted schema repair', () => {
  it('repairs invalid connection fields independently and strips extras', () => {
    expect(parseConnectionConfig(null)).toEqual(DEFAULT_CONNECTION_CONFIG);
    expect(parseConnectionConfig({ port: 9000, secret: 42, extra: true })).toEqual({
      port: 9000,
      secret: '',
    });
    expect(parseConnectionConfig({ port: 1, secret: 'kept' })).toEqual({
      port: DEFAULT_CONNECTION_CONFIG.port,
      secret: 'kept',
    });
  });

  it('defaults settings while preserving valid siblings of corrupt fields', () => {
    expect(parseDownloadSettings(undefined)).toEqual(DEFAULT_DOWNLOAD_SETTINGS);
    const repaired = parseDownloadSettings({
      enabled: false,
      forwardCookies: 'invalid',
      desktopUnavailable: { action: 'browser', startupTimeoutSeconds: 999 },
      interceptionScope: { magnet: false },
    });
    expect(repaired).toMatchObject({
      enabled: false,
      forwardCookies: true,
      desktopUnavailable: { action: 'browser', startupTimeoutSeconds: 15, openLink: false },
      interceptionScope: {
        browserDownloads: true,
        magnet: false,
        ed2k: true,
        thunder: true,
        incognito: false,
        otherExtensions: false,
      },
    });
  });

  it('remembers only a desktop it can describe', () => {
    const empty = { desktop: null, linkSuggested: false, noticeDismissed: null };
    expect(parseDesktopMemory(undefined)).toEqual(empty);
    const desktop = { product: 'motrix-next', version: '3.9.9', protocol: 1 };
    expect(
      parseDesktopMemory({ desktop, linkSuggested: true, noticeDismissed: 'Motrix Next 3.9.9' }),
    ).toEqual({ desktop, linkSuggested: true, noticeDismissed: 'Motrix Next 3.9.9' });
    expect(
      parseDesktopMemory({
        desktop: { ...desktop, protocol: 4 },
        linkSuggested: 'yes',
        noticeDismissed: 7,
      }),
    ).toEqual(empty);
  });

  it('normalizes persisted extension rules', () => {
    expect(
      parseDownloadSettings({
        fileExtensionRule: {
          enabled: true,
          extensions: [' .JPG ', 'tar.gz', 'jpg', 'bad/path'],
          listedAction: 'skip',
          unknownAction: 'intercept',
        },
      }).fileExtensionRule.extensions,
    ).toEqual(['jpg', 'tar.gz']);
  });

  it('keeps only structurally valid site rules', () => {
    expect(
      parseSiteRules([
        { id: 'valid', pattern: '*.example.com', action: 'always-skip', extra: true },
        { id: 'bad-action', pattern: '*', action: 'block' },
        { pattern: '*', action: 'always-skip' },
      ]),
    ).toEqual([{ id: 'valid', pattern: '*.example.com', action: 'always-skip' }]);
    expect(parseSiteRules('invalid')).toEqual([]);
  });

  it('repairs UI preferences without discarding valid values', () => {
    expect(parseUiPrefs(null)).toEqual(DEFAULT_UI_PREFS);
    expect(parseUiPrefs({ theme: 'dark', colorScheme: 1, locale: 'zh_CN' })).toEqual({
      theme: 'dark',
      colorScheme: 'rayburst',
      locale: 'zh_CN',
    });
  });

  it('repairs the diagnostic event limit', () => {
    expect(parseDiagnosticSettings(null)).toEqual(DEFAULT_DIAGNOSTIC_SETTINGS);
    expect(parseDiagnosticSettings({ maxEvents: 250 })).toEqual({ maxEvents: 250 });
    expect(parseDiagnosticSettings({ maxEvents: 9 })).toEqual(DEFAULT_DIAGNOSTIC_SETTINGS);
    expect(parseDiagnosticSettings({ maxEvents: 501 })).toEqual(DEFAULT_DIAGNOSTIC_SETTINGS);
  });

  it('builds a complete settings snapshot from partial or corrupt storage', () => {
    expect(parseSnapshot(null)).toEqual({
      connection: DEFAULT_CONNECTION_CONFIG,
      settings: DEFAULT_DOWNLOAD_SETTINGS,
      siteRules: [],
      uiPrefs: DEFAULT_UI_PREFS,
      diagnostics: DEFAULT_DIAGNOSTIC_SETTINGS,
    });
    expect(
      parseSnapshot({ connection: { port: 9000 }, settings: { enabled: false }, unknown: true }),
    ).toMatchObject({ connection: { port: 9000, secret: '' }, settings: { enabled: false } });
  });

  it('drops obsolete and oversized diagnostic events', () => {
    expect(
      parseDiagnosticEvents([
        { id: 'old', ts: 1, level: 'info', code: 'config_loaded', message: 'Old event' },
        {
          id: 'large',
          ts: 2,
          level: 'error',
          code: 'desktop_activation_failed',
          message: 'x'.repeat(241),
        },
      ]),
    ).toEqual([]);
  });
});
