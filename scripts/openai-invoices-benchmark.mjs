#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  ARM_IDS, assertManifest, canonicalJson, makeProviderInput,
  scoreArm, unavailableArm, acceptance,
} from './openai-invoices-benchmark-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha256(canonicalJson(value));
const fail = code => { throw new Error(code); };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const saveJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
};

async function containedFile(directory, relative) {
  const root = await realpath(directory);
  const file = await realpath(path.resolve(root, relative));
  if (!file.startsWith(root + path.sep)) fail('INPUT_PATH_OUTSIDE_MANIFEST');
  return file;
}

async function loadCorpus(manifestPath) {
  const manifest = assertManifest(await readJson(manifestPath));
  const directory = path.dirname(path.resolve(manifestPath));
  const bytes = new Map();
  for (const r of manifest.records) {
    const data = await readFile(await containedFile(directory, r.path));
    if (!data.length || data.length > 15 * 1024 * 1024) fail('INPUT_SIZE');
    if (sha256(data) !== r.sha256) fail('INPUT_HASH_MISMATCH');
    bytes.set(r.id, data);
  }
  if (manifest.provenance.classification === 'independent_holdout') {
    const p = manifest.provenance;
    if (sha256(await readFile(await containedFile(directory, p.evidencePath))) !== p.evidenceSha256) fail('PROVENANCE_HASH_MISMATCH');
  }
  return { manifest, bytes, directory };
}

function policyDigest() {
  const names = ['OPENAI_INVOICES_ENABLED', 'OPENAI_INVOICES_PRIVACY_APPROVED', 'OPENAI_INVOICES_SECURITY_APPROVED',
    'OPENAI_INVOICES_COST_APPROVED', 'OPENAI_INVOICES_APPROVAL_ID', 'OPENAI_INVOICES_ALLOWED_OWNERS',
    'OPENAI_INVOICES_COMPANY_ORGANIZATIONS', 'OPENAI_INVOICES_MAX_DOCUMENT_MICRO_USD', 'OPENAI_INVOICES_DAILY_BUDGET_MICRO_USD',
    'OPENAI_PROJECT_ID'];
  return jsonHash(Object.fromEntries(names.map(name => [name, process.env[name] || null])));
}

async function sourceSnapshot() {
  const files = new Set([
    'package.json', 'package-lock.json', 'sites/package.json', 'sites/package-lock.json',
    'test/helpers/ocr-quality-metrics.mjs', 'test/helpers/optical-invoice-fixtures.mjs', 'test/fixtures.js',
  ]);
  async function walk(relative) {
    for (const entry of await readdir(path.join(ROOT, relative), { withFileTypes: true })) {
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(name);
      else if (/\.(?:js|mjs|cjs|ts|json)$/.test(name)) files.add(name);
    }
  }
  await walk('src');
  await walk('sites/lib');
  for (const entry of await readdir(path.join(ROOT, 'scripts'))) {
    if (/^openai-invoices-.*\.mjs$/.test(entry)) files.add('scripts/' + entry);
  }
  const hashes = {};
  for (const file of [...files].sort()) hashes[file] = sha256(await readFile(path.join(ROOT, file)));
  const dependencies = {};
  for (const name of ['pdfjs-dist', 'tesseract.js', 'tesseract.js-core', '@napi-rs/canvas']) {
    try {
      const file = path.join(ROOT, 'node_modules', name, 'package.json');
      const bytes = await readFile(file);
      dependencies[name] = { version: JSON.parse(bytes).version, packageSha256: sha256(bytes) };
    } catch { dependencies[name] = null; }
  }
  return { files: hashes, dependencies, node: process.version, platform: process.platform, arch: process.arch };
}

export async function freezeCorpus(manifestPath, freezePath) {
  const { manifest } = await loadCorpus(manifestPath);
  const createdAt = new Date().toISOString();
  if (manifest.provenance.classification === 'independent_holdout' &&
      Date.parse(manifest.provenance.heldOutSince) >= Date.parse(createdAt)) fail('HOLDOUT_MUST_PREDATE_FREEZE');
  const freeze = {
    version: 1, createdAt, manifestSha256: jsonHash(manifest),
    source: await sourceSnapshot(), commit: process.env.GITHUB_SHA || null,
    arms: ARM_IDS, policyDigest: policyDigest(), protocol: 'openai-invoices-benchmark.v1',
  };
  freeze.freezeSha256 = jsonHash(freeze);
  await saveJson(path.resolve(freezePath), freeze);
  return freeze;
}

