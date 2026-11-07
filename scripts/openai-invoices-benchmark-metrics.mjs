import { evaluateDocument, projectReviewedFields, summarizeDocuments } from '../test/helpers/ocr-quality-metrics.mjs';

export const ARM_IDS = Object.freeze(['existing_ocr', 'openai_low', 'openai_strong', 'hybrid']);
export const SCORED_FIELDS = Object.freeze([
  'invoice_number', 'party', 'organization_number', 'issued_at', 'due_at',
  'total_cents', 'vat_cents', 'net_cents', 'reference', 'bankgiro',
  'direction', 'kind', 'currency',
]);
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const classes = new Set(['development', 'regression', 'independent_holdout']);
const fail = code => { throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export function assertManifest(manifest) {
  if (!object(manifest) || manifest.version !== 1 || !safeId(manifest.id)) fail('MANIFEST_SCHEMA');
  const p = manifest.provenance;
  if (!object(p) || !classes.has(p.classification) || typeof p.synthetic !== 'boolean' || typeof p.optimized !== 'boolean') fail('MANIFEST_PROVENANCE');
  if (!Array.isArray(manifest.records) || !manifest.records.length || manifest.records.length > 1000) fail('MANIFEST_RECORDS');
  if (p.classification === 'independent_holdout') {
    if (p.synthetic || p.optimized || p.previouslyUsed !== false || p.attestedIndependent !== true ||
        !date(p.heldOutSince) || !safeId(p.custodianId) ||
        typeof p.evidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.evidenceSha256) ||
        typeof p.evidencePath !== 'string' || !safeRelativePath(p.evidencePath)) fail('HOLDOUT_PROVENANCE');
  }
  const ids = new Set(), hashes = new Set(), groups = new Set();
  for (const r of manifest.records) {
    if (!object(r) || !safeId(r.id) || ids.has(r.id)) fail('RECORD_ID');
    ids.add(r.id);
    if (!safeRelativePath(r.path) || !MIME_TYPES.has(r.mimeType) ||
        !Number.isInteger(r.pageCount) || r.pageCount < 1 || r.pageCount > 10 ||
        !/^[a-f0-9]{64}$/.test(r.sha256 || '') ||
        !['optical', 'text'].includes(r.modality) || typeof r.requireReview !== 'boolean') fail('RECORD_SCHEMA');
    if (hashes.has(r.sha256)) fail('DUPLICATE_CONTENT');
    hashes.add(r.sha256);
    if (!object(r.gold?.fields) || !Object.keys(r.gold.fields).length ||
        Object.keys(r.gold.fields).some(key => !SCORED_FIELDS.includes(key)) ||
        !Object.values(r.gold.fields).some(value => value !== null)) fail('GOLD_FIELDS');
    for (const [key, value] of Object.entries(r.gold.fields)) {
      if (value !== null && (key.endsWith('_cents') ? !Number.isSafeInteger(value) : typeof value !== 'string')) fail('GOLD_VALUE');
    }
    if (p.classification === 'independent_holdout') {
      if (r.modality !== 'optical' || !safeId(r.documentGroup) || groups.has(r.documentGroup) ||
          SCORED_FIELDS.some(key => !Object.hasOwn(r.gold.fields, key)) ||
          /(^|\/)(test|fixtures|quality8)(\/|$)/.test(r.path) ||
          r.goldReview?.independent !== true || !safeId(r.goldReview?.reviewerId)) fail('HOLDOUT_RECORD');
      groups.add(r.documentGroup);
    }
  }
  return manifest;
}

export function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 500 &&
    !/^[\\/]/.test(value) && !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}

// Deliberate allowlist: neither gold, supplier family, path, fixture ID nor
// meaningful filename is sent to an extraction provider.
export function makeProviderInput(record, bytes) {
  return { bytes: new Uint8Array(bytes), mime: record.mimeType, pageCount: record.pageCount, sha256: record.sha256 };
}

export function unavailableArm(id, reason) {
  if (!ARM_IDS.includes(id)) fail('ARM_ID');
  return { id, status: 'unavailable', reason, metrics: null, observations: [] };
}

