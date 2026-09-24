import { requiredEnv, runText, setOutput } from './workflow-utils';

export function normalizeReleaseInput(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error('Release input is required');
  }
  if (value === 'latest') return value;
  const tag = value.startsWith('v') ? value : `v${value}`;
  const version = tag.slice(1);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${tag} is not a production SemVer tag`);
  }
  return tag;
}

function assertProductionRelease(tag: string, isPrerelease: boolean): string {
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (isPrerelease || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${tag} is not a production SemVer tag`);
  }
  return version;
}

function resolveProductionRelease(input: string, repo: string): { tag: string; version: string } {
  const normalized = normalizeReleaseInput(input || 'latest');
  const tag =
    normalized === 'latest'
      ? runText('gh', [
          'release',
          'list',
          '--repo',
          repo,
          '--exclude-pre-releases',
          '--exclude-drafts',
          '--limit',
          '1',
          '--json',
          'tagName',
          '-q',
          '.[0].tagName',
        ])
      : normalized;

  if (!tag) {
    throw new Error('No production GitHub Release found');
  }

  const releaseJson = runText('gh', [
    'release',
    'view',
    tag,
    '--repo',
    repo,
    '--json',
    'isPrerelease,isDraft,tagName',
  ]);
  const release = JSON.parse(releaseJson) as {
    isPrerelease?: boolean;
    isDraft?: boolean;
    tagName?: string;
  };
  if (release.isDraft) throw new Error('Draft releases cannot be submitted to stores');
  const version = assertProductionRelease(release.tagName || tag, release.isPrerelease === true);
  return { tag: release.tagName || tag, version };
}

export function main(): void {
  const release = resolveProductionRelease(
    process.env.RELEASE_INPUT || 'latest',
    process.env.GH_REPO || process.env.GITHUB_REPOSITORY || '',
  );
  setOutput('tag', release.tag);
  setOutput('version', release.version);
  const repo = process.env.GH_REPO || requiredEnv('GITHUB_REPOSITORY');
  const sha = runText('gh', ['api', `repos/${repo}/commits/${release.tag}`, '--jq', '.sha']);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid release commit');
  setOutput('sha', sha);
  console.log(`Resolved production release: ${release.tag}`);
}

if (process.argv[1]?.endsWith('/resolve-release.ts')) {
  main();
}
