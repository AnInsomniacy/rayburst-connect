import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePageMedia } from '@/lib/media/page-observer';
import type { MediaObservations } from '@/lib/media/messages';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('page media observation', () => {
  it('discovers dynamically inserted media in open shadow trees without modifying playback APIs', async () => {
    const send = vi
      .fn<(message: MediaObservations) => Promise<void>>()
      .mockResolvedValue(undefined);
    const fetchBefore = window.fetch;
    const playBefore = HTMLMediaElement.prototype.play;
    const observer = observePageMedia(send);
    const host = document.createElement('section');
    const shadow = host.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    video.src = 'https://example.com/movie.mp4';
    shadow.append(video);
    document.body.append(host);
    await vi.advanceTimersByTimeAsync(600);
    const observations = send.mock.calls.flatMap(([message]) => message.observations);
    expect(observations).toContainEqual({
      url: video.src,
      elementType: 'video',
      evidence: 'element',
    });
    expect(window.fetch).toBe(fetchBefore);
    expect(HTMLMediaElement.prototype.play).toBe(playBefore);
    observer.stop();
  });
  it('rescans on demand and disconnects cleanly', async () => {
    const send = vi
      .fn<(message: MediaObservations) => Promise<void>>()
      .mockResolvedValue(undefined);
    const audio = document.createElement('audio');
    audio.src = 'https://example.com/audio.mp3';
    document.body.append(audio);
    const observer = observePageMedia(send);
    await vi.advanceTimersByTimeAsync(600);
    const first = send.mock.calls.length;
    observer.rescan();
    await vi.advanceTimersByTimeAsync(600);
    expect(send.mock.calls.length).toBeGreaterThan(first);
    observer.stop();
    const stopped = send.mock.calls.length;
    audio.src = 'https://example.com/later.mp3';
    observer.rescan();
    await vi.advanceTimersByTimeAsync(600);
    expect(send.mock.calls.length).toBe(stopped);
  });
});
