/**
 * Playwright fixtures: the unpacked build in Chrome for Testing with a fresh
 * profile wired to the running desktop, and a loopback fixture server.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  test as base,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { chromePath } from './support/browser';
import { desktopConfig, desktopReachable } from './support/desktop';
import { startFixtureServer, type FixtureServer } from './support/server';

const EXTENSION =
  process.env.RAYBURST_E2E_EXTENSION ?? join(import.meta.dirname, '..', '.output', 'chromium-mv3');

export interface Extension {
  context: BrowserContext;
  worker: Worker;
  id: string;
  /** A popup command, sent from an extension page as the popup sends it; returns its data. */
  send<T>(command: Record<string, unknown>): Promise<T>;
  tabId(page: Page): Promise<number>;
  /** The real action popup, opened over `page`. */
  popup(page: Page): Promise<Page>;
}

interface Reply<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export const test = base.extend<{ extension: Extension; fixtures: FixtureServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form.
  fixtures: async ({}, use) => {
    const server = await startFixtureServer();
    await use(server);
    await server.close();
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form.
  extension: async ({}, use) => {
    test.skip(!(await desktopReachable()), 'Rayburst desktop is not running');
    const profile = await mkdtemp(join(tmpdir(), 'rayburst-e2e-profile-'));
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: await chromePath(),
      headless: false,
      viewport: { width: 1280, height: 800 },
      // Specs find controls by their English names.
      locale: 'en-US',
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        '--autoplay-policy=no-user-gesture-required',
        '--lang=en-US',
        // A second CDP client reaches the action popup, which Playwright does not adopt.
        '--remote-debugging-port=0',
      ],
    });
    // Playwright captures downloads under GUID names; the extension must see Chrome's own.
    const blank = context.pages()[0] ?? (await context.newPage());
    await (
      await context.newCDPSession(blank)
    ).send('Browser.setDownloadBehavior', {
      behavior: 'default',
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const { apiPort, apiSecret } = desktopConfig();
    await worker.evaluate((connection) => chrome.storage.local.set({ connection }), {
      port: apiPort,
      secret: apiSecret,
    });
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    let messenger: Page | undefined;
    let inspector: Browser | undefined;
    await use({
      context,
      worker,
      id,
      async send<T>(command: Record<string, unknown>) {
        if (!messenger) {
          messenger = await context.newPage();
          await messenger.goto(`chrome-extension://${id}/popup.html?e2e`);
        }
        const reply = await messenger.evaluate(
          (message) => chrome.runtime.sendMessage(message) as Promise<Reply<T>>,
          command,
        );
        if (!reply.ok) throw new Error(`${String(command.type)} failed: ${reply.error}`);
        return reply.data as T;
      },
      tabId: (page) =>
        worker.evaluate(
          (url) =>
            chrome.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url === url)?.id ?? -1),
          page.url(),
        ),
      async popup(page) {
        await page.bringToFront();
        await worker.evaluate(() => chrome.action.openPopup());
        inspector ??= await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const connected = inspector;
        return test.step('find the action popup', async () => {
          for (let attempt = 0; attempt < 50; attempt++) {
            const popup = connected
              .contexts()
              .flatMap((item) => item.pages())
              .find((item) => item.url() === `chrome-extension://${id}/popup.html`);
            if (popup) return popup;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error('The action popup did not open');
        });
      },
    });
    await inspector?.close();
    await context.close();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  },
});

export { expect } from '@playwright/test';
