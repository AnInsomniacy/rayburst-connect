import '@wxt-dev/auto-icons';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import Components from 'unplugin-vue-components/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import { buildExtensionManifest } from './shared/manifest';
import { localesPlugin } from './shared/i18n/locales-plugin';

const chromiumProfile = resolve('.wxt/chrome-data');
// The runner opens its log files before Chrome creates a fresh profile directory.
mkdirSync(chromiumProfile, { recursive: true });

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'public/icon/icon.svg',
    sizes: [16, 32, 48, 96, 128],
    developmentIndicator: false,
  },
  webExt: {
    chromiumProfile,
    keepProfileChanges: true,
  },
  dev: {
    // Native extension CSP and injected Vite URLs must share one origin.
    // Fail on duplicate dev servers instead of emitting an unloadable build.
    server: { port: 3000 },
  },
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}-mv3.zip',
  },
  manifest: ({ browser, mode }) => buildExtensionManifest(browser, mode),
  vite: () => ({
    build: {
      // WXT builds the service worker as an IIFE, so manual code-splitting is
      // not valid for every entrypoint. Keep the warning threshold explicit.
      chunkSizeWarningLimit: 1024,
    },
    plugins: [
      localesPlugin(),
      Components({
        resolvers: [NaiveUiResolver()],
        dirs: ['entrypoints/**/components'],
        dts: false,
      }),
    ],
  }),
});
