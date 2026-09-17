/** The versioned desktop media protocol. No browser or engine implementation lives here. */
import { z } from 'zod';

export const MEDIA_API_PATH = 'media/v2';
export const MEDIA_PROTOCOL_VERSION = 2;
export const MediaSourceKindSchema = z.enum(['hls', 'dash', 'collection']);
export const MediaFormatSchema = z.enum(['mp4', 'mkv', 'vtt']);
export const MediaHttpUrlSchema = z
  .string()
  .max(16_384)
  .refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Expected an HTTP(S) URL without embedded credentials');
const identifier = z.string().min(1).max(128);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const MediaFailureCodeSchema = z.enum([
  'integration_unavailable',
  'unavailable',
  'unsupported_source',
  'protected_media',
  'authentication_required',
  'source_expired',
  'unsupported_selection',
  'probe_failed',
  'expired',
  'not_found',
  'conflict',
]);

export const MediaRequestContextSchema = z.strictObject({
  url: MediaHttpUrlSchema,
  headers: z
    .array(z.strictObject({ name: z.string().min(1).max(128), value: z.string().max(8192) }))
    .max(32),
});

export const MediaInputPlanSchema = z.strictObject({
  manifests: z
    .array(z.strictObject({ url: MediaHttpUrlSchema, content: z.string().max(2 * 1024 * 1024) }))
    .max(32),
  tracks: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        type: z.enum(['video', 'audio', 'muxed', 'subtitle']),
        urls: z.array(MediaHttpUrlSchema).min(1).max(10_000),
        offsetMs: z.number().int().min(0).max(31_536_000_000).optional(),
      }),
    )
    .max(32),
  keys: z
    .array(
      z.strictObject({
        url: z.union([z.literal(''), MediaHttpUrlSchema]),
        key: z.string().regex(/^[a-f0-9]{32}$/i),
        iv: z.union([z.literal(''), z.string().regex(/^[a-f0-9]{32}$/i)]),
      }),
    )
    .max(64),
});
export type MediaInputPlan = z.infer<typeof MediaInputPlanSchema>;
export const emptyMediaInput = (): MediaInputPlan => ({ manifests: [], tracks: [], keys: [] });

export const MediaSourceSchema = z.strictObject({
  url: MediaHttpUrlSchema,
  kind: MediaSourceKindSchema,
  pageUrl: MediaHttpUrlSchema,
  title: z.string().max(512),
  filename: z.string().max(255),
  mime: z.string().max(128),
  requestContexts: z.array(MediaRequestContextSchema).max(8),
  input: MediaInputPlanSchema.optional(),
});

export const MediaTrackSchema = z.strictObject({
  id: identifier,
  type: z.enum(['video', 'audio', 'muxed', 'subtitle']),
  language: z.string().max(64),
  codec: z.string().max(128),
  width: integer,
  height: integer,
  bandwidth: integer,
  frameRate: z.number().finite().nonnegative().max(1000),
});

export const MediaSelectionSchema = z.strictObject({
  videoId: identifier.nullable(),
  audioId: identifier.nullable(),
  subtitleId: identifier.nullable(),
  format: MediaFormatSchema,
  recordTimeSeconds: z.number().int().min(0).max(31_536_000),
  startTimeSeconds: z.number().int().min(0).max(31_536_000).optional(),
  endTimeSeconds: z.number().int().min(0).max(31_536_000).optional(),
});

export const MediaPresentationSchema = z
  .strictObject({
    kind: MediaSourceKindSchema,
    title: z.string().max(512),
    live: z.boolean(),
    durationMs: integer.nullable(),
    size: integer.nullable(),
    tracks: z.array(MediaTrackSchema).max(256),
    formats: z.array(MediaFormatSchema).min(1).max(3),
    defaults: MediaSelectionSchema,
  })
  .superRefine((value, ctx) => {
    if (new Set(value.tracks.map((track) => track.id)).size !== value.tracks.length) {
      ctx.addIssue({ code: 'custom', message: 'Track identifiers must be unique' });
    }
    if (selectionError(value, value.defaults)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid default selection' });
    }
  });

