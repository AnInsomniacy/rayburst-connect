import { describe, expect, it, vi } from 'vitest';
import { activateDesktop, DesktopActivationError, NATIVE_MESSAGING_HOST } from '@/lib/desktop';

describe('activateDesktop', () => {
  it('sends the exact one-shot activation request', async () => {
    const sendNativeMessage = vi.fn().mockResolvedValue({ ok: true });

    await activateDesktop(sendNativeMessage);

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

    await expect(activateDesktop(sendNativeMessage)).rejects.toMatchObject({
      name: 'DesktopActivationError',
      code: 'activation_failed',
    });
  });

  it('rejects malformed and expanded responses', async () => {
    for (const response of [{}, { ok: true, extra: true }, { ok: false, error: 'unknown' }]) {
      await expect(activateDesktop(vi.fn().mockResolvedValue(response))).rejects.toMatchObject({
        code: 'invalid_response',
      });
    }
  });

  it('classifies browser connection failures', async () => {
    const cause = new Error('Specified native messaging host not found');

    await expect(activateDesktop(vi.fn().mockRejectedValue(cause))).rejects.toEqual(
      expect.objectContaining<Partial<DesktopActivationError>>({
        name: 'DesktopActivationError',
        code: 'host_unavailable',
        cause,
      }),
    );
  });
});
