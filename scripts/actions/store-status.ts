import identity from '../../browser-identity.json';
import {
  fetchEdgeJson,
  getGoogleAccessToken,
  readChromeRevision,
  createAmoJwt,
  getFirefoxVersions,
  type ChromeConfig,
} from './store-api';
import { execFileSync } from 'node:child_process';

import {
  appendStepSummary,
  configured,
  escapeCode,
  fetchJson,
  fetchText,
  isRecord,
  md,
  optionalEnv,
  requiredEnv,
  stringField,
} from './workflow-utils';
import { isBlockingChromeSubmissionState } from './publish-chrome';

export type StoreStatusRow = {
  store: string;
  liveVersion: string;
  pendingVersion: string;
  reviewState: string;
  canPublishNow: 'Yes' | 'No' | 'Unknown';
  rawStatus: string;
  notes: string;
};

type StoreStatusReportInput = {
  checkedAt: string;
  releaseTag: string;
  releaseVersion: string;
  stores: StoreStatusRow[];
};

type EdgeStoreStatusInput = {
  errorCode: string;
  liveVersion: string;
  operationStatus: string;
  operationVersion: string;
};

type EdgeStoreStatus = Pick<StoreStatusRow, 'pendingVersion' | 'reviewState' | 'canPublishNow'>;

type FirefoxConfig = {
  apiKey: string;
  apiSecret: string;
  slug: string;
};

type EdgeConfig = {
  apiKey: string;
  clientId: string;
  extensionId: string;
  operationId: string;
  operationRunId: string;
  operationSubmittedAt: string;
  operationVersion: string;
  productId: string;
};

async function runStoreStatusFromEnv(): Promise<void> {
  const releaseTag = requiredEnv('RELEASE_TAG');
  const releaseVersion = requiredEnv('RELEASE_VERSION');
  const checkedAt = new Date().toISOString();
  const stores = await Promise.all([
    withStoreError('Chrome Web Store', () =>
      checkChrome({
        clientId: optionalEnv('CHROME_CLIENT_ID'),
        clientSecret: optionalEnv('CHROME_CLIENT_SECRET'),
        extensionId: identity.stores.chromeId,
        publisherId: optionalEnv('CHROME_PUBLISHER_ID'),
        refreshToken: optionalEnv('CHROME_REFRESH_TOKEN'),
      }),
    ),
    withStoreError('Firefox AMO', () =>
      checkFirefox({
        apiKey: optionalEnv('FIREFOX_API_KEY'),
        apiSecret: optionalEnv('FIREFOX_API_SECRET'),
        slug: identity.stores.firefoxSlug,
      }),
    ),
    withStoreError('Edge Add-ons', () =>
      checkEdge({
        apiKey: optionalEnv('EDGE_API_KEY'),
        clientId: optionalEnv('EDGE_CLIENT_ID'),
        extensionId: identity.stores.edgeId,
        operationId: optionalEnv('EDGE_LAST_OPERATION_ID'),
        operationRunId: optionalEnv('EDGE_LAST_OPERATION_RUN_ID'),
        operationSubmittedAt: optionalEnv('EDGE_LAST_OPERATION_SUBMITTED_AT'),
        operationVersion: optionalEnv('EDGE_LAST_OPERATION_VERSION'),
        productId: identity.stores.edgeProductId,
      }),
    ),
  ]);

  const report = renderStoreStatusReport({ checkedAt, releaseTag, releaseVersion, stores });
  appendStepSummary(report);
  console.log(report);
}

