import identity from '../../browser-identity.json';
import { validatePackage, findZipByNamePart, fetchJson } from './workflow-utils';
import { createAmoJwt, getFirefoxVersions } from './store-api';

import { requiredEnv, runCommand, stringField } from './workflow-utils';

type FirefoxPublishDecision = {
  action: 'publish' | 'skip';
  reason: string;
};

export function decideFirefoxPublishAction(
  versions: unknown[],
  targetVersion: string,
): FirefoxPublishDecision {
  const exists = versions.some((version) => stringField(version, 'version') === targetVersion);
  if (exists) {
    return {
      action: 'skip',
      reason: `Firefox AMO already has version ${targetVersion}`,
    };
  }
  return { action: 'publish', reason: 'Firefox AMO can accept upload' };
}

async function publishFirefoxFromEnv(): Promise<void> {
  const apiKey = requiredEnv('FIREFOX_API_KEY');
  const apiSecret = requiredEnv('FIREFOX_API_SECRET');
  const version = requiredEnv('VERSION');
  const slug = identity.stores.firefoxSlug;
  validatePackage(findZipByNamePart('firefox-mv3'), version, 'firefox');
  const addon = await fetchJson(
    `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(slug)}/`,
  );
  if (stringField(addon, 'guid') !== identity.firefoxId)
    throw new Error('AMO listing identity does not match the package');
  const authHeader = createAmoJwt({ apiKey, apiSecret });
  const versions = await getFirefoxVersions(slug, authHeader, 'all_without_unlisted');
  const decision = decideFirefoxPublishAction(versions, version);

  if (decision.action === 'skip') {
    console.log(`::notice::${decision.reason}`);
    return;
  }

  const output = runCommand('./node_modules/.bin/web-ext', [
    'sign',
    '--source-dir',
    '.output/firefox-mv3',
    '--channel',
    'listed',
    '--api-key',
    apiKey,
    '--api-secret',
    apiSecret,
    '--upload-source-code',
    'source-code.zip',
    '--approval-timeout',
    '0',
  ]);
  console.log(output.output);
  if (output.exitCode !== 0) {
    throw new Error(`Firefox AMO signing failed: ${output.output.slice(0, 500)}`);
  }
}

if (process.argv[1]?.endsWith('/publish-firefox.ts')) {
  publishFirefoxFromEnv().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
