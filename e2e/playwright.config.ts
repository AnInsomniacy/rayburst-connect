import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// One desktop and one engine serve every test, so they run one at a time.
export default defineConfig({
  testDir: './specs',
  testMatch: '*.e2e.ts',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  // Traces and failure screenshots stay outside the repository.
  outputDir: join(tmpdir(), 'rayburst-e2e', 'connect'),
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
