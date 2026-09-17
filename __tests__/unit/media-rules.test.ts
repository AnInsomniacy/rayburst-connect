import { describe, expect, it } from 'vitest';
import { matchMediaRule } from '@/lib/media/rules';
import { parseDownloadSettings } from '@/lib/schema';

describe('media classification rules', () => {
  it('matches MIME and extension without changing signed URLs', () => {
    const rules = parseDownloadSettings({
      mediaDiscovery: {
        rules: [
          { field: 'mime', pattern: 'mpegurl', kind: 'hls', enabled: true },
          { field: 'extension', pattern: '^bin$', kind: 'file', minimumBytes: 10, enabled: true },
        ],
      },
    }).mediaDiscovery.rules;
    const url = 'https://example.com/file.bin?signature=a%2Fb';
    expect(matchMediaRule(rules, { url, mime: 'application/x-mpegurl' })).toBe('hls');
    expect(matchMediaRule(rules, { url, size: 10 })).toBe('file');
    expect(matchMediaRule(rules, { url, size: null })).toBeUndefined();
  });
  it('skips invalid and disabled expressions without hiding later matches', () => {
    const rules = parseDownloadSettings({
      mediaDiscovery: {
        rules: [
          { pattern: '[', kind: 'ignore', enabled: true },
          { pattern: '.', kind: 'ignore', enabled: false },
          { pattern: 'manifest', kind: 'dash', enabled: true },
        ],
      },
    }).mediaDiscovery.rules;
    expect(matchMediaRule(rules, { url: 'https://example.com/manifest' })).toBe('dash');
  });
});
