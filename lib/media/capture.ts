import { z } from 'zod';

export const CaptureChunkSchema = z.object({
  type: z.literal('chunk'),
  id: z.uuid(),
  stream: z.number().int().min(0).max(31),
  mime: z.string().max(256),
  offsetMs: z.number().int().min(0).max(31_536_000_000).optional(),
  data: z.string().max(360000),
});
export type CaptureChunk = z.infer<typeof CaptureChunkSchema>;

/** Chrome extension messaging is JSON-only; keep each native Blob conversion bounded. */
export async function encodeCaptureChunk(raw: Record<string, unknown>): Promise<CaptureChunk> {
  if (!(raw.blob instanceof Blob) || !raw.blob.size || raw.blob.size > 256 * 1024)
    throw new Error('Invalid capture block');
  const blob = raw.blob;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Cannot read capture block'));
    reader.readAsDataURL(blob);
  });
  return CaptureChunkSchema.parse({
    type: 'chunk',
    id: raw.id,
    stream: raw.stream,
    mime: raw.mime,
    offsetMs: raw.offsetMs,
    data,
  });
}
