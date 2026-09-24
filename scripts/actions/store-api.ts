import crypto from 'node:crypto';
import { fetchJson, isRecord, numberField, stringField } from './workflow-utils';

export type ChromeConfig = {
  clientId: string;
  clientSecret: string;
  extensionId: string;
  publisherId: string;
  refreshToken: string;
};

export type ChromeRevision = {
  state: string;
  version: string;
};

export async function fetchEdge(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Edge Publish API HTTP ${response.status}: verify EDGE_CLIENT_ID and EDGE_API_KEY against Partner Center > Publish API. Use the current API key and its paired Client ID, not legacy OAuth credentials. Browser sign-in does not authenticate GitHub Actions.`,
    );
  }
  return response;
}

export async function fetchEdgeJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchEdge(url, init);
  if (!response.ok) throw new Error(`Edge Publish API HTTP ${response.status}`);
  return response.json();
}

export async function getGoogleAccessToken(config: ChromeConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });
  const data = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = stringField(data, 'access_token');
  if (!token) throw new Error('Chrome OAuth token response did not include access_token');
  return token;
}

export function readChromeRevision(revision: unknown): ChromeRevision {
  const channels =
    isRecord(revision) && Array.isArray(revision.distributionChannels)
      ? revision.distributionChannels
      : [];
  const channel =
    channels.find((candidate) => numberField(candidate, 'deployPercentage') === 100) ||
    channels.find((candidate) => isRecord(candidate)) ||
    {};
  return {
    state: stringField(revision, 'state'),
    version: stringField(channel, 'crxVersion'),
  };
}

export async function getFirefoxVersions(
  slug: string,
  authHeader: string,
  filter = '',
): Promise<unknown[]> {
  const params = new URLSearchParams({ page_size: '10' });
  if (filter) params.set('filter', filter);
  const data = await fetchJson(
    `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(slug)}/versions/?${params}`,
    {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  );
  return isRecord(data) && Array.isArray(data.results) ? data.results : [];
}

export function createAmoJwt(input: { apiKey: string; apiSecret: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: input.apiKey,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 60,
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .createHmac('sha256', input.apiSecret)
    .update(unsigned)
    .digest('base64url');
  return `JWT ${unsigned}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