function verifyFreeze(freeze, manifest, source) {
  const { freezeSha256, ...body } = freeze;
  if (freeze.version !== 1 || freezeSha256 !== jsonHash(body) ||
      freeze.manifestSha256 !== jsonHash(manifest) || freeze.policyDigest !== policyDigest() ||
      canonicalJson(freeze.arms) !== canonicalJson(ARM_IDS)) fail('FREEZE_MISMATCH');
  if (canonicalJson(freeze.source) !== canonicalJson(source)) fail('FROZEN_SOURCE_CHANGED');
}

async function validateOriginal(record, bytes) {
  if (record.mimeType === 'application/pdf') {
    if (!Buffer.from(bytes).subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('INPUT_MIME');
    const canvas = await import('@napi-rs/canvas');
    for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) if (!globalThis[name] && canvas[name]) globalThis[name] = canvas[name];
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    try {
      if (doc.numPages !== record.pageCount || doc.numPages > 10) fail('INPUT_PAGE_COUNT');
      if (record.modality === 'optical') {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const text = (await page.getTextContent()).items.map(item => item.str || '').join('').trim();
          if (text) fail('OPTICAL_PDF_HAS_TEXT_LAYER');
        }
      }
    } finally { await doc.destroy(); }
  } else {
    const b = Buffer.from(bytes);
    const validMagic = record.mimeType === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      record.mimeType === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255 :
      b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
    if (!validMagic || record.pageCount !== 1) fail('INPUT_MIME');
    const { loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(b);
    if (!image.width || !image.height || image.width * image.height > 12_000_000) fail('INPUT_DIMENSIONS');
  }
}

async function currentOcr(input, context) {
  const { runDocumentProcess, interpretInvoice } = await import('../src/invoice-extraction.js');
  const processed = await runDocumentProcess(Buffer.from(input.bytes), input.mime);
  if (!processed || processed.error || typeof processed.text !== 'string') fail('OCR_PROCESSING_FAILED');
  return interpretInvoice(processed.text, {
    method: processed.method, ocrConfidence: processed.confidence,
    ocrEvidence: processed.ocrEvidence, ocrInputSha256: input.sha256,
    company_organization_number: context.companyOrganization || '',
    direction: context.companyRole === 'supplier' ? 'customer' : 'supplier',
    direction_confident: true, filename: 'document',
  });
}

function liveScope(manifest) {
  if (manifest.provenance.synthetic) return true;
  return manifest.provenance.classification === 'independent_holdout' &&
    manifest.dataClass === 'approved_anonymized' && manifest.corpusType === 'independent' &&
    typeof manifest.dataApprovalId === 'string' && /^[-A-Za-z0-9._:/]{3,120}$/.test(manifest.dataApprovalId);
}

export function liveBlockReason({ manifest, live, apiKey, ledgerPath }) {
  return !live ? 'LIVE_NOT_REQUESTED' :
    !apiKey?.trim() ? 'MISSING_API_KEY' :
    !liveScope(manifest) ? 'DATA_SCOPE_NOT_APPROVED' :
    typeof ledgerPath !== 'string' || !path.isAbsolute(ledgerPath) ? 'BENCHMARK_LEDGER_REQUIRED' : null;
}

