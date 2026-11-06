import {
  INVOICE_AI_SCHEMA, INVOICE_AI_SCHEMA_VERSION, INVOICE_AI_PROMPT_VERSION,
  INVOICE_AI_INSTRUCTIONS, INVOICE_AI_FIELD_NAMES, INVOICE_AI_LINE_FIELDS,
} from './schema.js';
import { getInvoiceAiProfile, invoiceAiCostMicroUsd, INVOICE_AI_POLICY_VERSION } from './profiles.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const encoder = new TextEncoder();
const MONEY_FIELDS = new Set(['netAmount', 'vatAmount', 'totalAmount', 'unitPrice']);
const ORGANIZATION_FIELDS = new Set(['supplierOrgNumber', 'recipientOrgNumber']);
const TWO_DECIMAL_CURRENCIES = new Set('SEK EUR USD GBP NOK DKK CHF CAD AUD NZD PLN CZK HUF RON BGN TRY CNY HKD SGD INR ZAR BRL MXN ILS AED SAR'.split(' '));
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const INJECTION = /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|disregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|(?:reveal|print|expose)\s+(?:the\s+)?(?:system\s+prompt|api\s+key|secret)|<\|(?:system|developer|assistant)\|>|ignorera\s+(?:alla\s+)?(?:tidigare|ovanst[åa]ende)\s+instruktioner/iu;

class AdapterError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new AdapterError(code); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9/_-]{0,99}$/.test(value);
const safeText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && normalized(value).length > 0 && !CONTROL.test(value);
const sameKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const unique = values => [...new Set(values)];
const codeOf = (error, otherwise) => error instanceof AdapterError ? error.code : otherwise;

function validOrganization(value) {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value) || Number(value[2]) < 2) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const product = Number(value[i]) * (i % 2 === 0 ? 2 : 1);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}

function resultBase(prepared = {}) {
  return {
    status: 'fallback', candidate: null, issues: [], canAutoRegister: false, bankEvidence: false,
    requiresReview: true, usage: null, costMicroUsd: 0, knownCostMicroUsd: 0, costUnknown: false,
    costBasis: 'standard_uncached_upper_bound', attempts: 0, inputCountTokens: null,
    estimatedMaximumCostMicroUsd: null, reservationMicroUsd: prepared.reservationMicroUsd || 0,
    model: prepared.model || null, profileId: prepared.profileId || null,
    schemaVersion: INVOICE_AI_SCHEMA_VERSION, promptVersion: INVOICE_AI_PROMPT_VERSION,
    pricingVersion: prepared.pricingVersion || null, configDigest: prepared.configDigest || null,
    idempotencyKey: prepared.idempotencyKey || null, source: prepared.source || null,
    evidenceVerified: false, lineItemsKnown: false, conflicts: [],
  };
}

