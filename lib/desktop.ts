/**
 * Desktop activation and readiness coordination: Native Messaging first, and
 * the desktop's link scheme in a tab when the user allowed that fallback.
 */
import { z } from '@/lib/validation';
import type { DesktopProtocol } from './api';
import { MOTRIX_NEXT_LINK, MOTRIX_NEXT_NATIVE_HOST } from './legacy';

z.config({ jitless: true });

export const NATIVE_MESSAGING_HOST = 'dev.aninsomniacy.rayburst.browser';
const DESKTOP_LINK = 'rayburst://';

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

const ACTIVATION_ERROR_CODES = [
  ...NativeHostErrorCodeSchema.options,
  'host_unavailable',
  'invalid_response',
] as const;
type ActivationErrorCode = (typeof ACTIVATION_ERROR_CODES)[number];
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
    public readonly code: ActivationErrorCode,
    public readonly cause?: unknown,
  ) {
    super(`Rayburst activation failed: ${code}`);
    this.name = 'DesktopActivationError';
  }
}

/** Whether a failed desktop action failed to start the desktop at all. */
export function isActivationErrorCode(code: string): code is ActivationErrorCode {
  return ACTIVATION_ERROR_CODES.some((known) => known === code);
}

/**
 * The native hosts to try, the desktop last identified first, so a missing
 * one still reaches the other after an upgrade. Motrix Next's host admits
 * only the Chromium store IDs.
 */
export function nativeHosts(protocol: DesktopProtocol | null, firefox: boolean): string[] {
  if (firefox) return [NATIVE_MESSAGING_HOST];
  return protocol === 1
    ? [MOTRIX_NEXT_NATIVE_HOST, NATIVE_MESSAGING_HOST]
    : [NATIVE_MESSAGING_HOST, MOTRIX_NEXT_NATIVE_HOST];
}

/** The link the desktop last identified registered for itself. */
export function desktopLink(protocol: DesktopProtocol | null): string {
  return protocol === 1 ? MOTRIX_NEXT_LINK : DESKTOP_LINK;
}

/**
 * Activate the desktop through the first installed host of `hosts`; a host
 * that is installed but fails ends the attempt.
 */
export async function activateDesktop(
  sendNativeMessage: NativeMessageSender,
  hosts: readonly string[],
): Promise<void> {
  let unavailable: unknown;
  for (const host of hosts) {
    let rawResponse: unknown;
    try {
      rawResponse = await sendNativeMessage(host, { action: 'activate' });
    } catch (error) {
      unavailable ??= error;
      continue;
    }
    const response = NativeHostResponseSchema.safeParse(rawResponse);
    if (!response.success) throw new DesktopActivationError('invalid_response', response.error);
    if (!response.data.ok) throw new DesktopActivationError(response.data.error);
    return;
  }
  throw new DesktopActivationError('host_unavailable', unavailable);
}

interface DesktopActivationOptions {
  /**
   * Activate the desktop app. It may return a cleanup that runs once the
   * wait ends, such as closing the tab that opened the desktop's link.
   */
  activate: () => Promise<(() => void) | void>;
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

  const cleanup = await options.activate();
  try {
    const deadline = Date.now() + options.maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(500);
      if (await checkReadySafely(options.checkReady, options.isFatalReadinessError)) return true;
    }
    return false;
  } finally {
    cleanup?.();
  }
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
