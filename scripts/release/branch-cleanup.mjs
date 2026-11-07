import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'sharbel0022/Mgeorge';
const EXECUTION_BRANCH = 'release/cleanup-approved-20261107';
const SHA = /^[a-f0-9]{40}$/;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function git(cwd, args, optional = false) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], {
    cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_TRACE: '0', GIT_CURL_VERBOSE: '0' },
  });
  if (result.status !== 0 && !optional) fail('GIT_COMMAND_FAILED', `Git ${args[0]} failed (exit ${result.status ?? 'unknown'}); no unsafe retry was attempted.`);
  return { status: result.status, stdout: (result.stdout || '').trim() };
}

function branchName(cwd, name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name)
    || name.startsWith('refs/') || git(cwd, ['check-ref-format', '--branch', name], true).status !== 0) {
    fail('INVALID_REQUEST', 'Every branch must be a literal, valid branch name.');
  }
}

function validate(cwd, request) {
  if (!request || request.version !== 1 || typeof request.expectedMain !== 'string' || !SHA.test(request.expectedMain)
    || typeof request.execute !== 'boolean' || !Array.isArray(request.candidates)
    || !Array.isArray(request.knownActiveBranches)) fail('INVALID_REQUEST', 'Request requires version 1, execute boolean, full expectedMain SHA, candidates and knownActiveBranches.');
  const names = new Set();
  for (const candidate of request.candidates) {
    branchName(cwd, candidate?.name);
    if (typeof candidate.sha !== 'string' || !SHA.test(candidate.sha) || names.has(candidate.name)) fail('INVALID_REQUEST', 'Candidate SHAs must be full lowercase SHAs and branch names must be unique.');
    names.add(candidate.name);
  }
  for (const name of request.knownActiveBranches) branchName(cwd, name);
}

export function createGitHubApi(token = process.env.GITHUB_TOKEN) {
  async function get(resource) {
    if (!token) fail('API_ERROR', 'The normal Actions GITHUB_TOKEN is required for authenticated checks.');
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${resource}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (!response.ok) fail('API_ERROR', `GitHub read was rejected (${response.status}); permissions and state remain unverified.`);
    return response.json();
  }
  return {
    branch: name => get('branches/' + encodeURIComponent(name)),
    async openPullRequests() {
      const all = [], seen = new Set();
      for (let page = 1; page <= 100; page++) {
        const rows = await get(`pulls?state=open&per_page=100&page=${page}`);
        if (!Array.isArray(rows)) fail('API_ERROR', 'Ambiguous PR inventory.');
        for (const row of rows) {
          if (!Number.isSafeInteger(row.number) || seen.has(row.number)) fail('API_ERROR', 'PR pagination changed or returned ambiguous rows.');
          seen.add(row.number); all.push(row);
        }
        if (rows.length < 100) return all;
      }
      fail('API_ERROR', 'PR pagination did not terminate.');
    },
  };
}

function remoteRefs(cwd, patterns = []) {
  const lines = git(cwd, ['ls-remote', 'origin', ...patterns]).stdout;
  const refs = new Map();
  for (const line of lines.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    if (!SHA.test(sha) || !ref || refs.has(ref)) fail('REMOTE_STATE', 'Remote returned ambiguous refs.');
    refs.set(ref, sha);
  }
  return refs;
}

function normalizeRemote(url) {
  return url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git\/?$/, '').replace(/\/$/, '');
}

function archive(cwd, candidate, expectedMain) {
  const suffix = createHash('sha256').update(candidate.name).digest('hex');
  const name = `archive/branch-cleanup/${candidate.sha}/${suffix}`, ref = 'refs/tags/' + name;
  let remote = remoteRefs(cwd, [ref, ref + '^{}']);
  if (!remote.has(ref)) {
    const local = git(cwd, ['rev-parse', '--verify', ref + '^{commit}'], true);
    if (local.status === 0 && local.stdout !== candidate.sha) fail('ARCHIVE_COLLISION', 'Existing local archive points to another commit.');
    if (local.status !== 0) git(cwd, ['-c', 'user.name=GitHub Actions branch cleanup', '-c', 'user.email=cleanup@users.noreply.github.com',
      'tag', '-a', name, candidate.sha, '-m', `Preserve refs/heads/${candidate.name} at ${candidate.sha}\nVerified against main ${expectedMain}`]);
    // A normal tag push never replaces an existing remote tag.
    git(cwd, ['push', '--porcelain', 'origin', `${ref}:${ref}`]);
    remote = remoteRefs(cwd, [ref, ref + '^{}']);
  }
  const peeledSha = remote.get(ref + '^{}') || remote.get(ref);
  if (!remote.has(ref) || peeledSha !== candidate.sha) fail('ARCHIVE_COLLISION', 'Remote archive does not peel to the exact candidate head.');
  git(cwd, ['fetch', '--no-tags', 'origin', `${ref}:${ref}`]);
  if (git(cwd, ['rev-parse', ref + '^{commit}']).stdout !== candidate.sha) fail('ARCHIVE_COLLISION', 'Fetched archive does not match its remote readback.');
  return { ref, objectSha: remote.get(ref), peeledSha, verifiedAt: new Date().toISOString() };
}

