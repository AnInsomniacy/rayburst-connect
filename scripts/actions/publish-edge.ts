import { requireStoreIdentity, validatePackage } from './workflow-utils';
import { readFile } from 'node:fs/promises';

import {
  configured,
  fetchJson,
  findZipByNamePart,
  isRecord,
  optionalEnv,
  requiredEnv,
  stringField,
} from './workflow-utils';

type EdgeVariableUpdateInput = {
  operationId: string;
  runId: string;
  submittedAt: string;
  version: string;
};

type EdgePublishOperation = {
  errorCode: string;
  errors: unknown;
  message: string;
  status: string;
};

type EdgePublishOperationAction =
  | 'failed'
  | 'pending'
  | 'published'
  | 'skipped-in-review'
  | 'skipped-no-updates';

type EdgePublishOperationDecision = {
  action: EdgePublishOperationAction;
  failed: boolean;
  terminal: boolean;
};

type EdgePreflightDecision = {
  action: 'publish' | 'skip';
  reason: string;
};

export function extractOperationIdFromLocation(location: string): string {
  if (!location) {
    throw new Error('Edge Add-ons response did not include a Location header');
  }
  const normalized = location.trim().replace(/\/+$/, '');
  const operationId = normalized.split('/').pop() || '';
  if (!operationId) {
    throw new Error(`Failed to extract Edge operation id from Location header: ${location}`);
  }
  return operationId;
}

function buildEdgeVariableUpdates(input: EdgeVariableUpdateInput): Record<string, string> {
  return {
    EDGE_LAST_OPERATION_ID: input.operationId,
    EDGE_LAST_OPERATION_VERSION: input.version,
    EDGE_LAST_OPERATION_RUN_ID: input.runId,
    EDGE_LAST_OPERATION_SUBMITTED_AT: input.submittedAt,
  };
}

export function classifyEdgePublishOperation(
  operation: EdgePublishOperation,
): EdgePublishOperationDecision {
  if (operation.status === 'Succeeded') {
    return { action: 'published', failed: false, terminal: true };
  }

  if (operation.status === 'InProgress') {
    return { action: 'pending', failed: false, terminal: false };
  }

  if (operation.status === 'Failed') {
    switch (operation.errorCode) {
      case 'InProgressSubmission':
        return { action: 'skipped-in-review', failed: false, terminal: true };
      case 'NoModulesUpdated':
        return { action: 'skipped-no-updates', failed: false, terminal: true };
      default:
        return { action: 'failed', failed: true, terminal: true };
    }
  }

  if (operation.message) {
    return { action: 'failed', failed: true, terminal: true };
  }

  return { action: 'pending', failed: false, terminal: false };
}

export function decideEdgePreflightAction(
  operation: EdgePublishOperation,
  operationVersion: string,
  targetVersion: string,
): EdgePreflightDecision {
  if (operationVersion !== targetVersion) {
    return { action: 'publish', reason: 'Edge Add-ons can accept upload' };
  }

  if (operation.status === 'InProgress') {
    return {
      action: 'skip',
      reason: `Edge Add-ons already has version ${targetVersion} submitted as InProgress`,
    };
  }

  if (operation.status === 'Succeeded') {
    return {
      action: 'skip',
      reason: `Edge Add-ons already has version ${targetVersion} submitted`,
    };
  }

  if (operation.status === 'Failed' && operation.errorCode === 'InProgressSubmission') {
    return {
      action: 'skip',
      reason: `Edge Add-ons already has version ${targetVersion} submitted as InProgressSubmission`,
    };
  }

  return { action: 'publish', reason: 'Edge Add-ons can accept upload' };
}