async function hash(value) {
  if (!globalThis.crypto?.subtle) fail('secure_hash_unavailable');
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function signatureMatches(bytes, mime) {
  if (mime === 'image/png') return bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value);
  if (mime === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  if (mime === 'application/pdf') return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-' && new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 4096))).includes('%%EOF');
  return false;
}

function publicPreparation(state) {
  return {
    status: state.status, issues: state.issues || [], model: state.profile?.model || null,
    profileId: state.profile?.id || null, pricingVersion: state.profile?.pricingVersion || null,
    idempotencyKey: state.idempotencyKey || null, configDigest: state.configDigest || null,
    reservationMicroUsd: state.policy?.maxDocumentMicroUsd || 0, source: state.source || null,
  };
}

async function prepare(args = {}) {
  if (!args?.policy || args.policy.status !== 'enabled') return { status: 'disabled', issues: ['disabled'] };
  // The host must create this policy from server-side approvals and owner authorization.
  // Document metadata, request JSON and model output are never policy authorities.
  const policy = { ...args.policy };
  if (policy.version !== INVOICE_AI_POLICY_VERSION) fail('policy_version_mismatch');
  if (!safeText(args.owner, 200) || args.owner !== policy.owner) fail('policy_owner_mismatch');
  if (!safeText(policy.approvalId, 200) || !validOrganization(policy.expectedCompanyOrganization)
    || !integer(policy.maxDocumentMicroUsd, 1, 100000000)
    || !integer(policy.dailyBudgetMicroUsd, policy.maxDocumentMicroUsd, 1000000000)) fail('policy_invalid');
  const profile = getInvoiceAiProfile(policy.profileId);
  if (!profile || policy.model !== profile.model || policy.reasoningEffort !== profile.reasoningEffort) fail('profile_mismatch');
  if (!['supplier', 'recipient'].includes(args.companyRole)) fail('company_role_invalid');
  if (args.inputValidated !== true) fail('input_not_validated');
  if (!(args.bytes instanceof Uint8Array) || args.bytes.byteLength === 0) fail('input_bytes_invalid');
  if (args.bytes.byteLength > profile.limits.maxBytes) fail('input_too_large');
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(args.mime)) fail('unsupported_mime');
  if (!signatureMatches(args.bytes, args.mime)) fail('input_signature_mismatch');
  if (!integer(args.pageCount, 1, Number.MAX_SAFE_INTEGER)) fail('page_count_invalid');
  if (args.pageCount > profile.limits.maxPages) fail('page_limit_exceeded');
  if (args.mime !== 'application/pdf' && args.pageCount !== 1) fail('image_page_count_invalid');
  if (typeof args.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(args.sha256)) fail('source_hash_invalid');
  if (args.documentId !== undefined && !safeText(args.documentId, 200)) fail('document_id_invalid');
  const textPages = [];
  if (args.textPages !== undefined) {
    if (!Array.isArray(args.textPages) || args.textPages.length > args.pageCount) fail('source_text_invalid');
    const seen = new Set();
    let chars = 0;
    for (const page of args.textPages) {
      if (!plain(page) || !integer(page.page, 1, args.pageCount) || seen.has(page.page) || typeof page.text !== 'string') fail('source_text_invalid');
      chars += page.text.length;
      if (chars > profile.limits.maxDocumentTextChars) fail('source_text_too_large');
      if (INJECTION.test(page.text.normalize('NFKC'))) fail('suspicious_source_instructions');
      seen.add(page.page);
      textPages.push({ page: page.page, text: page.text });
    }
    textPages.sort((a, b) => a.page - b.page);
  }
  // Snapshot bytes and context before the first await, preventing a caller mutation from
  // changing what is transmitted after source hashing or the host's durable reservation.
  const bytes = args.bytes.slice();
  const source = { sha256: args.sha256, mime: args.mime, pageCount: args.pageCount };
  const companyRole = args.companyRole;
  const owner = args.owner;
  const documentId = args.documentId || null;
  const deterministic = snapshotDeterministic(args.deterministic, companyRole);
  const actualHash = await hash(bytes);
  if (actualHash !== source.sha256) fail('source_hash_mismatch');
  const configDigest = await hash(JSON.stringify({
    policyVersion: policy.version, approvalId: policy.approvalId, profile,
    schemaVersion: INVOICE_AI_SCHEMA_VERSION, schema: INVOICE_AI_SCHEMA,
    promptVersion: INVOICE_AI_PROMPT_VERSION, instructions: INVOICE_AI_INSTRUCTIONS,
    expectedCompanyOrganization: policy.expectedCompanyOrganization, companyRole,
    maxDocumentMicroUsd: policy.maxDocumentMicroUsd, dailyBudgetMicroUsd: policy.dailyBudgetMicroUsd,
  }));
  const idempotencyKey = await hash(JSON.stringify({
    owner, documentId, source, configDigest, textPages, deterministic,
  }));
  return { status: 'ready', profile, policy, bytes, source, companyRole, textPages, deterministic, configDigest, idempotencyKey };
}

// This function performs local validation only; it does not count tokens or reserve a budget.
// The integration must durably reserve the full policy cap BEFORE calling extractOpenAiInvoice.
export async function prepareOpenAiInvoice(args = {}) {
  try { return publicPreparation(await prepare(args)); }
  catch (error) { return { status: 'fallback', issues: [codeOf(error, 'preflight_failed')], idempotencyKey: null, configDigest: null, reservationMicroUsd: 0 }; }
}

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function payload(state) {
  const data = 'data:' + state.source.mime + ';base64,' + base64(state.bytes);
  const part = state.source.mime === 'application/pdf'
    ? { type: 'input_file', filename: 'invoice.pdf', file_data: data, detail: 'high' }
    : { type: 'input_image', image_url: data, detail: 'high' };
  return {
    model: state.profile.model, instructions: INVOICE_AI_INSTRUCTIONS,
    input: [{ role: 'user', content: [part] }],
    reasoning: { effort: state.profile.reasoningEffort }, truncation: 'disabled',
    text: { format: { type: 'json_schema', name: 'invoice_intelligence_v1', strict: true, schema: INVOICE_AI_SCHEMA } },
  };
}