function verifyBundle(cwd, outputDir, request, results) {
  const mainRef = 'refs/cleanup/main/' + request.expectedMain;
  git(cwd, ['update-ref', mainRef, request.expectedMain]);
  const bundle = path.join(outputDir, 'recovery.bundle'), restored = path.join(outputDir, 'restore.git');
  git(cwd, ['bundle', 'create', bundle, mainRef, ...results.map(row => row.archive.ref)]);
  git(cwd, ['bundle', 'verify', bundle]);
  git(cwd, ['clone', '--bare', '--no-local', bundle, restored]);
  git(restored, ['fsck', '--full', '--strict']);
  for (const row of results) {
    if (git(restored, ['rev-parse', row.archive.ref + '^{commit}']).stdout !== row.sha) fail('RECOVERY_FAILED', 'Independent bundle restore does not recover an exact candidate head.');
  }
  // The custom main ref is explicitly recovered; clone defaults need not advertise it as a branch.
  git(restored, ['fetch', bundle, `${mainRef}:${mainRef}`]);
  if (git(restored, ['rev-parse', mainRef]).stdout !== request.expectedMain) fail('RECOVERY_FAILED', 'Main recovery anchor differs.');
  git(restored, ['fsck', '--full', '--strict']);
  const receipt = { verified: true, bundle: 'recovery.bundle', sha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'),
    expectedMain: request.expectedMain, restoredHeads: results.map(row => ({ name: row.name, sha: row.sha, archiveRef: row.archive.ref })),
    independentBareClone: true, fsck: 'git fsck --full --strict', verifiedAt: new Date().toISOString() };
  json(path.join(outputDir, 'recovery-verification.json'), receipt);
  return receipt;
}

function environmentContext() {
  return { actions: process.env.GITHUB_ACTIONS === 'true', repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF, eventName: process.env.GITHUB_EVENT_NAME };
}

