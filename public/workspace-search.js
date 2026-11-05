// Classic-script adapter of src/workspace-search.js; parity is verified by tests.
const workspaceSearch = (() => {
// Read-only workspace search. Amounts are integer minor units; a result is not
// evidence of an invoice/payment relationship and never creates an allocation.
const MAX_QUERY_LENGTH = 512;
const MAX_TERMS = 32;

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('sv-SE').trim().replace(/\s+/gu, ' ');
}

function dateAliases(value) {
  const date = normalize(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|t)/u.exec(date);
  return match ? [date, `${match[3]}/${match[2]}/${match[1]}`, `${match[3]}.${match[2]}.${match[1]}`, `${match[3]}-${match[2]}-${match[1]}`] : [date];
}

/** Build once per state revision, then reuse while the user types.
 * @param {Array<any>} records */
function createWorkspaceSearchIndex(records = []) {
  return records.filter(record => record?.type === 'invoice' || record?.type === 'transaction').map((record, order) => {
    const references = [record.number, record.reference, record.ocr, record.payerReference, record.bankReference].map(normalize).filter(Boolean);
    const amount = Number.isSafeInteger(record.amountCents) ? record.amountCents : null;
    const amountText = amount === null ? '' : (amount / 100).toFixed(2).replace('.', ',');
    const dates = [record.date, ...(Array.isArray(record.dates) ? record.dates : [])].flatMap(dateAliases);
    return {
      record, order, amount, references,
      text: [...references, normalize(record.party), normalize(record.text), ...dates, amountText].join(' '),
    };
  });
}

function queryParts(value) {
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) return null;
  const query = normalize(value);
  if (!query) return null;
  const amountGroups = [];
  let amountTerms = 0;
  // Decimal punctuation makes the amount explicit, so a bare numeric reference
  // (including leading zeroes) is never silently interpreted as money.
  // Start at a token boundary; an invoice suffix such as SYN-001 must not
  // become the first thousands group of the amount that follows it.
  const rest = query.replace(/(?<!\S)([+-]?(?:[1-9]\d{0,2}(?: \d{3})+|\d+))[,.](\d{1,2})(?![\p{L}\p{N},./])(?:\s*(?:kr|sek)\b)?/gu, (_match, major, minor) => {
    const groups = major.split(' ');
    amountTerms += groups.length;
    const alternatives = [];
    // "123 456,00" can mean 123,456 kronor or reference 123 plus 456 kronor.
    // Keep both readings. A recovered prefix must be an exact saved reference;
    // do not turn a thousands group into an arbitrary text substring match.
    for (let split = 0; split < groups.length; split++) {
      const compact = groups.slice(split).join('');
      const sign = compact.startsWith('-') ? -1 : 1;
      const amount = sign * (Math.abs(Number(compact)) * 100 + Number(minor.padEnd(2, '0')));
      if (Number.isSafeInteger(amount)) alternatives.push({ amount, reference: groups.slice(0, split).join(' ') });
    }
    amountGroups.push(alternatives);
    return ' ';
  });
  const terms = rest.split(/\s+/u).filter(Boolean);
  if (terms.length + amountTerms > MAX_TERMS || amountGroups.some(group => !group.length)) return null;
  return { query, terms, amountGroups };
}

/** All terms must match; exact references rank before partial text matches.
 * @param {Array<any>} index
 * @param {string|null|undefined} query
 * @param {{limitPerType?:number|null}} [options]
 * @returns {{invoices:Array<any>,transactions:Array<any>}} */
function searchWorkspaceIndex(index, query, { limitPerType = 4 } = {}) {
  const result = { invoices: [], transactions: [] };
  const parts = queryParts(query);
  if (!parts) return result;
  const all = limitPerType === null;
  const limit = Number.isSafeInteger(limitPerType) ? Math.max(1, Math.min(50, limitPerType)) : 4;
  const matches = { invoice: [], transaction: [] };
  for (const entry of index) {
    if (!parts.terms.every(term => entry.text.includes(term))) continue;
    let amountScore = 0;
    // Evaluate each bounded group independently, avoiding an exponential product
    // of parse paths. Every group and every remaining term must still match.
    for (const group of parts.amountGroups) {
      let groupScore = -1;
      for (const option of group) {
        if (entry.amount === option.amount && (!option.reference || entry.references.includes(option.reference))) groupScore = Math.max(groupScore, option.reference ? 100 : 0);
      }
      if (groupScore < 0) { amountScore = -1; break; }
      amountScore += groupScore;
    }
    if (amountScore < 0) continue;
    const score = amountScore + (entry.references.includes(parts.query) ? 1000 : 0) + parts.terms.reduce((total, term) => total + (entry.references.includes(term) ? 100 : entry.references.some(reference => reference.startsWith(term)) ? 10 : 0), 0);
    const bucket = matches[entry.record.type];
    if (all) { bucket.push({ record: entry.record, score }); continue; }
    const at = bucket.findIndex(match => score > match.score);
    if (at >= 0) bucket.splice(at, 0, { record: entry.record, score });
    else if (bucket.length < limit) bucket.push({ record: entry.record, score });
    if (bucket.length > limit) bucket.length = limit;
  }
  if (all) for (const bucket of Object.values(matches)) bucket.sort((a, b) => b.score - a.score);
  result.invoices = matches.invoice.map(match => match.record);
  result.transactions = matches.transaction.map(match => match.record);
  return result;
}

return { createWorkspaceSearchIndex, searchWorkspaceIndex };
})();
