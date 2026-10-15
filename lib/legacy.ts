/**
 * Older desktops, kept working until their users have moved on:
 *
 * - protocol 1: Motrix Next 3.8 and later (`/ping` without a product,
 *   `/add` answers once it queued the link);
 * - protocol 2: Rayburst 4.0 (`/add` takes a request ID and answers
 *   submitted, cancelled or needs-confirmation).
 *
 * Neither checks that it would receive the file the browser holds, so their
 * answers always release the browser download, as the extensions written for
 * them did. Motrix Next before 3.8 has no HTTP API and is not supported.
 *
 * Dropping them means deleting this file and the references to it.
 */
import { z } from '@/lib/validation';
import type { DesktopIdentity } from './api';
import type { AddDownloadRequest, AddDownloadResponse } from './download/contracts';

export type LegacyProtocol = 1 | 2;

/** Motrix Next's activation host; it admits the Chromium store IDs only. */
export const MOTRIX_NEXT_NATIVE_HOST = 'com.motrix.next.browser';
export const MOTRIX_NEXT_LINK = 'motrixnext://';

/** Names an older desktop for the upgrade hint; `null` for a current one. */
export function legacyDesktopName(desktop: DesktopIdentity): string | null {
  if (desktop.protocol === 3) return null;
  return `${desktop.product === 'motrix-next' ? 'Motrix Next' : 'Rayburst'} ${desktop.version}`;
}

/** Motrix Next answered `/ping` with only a status and its version. */
export function isMotrixNext(discovery: { product?: string; version: string }): boolean {
  return discovery.product === undefined && /^[1-3]\.\d+\.\d+(?:[-+].*)?$/.test(discovery.version);
}

/** The request fields each older desktop reads; it never saw the newer ones. */
export function legacyAddRequest(request: AddDownloadRequest, protocol: LegacyProtocol): object {
  const {
    verify: _verify,
    mime: _mime,
    size: _size,
    ack: _ack,
    filenameSource,
    ...common
  } = request;
  return protocol === 2 ? { id: crypto.randomUUID(), ...common, filenameSource } : common;
}

/** Reads an older answer as the current one. */
export function legacyAddResponse(
  protocol: LegacyProtocol,
): z.ZodType<AddDownloadResponse, unknown> {
  if (protocol === 1)
    return z.object({ action: z.string() }).transform(() => ({ action: 'added', gid: '' }));
  return z
    .object({
      action: z.enum(['submitted', 'cancelled', 'needs-confirmation']),
      gid: z.string().optional(),
    })
    .transform(({ action, gid }) =>
      action === 'cancelled'
        ? { action: 'cancelled' as const }
        : // A download awaiting confirmation has no task yet.
          { action: 'added' as const, gid: gid ?? '' },
    );
}
