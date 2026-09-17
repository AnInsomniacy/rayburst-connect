import { z } from 'zod';
import { browser } from 'wxt/browser';
import { MediaCandidateSchema, MediaOperationSchema } from '../schema';
import { MediaSelectionSchema } from './contracts';

const tabId = z.number().int().nonnegative();
const candidate = { tabId, candidateId: z.uuid() };
export const MediaCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('MEDIA_LIST'), tabId: z.number().int().min(-1) }),
  z.strictObject({ type: z.literal('MEDIA_RESCAN'), tabId }),
  z.strictObject({ type: z.literal('MEDIA_CLEAR'), tabId, candidateId: z.uuid().optional() }),
  z.strictObject({ type: z.literal('MEDIA_ENABLE'), tabId, enabled: z.boolean() }),
  z.strictObject({ type: z.literal('MEDIA_SITE'), tabId, excluded: z.boolean() }),
  z.strictObject({ type: z.literal('MEDIA_PROBE'), ...candidate }),
  z.strictObject({ type: z.literal('MEDIA_DOWNLOAD_FILE'), ...candidate }),
  z.strictObject({ type: z.literal('MEDIA_POLL'), ...candidate }),
  z.strictObject({ type: z.literal('MEDIA_CANCEL'), ...candidate }),
  z.strictObject({
    type: z.literal('MEDIA_SUBMIT'),
    ...candidate,
    selection: MediaSelectionSchema,
  }),
]);
export const MediaObservationsSchema = z.strictObject({
  type: z.literal('MEDIA_OBSERVATIONS'),
  title: z.string().max(512),
  observations: z
    .array(
      z.strictObject({
        url: z.string().max(16_384),
        evidence: z.enum(['element', 'resource']),
        elementType: z.enum(['video', 'audio']).optional(),
        mime: z.string().max(128).optional(),
      }),
    )
    .max(32),
});

export const MediaOperationViewSchema = MediaOperationSchema.omit({
  request: true,
  connectionKey: true,
}).extend({ probeId: z.uuid() });
export const MediaListSchema = z.strictObject({
  enabled: z.boolean(),
  excluded: z.boolean(),
  host: z.string(),
  items: z.array(
    MediaCandidateSchema.omit({ context: true }).extend({
      hasRequestContext: z.boolean(),
      operation: MediaOperationViewSchema.optional(),
    }),
  ),
});
export type MediaList = z.infer<typeof MediaListSchema>;
export type MediaItem = MediaList['items'][number];
export type MediaCommand = z.infer<typeof MediaCommandSchema>;
export type MediaObservations = z.infer<typeof MediaObservationsSchema>;

export async function sendMediaCommand(command: MediaCommand): Promise<MediaList> {
  const response: unknown = await browser.runtime.sendMessage(command);
  const result = z
    .discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), data: MediaListSchema }),
      z.strictObject({ ok: z.literal(false), error: z.string() }),
    ])
    .parse(response);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