// A small bounded duplicate-key scan precedes JSON.parse. Native JSON.parse alone would
// silently accept ambiguous last-key-wins financial fields.
function strictJson(text) {
  if (typeof text !== 'string' || text.length > 524288) fail('api_invalid_json');
  let cursor = 0;
  let nodes = 0;
  const whitespace = () => { while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) cursor++; };
  function string() {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '"') return JSON.parse(text.slice(start, cursor));
      if (char === '\\') cursor++;
    }
    fail('api_invalid_json');
  }
  function value(depth) {
    if (depth > 32 || ++nodes > 18000) fail('api_invalid_json');
    whitespace();
    const char = text[cursor];
    if (char === '"') { string(); return; }
    if (char === '{') {
      cursor++; whitespace();
      const keys = new Set();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        whitespace();
        if (text[cursor] !== '"') fail('api_invalid_json');
        const key = string();
        if (keys.has(key)) fail('api_invalid_json');
        keys.add(key); whitespace();
        if (text[cursor++] !== ':') fail('api_invalid_json');
        value(depth + 1); whitespace();
        const end = text[cursor++];
        if (end === '}') return;
        if (end !== ',') fail('api_invalid_json');
      }
    } else if (char === '[') {
      cursor++; whitespace();
      if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) {
        value(depth + 1); whitespace();
        const end = text[cursor++];
        if (end === ']') return;
        if (end !== ',') fail('api_invalid_json');
      }
    } else {
      const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(cursor));
      if (!match) fail('api_invalid_json');
      cursor += match[0].length;
      return;
    }
    fail('api_invalid_json');
  }
  try {
    value(0); whitespace();
    if (cursor !== text.length) fail('api_invalid_json');
    return JSON.parse(text);
  } catch { fail('api_invalid_json'); }
}

async function readBounded(response, maxBytes) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && /^\d+$/.test(length) && Number(length) > maxBytes) fail('response_too_large');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (encoder.encode(text).length > maxBytes) fail('response_too_large');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        fail('response_too_large');
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function request(url, body, key, fetchImpl, timeoutMs, maxBytes, requestId) {
  if (timeoutMs <= 0) fail('api_timeout');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AdapterError('api_timeout'));
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetchImpl(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId },
      body: JSON.stringify(body),
    });
    if (!response || !integer(response.status, 100, 599)) fail('api_invalid_response');
    const text = await readBounded(response, maxBytes);
    return { status: response.status, body: strictJson(text) };
  })();
  try { return await Promise.race([operation, timeout]); }
  catch (error) {
    if (error instanceof AdapterError) throw error;
    fail(controller.signal.aborted ? 'api_timeout' : 'api_network_error');
  } finally { clearTimeout(timer); }
}