export async function runCorpus({ manifestPath, freezePath, outputPath, live = false, ledgerPath = process.env.OPENAI_INVOICES_BENCHMARK_LEDGER }) {
  const { manifest, bytes } = await loadCorpus(manifestPath);
  const freeze = await readJson(freezePath);
  verifyFreeze(freeze, manifest, await sourceSnapshot());
  const context = manifest.context;
  if (!context || typeof context.owner !== 'string' || !['supplier', 'recipient'].includes(context.companyRole) ||
      !/^\d{10}$/.test(context.companyOrganization || '')) fail('BENCHMARK_CONTEXT');
  // A freeze is single-use, including failed runs, so predictions cannot be
  // silently used for tuning and then rerun as an untouched holdout.
  const startedAt = new Date().toISOString();
  await saveJson(path.resolve(freezePath) + '.observations.json', { startedAt, freezeSha256: freeze.freezeSha256 });
  const validity = new Map(), inputValidationLatencyMs = {};
  for (const r of manifest.records) {
    const started = performance.now();
    try { await validateOriginal(r, bytes.get(r.id)); validity.set(r.id, true); }
    catch { validity.set(r.id, false); }
    inputValidationLatencyMs[r.id] = performance.now() - started;
  }
  const { invoiceAiPolicy, mergeInvoiceSuggestion } = await import('../sites/lib/openai-invoices/integration.js');
  const { interpretInvoice } = await import('../src/invoice-extraction.js');
  let aiReason = liveBlockReason({ manifest, live, apiKey: process.env.OPENAI_API_KEY, ledgerPath });
  const policies = {};
  if (!aiReason) {
    for (const [arm, profile] of [['openai_low', 'luna-v1'], ['openai_strong', 'sol-v1'], ['hybrid', 'luna-v1']]) {
      const policy = invoiceAiPolicy({ ...process.env, OPENAI_INVOICES_PROFILE: profile }, context.owner);
      if (policy.status !== 'enabled' || policy.expectedCompanyOrganization !== context.companyOrganization) aiReason = 'SERVER_POLICY_NOT_APPROVED';
      policies[arm] = policy;
    }
  }
  let modelInventory = { status: 'NOT_REQUESTED' };
  const unavailableModels = new Set();
  if (!aiReason) {
    try {
      const { inspectOpenAiProject } = await import('./openai-invoices-inventory.mjs');
      const inventory = await inspectOpenAiProject({ apiKey: process.env.OPENAI_API_KEY, allowNetwork: true, project: process.env.OPENAI_PROJECT_ID });
      modelInventory = { status: inventory.models?.status || 'UNAVAILABLE',
        lowAvailable: inventory.models?.lunaAvailable === true, strongAvailable: inventory.models?.solAvailable === true };
      if (inventory.models?.status !== 'VERIFIED_LIST') aiReason = 'MODEL_INVENTORY_UNAVAILABLE';
      else for (const id of ARM_IDS.slice(1)) if (!inventory.models.ids?.includes(policies[id].model)) unavailableModels.add(id);
    } catch { aiReason = 'MODEL_INVENTORY_UNAVAILABLE'; modelInventory = { status: 'UNAVAILABLE' }; }
  }
  let ledger;
  if (!aiReason) {
    try { const { openBenchmarkLedger } = await import('./openai-invoices-benchmark-ledger.mjs'); ledger = await openBenchmarkLedger(ledgerPath, { owner: context.owner }); }
    catch { aiReason = 'BENCHMARK_LEDGER_UNAVAILABLE'; }
  }
  try {
  const arms = [];
  for (const id of ARM_IDS) {
    if (id !== 'existing_ocr' && (aiReason || unavailableModels.has(id))) { arms.push(unavailableArm(id, aiReason || 'MODEL_NOT_AVAILABLE')); continue; }
    const observations = [];
    for (const r of manifest.records) {
      const started = performance.now();
      let extraction = null, errorCode = null, result = null, hybridBaseline = null;
      let apiCostUsd = id === 'existing_ocr' ? 0 : null;
      try {
        if (!validity.get(r.id)) fail('ORIGINAL_PREFLIGHT_FAILED');
        const input = makeProviderInput(r, bytes.get(r.id));
        if (id === 'existing_ocr') {
          extraction = await currentOcr(input, context);
        } else {
          const baseline = id === 'hybrid' ? await currentOcr(input, context) :
            interpretInvoice('', { direction: context.companyRole === 'supplier' ? 'customer' : 'supplier', direction_confident: true, company_organization_number: context.companyOrganization, filename: 'document' });
          if (id === 'hybrid') hybridBaseline = baseline;
          if (id === 'hybrid' && baseline.level === 'green') {
            extraction = baseline;
            apiCostUsd = 0;
            result = { status: 'ocr_green_no_api_call' };
          } else {
            const policy = policies[id];
            const key = jsonHash([freeze.protocol, freeze.freezeSha256, id, input.sha256, policy.version, policy.profileId, policy.model]);
            const reservation = await ledger.store.reserve({
              key, documentId: 'benchmark:' + key, sha256: input.sha256,
              profileVersion: 'benchmark-v1', reservedMicroUsd: policy.maxDocumentMicroUsd,
              dailyBudgetMicroUsd: policy.dailyBudgetMicroUsd,
            });
            if (reservation.status !== 'reserved') {
              apiCostUsd = 0;
              fail(reservation.status === 'budget_exhausted' ? 'RUN_BUDGET_EXHAUSTED' : 'BENCHMARK_ALREADY_RESERVED');
            }
            const { extractOpenAiInvoice } = await import('../sites/lib/openai-invoices/adapter.js');
            try { result = await extractOpenAiInvoice({
              ...input, inputValidated: true, owner: context.owner,
              policy, companyRole: context.companyRole, apiKey: process.env.OPENAI_API_KEY,
              // Only optical/text observations, never manifest labels or gold.
              ...(id === 'hybrid' ? { documentText: baseline.text_excerpt || '', deterministic: baseline.fields } : {}),
            }); } catch { result = { status: 'fallback', code: 'AI_REQUEST_FAILED', costUnknown: true }; }
            if (!await ledger.store.record(key, result)) fail('BENCHMARK_RECEIPT_NOT_SAVED');
            if (Number.isSafeInteger(result.costMicroUsd) && result.costMicroUsd >= 0) {
              apiCostUsd = result.costMicroUsd / 1_000_000;
            }
            extraction = mergeInvoiceSuggestion(baseline, result, { companyRole: context.companyRole, expectedCompanyOrganization: context.companyOrganization });
            if ((result.status !== 'review' || !result.candidate) && id !== 'hybrid') errorCode = 'AI_NO_USABLE_RESULT';
          }
        }
      } catch {
        if (id === 'hybrid' && hybridBaseline) { extraction = hybridBaseline; result = { status: 'fallback' }; }
        else errorCode = 'EXTRACTION_FAILED';
      }
      observations.push({
        recordId: r.id, extraction, errorCode, durationMs: performance.now() - started,
        apiCostUsd, usage: result?.usage || null, model: result?.model || null,
        providerStatus: result?.status || null,
      });
    }
    arms.push(scoreArm(id, manifest.records, observations));
  }
  // Verify inputs and implementation a second time after observations.
  const after = await loadCorpus(manifestPath);
  verifyFreeze(freeze, after.manifest, await sourceSnapshot());
  const report = {
    version: 1, protocol: freeze.protocol, startedAt, finishedAt: new Date().toISOString(),
    manifestId: manifest.id, manifestSha256: freeze.manifestSha256, freezeSha256: freeze.freezeSha256,
    provenance: manifest.provenance, context: { companyRole: context.companyRole },
    scoredScope: { supportedCoreScalarFields: 13, scope: 'legacy_register_fields_including_bankgiro', recipientAndLineItems: 'not_established_unless_explicitly_annotated', fullInvoiceExtractionAcceptance: false },
    freezeVerified: true, sourceVerified: true, modelInventory, inputValidationLatencyMs,
    measurement: { execution: 'real', cache: 'none', sequentialArms: ARM_IDS, latency: 'extraction_wall_time_including_OCR_for_hybrid_excluding_separately_reported_shared_input_validation', cost: 'API_usage_cost_only_not_billing_invoice', infrastructureCost: 'NOT_MEASURED' },
    arms,
  };
  report.acceptance = acceptance(manifest, report);
  await saveJson(path.resolve(outputPath), report);
  return report;
  } finally { ledger?.close(); }
}

