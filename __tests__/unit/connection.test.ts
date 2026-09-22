import { describe, it, expect, vi } from 'vitest';
import {
  checkConnection,
  ApiAuthError,
  ApiTimeoutError,
  ApiUnreachableError,
  type PingResponse,
  type StatResponse,
} from '@/lib/api';

/** Helper: build a mock client with both ping and getStat. */
function mockClient(overrides: {
  ping?: () => Promise<PingResponse>;
  getStat?: () => Promise<StatResponse>;
}) {
  return {
    ping:
      overrides.ping ??
      vi
        .fn<() => Promise<PingResponse>>()
        .mockResolvedValue({ product: 'rayburst', status: 'ok', version: '3.7.3' }),
    getDownloadCapabilities: vi.fn().mockResolvedValue(undefined),
    getStat:
      overrides.getStat ??
      vi.fn<() => Promise<StatResponse>>().mockResolvedValue({
        downloadSpeed: '0',
        uploadSpeed: '0',
        numActive: '0',
        numWaiting: '0',
        numStopped: '0',
        numStoppedTotal: '0',
      }),
  };
}

describe('checkConnection', () => {
  it('returns connected when both ping and getStat succeed', async () => {
    const client = mockClient({});
    const result = await checkConnection(client);

    expect(result.status).toBe('connected');
    expect(result.version).toBe('3.7.3');
    expect(result).toHaveProperty('stat.downloadSpeed', '0');
    expect(client.getStat).toHaveBeenCalledTimes(1);
  });

  it('returns auth error with ping version when getStat rejects with 401', async () => {
    const result = await checkConnection(
      mockClient({ getStat: vi.fn().mockRejectedValue(new ApiAuthError()) }),
    );

    expect(result.status).toBe('disconnected');
    expect(result.version).toBe('3.7.3'); // version from ping survives auth failure
    expect(result).toHaveProperty('error', 'ApiAuthError');
  });

  it('classifies non-authentication failures without exposing a stale version', async () => {
    for (const [error, name] of [
      [new ApiUnreachableError(), 'ApiUnreachableError'],
      [new ApiTimeoutError(5000), 'ApiTimeoutError'],
      ['string error', 'UnknownError'],
    ] as const) {
      const result = await checkConnection(mockClient({ ping: vi.fn().mockRejectedValue(error) }));
      expect(result).toMatchObject({ status: 'disconnected', version: null, error: name });
    }

    const statFailure = await checkConnection(
      mockClient({ getStat: vi.fn().mockRejectedValue(new ApiUnreachableError()) }),
    );
    expect(statFailure.version).toBeNull();
  });
});