async function publishEdgeFromEnv(): Promise<void> {
  requireStoreIdentity('edgeId', requiredEnv('EDGE_EXTENSION_ID'));
  const productId = requiredEnv('EDGE_PRODUCT_ID');
  requireStoreIdentity('edgeProductId', productId);
  const clientId = requiredEnv('EDGE_CLIENT_ID');
  const apiKey = requiredEnv('EDGE_API_KEY');
  const version = requiredEnv('VERSION');
  const zipPath = optionalEnv('ZIP_PATH') || findZipByNamePart('chromium-mv3');
  validatePackage(zipPath, version, 'chromium');
  const authHeaders = {
    Authorization: `ApiKey ${apiKey}`,
    'X-ClientID': clientId,
  };
  const preflight = await fetchTrackedPublishOperation({
    authHeaders,
    operationId: optionalEnv('EDGE_LAST_OPERATION_ID'),
    operationVersion: optionalEnv('EDGE_LAST_OPERATION_VERSION'),
    productId,
    targetVersion: version,
  });
  if (preflight) {
    const decision = decideEdgePreflightAction(
      preflight,
      optionalEnv('EDGE_LAST_OPERATION_VERSION'),
      version,
    );
    if (decision.action === 'skip') {
      console.log(`::notice::${decision.reason}`);
      return;
    }
  }

  const uploadOperationId = await uploadDraftPackage({ authHeaders, productId, zipPath });
  await waitForPackageValidation({ authHeaders, operationId: uploadOperationId, productId });
  const publishOperationId = await submitForReview({ authHeaders, productId });
  if (!publishOperationId) return;

  const publishResult = await waitForPublishOperation({
    authHeaders,
    operationId: publishOperationId,
    productId,
  });

  const updates = buildEdgeVariableUpdates({
    operationId: publishOperationId,
    runId: optionalEnv('GITHUB_RUN_ID') || '0',
    submittedAt: new Date().toISOString(),
    version,
  });

  if (publishResult.decision.action === 'skipped-in-review') {
    console.log('::notice::Edge Add-ons: another submission is currently in review');
    await saveRepositoryVariables(updates);
    return;
  }

  if (publishResult.decision.action === 'skipped-no-updates') {
    console.log('::notice::Edge Add-ons: no publishable draft updates were found');
    await saveRepositoryVariables(updates);
    return;
  }

  if (publishResult.decision.failed) {
    throw new Error(
      `Edge Add-ons publish operation failed: ${formatEdgeOperation(publishResult.operation)}`,
    );
  }

  await saveRepositoryVariables(updates);
}

async function uploadDraftPackage(input: {
  authHeaders: Record<string, string>;
  productId: string;
  zipPath: string;
}): Promise<string> {
  const response = await fetch(
    `https://api.addons.microsoftedge.microsoft.com/v1/products/${input.productId}/submissions/draft/package`,
    {
      method: 'POST',
      headers: {
        ...input.authHeaders,
        'Content-Type': 'application/zip',
      },
      body: await readFile(input.zipPath),
    },
  );
  const text = await response.text();
  console.log(`Upload HTTP status: ${response.status}`);
  if (response.status !== 202) {
    throw new Error(`Edge Add-ons upload failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  }
  return extractOperationIdFromLocation(response.headers.get('location') || '');
}

async function waitForPackageValidation(input: {
  authHeaders: Record<string, string>;
  operationId: string;
  productId: string;
}): Promise<void> {
  let status: string;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await sleep(10_000);
    const response = await fetchJson(
      `https://api.addons.microsoftedge.microsoft.com/v1/products/${input.productId}/submissions/draft/package/operations/${input.operationId}`,
      { headers: input.authHeaders },
    );
    status = stringField(response, 'status') || stringField(response, 'Status');
    console.log(`Upload validation attempt ${attempt}: ${status || 'unknown'}`);
    if (status === 'Succeeded') return;
    if (status === 'Failed') {
      throw new Error(`Edge Add-ons package validation failed: ${JSON.stringify(response)}`);
    }
  }
  throw new Error('Edge Add-ons upload timed out after 5 minutes');
}

async function submitForReview(input: {
  authHeaders: Record<string, string>;
  productId: string;
}): Promise<string> {
  const response = await fetch(
    `https://api.addons.microsoftedge.microsoft.com/v1/products/${input.productId}/submissions`,
    {
      method: 'POST',
      headers: {
        ...input.authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes: 'Automated submission via CI/CD pipeline.' }),
    },
  );
  const text = await response.text();
  console.log(`Publish HTTP status: ${response.status}`);

  if (response.status !== 202 && response.status !== 200) {
    throw new Error(`Edge Add-ons publish failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  }

  const locationOperationId = response.headers.get('location')
    ? extractOperationIdFromLocation(response.headers.get('location') || '')
    : '';
  if (locationOperationId) return locationOperationId;

  const body = text ? (JSON.parse(text) as unknown) : {};
  const bodyOperationId = isRecord(body)
    ? stringField(body, 'operationId') ||
      stringField(body, 'id') ||
      stringField(body, 'operationID')
    : '';
  if (!bodyOperationId) {
    throw new Error('Edge Add-ons publish response did not include an operation id');
  }
  return bodyOperationId;
}

async function waitForPublishOperation(input: {
  authHeaders: Record<string, string>;
  operationId: string;
  productId: string;
}): Promise<{
  decision: EdgePublishOperationDecision;
  operation: EdgePublishOperation;
}> {
  let operation = emptyEdgePublishOperation();
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await sleep(10_000);
    const response = await fetchJson(
      `https://api.addons.microsoftedge.microsoft.com/v1/products/${input.productId}/submissions/operations/${input.operationId}`,
      { headers: input.authHeaders },
    );
    operation = readEdgePublishOperation(response);
    const decision = classifyEdgePublishOperation(operation);
    console.log(`Publish operation attempt ${attempt}: ${formatEdgeOperation(operation)}`);
    if (decision.terminal) return { decision, operation };
  }

  return {
    decision: { action: 'pending', failed: false, terminal: false },
    operation,
  };
}