export async function runCleanup({ cwd = process.cwd(), request, execute = false,
  outputDir = path.join(cwd, 'artifacts/branch-cleanup'), api, context = environmentContext(),
  expectedRemoteUrl = `https://github.com/${REPOSITORY}` } = {}) {
  outputDir = path.resolve(outputDir); mkdirSync(outputDir, { recursive: true });
  const report = { version: 1, repository: REPOSITORY, startedAt: new Date().toISOString(),
    mode: execute && request?.execute === true ? 'execute' : 'dry-run', status: 'blocked',
    expectedMain: request?.expectedMain ?? null, results: (Array.isArray(request?.candidates) ? request.candidates : []).map(row => ({ name: row?.name, sha: row?.sha, status: 'pending' })),
    knownActiveBranches: request?.knownActiveBranches ?? [], remainingBranches: [], remainingRefs: [] };
  const save = () => json(path.join(outputDir, 'result.json'), report);
  try {
    if (request == null) { report.status = 'no-request'; return report; }
    validate(cwd, request);
    if (report.mode === 'execute' && (!context.actions || context.repository !== REPOSITORY
      || context.ref !== 'refs/heads/' + EXECUTION_BRANCH || !['push', 'workflow_dispatch'].includes(context.eventName))) {
      fail('EXECUTION_CONTEXT', 'Execution is restricted to the approved release branch in repository Actions.');
    }
    if (normalizeRemote(git(cwd, ['remote', 'get-url', 'origin']).stdout) !== normalizeRemote(expectedRemoteUrl)) fail('REMOTE_MISMATCH', 'Origin does not match the expected repository.');
    if (git(cwd, ['rev-parse', '--is-shallow-repository']).stdout !== 'false') fail('SHALLOW_HISTORY', 'Complete history is required.');
    api ||= createGitHubApi();
    const checkoutBranch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true).stdout;
    const blocked = new Set(['main', 'feature/95-saas', EXECUTION_BRANCH, checkoutBranch, ...request.knownActiveBranches]);
    const callApi = async call => {
      try { return await call(); } catch (error) {
        if (error.code === 'API_ERROR') throw error;
        fail('API_ERROR', 'GitHub state could not be verified.');
      }
    };
    async function inspect(candidate, fetchObjects) {
      if (blocked.has(candidate.name)) fail('FORBIDDEN_BRANCH', 'Main, known active work and the execution checkout must be retained.');
      const main = await callApi(() => api.branch('main'));
      if (main?.name !== 'main') fail('API_ERROR', 'Main response identity is ambiguous.');
      if (main?.commit?.sha !== request.expectedMain) fail('MAIN_MOVED', 'Main differs from the manifest.');
      const prs = await callApi(() => api.openPullRequests());
      if (!Array.isArray(prs) || prs.some(pr => pr?.state !== 'open' || typeof pr.head?.ref !== 'string' || typeof pr.base?.ref !== 'string')) fail('API_ERROR', 'Open PR state is ambiguous.');
      if (prs.some(pr => pr.head.ref === candidate.name || pr.base.ref === candidate.name)) fail('OPEN_PR', 'An open PR uses this branch as its head or base.');
      const branch = await callApi(() => api.branch(candidate.name));
      if (branch?.name !== candidate.name) fail('API_ERROR', 'Branch response identity is ambiguous.');
      if (branch?.protected !== false) fail('PROTECTED_BRANCH', 'Branch protection is present or unknown.');
      if (branch?.commit?.sha !== candidate.sha) fail('HEAD_MOVED', 'Candidate head differs from the manifest.');
      if (fetchObjects) {
        for (const [name, sha] of [['main', request.expectedMain], [candidate.name, candidate.sha]]) {
          git(cwd, ['fetch', '--no-tags', 'origin', 'refs/heads/' + name]);
          if (git(cwd, ['rev-parse', 'FETCH_HEAD']).stdout !== sha) fail(name === 'main' ? 'MAIN_MOVED' : 'HEAD_MOVED', 'Ref changed while fetching.');
        }
      }
      const ancestry = git(cwd, ['merge-base', '--is-ancestor', candidate.sha, request.expectedMain], true);
      if (ancestry.status !== 0) fail('NOT_INTEGRATED', 'Exact candidate head is not proven to be an ancestor of main.');
      // This is the final remote read before a deletion; the deletion also carries an exact lease.
      const refs = remoteRefs(cwd, ['refs/heads/main', 'refs/heads/' + candidate.name]);
      if (refs.get('refs/heads/main') !== request.expectedMain) fail('MAIN_MOVED', 'Main changed during the checks.');
      if (refs.get('refs/heads/' + candidate.name) !== candidate.sha) fail('HEAD_MOVED', 'Candidate changed during the checks.');
      candidate.observedSha = refs.get('refs/heads/' + candidate.name);
      candidate.checkedAt = new Date().toISOString();
    }
    for (const candidate of report.results) {
      await inspect(candidate, true);
      candidate.status = 'would-delete'; save();
    }
    if (report.mode === 'dry-run' || !report.results.length) { report.status = 'dry-run'; return report; }
    // All requested branches must pass before any archive writes; all archives and the bundle must pass before any deletion.
    for (const candidate of report.results) { candidate.archive = archive(cwd, candidate, request.expectedMain); save(); }
    report.recovery = verifyBundle(cwd, outputDir, request, report.results); save();
    for (const candidate of report.results) {
      await inspect(candidate, false);
      git(cwd, ['push', '--porcelain', `--force-with-lease=refs/heads/${candidate.name}:${candidate.sha}`, 'origin', `:refs/heads/${candidate.name}`]);
      candidate.status = 'deleted'; candidate.deletedAt = new Date().toISOString(); save();
      if (remoteRefs(cwd, ['refs/heads/' + candidate.name]).has('refs/heads/' + candidate.name)) fail('REMOTE_STATE', 'Branch exists after deletion; no repeated deletion was attempted.');
    }
    report.status = 'completed';
  } catch (error) {
    report.error = { code: error.code || 'CLEANUP_FAILED', message: error.code ? error.message : 'Unexpected failure; no unsafe retry was attempted.' };
    for (const row of report.results) if (row.status !== 'deleted') Object.assign(row, { status: 'retained', code: report.error.code, reason: report.error.message });
    report.status = report.results.some(row => row.status === 'deleted') ? 'partial' : 'blocked';
  } finally {
    try {
      report.remainingRefs = [...remoteRefs(cwd, ['refs/heads/*', 'refs/tags/archive/branch-cleanup/*'])].map(([ref, sha]) => ({ ref, sha }));
      report.remainingBranches = report.remainingRefs.filter(row => row.ref.startsWith('refs/heads/')).map(row => ({ name: row.ref.slice(11), sha: row.sha }));
      json(path.join(outputDir, 'remaining-refs.json'), report.remainingRefs);
    } catch {
      report.remainingRefsError = 'Final remote inventory could not be verified.';
      report.status = report.results.some(row => row.status === 'deleted') ? 'partial' : 'blocked';
    }
    report.finishedAt = new Date().toISOString(); save();
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  let manifest = 'docs/cleanup/deletion-request.json', outputDir, execute = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--execute') execute = true;
    else if (arg === '--manifest' && args.length) manifest = args.shift();
    else if (arg === '--output' && args.length) outputDir = args.shift();
    else fail('INVALID_REQUEST', 'Supported arguments: --manifest FILE --output DIRECTORY --execute.');
  }
  let request;
  try { request = JSON.parse(readFileSync(manifest, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') request = { invalidRequest: true }; }
  const report = await runCleanup({ request, execute, outputDir });
  console.log(JSON.stringify({ status: report.status, mode: report.mode, deleted: report.results.filter(row => row.status === 'deleted').length, retained: report.results.filter(row => row.status === 'retained').length }));
  if (['blocked', 'partial'].includes(report.status)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Cleanup request could not be processed; no permission or protection bypass was attempted.'); process.exitCode = 1; });
}
