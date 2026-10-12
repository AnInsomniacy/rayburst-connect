/**
 * Ordinary downloads: browser takeover, then control from the popup. Specs act
 * only on tasks they create; the desktop may be running the user's own.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { test, expect } from '../fixtures';
import {
  deleteTask,
  engineTasks,
  fileName,
  rpc,
  track,
  type EngineStatus,
} from '../support/desktop';
import { fixtureDigest } from '../support/server';
import { until } from '../support/wait';

const MiB = 1 << 20;

function digest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const status = (gid: string) => rpc<EngineStatus>('aria2.tellStatus', gid);
const byName = (name: string) => async () =>
  (await engineTasks()).find((task) => fileName(task) === name);

test('a clicked link moves to Rayburst and the popup pauses and resumes it', async ({
  extension,
  fixtures,
}) => {
  const name = `e2e-${Date.now()}.bin`;
  const size = 48 * MiB;
  fixtures.file(`/files/${name}`, { size, rate: 4 * MiB });
  const page = await extension.context.newPage();
  await page.goto(fixtures.page('/downloads', `<a id="link" href="/files/${name}">${name}</a>`));
  await page.click('#link');
  const task = await until('the desktop task', byName(name));
  try {
    const popup = await extension.popup(page);
    const row = popup.locator('.task-row', { hasText: name });
    await row.getByRole('button', { name: 'Pause' }).click();
    await until('paused', async () => (await status(task.gid)).status === 'paused');
    // The icon turns into resume before the next poll confirms it.
    await row.getByRole('button', { name: 'Resume' }).click();
    await until('resumed', async () =>
      ['active', 'waiting'].includes((await status(task.gid)).status),
    );
    const state = track(task.gid);
    const done = await until(
      'completion',
      async () => {
        const current = await state();
        if (current.status === 'error') throw new Error(current.errorMessage);
        return current.status === 'complete' && current;
      },
      { timeout: 90_000 },
    );
    expect(Number(done.totalLength)).toBe(size);
    expect(await digest(done.path)).toBe(fixtureDigest(size));
  } finally {
    await deleteTask(task.gid);
  }
});