export async function createSyntheticCorpus(directory) {
  await mkdir(directory, { recursive: true });
  const { createCanvas } = await import('@napi-rs/canvas');
  const { rasterPdf } = await import('../test/helpers/optical-invoice-fixtures.mjs');
  const cases = [
    {
      id: 'sv-clean', family: 'synthetic-sv',
      lines: ['SYNTETISK TESTFAKTURA - INTE BETALBAR', 'Faktura', 'Fakturanummer: 0606', 'Leverantör: Testbolaget AB',
        'Organisationsnummer: 556016-0680', 'Kund: Café Exempel AB', 'Kundens organisationsnummer: 5599999983', 'Fakturadatum: 2026-10-24', 'Förfallodatum: 2026-11-07',
        'Netto: 3 000,00 kr', 'Moms: 750,00 kr', 'Att betala: 3 750,00 SEK', 'OCR: 000018', 'Bankgiro: 123-4567'],
      fields: { invoice_number: '0606', party: 'Testbolaget AB', organization_number: '5560160680',
        issued_at: '2026-10-24', due_at: '2026-11-07', net_cents: 300000, vat_cents: 75000,
        total_cents: 375000, reference: '000018', bankgiro: '123-4567', currency: 'SEK', direction: 'supplier', kind: 'invoice' },
    },
    {
      id: 'en-clean', family: 'synthetic-en',
      lines: ['SYNTHETIC TEST INVOICE - NOT PAYABLE', 'Invoice', 'Invoice number: INV-2048', 'Supplier: Example Services AB',
        'Organisation number: 556016-0680', 'Customer: Example Customer AB', 'Customer organisation number: 5599999983', 'Invoice date: 2026-10-24', 'Due date: 2026-11-07',
        'Net amount: 2 000.00 SEK', 'VAT: 500.00 SEK', 'Total due: 2 500.00 SEK', 'Payment reference: 000018', 'Bankgiro: 123-4567'],
      fields: { invoice_number: 'INV-2048', party: 'Example Services AB', organization_number: '5560160680',
        issued_at: '2026-10-24', due_at: '2026-11-07', net_cents: 200000, vat_cents: 50000,
        total_cents: 250000, reference: '000018', bankgiro: '123-4567', currency: 'SEK', direction: 'supplier', kind: 'invoice' },
    },
  ];
  const records = [];
  for (const fixture of cases) {
    const canvas = createCanvas(1600, 1400), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.font = '30px sans-serif';
    fixture.lines.forEach((line, index) => ctx.fillText(line, 70, 70 + index * 83));
    for (const format of ['png', 'pdf']) {
      const data = format === 'png' ? canvas.toBuffer('image/png') : rasterPdf({ canvas });
      const filename = fixture.id + '.' + format;
      await writeFile(path.join(directory, filename), data, { flag: 'wx', mode: 0o600 });
      records.push({
        id: fixture.id + '-' + format, family: fixture.family, path: filename,
        mimeType: format === 'png' ? 'image/png' : 'application/pdf', pageCount: 1,
        sha256: sha256(data), modality: 'optical', requireReview: true,
        gold: { fields: fixture.fields },
      });
    }
  }
  // Development fixtures reuse familiar values/layouts and MUST NOT be relabeled
  // as independent acceptance data, regardless of observed performance.
  const manifest = {
    version: 1, id: 'sv-en-optical-development-v1',
    provenance: { classification: 'development', synthetic: true, optimized: true, previouslyUsed: true,
      note: 'Generated development replay; not representative or independent; labels have not been independently reviewed.' },
    context: { owner: 'benchmark', companyRole: 'recipient', companyOrganization: '5599999983' },
    models: { openai_low: 'luna-v1', openai_strong: 'sol-v1', hybrid: 'luna-v1' },
    records,
  };
  await saveJson(path.join(directory, 'manifest.json'), manifest);
  return manifest;
}

