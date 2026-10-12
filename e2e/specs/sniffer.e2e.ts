/** Media sniffing: what the page plays becomes the right download in Rayburst. */
import { stat } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, type Extension } from '../fixtures';
import { deleteTask, engineTasks, fileName, track, type Tracked } from '../support/desktop';
import { until } from '../support/wait';

interface Listed {
  id: string;
  kind: string;
  ranged?: boolean;
  filename: string;
  operation?: { state: string; error?: string; gid?: string };
}

const list = (extension: Extension, tabId: number) =>
  extension.send<{ items: Listed[] }>({ type: 'MEDIA_LIST', tabId }).then((data) => data.items);

async function finish(gid: string): Promise<Tracked> {
  const state = track(gid);
  return until(
    'the download',
    async () => {
      const task = await state();
      if (task.status === 'error') throw new Error(task.errorMessage);
      return task.status === 'complete' && task;
    },
    { timeout: 180_000, every: 1000 },
  );
}

async function openSniffer(extension: Extension, page: Page) {
  const popup = await extension.popup(page);
  await popup.locator('.popup-tabs .n-tabs-tab', { hasText: 'Sniffer' }).click();
  await expect(popup.locator('.resources')).toBeVisible();
  return popup;
}

test('a sniffed file without a name is saved under the page title', async ({
  extension,
  fixtures,
}) => {
  const title = `Night snack ${Date.now()}`;
  fixtures.file('/media/', { size: 2 << 20, type: 'video/mp4' });
  const page = await extension.context.newPage();
  await page.goto(
    fixtures.page('/watch', `<title>${title}</title><video src="/media/" muted autoplay></video>`),
  );
  const tabId = await extension.tabId(page);
  await until('the sniffed file', async () =>
    (await list(extension, tabId)).find((item) => item.kind === 'file'),
  );
  const popup = await openSniffer(extension, page);
  await popup.locator('.resource-row').first().getByRole('button', { name: 'Download' }).click();
  const task = await until('the desktop task', async () =>
    (await engineTasks()).find((item) => fileName(item).startsWith(title)),
  );
  try {
    expect(fileName(task)).toBe(`${title}.mp4`);
  } finally {
    await finish(task.gid);
    await deleteTask(task.gid);
  }
});

test.describe('public sites', () => {
  test.skip(!process.env.RAYBURST_E2E_PUBLIC, 'Set RAYBURST_E2E_PUBLIC=1 to reach public sites');

  test('split Bilibili tracks download as one complete video from the popup', async ({
    extension,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(
      process.env.RAYBURST_E2E_BILIBILI ?? 'https://www.bilibili.com/video/BV1GJ411x7h7',
      { waitUntil: 'domcontentloaded' },
    );
    await until(
      'playback',
      () =>
        page.evaluate(() => {
          const video = document.querySelector('video');
          if (!video) return false;
          video.muted = true;
          if (video.paused) void video.play().catch(() => undefined);
          return video.currentTime > 3;
        }),
      { timeout: 60_000 },
    );
    const tabId = await extension.tabId(page);
    await until(
      'two track files',
      async () =>
        (await list(extension, tabId)).filter((item) => item.kind === 'fragment' && item.ranged)
          .length >= 2 && true,
    );
    const popup = await openSniffer(extension, page);
    const group = popup.locator('.resource-row--tracks');
    await expect(group).toHaveCount(1);
    await group.getByRole('button', { name: 'Download' }).click();
    // Without quick download the selection opens: confirm its defaults.
    const confirm = popup.locator('.media-actions').getByRole('button', { name: 'Download' });
    const operation = await until(
      'submission',
      async () => {
        if (await confirm.isEnabled().catch(() => false)) await confirm.click();
        const collection = (await list(extension, tabId)).find(
          (item) => item.kind === 'collection',
        );
        if (collection?.operation?.state === 'failed')
          throw new Error(`probe failed: ${collection.operation.error}`);
        return collection?.operation?.state === 'submitted' && collection.operation;
      },
      { timeout: 90_000, every: 1000 },
    );
    const done = await finish(operation.gid ?? '');
    try {
      const path = done.path;
      expect(path).toMatch(/bilibili.*\.mp4$/i);
      expect((await stat(path)).size).toBeGreaterThan(1 << 20);
    } finally {
      await deleteTask(operation.gid ?? '');
    }
  });
});
