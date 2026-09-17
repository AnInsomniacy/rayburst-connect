/** Native Messaging activation and readiness coordination for Rayburst. */
import { z } from 'zod';

z.config({ jitless: true });

export const NATIVE_MESSAGING_HOST = 'dev.aninsomniacy.rayburst.browser';

const NativeHostErrorCodeSchema = z.enum([
  'untrusted_caller',
  'incomplete_frame',
  'invalid_size',
  'invalid_request',
  'activation_failed',
  'response_failed',
]);

const NativeHostResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), error: NativeHostErrorCodeSchema }),
]);

type NativeHostErrorCode = z.output<typeof NativeHostErrorCodeSchema>;
type NativeMessageSender = (hostName: string, message: object) => Promise<unknown>;
export type DesktopAction = 'OPEN_DESKTOP' | 'START_DESKTOP';
export type DesktopActionResponse = { ok: true } | { ok: false; error: string };

export function parseDesktopActionResponse(response: unknown): DesktopActionResponse {
  if (response === null || typeof response !== 'object' || !('ok' in response)) {
    return { ok: false, error: 'invalid_response' };
  }
  if (response.ok === true) return { ok: true };
  return {
    ok: false,
    error: 'error' in response && typeof response.error === 'string' ? response.error : 'unknown',
  };
}

export class DesktopActivationError extends Error {
  constructor(
    public readonly code: NativeHostErrorCode | 'host_unavailable' | 'invalid_response',
    public readonly cause?: unknown,
  ) {
    super(`Rayburst activation failed: ${code}`);
    this.name = 'DesktopActivationError';
  }
}

/** Activate Rayburst through its allowlisted one-shot native host. */
export async function activateDesktop(sendNativeMessage: NativeMessageSender): Promise<void> {
  let rawResponse: unknown;
  try {
    rawResponse = await sendNativeMessage(NATIVE_MESSAGING_HOST, { action: 'activate' });
  } catch (error) {
    throw new DesktopActivationError('host_unavailable', error);
  }

  const response = NativeHostResponseSchema.safeParse(rawResponse);
  if (!response.success) throw new DesktopActivationError('invalid_response', response.error);
  if (!response.data.ok) throw new DesktopActivationError(response.data.error);
}

interface DesktopActivationOptions {
  /** Activate the desktop app through Native Messaging. */
  activate: () => Promise<void>;
  /** Return true when both the desktop app and its engine are ready. */
  checkReady: () => Promise<boolean>;
  /** Stop waiting when a readiness error cannot recover through polling. */
  isFatalReadinessError?: (error: unknown) => boolean;
  /** Maximum time to wait for readiness. */
  maxWaitMs: number;
}

type ActivateDesktopAndWait = (options: DesktopActivationOptions) => Promise<boolean>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function checkReadySafely(
  check: () => Promise<boolean>,
  isFatal: ((error: unknown) => boolean) | undefined,
): Promise<boolean> {
  try {
    return await check();
  } catch (error) {
    if (isFatal?.(error)) throw error;
    return false;
  }
}

async function activateAndWaitForApi(options: DesktopActivationOptions): Promise<boolean> {
  if (await checkReadySafely(options.checkReady, options.isFatalReadinessError)) return true;

  await options.activate();
  const deadline = Date.now() + options.maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(500);
    if (await checkReadySafely(options.checkReady, options.isFatalReadinessError)) return true;
  }
  return false;
}

/** Create one coordinator that coalesces concurrent activation attempts. */
export function createDesktopActivationCoordinator(): ActivateDesktopAndWait {
  let pending: Promise<boolean> | null = null;

  return (options) => {
    if (pending) return pending;
    pending = activateAndWaitForApi(options).finally(() => {
      pending = null;
    });
    return pending;
  };
}
