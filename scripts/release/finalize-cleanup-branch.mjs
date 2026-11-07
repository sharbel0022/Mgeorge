import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'sharbel0022/Mgeorge', BRANCH = 'release/cleanup-approved-20261107';
const WORKFLOW = '.github/workflows/branch-cleanup.yml', JOB = 'Finalize archived execution branch';
const UPLOAD = 'Upload execution recovery before deletion', SCRIPT = 'scripts/release/finalize-cleanup-branch.mjs';
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/, MAX_ARCHIVE = 256 * 1024 * 1024;
const ALLOWED = new Set([WORKFLOW, SCRIPT, 'test/release-finalizer.test.js', 'docs/cleanup/deletion-request.json']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function command(cwd, executable, args, optional = false, binary = false) {
  const r = spawnSync(executable, args, { cwd, encoding: binary ? null : 'utf8', timeout: 120_000,
    maxBuffer: MAX_ARCHIVE, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_TRACE: '0', GIT_CURL_VERBOSE: '0' } });
  if (r.status !== 0 && !optional) fail('COMMAND_FAILED', `${executable} operation failed; no unsafe retry was attempted.`);
  return { status: r.status, output: binary ? r.stdout : (r.stdout || '').trim() };
}
const git = (cwd, args, optional = false) => command(cwd, 'git', ['--no-replace-objects', ...args], optional);
const normalizeRemote = url => url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git\/?$/, '').replace(/\/$/, '');