export const MediaCapabilitiesSchema = z.strictObject({
  product: z.literal('rayburst'),
  protocolVersion: z.literal(MEDIA_PROTOCOL_VERSION),
  sourceKinds: z.array(MediaSourceKindSchema).min(1).max(3),
  requestContexts: z.literal(true),
});
export const MediaProbeRequestSchema = z.strictObject({ id: z.uuid(), source: MediaSourceSchema });
const probeBase = { id: z.uuid(), expiresAt: integer };
export const MediaProbeSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...probeBase, state: z.literal('probing') }),
  z.strictObject({
    ...probeBase,
    state: z.literal('ready'),
    presentation: MediaPresentationSchema,
  }),
  z.strictObject({ ...probeBase, state: z.literal('failed'), error: MediaFailureCodeSchema }),
  z.strictObject({ ...probeBase, state: z.literal('cancelled') }),
  z.strictObject({ ...probeBase, state: z.literal('submitting'), submissionId: z.uuid() }),
  z.strictObject({
    ...probeBase,
    state: z.literal('submitted'),
    submissionId: z.uuid(),
    gid: identifier,
  }),
]);
export const MediaSubmitRequestSchema = z.strictObject({
  submissionId: z.uuid(),
  selection: MediaSelectionSchema,
});
export const MediaSubmitResponseSchema = z.strictObject({
  id: z.uuid(),
  submissionId: z.uuid(),
  gid: identifier,
});
export const MediaCancelResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({ id: z.uuid(), state: z.literal('cancelled') }),
  z.strictObject({
    id: z.uuid(),
    state: z.literal('submitted'),
    submissionId: z.uuid(),
    gid: identifier,
  }),
]);
export const MediaErrorResponseSchema = z.strictObject({ error: MediaFailureCodeSchema });

export type MediaSource = z.infer<typeof MediaSourceSchema>;
export type MediaSourceKind = z.infer<typeof MediaSourceKindSchema>;
export type MediaRequestContext = z.infer<typeof MediaRequestContextSchema>;
export type MediaTrack = z.infer<typeof MediaTrackSchema>;
export type MediaSelection = z.infer<typeof MediaSelectionSchema>;
export type MediaPresentation = z.infer<typeof MediaPresentationSchema>;
export type MediaProbe = z.infer<typeof MediaProbeSchema>;
export type MediaProbeRequest = z.infer<typeof MediaProbeRequestSchema>;
export type MediaSubmitRequest = z.infer<typeof MediaSubmitRequestSchema>;
export type MediaFailureCode = z.infer<typeof MediaFailureCodeSchema>;

/** A selection references native track IDs; resolution labels never become selectors. */
export function selectionError(
  presentation: { kind: MediaSourceKind; live: boolean; tracks: MediaTrack[]; formats: string[] },
  selection: MediaSelection,
): string | null {
  if (
    (selection.endTimeSeconds ?? 0) > 0 &&
    (selection.endTimeSeconds ?? 0) <= (selection.startTimeSeconds ?? 0)
  )
    return 'invalid_range';
  if (
    (presentation.live || presentation.kind === 'collection') &&
    (selection.startTimeSeconds || selection.endTimeSeconds)
  )
    return 'invalid_range';
  if (
    selection.format === 'vtt' &&
    (selection.videoId || selection.audioId || !selection.subtitleId)
  )
    return 'invalid_format';
  if (!presentation.formats.includes(selection.format)) return 'invalid_format';
  if (!presentation.live && selection.recordTimeSeconds !== 0) return 'invalid_duration';
  const video = presentation.tracks.find((track) => track.id === selection.videoId);
  const audio = presentation.tracks.find((track) => track.id === selection.audioId);
  const subtitle = presentation.tracks.find((track) => track.id === selection.subtitleId);
  if (selection.videoId && (!video || !['video', 'muxed'].includes(video.type)))
    return 'invalid_video';
  if (selection.audioId && (!audio || !['audio', 'muxed'].includes(audio.type)))
    return 'invalid_audio';
  if (selection.subtitleId && (!subtitle || subtitle.type !== 'subtitle'))
    return 'invalid_subtitle';
  if (video && audio && (video.type === 'muxed' || audio.type === 'muxed') && video.id !== audio.id)
    return 'invalid_muxed_selection';
  if (!video && !audio && !subtitle) return 'track_required';
  return null;
}