async function main(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--live') { options.live = true; continue; }
    if (!['--directory', '--manifest', '--freeze', '--output', '--ledger'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) fail('CLI_ARGUMENTS');
    options[key.slice(2)] = args[++i];
  }
  if (command === 'synthetic' && options.directory) {
    const result = await createSyntheticCorpus(path.resolve(options.directory));
    console.log(JSON.stringify({ status: 'generated_development_only', documents: result.records.length }));
  } else if (command === 'freeze' && options.manifest && options.freeze) {
    const result = await freezeCorpus(options.manifest, options.freeze);
    console.log(JSON.stringify({ status: 'frozen_before_observations', freezeSha256: result.freezeSha256 }));
  } else if (command === 'run' && options.manifest && options.freeze && options.output) {
    const result = await runCorpus({ manifestPath: options.manifest, freezePath: options.freeze, outputPath: options.output, live: options.live, ledgerPath: options.ledger });
    console.log(JSON.stringify({ status: 'completed', acceptance: result.acceptance, arms: result.arms.map(a => ({ id: a.id, status: a.status, reason: a.reason, metrics: a.metrics })) }));
    if (result.arms[0].status === 'failed') process.exitCode = 1;
  } else fail('CLI_ARGUMENTS');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    const code = /^[A-Z_]{3,80}$/.test(error?.message || '') ? error.message : 'BENCHMARK_FAILED';
    console.error(JSON.stringify({ status: 'blocked', code }));
    process.exitCode = 1;
  });
}
