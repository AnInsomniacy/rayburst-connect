import { describe, expect, it, vi } from 'vitest';
import {
  activateDesktop,
  desktopLink,
  DesktopActivationError,
  isActivationErrorCode,
  NATIVE_MESSAGING_HOST,
  nativeHosts,
} from '@/lib/desktop';
import { MOTRIX_NEXT_NATIVE_HOST } from '@/lib/legacy';

const RAYBURST = [NATIVE_MESSAGING_HOST];

describe('activateDesktop', () => {
  it('sends the exact one-shot activation request', async () => {
    const sendNativeMessage = vi.fn().mockResolvedValue({ ok: true });

    await activateDesktop(sendNativeMessage, RAYBURST);

    expect(sendNativeMessage).toHaveBeenCalledOnce();
    expect(sendNativeMessage).toHaveBeenCalledWith(NATIVE_MESSAGING_HOST, {
      action: 'activate',
    });
  });

  it('surfaces a native host error response', async () => {
    const sendNativeMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: 'activation_failed',
    });

    await expect(activateDesktop(sendNativeMessage, RAYBURST)).rejects.toMatchObject({
      name: 'DesktopActivationError',
      code: 'activation_failed',
    });
  });

  it('rejects malformed and expanded responses', async () => {
    for (const response of [{}, { ok: true, extra: true }, { ok: false, error: 'unknown' }]) {
      await expect(
        activateDesktop(vi.fn().mockResolvedValue(response), RAYBURST),
      ).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });

  it('classifies browser connection failures', async () => {
    const cause = new Error('Specified native messaging host not found');

    await expect(activateDesktop(vi.fn().mockRejectedValue(cause), RAYBURST)).rejects.toEqual(
      expect.objectContaining<Partial<DesktopActivationError>>({
        name: 'DesktopActivationError',
        code: 'host_unavailable',
        cause,
      }),
    );
    await expect(activateDesktop(vi.fn(), [])).rejects.toMatchObject({
      code: 'host_unavailable',
    });
  });

  it('moves past a missing host but stops at an installed one that fails', async () => {
    const hosts = [NATIVE_MESSAGING_HOST, MOTRIX_NEXT_NATIVE_HOST];
    const missingFirst = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ ok: true });
    await activateDesktop(missingFirst, hosts);
    expect(missingFirst).toHaveBeenLastCalledWith(MOTRIX_NEXT_NATIVE_HOST, {
      action: 'activate',
    });

    const failingFirst = vi.fn().mockResolvedValue({ ok: false, error: 'activation_failed' });
    await expect(activateDesktop(failingFirst, hosts)).rejects.toMatchObject({
      code: 'activation_failed',
    });
    expect(failingFirst).toHaveBeenCalledOnce();
  });
});

describe('desktop selection', () => {
  it('tries the desktop that answered last first, and Rayburst when none did', () => {
    const both = [NATIVE_MESSAGING_HOST, MOTRIX_NEXT_NATIVE_HOST];
    expect(nativeHosts(3, false)).toEqual(both);
    expect(nativeHosts(null, false)).toEqual(both);
    expect(nativeHosts(1, false)).toEqual([MOTRIX_NEXT_NATIVE_HOST, NATIVE_MESSAGING_HOST]);
    // Motrix Next's host does not admit the Firefox add-on.
    expect(nativeHosts(1, true)).toEqual(RAYBURST);
    expect(nativeHosts(2, true)).toEqual(RAYBURST);
    expect(desktopLink(1)).toBe('motrixnext://');
    expect(desktopLink(null)).toBe('rayburst://');
  });

  it('tells activation failures from readiness failures', () => {
    expect(isActivationErrorCode('host_unavailable')).toBe(true);
    expect(isActivationErrorCode('activation_failed')).toBe(true);
    expect(isActivationErrorCode('readiness_timeout')).toBe(false);
    expect(isActivationErrorCode('ApiAuthError')).toBe(false);
  });
});
