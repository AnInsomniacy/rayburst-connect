import { describe, expect, it } from 'vitest';
import { BrowserBypass, BYPASS_WINDOW_MS, parseBypassMessage } from '@/lib/download/bypass';
import { createFilterPipeline, evaluateFilterPipeline } from '@/lib/download/filter';
import { DEFAULT_DOWNLOAD_SETTINGS } from '@/lib/schema';

describe('Alt-click bypass', () => {
  it('matches the clicked link, or any download after a click elsewhere, within the window', () => {
    let now = 1000;
    const bypass = new BrowserBypass(() => now);
    bypass.add('https://example.com/a.zip');
    expect(bypass.matches(['https://example.com/a.zip'])).toBe(true);
    expect(bypass.matches(['https://example.com/b.zip'])).toBe(false);
    bypass.add('');
    expect(bypass.matches(['https://example.com/b.zip'])).toBe(true);
    now += BYPASS_WINDOW_MS;
    expect(bypass.matches(['https://example.com/a.zip'])).toBe(false);
  });

  it('accepts only http(s) links or an empty link from content scripts', () => {
    expect(parseBypassMessage({ type: 'BYPASS_DOWNLOAD', url: 'https://x.test/f' })).toBe(
      'https://x.test/f',
    );
    expect(parseBypassMessage({ type: 'BYPASS_DOWNLOAD', url: '' })).toBe('');
    expect(parseBypassMessage({ type: 'BYPASS_DOWNLOAD', url: 'javascript:alert(1)' })).toBeNull();
    expect(parseBypassMessage({ type: 'PAUSE_ALL' })).toBeNull();
  });

  it('leaves an Alt-clicked download to the browser unless the setting is off', () => {
    const candidate = {
      url: 'https://example.com/a.zip',
      finalUrl: 'https://cdn.example.com/a.zip',
      filename: 'a.zip',
      fileSize: -1,
      totalBytes: -1,
      mimeType: 'application/zip',
      tabUrl: 'https://example.com/',
    };
    const stages = createFilterPipeline(
      () => [],
      (urls) => urls.includes('https://cdn.example.com/a.zip'),
    );
    expect(evaluateFilterPipeline(candidate, DEFAULT_DOWNLOAD_SETTINGS, stages)).toEqual({
      verdict: 'skip',
      stageName: 'alt-click',
    });
    const off = { ...DEFAULT_DOWNLOAD_SETTINGS, altClickBypass: false };
    expect(evaluateFilterPipeline(candidate, off, stages).verdict).toBe('intercept');
  });
});
