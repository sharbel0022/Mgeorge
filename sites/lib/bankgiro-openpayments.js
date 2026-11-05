import { normalizePayerEvidence, payerField } from './payer-evidence.js';
import { extractPaymentReferences, REFERENCE_VERSION } from './payment-references.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const VERSION = 'openpayments-bankgiro-v1';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = value => typeof value === 'string' ? value : '';
const unique = values => [...new Set(values)];
const present = value => value !== undefined && value !== null && value !== '';
const encoder = new TextEncoder();
const placeholder = value => /^(?:NOT\s?PROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value);
function identity(value, field, max = 500) {
  if (!present(value)) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_ORIGINAL', `Malformed identity at ${field}`);
  return !value.trim() || value !== value.trim() || placeholder(value) ? '' : value;
}
function creditorAccount(account, path, context, issues) {
  if (account === undefined) return '';
  if (!object(account)) fail('INVALID_ORIGINAL', `Malformed creditor account at ${path}`);
  if (present(account.iban) && account.iban !== context.iban) fail('ACCOUNT_MISMATCH', 'Original creditor IBAN differs from expected bank account');
  if (present(account.bankgiroNumber) && typeof account.bankgiroNumber !== 'string') fail('INVALID_ORIGINAL', `Malformed Bankgiro at ${path}`);
  const bankgiro = str(account.bankgiroNumber);
  if (context.bankgiro && bankgiro && context.bankgiro.replace(/[- ]/g, '') !== bankgiro.replace(/[- ]/g, '')) issues.push('recipient_bankgiro_mismatch');
  return bankgiro;
}

function canonical(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 150000 || depth > 40) fail('INVALID_ORIGINAL', 'Original exceeds JSON structural limits');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1, budget)).join(',') + ']';
  if (object(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1, budget)).join(',') + '}';
  }
  fail('INVALID_ORIGINAL', 'Expected a parsed original JSON body');
}

function cents(value, field) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value) || value.length > 30) fail('INVALID_ORIGINAL', `Invalid decimal amount at ${field}`);
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const amount = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) fail('INVALID_ORIGINAL', `Unsafe amount at ${field}`);
  return Number(amount);
}

function date(value, field) {
  if (!present(value)) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_ORIGINAL', `Invalid date at ${field}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail('INVALID_ORIGINAL', `Invalid calendar date at ${field}`);
  return value;
}

function references(child, path, issues) {
  const candidates = [], warnings = [];
  let incomplete = false;
  const add = (value, source, structured) => {
    if (!present(value)) return;
    if (typeof value !== 'string') { issues.push('unsupported_remittance_type'); incomplete = true; return; }
    // Feed only documented remittance fields to the shared extractor. API IDs and
    // aggregate remittance are not individual payment references.
    const field = structured ? 'paymentReference' : 'remittance';
    const evidence = extractPaymentReferences({ [field]: value }, { sourcePrefix: path });
    for (const candidate of evidence.candidates) candidates.push({ ...candidate, source: candidate.source.replace(`${path}.${field}`, source) });
    warnings.push(...evidence.warnings);
    incomplete ||= evidence.incomplete;
  };
  add(child.remittanceInformationStructured, `${path}.remittanceInformationStructured`, true);
  add(child.remittanceInformationUnstructured, `${path}.remittanceInformationUnstructured`, false);
  if (present(child.remittanceInformationUnstructuredArray)) {
    if (!Array.isArray(child.remittanceInformationUnstructuredArray)) { issues.push('unsupported_remittance_type'); incomplete = true; }
    else child.remittanceInformationUnstructuredArray.forEach((value, index) => add(value, `${path}.remittanceInformationUnstructuredArray[${index}]`, false));
  }
  if (present(child.remittanceInformationStructuredArray) && !(Array.isArray(child.remittanceInformationStructuredArray) && child.remittanceInformationStructuredArray.length === 0)) {
    issues.push('unsupported_structured_reference_object'); incomplete = true;
  }
  candidates.sort((a, b) => b.priority - a.priority || a.source.localeCompare(b.source));
  if (candidates.length > 40) { candidates.length = 40; incomplete = true; }
  if (incomplete) issues.push('incomplete_reference_evidence');
  return { version: REFERENCE_VERSION, candidates, selected: candidates.find(candidate => candidate.kind !== 'message') || candidates[0] || null, incomplete, warnings: unique(warnings) };
}