export async function fetchTrackedPublishOperation(input: {
  authHeaders: Record<string, string>;
  operationId: string;
  operationVersion: string;
  productId: string;
  targetVersion: string;
}): Promise<EdgePublishOperation | undefined> {
  if (!configured(input.operationId) || input.operationVersion !== input.targetVersion) {
    return undefined;
  }

  const url = `https://api.addons.microsoftedge.microsoft.com/v1/products/${input.productId}/submissions/operations/${input.operationId}`;
  const response = await fetch(url, { headers: input.authHeaders });
  const text = await response.text();
  if (response.status === 404) {
    console.log('::notice::Edge Add-ons: tracked publish operation is no longer available');
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`${url} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  }
  return readEdgePublishOperation(text ? (JSON.parse(text) as unknown) : {});
}

function readEdgePublishOperation(value: unknown): EdgePublishOperation {
  return {
    errorCode: stringField(value, 'errorCode') || stringField(value, 'ErrorCode'),
    errors: isRecord(value) ? value.errors : null,
    message: stringField(value, 'message') || stringField(value, 'Message'),
    status: stringField(value, 'status') || stringField(value, 'Status'),
  };
}

function emptyEdgePublishOperation(): EdgePublishOperation {
  return { errorCode: '', errors: null, message: '', status: '' };
}

function formatEdgeOperation(operation: EdgePublishOperation): string {
  return [
    `status=${operation.status || 'unknown'}`,
    operation.errorCode ? `errorCode=${operation.errorCode}` : '',
    operation.message ? `message=${operation.message}` : '',
    formatEdgeErrors(operation.errors),
  ]
    .filter(Boolean)
    .join(', ');
}

function formatEdgeErrors(errors: unknown): string {
  if (errors === null || errors === undefined) return '';
  return `errors=${JSON.stringify(errors).slice(0, 500)}`;
}

async function saveRepositoryVariables(updates: Record<string, string>): Promise<void> {
  const repo = optionalEnv('GITHUB_REPOSITORY');
  const token = optionalEnv('REPO_VARIABLES_TOKEN') || optionalEnv('GITHUB_TOKEN');
  if (!repo || !configured(token)) {
    console.log(
      '::warning::Skipping Edge operation state save because repository or token is missing',
    );
    return;
  }

  for (const [name, value] of Object.entries(updates)) {
    await upsertRepositoryVariable({ name, repo, token, value });
  }
}

async function upsertRepositoryVariable(input: {
  name: string;
  repo: string;
  token: string;
  value: string;
}): Promise<void> {
  const baseUrl = `https://api.github.com/repos/${input.repo}/actions/variables`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${input.token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const updateResponse = await fetch(`${baseUrl}/${input.name}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: input.name, value: input.value }),
  });
  if (updateResponse.ok) return;

  if (updateResponse.status !== 404) {
    const text = await updateResponse.text();
    console.log(
      `::warning::Failed to update repository variable ${input.name}: HTTP ${updateResponse.status} ${text.slice(0, 160)}`,
    );
    return;
  }

  const createResponse = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: input.name, value: input.value }),
  });
  if (createResponse.ok) return;

  const text = await createResponse.text();
  console.log(
    `::warning::Failed to create repository variable ${input.name}: HTTP ${createResponse.status} ${text.slice(0, 160)}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1]?.endsWith('/publish-edge.ts')) {
  publishEdgeFromEnv().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
