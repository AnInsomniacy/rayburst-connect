/** Bounded, restart-durable handoff journal. Terminal receipts remove credentials. */
import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { ConnectionConfig } from '../schema';
import { AddDownloadRequestSchema, type AddDownloadRequest } from './contracts';
const PREFIX = 'pending-download:';
const PendingDownloadSchema = z.object({
  request: AddDownloadRequestSchema,
  connection: z.object({ port: z.number(), secret: z.string() }),
  browserDownloadId: z.number().int().nonnegative().optional(),
});
export async function rememberDownload(
  request: AddDownloadRequest,
  connection: ConnectionConfig,
  browserDownloadId?: number,
) {
  return navigator.locks.request('download-journal', async () => {
    const entries = await browser.storage.local.get(null);
    if (
      !entries[PREFIX + request.id] &&
      Object.keys(entries).filter((key) => key.startsWith(PREFIX)).length >= 100
    )
      throw new Error('Resolve pending downloads before handing off another download');
    await browser.storage.local.set({
      [PREFIX + request.id]: { request, connection, browserDownloadId },
    });
    return Boolean(entries[PREFIX + request.id]);
  });
}
export async function forgetDownload(id: string) {
  await browser.storage.local.remove(PREFIX + id);
}
export async function pendingDownloads(
  connection: ConnectionConfig,
): Promise<Array<z.infer<typeof PendingDownloadSchema>>> {
  const entries = await browser.storage.local.get(null);
  return Object.entries(entries).flatMap(([key, value]) => {
    if (!key.startsWith(PREFIX)) return [];
    const parsed = PendingDownloadSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.connection.port !== connection.port ||
      parsed.data.connection.secret !== connection.secret
    )
      return [];
    return [parsed.data];
  });
}
