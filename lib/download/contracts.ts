/** Consumer validation for the desktop-owned download handoff protocol. */
import { z } from '@/lib/validation';
export const AddDownloadRequestSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string(),
  finalUrl: z.string().optional(),
  referer: z.string().optional(),
  cookie: z.string().optional(),
  filename: z.string().optional(),
  filenameSource: z.enum(['browser', 'suggested']).optional(),
  userAgent: z.string().optional(),
  requestHeaders: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});
export const AddDownloadResponseSchema = z.discriminatedUnion('action', [
  z.object({ id: z.string().min(1), action: z.literal('cancelled'), gid: z.string().optional() }),
  z.object({ id: z.string().min(1), action: z.literal('submitted'), gid: z.string().min(1) }),
  z.object({
    id: z.string().min(1),
    action: z.literal('needs-confirmation'),
    gid: z.string().optional(),
  }),
]);
export type AddDownloadRequest = z.infer<typeof AddDownloadRequestSchema>;
export type AddDownloadResponse = z.infer<typeof AddDownloadResponseSchema>;