export function scoreArm(id, records, observations) {
  if (!ARM_IDS.includes(id)) fail('ARM_ID');
  if (!records.length || observations.length !== records.length ||
      new Set(observations.map(o => o.recordId)).size !== records.length ||
      observations.some(o => !records.some(r => r.id === o.recordId))) fail('OBSERVATION_COVERAGE');
  const byId = new Map(observations.map(o => [o.recordId, o]));
  const rows = records.map(r => {
    const o = byId.get(r.id);
    const bad = o.errorCode || !o.extraction || typeof o.extraction !== 'object';
    const extraction = bad ? { fields: {}, level: 'red' } : o.extraction;
    const projected = projectReviewedFields(extraction, r.gold);
    return evaluateDocument({
      id: r.id, family: r.family || 'unclassified', subset: r.modality,
      ...projected, level: extraction.level, requireReview: r.requireReview,
      durationMs: Number.isFinite(o.durationMs) && o.durationMs >= 0 ? o.durationMs : null,
      error: bad ? 'EXTRACTION_FAILED' : null,
    });
  });
  const summary = summarizeDocuments(rows);
  const knownCosts = observations.filter(o => Number.isFinite(o.apiCostUsd) && o.apiCostUsd >= 0);
  const knownCostUsd = knownCosts.reduce((sum, o) => sum + o.apiCostUsd, 0);
  const metrics = {
    documents: summary.documents, counts: summary.counts,
    fieldPrecision: summary.fieldPrecision, fieldRecall: summary.fieldRecall,
    completeCorrectDocuments: summary.exactDocuments,
    completeCorrectDocumentRate: summary.documentCoverage,
    approvedDocuments: summary.greenCount,
    falseApprovals: summary.falseGreenCount,
    falseApprovalRate: summary.falseGreenRate,
    falseApprovalAmongApproved: summary.falseGreenAmongGreen,
    manualReviewDocuments: summary.manualReviewCount,
    manualReviewRate: summary.manualReviewRate,
    errorDocuments: summary.errorCount,
    latencyMs: {
      measuredDocuments: summary.timedDocuments, total: summary.totalTimeMs,
      mean: summary.averageTimeMs, median: summary.medianTimeMs, p95: summary.p95TimeMs,
    },
    apiCostUsd: knownCosts.length === records.length ? knownCostUsd : null,
    knownApiCostUsd: knownCostUsd,
    costKnownDocuments: knownCosts.length,
    apiCostBasis: id === 'existing_ocr' ? 'no_external_api_call' : 'reported_usage_at_frozen_adapter_prices',
    infrastructureCostUsd: null,
    byField: summary.byField, byFieldGroup: summary.byFieldGroup,
    byFamily: summary.byFamily, bySubset: summary.bySubset,
  };
  return {
    id, status: summary.errorCount === records.length ? 'failed' : 'measured',
    reason: summary.errorCount === records.length ? 'ALL_DOCUMENTS_FAILED' : null,
    metrics,
    observations: rows.map(row => ({
      ...row, apiCostUsd: byId.get(row.id).apiCostUsd ?? null,
      usage: byId.get(row.id).usage ?? null,
      model: byId.get(row.id).model ?? null,
      providerStatus: byId.get(row.id).providerStatus ?? null,
    })),
  };
}

export function acceptance(manifest, report) {
  const independent = manifest.provenance.classification === 'independent_holdout' &&
    manifest.records.every(r => r.modality === 'optical');
  const eligible = independent && report.freezeVerified === true && report.sourceVerified === true;
  const arms = Object.fromEntries(ARM_IDS.map(id => {
    const arm = report.arms.find(value => value.id === id);
    const m = arm?.metrics;
    const measured = arm?.status === 'measured' && m?.documents === manifest.records.length && m.errorDocuments === 0;
    const passed = Boolean(eligible && measured && m.fieldRecall >= 0.85 &&
      m.fieldPrecision !== null && m.fieldPrecision >= 0.98 && m.falseApprovals === 0);
    return [id, { measured, passed }];
  }));
  const allArmsMeasured = ARM_IDS.every(id => arms[id].measured);
  return {
    eligible, passed: eligible && allArmsMeasured && arms.hybrid.passed,
    reason: !independent ? 'NOT_INDEPENDENT_OPTICAL' :
      !eligible ? 'FREEZE_OR_SOURCE_NOT_VERIFIED' :
      !allArmsMeasured ? 'COMPARISON_INCOMPLETE' :
      !arms.hybrid.passed ? 'TARGET_NOT_MET' : 'TARGET_MET',
    thresholds: { fieldRecall: 0.85, fieldPrecision: 0.98, maximumFalseApprovals: 0 },
    allArmsMeasured, arms,
    note: 'Independence is an externally reviewed provenance attestation; hashes verify immutability, not provenance truth.',
  };
}
