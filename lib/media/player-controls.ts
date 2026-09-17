import { z } from 'zod';

export const PlayerCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({
    action: z.enum(['play', 'pause', 'pip', 'fullscreen', 'screenshot']),
    id: z.number().int(),
  }),
  z.object({
    action: z.enum(['rate', 'volume', 'time']),
    id: z.number().int(),
    value: z.number().finite(),
  }),
  z.object({ action: z.enum(['loop', 'muted']), id: z.number().int(), value: z.boolean() }),
]);

/** Frame-local element identities survive DOM reordering and cannot select another frame. */
export function createPlayerControls() {
  const ids = new WeakMap<HTMLMediaElement, number>();
  const players = new Map<number, HTMLMediaElement>();
  let next = 0;
  function scan(root: Document | ShadowRoot) {
    for (const element of root.querySelectorAll('*')) {
      if (element instanceof HTMLMediaElement) {
        let id = ids.get(element);
        if (id === undefined) {
          id = next++;
          ids.set(element, id);
        }
        players.set(id, element);
      }
      if (element.shadowRoot) scan(element.shadowRoot);
    }
    for (const [id, element] of players) if (!element.isConnected) players.delete(id);
  }
  return async (raw: unknown) => {
    const command = PlayerCommandSchema.parse(raw);
    if (command.action === 'list') {
      scan(document);
      return [...players].map(([id, player]) => ({
        id,
        source: player.currentSrc,
        paused: player.paused,
        duration: Number.isFinite(player.duration) ? player.duration : 0,
        time: player.currentTime,
        rate: player.playbackRate,
        volume: player.volume,
        muted: player.muted,
        loop: player.loop,
        video: player instanceof HTMLVideoElement,
      }));
    }
    const player = players.get(command.id);
    if (!player?.isConnected) throw new Error('player_not_found');
    switch (command.action) {
      case 'play':
        await player.play();
        break;
      case 'pause':
        player.pause();
        break;
      case 'rate':
        player.playbackRate = Math.max(0.25, Math.min(16, command.value));
        break;
      case 'volume':
        player.volume = Math.max(0, Math.min(1, command.value));
        break;
      case 'time':
        player.currentTime = Math.max(0, Math.min(player.duration, command.value));
        break;
      case 'loop':
        player.loop = command.value;
        break;
      case 'muted':
        player.muted = command.value;
        break;
      case 'pip':
        if (player instanceof HTMLVideoElement) await player.requestPictureInPicture();
        break;
      case 'fullscreen':
        await player.requestFullscreen();
        break;
      case 'screenshot': {
        if (!(player instanceof HTMLVideoElement)) throw new Error('unsupported_source');
        const canvas = document.createElement('canvas');
        canvas.width = player.videoWidth;
        canvas.height = player.videoHeight;
        canvas.getContext('2d')?.drawImage(player, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('capture_failed'))),
            'image/png',
          ),
        );
        // The extension sends the image through the same desktop-owned capture transport.
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('capture_failed'));
          reader.readAsDataURL(blob);
        });
      }
    }
    return true;
  };
}
