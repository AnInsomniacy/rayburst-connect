/** Chrome for Testing: full codecs and unpacked extensions, unlike branded Chrome 137+. */
import { join } from 'node:path';
import {
  Browser,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
} from '@puppeteer/browsers';

const CACHE = join(import.meta.dirname, '..', '..', 'node_modules', '.cache', 'rayburst-e2e');

export async function installChrome(): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Chrome for Testing does not support this platform');
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
  const installed = await install({ browser: Browser.CHROME, buildId, cacheDir: CACHE });
  return installed.executablePath;
}

export async function chromePath(): Promise<string> {
  if (process.env.RAYBURST_E2E_CHROME) return process.env.RAYBURST_E2E_CHROME;
  const [latest] = (await getInstalledBrowsers({ cacheDir: CACHE }))
    .filter((item) => item.browser === Browser.CHROME)
    .sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));
  if (!latest) throw new Error('Chrome for Testing is missing: run `pnpm e2e:install`');
  return latest.executablePath;
}