/** Normalize parsed bank originals. Does not authorize, reconcile, or mutate them. */
export function normalizeOpenPaymentsBankgiro(pages, context) {
  const contextText = value => typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
  if (!object(context) || ['owner', 'companyId', 'sourceId', 'accountId', 'iban'].some(key => !contextText(context[key]))) fail('INVALID_ORIGINAL', 'Missing tenant or account context');
  if (['scopeId', 'bankgiro', 'reportId'].some(key => context[key] !== undefined && !contextText(context[key]))) fail('INVALID_ORIGINAL', 'Invalid optional context');
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 50) fail('INVALID_ORIGINAL', 'Expected 1–50 original pages');
  canonical(context);
  const scope = JSON.stringify([context.owner, context.companyId, context.sourceId, context.scopeId || '', context.accountId, context.iban]);
  const scoped = (kind, value) => `${VERSION}:${kind}:${bytesToHex(sha256(encoder.encode(JSON.stringify([scope, kind, value]))))}`;
  const rows = [], groups = new Map(), parents = new Map(), seen = new Map(), coverageIssues = [];
  let count = 0, bookedCount = 0, totalBytes = 0;
  const structuralBudget = { nodes: 0 };
  pages.forEach((page, pageIndex) => {
    if (!object(page) || !object(page.transactions)) fail('INVALID_ORIGINAL', 'Expected an original accountReport with transactions');
    const pageBytes = encoder.encode(canonical(page, 0, structuralBudget)).length;
    totalBytes += pageBytes;
    if (pageBytes > 8 * 1024 * 1024 || totalBytes > 15000000) fail('INVALID_ORIGINAL', 'Original pages exceed size limit');
    if (page.account !== undefined && !object(page.account)) fail('INVALID_ORIGINAL', 'Malformed response account');
    const actualIban = str(page.account?.iban);
    if (present(page.account?.iban) && !actualIban) fail('INVALID_ORIGINAL', 'Malformed response IBAN');
    if (actualIban && actualIban !== context.iban) fail('ACCOUNT_MISMATCH', 'Original response account differs from expected bank account');
    if (!actualIban) coverageIssues.push('missing_response_account');
    if (page.account) creditorAccount(page.account, `$[${pageIndex}].account`, context, coverageIssues);
    if (present(page._links?.download) || present(page.download) || present(page.transactions._links?.download)) coverageIssues.push('download_not_resolved');
    if (pageIndex === pages.length - 1 && (present(page.transactions._links?.next) || present(page._links?.next))) coverageIssues.push('pagination_incomplete');
    const booked = page.transactions.booked;
    if (booked !== undefined && !Array.isArray(booked)) fail('INVALID_ORIGINAL', 'Malformed booked transactions');
    bookedCount += booked?.length || 0;
    if (bookedCount > 10000) fail('INVALID_ORIGINAL', 'Originals exceed 10000 booked observations');
    for (const [index, parent] of (booked || []).entries()) {
      if (!object(parent)) fail('INVALID_ORIGINAL', 'Malformed booked transaction');
      const parentId = identity(parent.transactionId, `$[${pageIndex}].transactions.booked[${index}].transactionId`);
      if (!parentId) continue;
      const facts = canonical(parent), prior = parents.get(parentId);
      if (!prior) parents.set(parentId, { raw: parent, facts, source: `$[${pageIndex}].transactions.booked[${index}]`, ambiguous: false });
      else if (prior.facts !== facts) prior.ambiguous = true;
    }
    if (page.transactions.bankgiro === undefined) coverageIssues.push('bankgiro_details_absent');
    else if (!Array.isArray(page.transactions.bankgiro)) fail('INVALID_ORIGINAL', 'Malformed Bankgiro details');
    else if (!page.transactions.bankgiro.length) coverageIssues.push('bankgiro_details_empty');
    count += page.transactions.bankgiro?.length || 0;
    if (count > 1000) fail('INVALID_ORIGINAL', 'Originals exceed 1000 detail observations');
  });
  pages.forEach((page, pageIndex) => {
    for (const [index, child] of (page.transactions.bankgiro || []).entries()) {
      if (!object(child) || !object(child.transactionAmount)) fail('INVALID_ORIGINAL', 'Malformed Bankgiro transaction');
      const path = `$[${pageIndex}].transactions.bankgiro[${index}]`, issues = [];
      if (present(child.aggregateId) && (!Number.isSafeInteger(child.aggregateId) || child.aggregateId < 0)) fail('INVALID_ORIGINAL', 'Malformed aggregate serial');
      const transactionId = identity(child.transactionId, `${path}.transactionId`), parentId = identity(child.aggregateTransactionId, `${path}.aggregateTransactionId`);
      const facts = canonical(child);
      if (transactionId && seen.has(transactionId)) {
        const prior = seen.get(transactionId);
        if (prior.facts !== facts) fail('IDENTITY_CONFLICT', 'Same child transactionId has different original facts');
        prior.row.enrichmentEvidence.sourcePaths.push(path);
        continue;
      }
      const amount = cents(child.transactionAmount.amount, `${path}.transactionAmount.amount`);
      const currency = str(child.transactionAmount.currency);
      const bookingDate = date(child.bookingDate, `${path}.bookingDate`);
      const settlementDate = date(child.valueDate, `${path}.valueDate`);
      if (amount <= 0) issues.push('non_positive_incoming_amount');
      if (currency !== 'SEK') issues.push('unsupported_currency');
      if (!bookingDate) issues.push('missing_booking_date');
      if (child.isAliasPayin !== true || child.isAliasPayout === true) issues.push('incoming_alias_not_confirmed');
      if (child.isEnriched !== true) issues.push('enrichment_not_confirmed');
      if (!transactionId || !transactionId.trim()) issues.push('missing_stable_individual_id');
      if (!transactionId && present(child.transactionListId)) issues.push('weak_transaction_list_id');
      if (!parentId) issues.push('missing_parent_transaction_id');
      if (!parentId && present(child.aggregateTransactionListId)) issues.push('weak_parent_list_id');
      const actualIban = str(page.account?.iban);
      const recipientBankgiro = creditorAccount(child.creditorAccount, `${path}.creditorAccount`, context, issues);
      const party = str(child.debtorName);
      const identifiers = [];
      if (typeof child.debtorOrganisationId === 'string' && child.debtorOrganisationId.trim()) identifiers.push({ ...payerField(child.debtorOrganisationId, `${path}.debtorOrganisationId`), kind: 'organization', scheme: '', issuer: '' });
      for (const kind of ['iban', 'bban']) if (typeof child.debtorAccount?.[kind] === 'string') identifiers.push({ ...payerField(child.debtorAccount[kind], `${path}.debtorAccount.${kind}`), kind, scheme: '', issuer: '' });
      const collective = /^(?:bankgiro(?:t)?(?:\s+ab)?|(?:bankgiro|bg)(?:\s*[- ]?\s*(?:inbetalning(?:ar)?|insättning(?:ar)?|betalning(?:ar)?))|samlingsinsättning|swedbank(?:\s+ab)?|bg)$/i.test(party.trim());
      const address = object(child.debtorAddress) ? { fields: Object.entries(child.debtorAddress).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).flatMap((item, n) => typeof item === 'string' ? [payerField(item, `${path}.debtorAddress.${key}${Array.isArray(value) ? `[${n}]` : ''}`)] : [])) } : null;
      const payerEvidence = normalizePayerEvidence({ namespace: scoped('scope', ''), scope: collective ? 'collective' : 'individual', name: party ? payerField(party, `${path}.debtorName`) : null, identifiers, address });
      if (!party.trim() || placeholder(party.trim())) issues.push('missing_individual_payer');
      if (payerEvidence.scope !== 'individual') issues.push('collective_payer');
      const referenceEvidence = references(child, path, issues);
      const key = transactionId ? scoped('child', transactionId) : scoped('observation', [context.reportId || '', pageIndex, index]);
      const groupKey = parentId ? scoped('parent', parentId) : scoped('parent-review', [context.reportId || '', pageIndex, child.aggregateId ?? index, bookingDate]);
      const payerAccount = str(child.debtorAccount?.iban) || str(child.debtorAccount?.bban);
      const remittanceMessage = [child.remittanceInformationUnstructured, ...(Array.isArray(child.remittanceInformationUnstructuredArray) ? child.remittanceInformationUnstructuredArray : [])].filter(value => typeof value === 'string').join('\n');
      const row = {
        kind: 'payment', specification: true, verified: false,
        key, externalId: transactionId ? scoped('transaction', transactionId) : '',
        parentKey: groupKey, date: bookingDate, settlementDate, amount, currency, party,
        payerReference: referenceEvidence.selected?.value || '', bankReference: identity(child.entryReference, `${path}.entryReference`, 300), parentBankReference: '',
        organizationNumber: payerEvidence.organizationNumber, payerAccount: payerAccount ? '•••• ' + payerAccount.replace(/[\s-]/g, '').slice(-4) : '', remittanceMessage, description: str(child.additionalInformation),
        recipientBankgiro, account: actualIban, source: 'Open Payments Bankgiro', format: 'Open Payments Bankgiro JSON',
        payerEvidence, referenceEvidence,
        reportEvidence: { profile: VERSION, reportId: context.reportId || '', sequence: present(child.aggregateId) ? String(child.aggregateId) : '', entryReference: str(child.entryReference), paymentCount: '', totalCents: '', recipientBankgiro, currencySource: `${path}.transactionAmount.currency` },
        bankgiroEnrichmentIssue: '',
        enrichmentEvidence: { version: VERSION, provider: 'openpayments', owner: context.owner, companyId: context.companyId, sourceId: context.sourceId, scopeId: context.scopeId || '', accountId: context.accountId, transactionId, parentTransactionId: parentId, aggregateId: child.aggregateId ?? null, transactionListId: str(child.transactionListId), aggregateTransactionListId: str(child.aggregateTransactionListId), sourcePaths: [path], accountSource: `$[${pageIndex}].account`, fieldEvidence: structuredClone(child) },
        rawBankData: structuredClone(child), rawAccount: page.account ? structuredClone(page.account) : null,
      };
      rows.push(row);
      if (transactionId) seen.set(transactionId, { facts, row });
      let group = groups.get(groupKey);
      if (!group) { group = { key: groupKey, parentTransactionId: parentId, parentEntryReference: '', amount: null, paymentCount: 0, complete: false, issues: [], rowKeys: [], rows: [], totals: [], dates: [], currencies: [] }; groups.set(groupKey, group); }
      group.rows.push(row); group.rowKeys.push(key); group.paymentCount++;
      group.issues.push(...issues); group.dates.push(bookingDate); group.currencies.push(currency);
      if (present(child.aggregateAmount)) group.totals.push(cents(child.aggregateAmount, `${path}.aggregateAmount`));
      else group.issues.push('missing_aggregate_amount');
    }
  });
  const resultGroups = [];
  const entryClaims = new Map();
  for (const group of groups.values()) {
    const parent = parents.get(group.parentTransactionId);
    if (!parent || parent.ambiguous) group.issues.push(parent?.ambiguous ? 'ambiguous_parent_transaction' : 'missing_booked_parent');
    let parentAmount = null;
    if (parent && !parent.ambiguous) {
      group.parentEntryReference = identity(parent.raw.entryReference, `${parent.source}.entryReference`, 300);
      if (!group.parentEntryReference.trim()) group.issues.push('missing_parent_entry_reference');
      creditorAccount(parent.raw.creditorAccount, `${parent.source}.creditorAccount`, context, group.issues);
      if (object(parent.raw.transactionAmount)) {
        parentAmount = cents(parent.raw.transactionAmount.amount, `${parent.source}.transactionAmount.amount`);
        group.currencies.push(str(parent.raw.transactionAmount.currency));
      } else group.issues.push('missing_parent_amount');
      group.dates.push(date(parent.raw.bookingDate, `${parent.source}.bookingDate`));
    }
    if (unique(group.currencies).length !== 1 || group.currencies[0] !== 'SEK') group.issues.push('group_currency_mismatch');
    if (unique(group.dates).length !== 1 || !group.dates[0]) group.issues.push('group_booking_date_mismatch');
    const sum = group.rows.reduce((total, row) => total + BigInt(row.amount), 0n);
    if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER)) fail('INVALID_ORIGINAL', 'Unsafe group total');
    if (unique(group.totals).length > 1) group.issues.push('aggregate_amount_conflict');
    group.amount = parentAmount ?? group.totals[0] ?? null;
    if (sum <= 0n || group.totals.some(total => total <= 0 || BigInt(total) !== sum) || parentAmount !== null && (parentAmount <= 0 || BigInt(parentAmount) !== sum)) group.issues.push('group_total_mismatch');
    group.issues = unique([...group.issues, ...coverageIssues]);
    group.complete = group.issues.length === 0;
    for (const row of group.rows) {
      row.parentBankReference = group.parentEntryReference;
      row.bankgiroEnrichmentIssue = group.issues.join('; ');
      row.reportEvidence.paymentCount = String(group.paymentCount);
      row.reportEvidence.totalCents = group.amount === null ? '' : String(group.amount);
      row.enrichmentEvidence.parentEntryReference = group.parentEntryReference;
      row.enrichmentEvidence.parentSource = parent && !parent.ambiguous ? parent.source : '';
      row.enrichmentEvidence.groupComplete = group.complete;
    }
    const { rows: ignoredRows, totals, dates, currencies, ...publicGroup } = group;
    resultGroups.push(publicGroup);
    if (group.parentEntryReference) {
      const claim = JSON.stringify([group.parentEntryReference, dates[0], currencies[0], group.amount]);
      entryClaims.set(claim, [...(entryClaims.get(claim) || []), { group: publicGroup, rows: group.rows }]);
    }
  }
  for (const claims of entryClaims.values()) if (claims.length > 1) for (const { group, rows: children } of claims) {
    group.issues.push('ambiguous_bank_entry_reference'); group.complete = false;
    for (const row of children) { row.bankgiroEnrichmentIssue = group.issues.join('; '); row.enrichmentEvidence.groupComplete = false; }
  }
  const issues = unique([...coverageIssues, ...resultGroups.flatMap(group => group.issues)]);
  if (!rows.length && !issues.length) issues.push('bankgiro_details_unavailable');
  return { version: VERSION, provider: 'openpayments', context: structuredClone(context), rows, groups: resultGroups, coverage: { status: rows.length ? issues.length ? 'partial' : 'available' : 'unavailable', reasons: [...issues] }, issues };
}