function httpFailure(status, body) {
  const code = typeof body?.error?.code === 'string' ? body.error.code : '';
  const type = typeof body?.error?.type === 'string' ? body.error.type : '';
  if ([code, type].some(value => ['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(value))) return { issue: 'api_quota_exhausted', retry: false, ambiguous: false };
  if (status === 401) return { issue: 'api_authentication_failed', retry: false, ambiguous: false };
  if (status === 403) return { issue: 'api_access_denied', retry: false, ambiguous: false };
  if (status === 429) return { issue: 'api_rate_limited', retry: code === 'rate_limit_exceeded', ambiguous: false };
  if ([500, 502, 503, 504].includes(status)) return { issue: 'api_server_error', retry: true, ambiguous: true };
  return { issue: 'api_request_rejected', retry: false, ambiguous: status >= 500 };
}

function readUsage(body, state) {
  const raw = body?.usage;
  if (!plain(raw) || !integer(raw.input_tokens, 0, 10000000) || !integer(raw.output_tokens, 0, 10000000)) fail('usage_missing');
  if (raw.total_tokens !== undefined && raw.total_tokens !== raw.input_tokens + raw.output_tokens) fail('usage_invalid');
  if (raw.input_tokens_details?.cached_tokens !== undefined && !integer(raw.input_tokens_details.cached_tokens, 0, raw.input_tokens)) fail('usage_invalid');
  if (raw.output_tokens_details?.reasoning_tokens !== undefined && !integer(raw.output_tokens_details.reasoning_tokens, 0, raw.output_tokens)) fail('usage_invalid');
  const usage = { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
  const cost = invoiceAiCostMicroUsd(usage, state.profile.pricing);
  return { usage, cost };
}

function responseOutput(body, model) {
  if (!plain(body) || body.object !== 'response') fail('api_invalid_response');
  if (body.model !== model) fail('response_model_mismatch');
  if (body.service_tier !== undefined && body.service_tier !== 'default') fail('response_service_tier_mismatch');
  if (body.status === 'incomplete') fail('api_incomplete');
  if (body.status !== 'completed' || body.error) fail('api_response_failed');
  if (!Array.isArray(body.output) || body.output.length === 0 || body.output.length > 8) fail('api_invalid_response');
  let text = null;
  for (const item of body.output) {
    if (item?.type === 'reasoning') continue;
    if (item?.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) fail('unexpected_response_item');
    for (const part of item.content) {
      if (part?.type === 'refusal') fail('api_refusal');
      if (part?.type !== 'output_text' || typeof part.text !== 'string' || text !== null) fail('unexpected_response_item');
      text = part.text;
    }
  }
  if (text === null) fail('malformed_output');
  try { return strictJson(text); }
  catch { fail('malformed_output'); }
}

function money(value) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value) || value === '-0.00') fail('malformed_output');
  const negative = value[0] === '-';
  const minor = BigInt(value.replace('-', '').replace('.', '')) * (negative ? -1n : 1n);
  if (minor < -1000000000000n || minor > 1000000000000n) fail('malformed_output');
  return Number(minor);
}
function quotedMoney(quote, target) {
  const text = normalized(quote).replace(/\u2212/g, '-');
  const decimals = text.match(/-?(?:\d{1,3}(?:[ .,]\d{3})+|\d+)[.,]\d{2}(?!\d)/g) || [];
  for (const token of decimals) {
    const compact = token.replace(/[ .,]/g, '');
    try { if (BigInt(compact) === BigInt(target)) return true; } catch { /* Not a monetary token. */ }
  }
  // Whole-unit amounts printed without decimals are allowed, but still retain the source quote.
  const whole = text.match(/(?<![\d.,])-?\d+(?![\d.,])/g) || [];
  return whole.some(token => {
    try { return BigInt(token) * 100n === BigInt(target); } catch { return false; }
  });
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
function quotedDate(quote, value, issues) {
  const text = normalized(quote).toLowerCase();
  const [year, month, day] = value.split('-');
  if ([value, year + '/' + month + '/' + day, year + '.' + month + '.' + day].some(date => text.includes(date))) return true;
  for (const separator of ['/', '.', '-']) {
    for (const d of [day, String(Number(day))]) for (const m of [month, String(Number(month))]) {
      if (text.includes(d + separator + m + separator + year)) {
        if (Number(day) <= 12 && day !== month) issues.push('ambiguous_date_evidence');
        return true;
      }
    }
  }
  const months = [
    ['january', 'januari'], ['february', 'februari'], ['march', 'mars'], ['april'],
    ['may', 'maj'], ['june', 'juni'], ['july', 'juli'], ['august', 'augusti'],
    ['september'], ['october', 'oktober'], ['november'], ['december'],
  ];
  return months[Number(month) - 1].some(name => text.includes(name))
    && new RegExp('\\b' + year + '\\b').test(text) && new RegExp('\\b0?' + Number(day) + '\\b').test(text);
}

function validateOutput(output, state) {
  if (!sameKeys(output, ['documentType', 'suspiciousInstructions', ...INVOICE_AI_FIELD_NAMES, 'lineItems', 'conflicts'])
    || !['invoice', 'credit_note', 'other', 'unknown'].includes(output.documentType)
    || typeof output.suspiciousInstructions !== 'boolean') fail('malformed_output');
  if (output.suspiciousInstructions) fail('suspicious_source_instructions');
  if (!['invoice', 'credit_note'].includes(output.documentType)) fail('not_an_invoice');
  const issues = ['ai_review_required'];
  let evidenceCount = 0;
  let matchedEvidence = 0;
  const pageText = new Map(state.textPages.map(page => [page.page, normalized(page.text)]));
  const checkEvidence = evidence => {
    if (!sameKeys(evidence, ['page', 'quote']) || !integer(evidence.page, 1, state.source.pageCount) || !safeText(evidence.quote, 1200)) fail('malformed_output');
    if (INJECTION.test(evidence.quote.normalize('NFKC'))) fail('suspicious_source_instructions');
    evidenceCount++;
    if (pageText.has(evidence.page)) {
      if (!pageText.get(evidence.page).includes(normalized(evidence.quote))) fail('evidence_not_in_source');
      matchedEvidence++;
    }
    return { page: evidence.page, quote: evidence.quote };
  };
  const checkField = (name, wrapper) => {
    if (!sameKeys(wrapper, ['value', 'evidence'])) fail('malformed_output');
    if (wrapper.value === null) {
      if (wrapper.evidence !== null) fail('malformed_output');
      return { value: null, evidence: null };
    }
    const evidence = checkEvidence(wrapper.evidence);
    const value = wrapper.value;
    if (!safeText(value, name === 'description' ? 500 : 240)) fail('malformed_output');
    let normalizedValue = value;
    if (MONEY_FIELDS.has(name)) {
      normalizedValue = money(value);
      if (!quotedMoney(evidence.quote, normalizedValue)) fail('malformed_output');
    } else if (name === 'invoiceNumber' || name === 'paymentReference') {
      if (!identifier(value) || !normalized(evidence.quote).includes(value)) fail('malformed_output');
    } else if (ORGANIZATION_FIELDS.has(name)) {
      if (!/^\d{10}$/.test(value) || !evidence.quote.replace(/[ -]/g, '').includes(value)) fail('malformed_output');
      if (!validOrganization(value)) issues.push('invalid_organization_number:' + name);
    } else if (name === 'invoiceDate' || name === 'dueDate') {
      if (!validDate(value) || !quotedDate(evidence.quote, value, issues)) fail('malformed_output');
    } else if (name === 'currency') {
      if (!TWO_DECIMAL_CURRENCIES.has(value)) fail('currency_unsupported');
      if (!normalized(evidence.quote).toUpperCase().includes(value)) fail('malformed_output');
    } else if (name === 'quantity') {
      if (!/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value)
        || !normalized(evidence.quote).replace(/,/g, '.').includes(value)) fail('malformed_output');
    } else if (!normalized(evidence.quote).toLowerCase().includes(normalized(value).toLowerCase())) {
      fail('malformed_output');
    }
    return { value: normalizedValue, evidence };
  };
  const candidate = {};
  for (const name of INVOICE_AI_FIELD_NAMES) candidate[name] = checkField(name, output[name]);
  let lineItemsKnown = output.lineItems !== null;
  candidate.lineItems = [];
  if (lineItemsKnown) {
    if (!Array.isArray(output.lineItems) || output.lineItems.length > 100) fail('malformed_output');
    for (const item of output.lineItems) {
      if (!sameKeys(item, INVOICE_AI_LINE_FIELDS)) fail('malformed_output');
      const line = {};
      for (const name of INVOICE_AI_LINE_FIELDS) line[name] = checkField(name, item[name]);
      candidate.lineItems.push(line);
      if ([line.netAmount.value, line.vatAmount.value, line.totalAmount.value].every(value => value !== null)
        && line.netAmount.value + line.vatAmount.value !== line.totalAmount.value) issues.push('line_amounts_do_not_reconcile');
    }
  } else { issues.push('line_items_unknown'); }
  if (!Array.isArray(output.conflicts) || output.conflicts.length > 20) fail('malformed_output');
  const conflicts = [];
  for (const conflict of output.conflicts) {
    if (!sameKeys(conflict, ['field', 'reason', 'evidence']) || ![...INVOICE_AI_FIELD_NAMES, 'lineItems'].includes(conflict.field)
      || !safeText(conflict.reason, 300) || !Array.isArray(conflict.evidence) || conflict.evidence.length < 1 || conflict.evidence.length > 4) fail('malformed_output');
    conflicts.push({ field: conflict.field, reason: conflict.reason, evidence: conflict.evidence.map(checkEvidence) });
    issues.push('source_conflict:' + conflict.field);
    if (conflict.field === 'lineItems') { candidate.lineItems = []; lineItemsKnown = false; }
    else candidate[conflict.field] = { value: null, evidence: null };
  }
  const companyField = state.companyRole === 'supplier' ? 'supplierOrgNumber' : 'recipientOrgNumber';
  for (const name of ['invoiceNumber', 'supplierName', 'recipientName', 'invoiceDate', 'totalAmount', 'currency', companyField]) {
    if (candidate[name].value === null) issues.push('missing_field:' + name);
  }
  if (candidate[companyField].value !== state.policy.expectedCompanyOrganization) issues.push('company_organization_mismatch');
  if (candidate.currency.value !== null && candidate.currency.value !== 'SEK') issues.push('currency_not_sek');
  if (candidate.invoiceDate.value && candidate.dueDate.value && candidate.dueDate.value < candidate.invoiceDate.value) issues.push('due_date_before_invoice_date');
  const net = candidate.netAmount.value;
  const vat = candidate.vatAmount.value;
  const total = candidate.totalAmount.value;
  if ([net, vat, total].every(value => value !== null) && net + vat !== total) issues.push('amounts_do_not_reconcile');
  if (output.documentType === 'invoice' && total !== null && total <= 0) issues.push('invoice_total_not_positive');
  if (output.documentType === 'credit_note') {
    issues.push('credit_note_requires_review');
    if (total !== null && total >= 0) issues.push('credit_note_sign_conflict');
  }
  if (candidate.lineItems.length && total !== null && candidate.lineItems.every(item => item.totalAmount.value !== null)) {
    const sum = candidate.lineItems.reduce((acc, item) => acc + BigInt(item.totalAmount.value), 0n);
    if (sum !== BigInt(total)) issues.push('line_total_mismatch');
  }
  for (const [name, known] of Object.entries(state.deterministic)) {
    const value = candidate[name]?.value;
    if (value !== null && value !== undefined && comparable(value) !== comparable(known)) issues.push('deterministic_conflict:' + name);
  }
  const evidenceVerified = evidenceCount > 0 && evidenceCount === matchedEvidence;
  if (!evidenceVerified) issues.push('source_evidence_requires_review');
  return { candidate, issues: unique(issues), evidenceVerified, lineItemsKnown, conflicts, documentType: output.documentType };
}

function comparable(value) {
  return typeof value === 'string' ? normalized(value).toLowerCase() : value;
}
function snapshotDeterministic(raw, role) {
  if (!plain(raw)) return {};
  const snake = {
    invoiceNumber: 'invoice_number', paymentReference: 'reference',
    invoiceDate: 'issued_at', dueDate: 'due_at', netAmount: 'net_cents',
    vatAmount: 'vat_cents', totalAmount: 'total_cents', currency: 'currency',
    supplierName: role === 'recipient' ? 'party' : 'supplier',
    recipientName: role === 'supplier' ? 'party' : 'recipient',
    supplierOrgNumber: role === 'recipient' ? 'organization_number' : 'supplier_organization_number',
    recipientOrgNumber: role === 'supplier' ? 'organization_number' : 'recipient_organization_number',
  };
  const result = {};
  for (const name of INVOICE_AI_FIELD_NAMES) {
    let value = Object.hasOwn(raw, name) ? raw[name] : raw[snake[name]];
    if (plain(value)) value = value.value;
    if (typeof value === 'string' && value.length <= 500) result[name] = value;
    else if (Number.isSafeInteger(value)) result[name] = value;
  }
  return result;
}

/**
 * Server-only adapter. The host must authorize the owner, parse the original locally,
 * and atomically reserve the complete document cap in its durable idempotency ledger.
 * Neither this function nor a successful AI proposal is bank or payment evidence.
 * It never uploads persistent Files, stores Responses, logs payloads, or executes tools.
 */
export async function extractOpenAiInvoice(args = {}, options = {}) {
  let state;
  let result = resultBase();
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') fail('server_only');
    state = await prepare(args);
    result = resultBase(publicPreparation(state));
    if (state.status === 'disabled') return { ...result, status: 'disabled', issues: state.issues };
    const apiKey = args.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) fail('api_key_missing');
    if (apiKey.length > 4096 || !/^[\x21-\x7E]+$/.test(apiKey)) fail('api_key_invalid');
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') fail('fetch_unavailable');
    const timeoutMs = options.timeoutMs ?? state.profile.limits.timeoutMs;
    const retryDelayMs = options.retryDelayMs ?? state.profile.limits.retryDelayMs;
    if (!integer(timeoutMs, 1, 45000) || !integer(retryDelayMs, 0, 2000)) fail('transport_configuration_invalid');
    const deadline = Date.now() + timeoutMs;
    const common = payload(state);
    let counted;
    try {
      counted = await request(ENDPOINT + '/input_tokens', common, apiKey, fetchImpl,
        deadline - Date.now(), 16384, state.idempotencyKey + '-count');
    } catch { fail('input_count_unavailable'); }
    if (counted.status !== 200) fail('input_count_unavailable');
    if (counted.body?.object !== 'response.input_tokens' || !integer(counted.body.input_tokens, 1, 10000000)) fail('input_count_invalid');
    result.inputCountTokens = counted.body.input_tokens;
    if (result.inputCountTokens > state.profile.limits.maxInputTokens) fail('input_context_limit');
    const perAttempt = invoiceAiCostMicroUsd({
      inputTokens: result.inputCountTokens, outputTokens: state.profile.limits.maxOutputTokens,
    }, state.profile.pricing);
    result.estimatedMaximumCostMicroUsd = perAttempt * state.profile.limits.maxAttempts;
    if (result.estimatedMaximumCostMicroUsd > state.policy.maxDocumentMicroUsd) fail('document_budget_exceeded');
    const body = {
      ...common, max_output_tokens: state.profile.limits.maxOutputTokens,
      store: false, background: false, stream: false, service_tier: 'default',
    };
    for (let attempt = 1; attempt <= state.profile.limits.maxAttempts; attempt++) {
      if (deadline <= Date.now()) fail('api_timeout');
      result.attempts = attempt;
      let received;
      try {
        received = await request(ENDPOINT, body, apiKey, fetchImpl, deadline - Date.now(),
          state.profile.limits.maxResponseBytes, state.idempotencyKey);
      } catch (error) {
        result.costUnknown = true;
        fail(codeOf(error, 'api_network_error'));
      }
      if (received.status < 200 || received.status >= 300) {
        const failure = httpFailure(received.status, received.body);
        if (failure.ambiguous) result.costUnknown = true;
        if (failure.retry && attempt < state.profile.limits.maxAttempts && deadline - Date.now() > retryDelayMs) {
          if (retryDelayMs) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          continue;
        }
        fail(failure.issue);
      }
      let accounting;
      try { accounting = readUsage(received.body, state); }
      catch (error) { result.costUnknown = true; throw error; }
      result.usage = accounting.usage;
      result.knownCostMicroUsd += accounting.cost;
      result.costMicroUsd = result.costUnknown ? null : result.knownCostMicroUsd;
      if (received.body.model !== state.profile.model || (received.body.service_tier !== undefined && received.body.service_tier !== 'default')) result.costUnknown = true;
      const output = responseOutput(received.body, state.profile.model);
      if (result.usage.inputTokens !== result.inputCountTokens) fail('input_count_mismatch');
      if (result.usage.outputTokens > state.profile.limits.maxOutputTokens) fail('output_token_limit_exceeded');
      if (result.knownCostMicroUsd > state.policy.maxDocumentMicroUsd) fail('actual_cost_exceeds_budget');
      const validated = validateOutput(output, state);
      return {
        ...result, ...validated, status: 'review',
        costMicroUsd: result.costUnknown ? null : result.knownCostMicroUsd,
      };
    }
    fail('api_retry_limit');
  } catch (error) {
    return {
      ...result, status: 'fallback', candidate: null,
      issues: unique([...result.issues, codeOf(error, 'adapter_failed')]),
      costMicroUsd: result.costUnknown ? null : result.knownCostMicroUsd,
    };
  }
}
