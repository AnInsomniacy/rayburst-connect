import identity from '../../browser-identity.json';
import { validatePackageManifest } from '@/scripts/actions/workflow-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDecision,
  isActiveFirefoxReviewStatus,
  resolveEdgeStoreStatus,
  type StoreStatusRow,
} from '@/scripts/actions/store-status';
import {
  decideChromePublishAction,
  isBlockingChromeSubmissionState,
  readChromeStoreStatus,
} from '@/scripts/actions/publish-chrome';
import { decideFirefoxPublishAction } from '@/scripts/actions/publish-firefox';
import {
  decideEdgePreflightAction,
  classifyEdgePublishOperation,
  extractOperationIdFromLocation,
  fetchTrackedPublishOperation,
} from '@/scripts/actions/publish-edge';
import { normalizeReleaseInput } from '@/scripts/actions/resolve-release';

function chromeStatus(submittedVersion: string, state: string, liveVersion = '1.3.1') {
  return readChromeStoreStatus({
    publishedItemRevisionStatus: {
      state: 'PUBLISHED',
      distributionChannels: [{ crxVersion: liveVersion, deployPercentage: 100 }],
    },
    submittedItemRevisionStatus: {
      state,
      distributionChannels: [{ crxVersion: submittedVersion, deployPercentage: 100 }],
    },
  });
}

describe('release workflow decisions', () => {
  it('accepts production release tags and rejects prereleases', () => {
    expect(normalizeReleaseInput('1.2.3')).toBe('v1.2.3');
    expect(normalizeReleaseInput('v1.2.3')).toBe('v1.2.3');
    expect(() => normalizeReleaseInput('1.2.3-beta.1')).toThrow('production SemVer');
  });

  it('covers Chrome publish, review, terminal, and existing-version decisions', () => {
    expect(
      decideChromePublishAction(chromeStatus('1.3.2', 'PUBLISHED', '1.3.2'), '1.3.2').action,
    ).toBe('skip');
    expect(decideChromePublishAction(chromeStatus('1.3.2', 'PENDING_REVIEW'), '1.3.2').action).toBe(
      'skip',
    );
    expect(decideChromePublishAction(chromeStatus('1.3.3', 'PENDING_REVIEW'), '1.3.2').action).toBe(
      'skip',
    );
    for (const state of ['CANCELLED', 'REJECTED']) {
      expect(decideChromePublishAction(chromeStatus('1.3.3', state), '1.3.4').action).toBe(
        'publish',
      );
      expect(isBlockingChromeSubmissionState(state)).toBe(false);
    }
    expect(isBlockingChromeSubmissionState('PENDING_REVIEW')).toBe(true);
  });

  it('covers Firefox duplicate detection and review states', () => {
    expect(
      decideFirefoxPublishAction([{ version: '1.3.2', file: { status: 'unreviewed' } }], '1.3.2')
        .action,
    ).toBe('skip');
    expect(isActiveFirefoxReviewStatus('disabled')).toBe(false);
    expect(isActiveFirefoxReviewStatus('awaiting-review')).toBe(true);
  });

  it('validates Edge operation identifiers', () => {
    expect(
      extractOperationIdFromLocation(
        'https://api.addons.microsoftedge.microsoft.com/v1/products/id/operations/op-123',
      ),
    ).toBe('op-123');
    expect(() => extractOperationIdFromLocation('')).toThrow('Location header');
  });

  it('handles tracked Edge preflight state without reusing stale operations', async () => {
    expect(
      decideEdgePreflightAction(
        { status: 'InProgress', message: '', errorCode: '', errors: null },
        '1.3.2',
        '1.3.2',
      ).action,
    ).toBe('skip');

    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchTrackedPublishOperation({
        authHeaders: {},
        operationId: 'old',
        operationVersion: '1.3.2',
        productId: 'product',
        targetVersion: '1.3.4',
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('classifies successful, conflicting, empty, and invalid Edge operations', () => {
    const cases = [
      [
        {
          status: 'Succeeded',
          message: 'Successfully created submission',
          errorCode: '',
          errors: null,
        },
        { action: 'submitted', failed: false, terminal: true },
      ],
      [
        {
          status: 'Failed',
          message: 'submission is in progress',
          errorCode: 'InProgressSubmission',
          errors: null,
        },
        { action: 'skipped-in-review', failed: false, terminal: true },
      ],
      [
        {
          status: 'Failed',
          message: 'there are no updates',
          errorCode: 'NoModulesUpdated',
          errors: null,
        },
        { action: 'skipped-no-updates', failed: false, terminal: true },
      ],
      [
        {
          status: 'Failed',
          message: 'cannot publish',
          errorCode: 'Validation',
          errors: ['missing'],
        },
        { action: 'failed', failed: true, terminal: true },
      ],
    ] as const;
    for (const [operation, expected] of cases) {
      expect(classifyEdgePublishOperation(operation)).toEqual(expected);
    }
  });

  it('resolves Edge live, pending, and in-progress store states', () => {
    expect(
      resolveEdgeStoreStatus({
        errorCode: '',
        liveVersion: '1.1.6',
        operationStatus: 'Succeeded',
        operationVersion: '1.2.4',
      }).canPublishNow,
    ).toBe('No');
    expect(
      resolveEdgeStoreStatus({
        errorCode: '',
        liveVersion: '1.2.4',
        operationStatus: 'Succeeded',
        operationVersion: '1.2.4',
      }).reviewState,
    ).toBe('Published');
    expect(
      resolveEdgeStoreStatus({
        errorCode: 'InProgressSubmission',
        liveVersion: '1.1.6',
        operationStatus: 'Failed',
        operationVersion: '1.2.4',
      }).reviewState,
    ).toBe('Submission in progress');
  });

  it('reports incomplete publishability data', () => {
    const rows: StoreStatusRow[] = [
      {
        store: 'Firefox AMO',
        liveVersion: '1.1.10',
        pendingVersion: '-',
        reviewState: 'Published',
        canPublishNow: 'Yes',
        rawStatus: 'public',
        notes: 'checked',
      },
      {
        store: 'Edge Add-ons',
        liveVersion: '1.1.6',
        pendingVersion: 'Not tracked',
        reviewState: 'Not tracked',
        canPublishNow: 'Unknown',
        rawStatus: 'missing operation',
        notes: 'checked',
      },
    ];
    expect(buildDecision('1.2.3', rows)).toContain('incomplete publishability data');
  });
});

describe('store package validation', () => {
  it('rejects a stale package even when its filename matches the release', () => {
    expect(() =>
      validatePackageManifest(
        { manifest_version: 3, version: '1.3.7', key: identity.chromiumPublicKey },
        '2.0.1',
        'chromium',
      ),
    ).toThrow('version');
  });
  it('rejects another Firefox identity and accepts the intended listing', () => {
    const manifest = {
      manifest_version: 3,
      version: '2.0.1',
      browser_specific_settings: { gecko: { id: 'unrelated@example.org' } },
    };
    expect(() => validatePackageManifest(manifest, '2.0.1', 'firefox')).toThrow('identity');
    manifest.browser_specific_settings.gecko.id = identity.firefoxId;
    expect(() => validatePackageManifest(manifest, '2.0.1', 'firefox')).not.toThrow();
  });
  it('rejects a different Chromium key', () => {
    expect(() =>
      validatePackageManifest(
        { manifest_version: 3, version: '2.0.1', key: 'wrong' },
        '2.0.1',
        'chromium',
      ),
    ).toThrow('identity');
  });
});
