import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';
import { localesPlugin } from './shared/i18n/locales-plugin';

export default defineConfig({
  // WxtVitest polyfills extension APIs (fakeBrowser) and defines
  // import.meta.env.* flags; localesPlugin serves virtual:locales.
  plugins: [WxtVitest(), localesPlugin()],
  test: {
    setupFiles: ['./__tests__/setup.ts'],
    server: { deps: { inline: ['@material/material-color-utilities'] } },
    environment: 'happy-dom',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
    },
  },
});