function renderStoreStatusReport(input: StoreStatusReportInput): string {
  const decision = buildDecision(input.releaseVersion, input.stores);
  const lines = [
    '## Store Release Status',
    '',
    `Release: ${input.releaseTag}`,
    `Checked at: ${input.checkedAt}`,
    '',
    '| Store | Live version | Pending version | Review state | Can publish now |',
    '|---|---:|---:|---|---|',
    ...input.stores.map(
      (store) =>
        `| ${store.store} | ${md(store.liveVersion)} | ${md(store.pendingVersion)} | ${md(store.reviewState)} | ${md(store.canPublishNow)} |`,
    ),
    '',
    '### Details',
    '',
    '| Store | Raw status | Notes |',
    '|---|---|---|',
    ...input.stores.map(
      (store) => `| ${store.store} | \`${escapeCode(store.rawStatus)}\` | ${md(store.notes)} |`,
    ),
    '',
    '### Decision',
    '',
    decision,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function buildDecision(releaseVersion: string, stores: StoreStatusRow[]): string {
  const blockers = stores.filter((store) => store.canPublishNow === 'No');
  const behind = stores.filter(
    (store) => isVersion(store.liveVersion) && store.liveVersion !== releaseVersion,
  );
  const unknown = stores.filter((store) => store.canPublishNow === 'Unknown');

  if (blockers.length > 0) {
    return `Do not submit another release yet. ${storeNames(blockers)} already has an active submission or review blocker.`;
  }

  if (behind.length > 0 || unknown.length > 0) {
    return [
      'Review before publishing.',
      `Stores behind the target release: ${storeNames(behind) || 'none'}.`,
      `Stores with incomplete publishability data: ${storeNames(unknown) || 'none'}.`,
    ].join(' ');
  }

  return 'All checked stores match the target release and no active review blocker was detected.';
}

async function withStoreError(
  name: string,
  fn: () => Promise<StoreStatusRow>,
): Promise<StoreStatusRow> {
  try {
    return await fn();
  } catch (error) {
    return {
      store: name,
      liveVersion: 'Unavailable',
      pendingVersion: 'Unavailable',
      reviewState: 'Unavailable',
      canPublishNow: 'Unknown',
      rawStatus: error instanceof Error ? error.message : String(error),
      notes: 'Status query failed.',
    };
  }
}

async function checkChrome(chrome: ChromeConfig): Promise<StoreStatusRow> {
  const publicVersion = await getChromePublicVersion(chrome.extensionId);
  if (
    !configured(chrome.publisherId) ||
    !configured(chrome.clientId) ||
    !configured(chrome.clientSecret) ||
    !configured(chrome.refreshToken)
  ) {
    return {
      store: 'Chrome Web Store',
      liveVersion: publicVersion || 'Unavailable',
      pendingVersion: 'Not checked',
      reviewState: 'Not checked',
      canPublishNow: 'Unknown',
      rawStatus: 'missing Chrome publisher id or OAuth secrets',
      notes:
        'Public version was checked. Review status requires Chrome Web Store API v2 credentials.',
    };
  }

  const token = await getGoogleAccessToken(chrome);
  const name = `publishers/${chrome.publisherId}/items/${chrome.extensionId}`;
  const status = await fetchJson(`https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const published = readChromeRevision(
    isRecord(status) ? status.publishedItemRevisionStatus : undefined,
  );
  const submitted = readChromeRevision(
    isRecord(status) ? status.submittedItemRevisionStatus : undefined,
  );
  const liveVersion = published.version || publicVersion || 'Unavailable';
  const hasBlockingSubmission =
    Boolean(submitted.version || submitted.state) &&
    isBlockingChromeSubmissionState(submitted.state);
  const pendingVersion =
    hasBlockingSubmission && submitted.version && submitted.version !== liveVersion
      ? submitted.version
      : '-';
  const reviewState = mapChromeState(submitted.state || published.state);
  const canPublishNow = hasBlockingSubmission
    ? 'No'
    : published.state !== 'PUBLISHED' || (isRecord(status) && status.takenDown === true)
      ? 'Unknown'
      : 'Yes';

  return {
    store: 'Chrome Web Store',
    liveVersion,
    pendingVersion,
    reviewState,
    canPublishNow,
    rawStatus: [
      `published=${published.state || 'unset'}`,
      `submitted=${submitted.state || 'unset'}`,
      isRecord(status) && status.warned === true ? 'warned=true' : '',
      isRecord(status) && status.takenDown === true ? 'takenDown=true' : '',
    ]
      .filter(Boolean)
      .join(', '),
    notes:
      isRecord(status) && status.takenDown === true
        ? 'Item is taken down.'
        : isRecord(status) && status.warned === true
          ? 'Item has a policy warning.'
          : 'Chrome API status fetched.',
  };
}

async function getChromePublicVersion(extensionId: string): Promise<string> {
  if (!configured(extensionId)) return '';
  const url = `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=146.0.0.0&acceptformat=crx3&x=id%3D${encodeURIComponent(extensionId)}%26uc`;
  const text = await fetchText(url);
  const match = text.match(/<updatecheck\b[^>]*\bversion="([^"]+)"/);
  return match?.[1] || '';
}

function mapChromeState(state: string): string {
  switch (state) {
    case 'PENDING_REVIEW':
      return 'In review';
    case 'STAGED':
      return 'Approved, staged';
    case 'PUBLISHED':
      return 'Published';
    case 'PUBLISHED_TO_TESTERS':
      return 'Published to testers';
    case 'REJECTED':
      return 'Rejected';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return state || 'No active submission';
  }
}

export async function checkFirefox(firefox: FirefoxConfig): Promise<StoreStatusRow> {
  const publicVersions = await getFirefoxVersions(firefox.slug, '');
  const publicLive = publicVersions.find((version) => firefoxStatus(version) === 'public');
  const authHeader =
    configured(firefox.apiKey) && configured(firefox.apiSecret) ? createAmoJwt(firefox) : '';
  const versions = authHeader
    ? await getFirefoxVersions(firefox.slug, authHeader, 'all_without_unlisted')
    : publicVersions;
  const latest = versions[0];
  const pending = versions.find((version) => isActiveFirefoxReviewStatus(firefoxStatus(version)));
  const liveVersion = stringField(publicLive, 'version') || 'Unavailable';
  const pendingVersion =
    stringField(pending, 'version') && stringField(pending, 'version') !== liveVersion
      ? stringField(pending, 'version')
      : '-';
  const activeStatus = pending ? firefoxStatus(pending) : firefoxStatus(latest);

  return {
    store: 'Firefox AMO',
    liveVersion,
    pendingVersion,
    reviewState: mapFirefoxState(activeStatus),
    canPublishNow: !authHeader
      ? 'Unknown'
      : pending
        ? 'No'
        : activeStatus === 'public' || activeStatus === 'disabled'
          ? 'Yes'
          : 'Unknown',
    rawStatus: activeStatus ? `file.status=${activeStatus}` : 'no versions returned',
    notes: authHeader
      ? 'AMO developer version list fetched.'
      : 'Public version was checked. Review status requires AMO API credentials.',
  };
}

function firefoxStatus(version: unknown): string {
  const file = isRecord(version) ? version.file : undefined;
  return stringField(file, 'status');
}

export function isActiveFirefoxReviewStatus(status: string): boolean {
  return status === 'unreviewed' || status === 'awaiting-review';
}

function mapFirefoxState(status: string): string {
  switch (status) {
    case 'public':
      return 'Published';
    case 'unreviewed':
    case 'awaiting-review':
      return 'Awaiting review';
    case 'disabled':
      return 'Disabled or rejected';
    default:
      return status || 'No active submission';
  }
}

async function checkEdge(edge: EdgeConfig): Promise<StoreStatusRow> {
  const liveVersion = await getEdgePublicVersion(edge.extensionId);
  if (!configured(edge.operationId)) {
    return {
      store: 'Edge Add-ons',
      liveVersion: liveVersion || 'Unavailable',
      pendingVersion: 'Not tracked',
      reviewState: 'Not tracked',
      canPublishNow: 'Unknown',
      rawStatus: 'no Edge operation id provided',
      notes:
        'Live package was checked. Review status and API credentials were not verified: no saved publish operation ID. Check Partner Center for manual submissions.',
    };
  }

  if (!configured(edge.productId) || !configured(edge.clientId) || !configured(edge.apiKey)) {
    return {
      store: 'Edge Add-ons',
      liveVersion: liveVersion || 'Unavailable',
      pendingVersion: edge.operationVersion || 'Tracked operation',
      reviewState: 'Not checked',
      canPublishNow: 'Unknown',
      rawStatus: 'missing Edge API credentials',
      notes: 'Live package was checked. Operation lookup requires Edge API credentials.',
    };
  }

  const operation = await fetchEdgeJson(
    `https://api.addons.microsoftedge.microsoft.com/v1/products/${edge.productId}/submissions/operations/${edge.operationId}`,
    {
      headers: {
        Authorization: `ApiKey ${edge.apiKey}`,
        'X-ClientID': edge.clientId,
      },
    },
  );
  const status = stringField(operation, 'status') || stringField(operation, 'Status');
  const message = stringField(operation, 'message') || stringField(operation, 'Message');
  const errorCode = stringField(operation, 'errorCode') || stringField(operation, 'ErrorCode');

  return {
    store: 'Edge Add-ons',
    liveVersion: liveVersion || 'Unavailable',
    ...resolveEdgeStoreStatus({
      errorCode,
      liveVersion,
      operationStatus: status,
      operationVersion: edge.operationVersion,
    }),
    rawStatus: [
      `operation.status=${status || 'unset'}`,
      errorCode ? `errorCode=${errorCode}` : '',
      message ? `message=${message}` : '',
      formatEdgeErrors(isRecord(operation) ? operation.errors : null),
      edge.operationRunId ? `run=${edge.operationRunId}` : '',
      edge.operationSubmittedAt ? `submitted=${edge.operationSubmittedAt}` : '',
    ]
      .filter(Boolean)
      .join(', '),
    notes: `Operation ${edge.operationId} checked.`,
  };
}

export function resolveEdgeStoreStatus(input: EdgeStoreStatusInput): EdgeStoreStatus {
  const pendingVersion = resolveEdgePendingVersion(input.liveVersion, input.operationVersion);

  if (input.operationStatus === 'Succeeded') {
    if (pendingVersion === '-') {
      return {
        pendingVersion,
        reviewState: 'Published',
        canPublishNow: 'Yes',
      };
    }

    return {
      pendingVersion,
      reviewState: 'Submitted, not live yet',
      canPublishNow: 'No',
    };
  }

  return {
    pendingVersion,
    reviewState: mapEdgeState(input.operationStatus, input.errorCode),
    canPublishNow: mapEdgeCanPublish(input.operationStatus, input.errorCode),
  };
}

function resolveEdgePendingVersion(liveVersion: string, operationVersion: string): string {
  if (!operationVersion) return 'Tracked operation';
  return operationVersion === liveVersion ? '-' : operationVersion;
}

async function getEdgePublicVersion(extensionId: string): Promise<string> {
  if (!configured(extensionId)) return '';
  const url = `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prodversion=146.0.0.0&acceptformat=crx3&x=id%3D${encodeURIComponent(extensionId)}%26installsource%3Dondemand%26uc`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Edge public package request failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const manifest = readManifestFromCrx(buffer);
  return stringField(manifest, 'version');
}

function mapEdgeState(status: string, errorCode = ''): string {
  if (status === 'Failed' && errorCode === 'InProgressSubmission') {
    return 'Submission in progress';
  }
  if (status === 'Failed' && errorCode === 'NoModulesUpdated') {
    return 'No draft updates';
  }

  switch (status) {
    case 'InProgress':
      return 'In progress';
    case 'Succeeded':
      return 'Submitted, not live yet';
    case 'Failed':
      return 'Failed';
    default:
      return status || 'Not tracked';
  }
}

function mapEdgeCanPublish(status: string, errorCode: string): 'Yes' | 'No' | 'Unknown' {
  if (status === 'InProgress' || errorCode === 'InProgressSubmission') return 'No';
  return 'Unknown';
}

function formatEdgeErrors(errors: unknown): string {
  if (errors === null || errors === undefined) return '';
  return `errors=${JSON.stringify(errors).slice(0, 500)}`;
}

export function readManifestFromCrx(buffer: Buffer): unknown {
  // zipfile handles the CRX prefix and ZIP directory without a custom archive parser.
  const json = execFileSync(
    'python3',
    [
      '-c',
      `
import io, sys, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    info = archive.getinfo('manifest.json')
    if info.file_size > 1024 * 1024:
        raise ValueError('manifest.json exceeds 1 MiB')
    sys.stdout.buffer.write(archive.read(info))
`,
    ],
    { input: buffer, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000 },
  );
  return JSON.parse(json) as unknown;
}

function storeNames(stores: StoreStatusRow[]): string {
  return stores.map((store) => store.store).join(', ');
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/.test(value);
}

if (process.argv[1]?.endsWith('/store-status.ts')) {
  runStoreStatusFromEnv().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