export function createFinalizationApi(token = process.env.GITHUB_TOKEN) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mgeorge-release-finalizer' };
  async function request(route, redirect = 'error') {
    if (!token) fail('API_UNAVAILABLE', 'The normal Actions token is required.');
    return fetch(`https://api.github.com/repos/${REPO}/${route}`, { headers, redirect, signal: AbortSignal.timeout(60_000) });
  }
  return {
    async get(route) {
      const r = await request(route);
      if (!r.ok) fail('API_UNAVAILABLE', `GitHub verification was denied (${r.status}).`);
      return r.json();
    },
    async downloadArtifact(id) {
      let r = await request(`actions/artifacts/${id}/zip`, 'manual');
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const location = new URL(r.headers.get('location'));
        if (location.protocol !== 'https:' || location.username || location.password) fail('ARTIFACT_UNVERIFIED', 'Invalid artifact redirect.');
        // Storage requests deliberately receive no GitHub authorization header.
        r = await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
      }
      if (!r.ok || !r.body) fail('ARTIFACT_UNVERIFIED', 'Artifact download failed.');
      const chunks = []; let size = 0;
      for await (const chunk of r.body) {
        size += chunk.length;
        if (size > MAX_ARCHIVE) fail('ARTIFACT_UNVERIFIED', 'Artifact exceeds the bounded recovery size.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}

async function pages(api, route, key) {
  const rows = [], ids = new Set(); let total;
  for (let page = 1; page <= 100; page++) {
    const data = await api.get(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const batch = key ? data?.[key] : data;
    if (!Array.isArray(batch)) fail('API_AMBIGUOUS', 'Incomplete paginated inventory.');
    if (key) {
      if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || (total !== undefined && total !== data.total_count)) fail('API_AMBIGUOUS', 'Inventory changed during pagination.');
      total = data.total_count;
    }
    for (const row of batch) {
      if (!Number.isSafeInteger(row.id) || ids.has(row.id)) fail('API_AMBIGUOUS', 'Duplicate or missing inventory identity.');
      ids.add(row.id); rows.push(row);
    }
    if (batch.length < 100) {
      if (key && rows.length !== total) fail('API_AMBIGUOUS', 'Paginated inventory is incomplete.');
      return rows;
    }
  }
  fail('API_AMBIGUOUS', 'Pagination did not terminate.');
}

function refs(cwd, patterns) {
  const result = new Map();
  for (const line of git(cwd, ['ls-remote', 'origin', ...patterns]).output.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    if (!SHA.test(sha) || !ref || result.has(ref)) fail('REMOTE_AMBIGUOUS', 'Remote refs are ambiguous.');
    result.set(ref, sha);
  }
  return result;
}

function contextFromEnvironment() {
  return { actions: process.env.GITHUB_ACTIONS === 'true', repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB,
    eventName: process.env.GITHUB_EVENT_NAME, workflowRef: process.env.GITHUB_WORKFLOW_REF };
}

function artifactIdentity(a, name, context) {
  if (!a || !Number.isSafeInteger(a.id) || a.name !== name || a.expired !== false
    || !Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes <= 0 || a.size_in_bytes > MAX_ARCHIVE
    || !/^sha256:[a-f0-9]{64}$/.test(a.digest || '') || String(a.workflow_run?.id) !== context.runId
    || a.workflow_run?.head_sha !== context.sha || a.workflow_run?.head_branch !== BRANCH) {
    fail('ARTIFACT_UNVERIFIED', 'Artifact identity, source, availability or digest is unverified.');
  }
  return a;
}

function restore(cwd, bundle, destination, archiveRef, source, main, mainTree) {
  git(cwd, ['bundle', 'verify', bundle]);
  git(cwd, ['clone', '--bare', '--no-local', bundle, destination]);
  if (git(destination, ['rev-parse', archiveRef + '^{commit}']).output !== source
    || git(destination, ['rev-parse', main + '^{tree}']).output !== mainTree) fail('RESTORE_FAILED', 'Independent restore differs from the exact source or main.');
  git(destination, ['fsck', '--full', '--strict']);
}

export async function runFinalization({ cwd = process.cwd(), request, context = contextFromEnvironment(), api,
  phase = 'check', outputDir = path.join(process.env.RUNNER_TEMP || cwd, 'release-finalizer'), artifactId,
  artifactDigest, expectedRemoteUrl = `https://github.com/${REPO}` } = {}) {
  outputDir = path.resolve(outputDir); mkdirSync(outputDir, { recursive: true });
  const report = { version: 1, phase, status: 'retained', repository: REPO, branch: BRANCH,
    sourceSha: context.sha, expectedMain: request?.expectedMain, runId: context.runId,
    runAttempt: context.runAttempt, startedAt: new Date().toISOString(), branchDeleted: false };
  try {
    if (!['check', 'prepare', 'delete'].includes(phase)) fail('INVALID_PHASE', 'Unknown finalization phase.');
    if (!request || request.version !== 1 || request.execute !== true || request.finalizeExecutionBranch !== true
      || typeof request.expectedMain !== 'string' || !SHA.test(request.expectedMain)
      || !Array.isArray(request.candidates) || !request.candidates.length) fail('EXPLICIT_REQUEST_REQUIRED', 'A versioned execution and terminal-finalization request with exact main is required.');
    if (!context.actions || context.repository !== REPO || context.ref !== 'refs/heads/' + BRANCH
      || !SHA.test(context.sha || '') || !/^[1-9][0-9]*$/.test(context.runId || '')
      || !/^[1-9][0-9]*$/.test(context.runAttempt || '') || context.job !== 'finalize'
      || !['push', 'workflow_dispatch'].includes(context.eventName)
      || context.workflowRef !== `${REPO}/${WORKFLOW}@refs/heads/${BRANCH}`) fail('EXECUTION_CONTEXT', 'Only the real, fixed terminal Actions context may finalize this branch.');
    if (normalizeRemote(git(cwd, ['remote', 'get-url', 'origin']).output) !== normalizeRemote(expectedRemoteUrl)) fail('REMOTE_MISMATCH', 'Origin differs from the fixed repository.');
    const assertCheckout = () => {
      if (git(cwd, ['rev-parse', 'HEAD']).output !== request.expectedMain
        || git(cwd, ['symbolic-ref', '--quiet', 'HEAD'], true).status !== 1
        || git(cwd, ['status', '--porcelain']).output) fail('CHECKOUT_MISMATCH', 'The actual clean checkout must be detached at exact approved main.');
    };
    assertCheckout();
    if (git(cwd, ['rev-parse', '--is-shallow-repository']).output !== 'false') fail('INCOMPLETE_HISTORY', 'Full history is required.');
    const mainTree = git(cwd, ['rev-parse', 'HEAD^{tree}']).output;
    for (const [name, sha] of [['main', request.expectedMain], [BRANCH, context.sha]]) {
      git(cwd, ['fetch', '--no-tags', 'origin', 'refs/heads/' + name]);
      if (git(cwd, ['rev-parse', 'FETCH_HEAD']).output !== sha) fail(name === 'main' ? 'MAIN_MOVED' : 'HEAD_MOVED', 'A remote ref changed.');
    }
    if (git(cwd, ['merge-base', '--is-ancestor', request.expectedMain, context.sha], true).status !== 0) fail('SOURCE_BASE_MISMATCH', 'The execution commit must descend from approved main.');
    const changedPaths = git(cwd, ['diff', '--name-only', '--no-renames', request.expectedMain, context.sha]).output.split('\n').filter(Boolean);
    if (changedPaths.some(file => !ALLOWED.has(file))) fail('PRODUCT_CHANGE', 'The release commit contains changes outside its four operational paths.');
    if (git(cwd, ['hash-object', '--no-filters', fileURLToPath(import.meta.url)]).output !== git(cwd, ['rev-parse', `${context.sha}:${SCRIPT}`]).output) fail('SOURCE_SCRIPT_MISMATCH', 'Running finalizer differs from the archived execution commit.');
    const sourceRequest = git(cwd, ['show', `${context.sha}:docs/cleanup/deletion-request.json`]).output;
    if (JSON.stringify(JSON.parse(sourceRequest)) !== JSON.stringify(request)) fail('REQUEST_MISMATCH', 'Request differs from the immutable execution commit.');
    const requestDigest = hash(sourceRequest), archiveRef = `refs/tags/archive/cleanup-execution/${context.sha}`;
    Object.assign(report, { mainTree, changedPaths, requestDigest, archiveRef });
    api ||= createFinalizationApi();

    async function gate(requireUpload) {
      assertCheckout();
      const main = await api.get('branches/main'), head = await api.get('branches/' + encodeURIComponent(BRANCH));
      if (main?.name !== 'main' || head?.name !== BRANCH) fail('API_AMBIGUOUS', 'Branch identity is ambiguous.');
      if (main.commit?.sha !== request.expectedMain) fail('MAIN_MOVED', 'Main changed.');
      if (head.commit?.sha !== context.sha) fail('HEAD_MOVED', 'Execution branch changed.');
      if (head.protected !== false) fail('PROTECTED', 'Execution branch protection is active or unknown.');
      const prs = await pages(api, 'pulls?state=open', null);
      if (prs.some(pr => pr.state !== 'open' || typeof pr.head?.ref !== 'string' || typeof pr.base?.ref !== 'string')) fail('API_AMBIGUOUS', 'PR state is incomplete.');
      if (prs.some(pr => pr.head.ref === BRANCH || pr.base.ref === BRANCH)) fail('OPEN_PR', 'An open PR uses the execution branch.');
      const current = await api.get(`actions/runs/${context.runId}`);
      if (String(current?.id) !== context.runId || String(current.run_attempt) !== context.runAttempt
        || current.head_sha !== context.sha || current.head_branch !== BRANCH || current.status !== 'in_progress'
        || current.path !== WORKFLOW || current.event !== context.eventName || current.repository?.full_name !== REPO) fail('RUN_CONTEXT', 'Current run identity or attempt differs from the real Actions context.');
      const runs = await pages(api, 'actions/runs?branch=' + encodeURIComponent(BRANCH), 'workflow_runs');
      if (!runs.some(run => String(run.id) === context.runId) || runs.some(run => run.head_branch !== BRANCH)) fail('API_AMBIGUOUS', 'Current branch run inventory is incomplete.');
      if (runs.some(run => String(run.id) !== context.runId && run.status !== 'completed')) fail('OTHER_ACTIVE_RUN', 'Another execution-branch run is still active, queued or waiting.');
      const jobs = await pages(api, `actions/runs/${context.runId}/attempts/${context.runAttempt}/jobs`, 'jobs');
      if (jobs.some(job => String(job.run_id) !== context.runId || job.head_sha !== context.sha)) fail('RUN_CONTEXT', 'Job source identity differs.');
      const terminals = jobs.filter(job => job.name === JOB), cleanups = jobs.filter(job => job.name === 'cleanup');
      if (terminals.length !== 1 || terminals[0].status !== 'in_progress') fail('RUN_CONTEXT', 'Exactly one current terminal job must be running.');
      if (jobs.some(job => job.id !== terminals[0].id && job.status !== 'completed')) fail('OTHER_ACTIVE_JOB', 'Another current-run job is not complete.');
      const successfulStep = (job, name) => job.steps?.filter(step => step.name === name && step.status === 'completed' && step.conclusion === 'success').length === 1;
      if (cleanups.length !== 1 || cleanups[0].conclusion !== 'success'
        || !successfulStep(cleanups[0], 'Preserve results and verified recovery bundle')) fail('INCOMPLETE_PREREQUISITE', 'Original cleanup and its recovery-artifact upload must have succeeded.');
      if (requireUpload && !successfulStep(terminals[0], UPLOAD)) fail('INCOMPLETE_PREREQUISITE', 'Terminal recovery upload has not completed successfully.');
      const artifacts = await pages(api, `actions/runs/${context.runId}/artifacts`, 'artifacts');
      const cleanupArtifacts = artifacts.filter(a => a.name === `branch-cleanup-${context.sha}-${context.runId}-${context.runAttempt}`);
      if (cleanupArtifacts.length !== 1) fail('INCOMPLETE_PREREQUISITE', 'The exact original cleanup artifact is missing or ambiguous.');
      report.cleanupArtifactId = artifactIdentity(cleanupArtifacts[0], cleanupArtifacts[0].name, context).id;
      const latest = refs(cwd, ['refs/heads/main', 'refs/heads/' + BRANCH]);
      if (latest.get('refs/heads/main') !== request.expectedMain) fail('MAIN_MOVED', 'Main changed during verification.');
      if (latest.get('refs/heads/' + BRANCH) !== context.sha) fail('HEAD_MOVED', 'Execution head changed during verification.');
      report.lastGateAt = new Date().toISOString();
    }
    await gate(phase === 'delete');
    if (phase === 'check') { report.status = 'ready'; return report; }
    const bundle = path.join(outputDir, 'execution-recovery.bundle'), receiptFile = path.join(outputDir, 'execution-recovery.json');
    function verifyRemoteArchive() {
      const archive = refs(cwd, [archiveRef, archiveRef + '^{}']);
      if (!archive.has(archiveRef) || archive.get(archiveRef + '^{}') !== context.sha) fail('ARCHIVE_UNVERIFIED', 'Annotated remote archive does not peel to the exact execution head.');
      git(cwd, ['fetch', '--no-tags', 'origin', `${archiveRef}:${archiveRef}`]);
      if (git(cwd, ['cat-file', '-t', archiveRef]).output !== 'tag'
        || git(cwd, ['rev-parse', archiveRef + '^{commit}']).output !== context.sha) fail('ARCHIVE_UNVERIFIED', 'Fetched annotated archive differs.');
      return archive.get(archiveRef);
    }
    if (phase === 'prepare') {
      if (!refs(cwd, [archiveRef]).has(archiveRef)) {
        const local = git(cwd, ['rev-parse', '--verify', archiveRef], true);
        if (local.status !== 0) git(cwd, ['-c', 'user.name=GitHub Actions release finalization', '-c', 'user.email=cleanup@users.noreply.github.com',
          'tag', '-a', archiveRef.slice(10), context.sha, '-m', `Preserve ${REPO} ${BRANCH} at ${context.sha}; main ${request.expectedMain}; run ${context.runId}/${context.runAttempt}`]);
        git(cwd, ['push', '--porcelain', 'origin', `${archiveRef}:${archiveRef}`]);
      }
      const archiveObject = verifyRemoteArchive();
      git(cwd, ['bundle', 'create', bundle, archiveRef]);
      restore(cwd, bundle, path.join(outputDir, 'prepared-restore.git'), archiveRef, context.sha, request.expectedMain, mainTree);
      const receipt = { version: 1, repository: REPO, branch: BRANCH, sourceSha: context.sha, expectedMain: request.expectedMain,
        mainTree, runId: context.runId, runAttempt: context.runAttempt, requestDigest, archiveRef, archiveObject,
        bundleSha256: hash(readFileSync(bundle)), independentRestore: true, strictFsck: true, changedPaths,
        preparedAt: new Date().toISOString() };
      save(receiptFile, receipt); report.status = 'prepared'; report.recovery = receipt;
    } else {
      if (!/^[1-9][0-9]*$/.test(String(artifactId || '')) || !DIGEST.test(artifactDigest || '')) fail('ARTIFACT_UNVERIFIED', 'Successful upload ID and SHA-256 output are required.');
      const receiptBytes = readFileSync(receiptFile), receipt = JSON.parse(receiptBytes);
      for (const [key, expected] of Object.entries({ repository: REPO, branch: BRANCH, sourceSha: context.sha, expectedMain: request.expectedMain,
        mainTree, runId: context.runId, runAttempt: context.runAttempt, requestDigest, archiveRef })) {
        if (receipt[key] !== expected) fail('ARTIFACT_UNVERIFIED', 'Prepared recovery receipt does not match this exact execution.');
      }
      if (receipt.independentRestore !== true || receipt.strictFsck !== true || hash(readFileSync(bundle)) !== receipt.bundleSha256) fail('ARTIFACT_UNVERIFIED', 'Prepared bundle or restoration receipt changed.');
      verifyRemoteArchive();
      const name = `execution-recovery-${context.sha}-${context.runId}-${context.runAttempt}`;
      const artifact = artifactIdentity(await api.get(`actions/artifacts/${artifactId}`), name, context);
      if (String(artifact.id) !== String(artifactId) || artifact.digest !== 'sha256:' + artifactDigest) fail('ARTIFACT_UNVERIFIED', 'Artifact does not match the successful upload output.');
      const zipped = await api.downloadArtifact(artifactId);
      if (!Buffer.isBuffer(zipped) || zipped.length > MAX_ARCHIVE || hash(zipped) !== artifactDigest) fail('ARTIFACT_UNVERIFIED', 'Downloaded artifact digest differs.');
      const zipFile = path.join(outputDir, 'uploaded-recovery.zip'); writeFileSync(zipFile, zipped);
      const entries = command(cwd, 'unzip', ['-Z1', zipFile]).output.split('\n').sort();
      if (JSON.stringify(entries) !== JSON.stringify(['execution-recovery.bundle', 'execution-recovery.json'])) fail('ARTIFACT_UNVERIFIED', 'Recovery archive must contain only the two fixed file names.');
      const uploadedBundle = command(cwd, 'unzip', ['-p', zipFile, 'execution-recovery.bundle'], false, true).output;
      const uploadedReceipt = command(cwd, 'unzip', ['-p', zipFile, 'execution-recovery.json'], false, true).output;
      if (hash(uploadedBundle) !== receipt.bundleSha256 || !uploadedReceipt.equals(receiptBytes)) fail('ARTIFACT_UNVERIFIED', 'Uploaded recovery contents differ from the verified preparation.');
      const recoveredFile = path.join(outputDir, 'uploaded-recovery.bundle'); writeFileSync(recoveredFile, uploadedBundle);
      restore(cwd, recoveredFile, path.join(outputDir, 'uploaded-restore.git'), archiveRef, context.sha, request.expectedMain, mainTree);
      Object.assign(report, { uploadVerified: true, recoveryArtifactId: artifact.id, recoveryArtifactDigest: artifactDigest });
      await gate(true);
      git(cwd, ['push', '--porcelain', `--force-with-lease=refs/heads/${BRANCH}:${context.sha}`, 'origin', `:refs/heads/${BRANCH}`]);
      report.branchDeleted = true;
      const after = refs(cwd, ['refs/heads/main', 'refs/heads/' + BRANCH]);
      report.mainUnchanged = after.get('refs/heads/main') === request.expectedMain;
      report.remainingExecutionHead = after.get('refs/heads/' + BRANCH) || null;
      assertCheckout();
      report.productCheckoutUnchanged = git(cwd, ['rev-parse', 'HEAD^{tree}']).output === mainTree;
      if (!report.mainUnchanged || !report.productCheckoutUnchanged || report.remainingExecutionHead) fail('POSTCHECK_FAILED', 'Deletion completed but final main/checkout/ref verification differs; do not retry deletion.');
      report.status = 'deleted';
    }
  } catch (error) {
    report.status = report.branchDeleted ? 'deleted_with_verification_failure' : 'retained';
    report.code = error.code || 'VERIFICATION_FAILED';
    report.reason = error.code ? error.message : 'Verification could not be completed; branch deletion was not retried.';
  } finally {
    try {
      report.remainingRefs = [...refs(cwd, ['refs/heads/*', 'refs/tags/archive/*'])].map(([ref, sha]) => ({ ref, sha }));
      report.remainingHeads = report.remainingRefs.filter(row => row.ref.startsWith('refs/heads/')).map(row => ({ name: row.ref.slice(11), sha: row.sha }));
      save(path.join(outputDir, 'remaining-refs.json'), report.remainingRefs);
    } catch {
      report.remainingRefsError = 'Final remote inventory could not be verified.';
      report.status = report.branchDeleted ? 'deleted_with_verification_failure' : 'retained';
    }
    report.finishedAt = new Date().toISOString();
    save(path.join(outputDir, `finalization-${['check', 'prepare', 'delete'].includes(phase) ? phase : 'invalid'}.json`), report);
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2), options = { phase: 'check' }; let manifest;
  while (args.length) {
    const flag = args.shift(), key = { '--phase': 'phase', '--output': 'outputDir', '--artifact-id': 'artifactId', '--artifact-digest': 'artifactDigest' }[flag];
    if (flag === '--manifest' && args.length) manifest = args.shift();
    else if (key && args.length) options[key] = args.shift();
    else fail('INVALID_ARGUMENT', 'Unknown or incomplete finalization argument.');
  }
  options.request = JSON.parse(readFileSync(manifest || 'docs/cleanup/deletion-request.json', 'utf8'));
  const report = await runFinalization(options);
  console.log(JSON.stringify({ phase: report.phase, status: report.status, sourceSha: report.sourceSha, code: report.code }));
  if (!['ready', 'prepared', 'deleted'].includes(report.status)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Terminal finalization could not be verified; no unsafe fallback was attempted.'); process.exitCode = 1; });
}
