import { describe, expect, it } from 'vitest';
import {
  createFilterPipeline,
  evaluateFilterPipeline,
  type FilterContext,
} from '@/lib/download/filter';
import { DEFAULT_DOWNLOAD_SETTINGS, type DownloadSettings, type SiteRule } from '@/lib/schema';

function context(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    url: 'https://example.com/file.zip',
    finalUrl: 'https://example.com/file.zip',
    filename: 'file.zip',
    fileSize: 10 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024,
    mimeType: 'application/zip',
    tabUrl: 'https://example.com/page',
    ...overrides,
  };
}

function settings(patch: Partial<DownloadSettings> = {}): DownloadSettings {
  return { ...structuredClone(DEFAULT_DOWNLOAD_SETTINGS), ...patch };
}

function evaluate(candidate: FilterContext, config = settings(), rules: SiteRule[] = []) {
  return evaluateFilterPipeline(
    candidate,
    config,
    createFilterPipeline(() => rules, undefined, 'rayburst-connect'),
  );
}

function scope(patch: Partial<DownloadSettings['interceptionScope']>): DownloadSettings {
  return settings({
    interceptionScope: { ...DEFAULT_DOWNLOAD_SETTINGS.interceptionScope, ...patch },
  });
}

describe('download filter pipeline', () => {
  it('applies the ordered safety gates', () => {
    const cases: Array<[FilterContext, DownloadSettings, string]> = [
      [context(), settings({ enabled: false }), 'enabled'],
      [context({ byExtensionId: 'another-extension' }), settings(), 'extension-trigger'],
      [
        context(),
        settings({
          interceptionScope: {
            ...DEFAULT_DOWNLOAD_SETTINGS.interceptionScope,
            browserDownloads: false,
          },
        }),
        'interception-scope',
      ],
      [context({ url: 'blob:https://example.com/id' }), settings(), 'scheme'],
      [context({ mimeType: 'Text/HTML; charset=utf-8' }), settings(), 'browser-ownership'],
    ];

    for (const [candidate, config, stageName] of cases) {
      expect(evaluate(candidate, config)).toEqual({ verdict: 'skip', stageName });
    }
    expect(evaluate(context())).toEqual({ verdict: 'intercept', stageName: null });
  });

  it('takes private-window and other-extension downloads only when enabled', () => {
    expect(evaluate(context({ incognito: true }), scope({ incognito: true }))).toEqual({
      verdict: 'intercept',
      stageName: null,
    });
    const foreign = context({ byExtensionId: 'another-extension' });
    expect(evaluate(foreign, scope({ otherExtensions: true }))).toEqual({
      verdict: 'intercept',
      stageName: null,
    });
    for (const own of [
      context({ byExtensionId: 'rayburst-connect' }),
      context({ byExtensionId: 'rayburst-connect', incognito: true }),
    ]) {
      expect(evaluate(own, scope({ incognito: true, otherExtensions: true }))).toEqual({
        verdict: 'skip',
        stageName: 'extension-trigger',
      });
    }
    expect(
      evaluateFilterPipeline(
        foreign,
        scope({ otherExtensions: true }),
        createFilterPipeline(() => []),
      ),
    ).toEqual({ verdict: 'skip', stageName: 'extension-trigger' });
  });

  it('matches site rules against page, request, and redirected hosts', () => {
    const skipRules: SiteRule[] = [
      { id: 'skip', pattern: '*.blocked.example', action: 'always-skip' },
    ];
    for (const candidate of [
      context({ tabUrl: 'https://page.blocked.example/item' }),
      context({ url: 'https://request.blocked.example/file' }),
      context({ finalUrl: 'https://redirect.blocked.example/file' }),
    ]) {
      expect(evaluate(candidate, settings(), skipRules)).toEqual({
        verdict: 'skip',
        stageName: 'site-rule',
      });
    }

    const forceRules: SiteRule[] = [
      { id: 'force', pattern: 'example.com', action: 'always-intercept' },
    ];
    expect(evaluate(context(), settings(), forceRules)).toEqual({
      verdict: 'intercept',
      stageName: 'site-rule',
    });
    for (const candidate of [
      context({ mimeType: 'text/html' }),
      context({ filename: 'saved-page.html', mimeType: '' }),
      context({ requestMethod: 'POST' }),
      context({ incognito: true }),
    ]) {
      expect(evaluate(candidate, settings(), forceRules)).toEqual({
        verdict: 'skip',
        stageName: 'browser-ownership',
      });
    }
  });

  it('applies listed, compound, unknown, and unlisted extension behavior', () => {
    const config = settings({
      fileExtensionRule: {
        enabled: true,
        extensions: ['jpg', 'tar.gz'],
        listedAction: 'skip',
        unknownAction: 'skip',
      },
    });

    for (const filename of ['photo.JPG', 'archive.tar.gz']) {
      expect(evaluate(context({ filename }), config).stageName).toBe('file-extension-rule');
    }
    expect(
      evaluate(
        context({ url: 'https://example.com/download', finalUrl: '', filename: 'download' }),
        config,
      ).stageName,
    ).toBe('file-extension-rule');
    expect(evaluate(context({ filename: 'video.mp4' }), config)).toEqual({
      verdict: 'intercept',
      stageName: null,
    });
  });

  it('handles known and unknown minimum sizes without blocking torrent descriptors', () => {
    const config = settings({
      minimumFileSize: { enabled: true, sizeMb: 5, unknownSizeAction: 'skip' },
    });

    expect(evaluate(context({ totalBytes: 1024, fileSize: 1024 }), config).stageName).toBe(
      'minimum-file-size',
    );
    expect(evaluate(context({ totalBytes: -1, fileSize: -1 }), config).stageName).toBe(
      'minimum-file-size',
    );
    for (const torrent of [
      context({ mimeType: 'application/x-bittorrent', totalBytes: 1024, fileSize: 1024 }),
      context({ finalUrl: 'https://example.com/linux.torrent', totalBytes: 1024, fileSize: 1024 }),
    ]) {
      expect(evaluate(torrent, config)).toEqual({ verdict: 'intercept', stageName: null });
    }
  });
});

it('normalizes pasted website rules and recognizes unnamed torrent responses', () => {
  expect(
    evaluate(context(), settings(), [
      { id: 'site', pattern: 'https://example.com/', action: 'always-skip' },
    ]).verdict,
  ).toBe('skip');
  const config = settings({
    fileExtensionRule: {
      enabled: true,
      extensions: ['torrent'],
      listedAction: 'skip',
      unknownAction: 'intercept',
    },
  });
  expect(
    evaluate(
      context({
        url: 'https://cdn.test/download',
        finalUrl: 'https://cdn.test/download',
        filename: '',
        mimeType: 'application/x-bittorrent',
      }),
      config,
    ).verdict,
  ).toBe('skip');
});
