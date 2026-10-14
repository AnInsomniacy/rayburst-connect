import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopActivationCoordinator } from '@/lib/desktop';

describe('createDesktopActivationCoordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('skips activation when the desktop app and engine are ready', async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    const checkReady = vi.fn().mockResolvedValue(true);

    const pending = createDesktopActivationCoordinator()({
      activate,
      checkReady,
      maxWaitMs: 5000,
    });

    await vi.runAllTimersAsync();
    expect(await pending).toBe(true);
    expect(activate).not.toHaveBeenCalled();
    expect(checkReady).toHaveBeenCalledTimes(1);
  });

  it('activates once and polls until the desktop app and engine are ready', async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;
    const checkReady = vi.fn().mockImplementation(async () => {
      if (++callCount < 3) throw new Error('ECONNREFUSED');
      return true;
    });

    const pending = createDesktopActivationCoordinator()({
      activate,
      checkReady,
      maxWaitMs: 1000,
    });

    await vi.runAllTimersAsync();
    expect(await pending).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(checkReady).toHaveBeenCalledTimes(3);
  });

  it('times out on transient failures and stops immediately on fatal failures', async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    const checkReady = vi.fn().mockResolvedValue(false);

    const pending = createDesktopActivationCoordinator()({
      activate,
      checkReady,
      maxWaitMs: 40,
    });

    await vi.runAllTimersAsync();
    expect(await pending).toBe(false);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(checkReady.mock.calls.length).toBeGreaterThanOrEqual(2);

    const fatalError = new Error('fatal readiness failure');
    const fatalActivate = vi.fn().mockResolvedValue(undefined);
    await expect(
      createDesktopActivationCoordinator()({
        activate: fatalActivate,
        checkReady: vi.fn().mockRejectedValue(fatalError),
        isFatalReadinessError: (error) => error === fatalError,
        maxWaitMs: 1000,
      }),
    ).rejects.toBe(fatalError);
    expect(fatalActivate).not.toHaveBeenCalled();
  });

  it('coalesces concurrent attempts and clears pending state after completion', async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    const checkReady = vi.fn().mockResolvedValue(false);
    const activateAndWait = createDesktopActivationCoordinator();
    const options = { activate, checkReady, maxWaitMs: 40 };

    const first = activateAndWait(options);
    const second = activateAndWait(options);

    expect(first).toBe(second);
    await vi.runAllTimersAsync();
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(activate).toHaveBeenCalledTimes(1);
    checkReady.mockResolvedValue(true);
    await expect(activateAndWait({ activate, checkReady, maxWaitMs: 100 })).resolves.toBe(true);
  });

  it('cleans up after the activation once the wait ends either way', async () => {
    for (const ready of [true, false]) {
      const cleanup = vi.fn();
      let checks = 0;
      const pending = createDesktopActivationCoordinator()({
        // Opening the desktop's link leaves a tab to close.
        activate: vi.fn().mockResolvedValue(cleanup),
        checkReady: vi.fn().mockImplementation(async () => ready && ++checks > 1),
        maxWaitMs: 1000,
      });
      await vi.runAllTimersAsync();
      expect(await pending).toBe(ready);
      expect(cleanup).toHaveBeenCalledOnce();
    }
  });
});
