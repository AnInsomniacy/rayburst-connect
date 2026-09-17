import { describe, expect, it } from 'vitest';
import { selectMedia, mediaSiteAllowed, matchesSize, testMediaRegex } from '@/lib/media/rules';
import { parseMediaSettings, MediaRegexRuleSchema, MediaSizeRuleSchema } from '@/lib/schema';

const network = (url: string, mime?: string) => ({ url, mime, evidence: 'network' as const });
describe('media capture policy', () => {
  it('excludes TS and subtitles without suppressing M4S, AAC or playlists', () => {
    const settings = parseMediaSettings({});
    expect(selectMedia(network('https://cdn.test/a.ts', 'video/mp2t'), settings)).toBeNull();
    expect(selectMedia(network('https://cdn.test/a.vtt', 'text/vtt'), settings)).toBeNull();
    expect(selectMedia(network('https://cdn.test/a.m4s', 'video/mp4'), settings)?.kind).toBe(
      'fragment',
    );
    expect(selectMedia(network('https://cdn.test/a.aac', 'audio/aac'), settings)?.kind).toBe(
      'file',
    );
    expect(
      selectMedia(network('https://cdn.test/playlist', 'application/vnd.apple.mpegurl'), settings)
        ?.kind,
    ).toBe('hls');
    expect(selectMedia(network('https://cdn.test/image.png', 'image/png'), settings)).toBeNull();
  });
  it('honors an explicit extension disable before a broad MIME match on every discovery path', () => {
    const settings = parseMediaSettings({});
    settings.extensions.find((item) => item.value === 'mp4')!.enabled = false;
    for (const evidence of ['network', 'resource', 'element', 'script'] as const) {
      expect(
        selectMedia(
          { ...network('https://cdn.test/a.mp4', 'video/mp4'), evidence, elementType: 'video' },
          settings,
        ),
      ).toBeNull();
    }
    settings.extensions.find((item) => item.value === 'ts')!.enabled = true;
    expect(selectMedia(network('https://cdn.test/a.ts', 'video/mp2t'), settings)?.kind).toBe(
      'fragment',
    );
  });
  it('supports native comparisons and keeps unknown lengths eligible', () => {
    const rule = MediaSizeRuleSchema.parse({ operator: 'between', value: 1, upper: 2, unit: 'KB' });
    expect(matchesSize(rule, 1024)).toBe(true);
    expect(matchesSize(rule, 2048)).toBe(true);
    expect(matchesSize(rule, 2049)).toBe(false);
    expect(matchesSize(rule, null)).toBe(true);
    const settings = parseMediaSettings({});
    settings.extensions.find((item) => item.value === 'mp4')!.size = rule;
    expect(
      selectMedia(
        {
          ...network('https://cdn.test/a.mp4'),
          status: 206,
          length: '1',
          contentRange: 'bytes 0-0/1536',
        },
        settings,
      ),
    ).not.toBeNull();
  });
  it('matches ordered expressions, validates syntax and preserves captured signatures', () => {
    const rule = MediaRegexRuleSchema.parse({
      id: crypto.randomUUID(),
      pattern: 'target=(https://.*)',
      flags: 'i',
      action: 'capture',
      kind: 'dash',
      captureGroup: 1,
    });
    const signed = 'https://cdn.test/stream?sig=a%2fb+%20&x=1&x=2';
    const wrapped = 'https://page.test/embed?target=' + signed;
    expect(testMediaRegex(rule, wrapped)?.url).toBe(signed);
    const settings = parseMediaSettings({ regexRules: [rule] });
    expect(selectMedia(network(wrapped), settings)).toMatchObject({ url: signed, kind: 'dash' });
    settings.regexRules.unshift({
      ...rule,
      id: crypto.randomUUID(),
      pattern: 'embed',
      action: 'ignore',
    });
    expect(selectMedia(network(wrapped), settings)).toBeNull();
    expect(MediaRegexRuleSchema.safeParse({ ...rule, pattern: '[' }).success).toBe(false);
    expect(MediaRegexRuleSchema.safeParse({ ...rule, flags: 'invalid' }).success).toBe(false);
  });
  it('supports hostname and URL scopes with an explicit allow-list mode', () => {
    const settings = parseMediaSettings({
      excludedHosts: ['*.example.com', 'https://video.test/private/**'],
    });
    expect(mediaSiteAllowed(settings, 'https://www.example.com/watch')).toBe(false);
    expect(mediaSiteAllowed(settings, 'https://video.test/private/one')).toBe(false);
    expect(mediaSiteAllowed(settings, 'https://video.test/public/one')).toBe(true);
    settings.siteMode = 'include';
    expect(mediaSiteAllowed(settings, 'https://www.example.com/watch')).toBe(true);
    expect(mediaSiteAllowed(settings, 'https://other.test')).toBe(false);
  });
});
