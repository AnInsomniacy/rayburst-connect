/**
 * Consumer validation for the desktop-owned download handoff protocol (v3).
 *
 * The browser keeps holding a download until `/add` answers: `accepted` (the
 * desktop shows it for confirmation and owns it from now on), `added` (the
 * desktop owns it), `cancelled` (the user declined it) or `fallback` (the
 * browser should continue). Any other outcome, including a lost answer, also
 * leaves the download to the browser.
 *
 * Requests ask for `ack: 'early'`: Chromium gives an extension 15 seconds to
 * name a download, so the browser cannot wait for the user's decision. A
 * desktop older than this field answers only once the user decides.
 */
import { z } from '@/lib/validation';
export const AddDownloadRequestSchema = z.object({
  url: z.string(),
  finalUrl: z.string().optional(),
  referer: z.string().optional(),
  cookie: z.string().optional(),
  filename: z.string().optional(),
  filenameSource: z.enum(['browser', 'suggested']).optional(),
  userAgent: z.string().optional(),
  requestHeaders: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  /** The browser holds this download; the engine must receive the same file. */
  verify: z.boolean().optional(),
  /** Answer `accepted` as soon as the confirmation shows. */
  ack: z.enum(['early', 'final']).optional(),
  mime: z.string().optional(),
  size: z.number().int().optional(),
});
export const AddDownloadResponseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accepted') }),
  z.object({ action: z.literal('added'), gid: z.string().min(1) }),
  z.object({ action: z.literal('cancelled') }),
  z.object({
    action: z.literal('fallback'),
    // unreachable, rejected, web-page, size-mismatch or unconfirmed
    reason: z.string(),
  }),
]);
export type AddDownloadRequest = z.infer<typeof AddDownloadRequestSchema>;
export type AddDownloadResponse = z.infer<typeof AddDownloadResponseSchema>;
