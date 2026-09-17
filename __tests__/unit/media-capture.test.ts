import { describe, expect, it } from 'vitest';
import { encodeCaptureChunk } from '@/lib/media/capture';

describe('capture transport integrity', () => {
  it('preserves binary bytes, replay identity and track timing through JSON messaging', async () => {
    const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, index) => index % 256);
    const id = crypto.randomUUID();
    const encoded = await encodeCaptureChunk({
      blob: new Blob([bytes]),
      id,
      stream: 3,
      mime: 'audio/webm',
      offsetMs: 123,
    });
    const received = JSON.parse(JSON.stringify(encoded)) as typeof encoded;
    expect(Uint8Array.from(atob(received.data), (char) => char.charCodeAt(0))).toEqual(bytes);
    expect(received).toMatchObject({ id, stream: 3, mime: 'audio/webm', offsetMs: 123 });
  });
  it('rejects oversized blocks and missing replay identities', async () => {
    await expect(
      encodeCaptureChunk({
        blob: new Blob([new Uint8Array(256 * 1024 + 1)]),
        id: crypto.randomUUID(),
        stream: 0,
        mime: 'video/mp4',
      }),
    ).rejects.toThrow();
    await expect(
      encodeCaptureChunk({ blob: new Blob(['payload']), stream: 0, mime: 'video/mp4' }),
    ).rejects.toThrow();
  });
});
