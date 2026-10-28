// Pure, bounded extraction. Bank IDs, account numbers and amounts are never payer references.
export const REFERENCE_VERSION = 'payment-references-2026-10-28.2';
const keyName = key => key.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const missing = value => !value || /^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value);

/** Modulus-10 only. Length control requires the company's separate bank agreement. */
export function ocrChecksum(value) {
  const input=String(value).trim();
  if(!/^\d[\d -]*\d$/.test(input))return false;
  const digits = input.replace(/[ -]/g, '');
  if (!/^\d{2,25}$/.test(digits)) return false;
  let sum = 0;
  for (let n = digits.length - 1, weight = 1; n >= 0; n--, weight = 3 - weight) {
    const product = Number(digits[n]) * weight;
    sum += Math.floor(product / 10) + product % 10;
  }
  return sum % 10 === 0;
}

export function extractPaymentReferences(raw) {
  const candidates = [], warnings = [], visited = new WeakSet();
  let nodes = 0, incomplete = false;
  const add = (input, source, kind, priority) => {
    if (typeof input !== 'string') return;
    const value = input.trim();
    if (missing(value)) return;
    if (value.length > 300 || candidates.length >= 40) { incomplete = true; return; }
    if (candidates.some(c => c.value === value && c.source === source)) return;
    const validity = kind === 'ocr' ? ocrChecksum(value) ? 'checksum_valid' : 'checksum_invalid' : 'unchecked';
    candidates.push({value, source, kind, priority: validity === 'checksum_valid' ? 100 : priority, validity});
  };
  const labelled = (value, source) => {
    // Boundaries preserve AB/12, hyphens and leading zeros. Never guess from bare dates or amounts.
    const pattern = /(?:^|[\s,;])(?:faktura(?:nummer|\s*nr\.?)?|invoice(?:\s*(?:no\.?|number))?)\s*[:#]?\s*([\p{L}\p{N}][\p{L}\p{N}/_-]*)/giu;
    for (const match of value.matchAll(pattern)) {
      if (/\d/.test(match[1])) add(match[1], source, 'invoice', 80);
    }
    const ocr=/(?:^|[\s,;])OCR(?:[- ]?(?:nummer|referens))?\s*[:#]?\s*(\d[\d -]*\d|[\p{L}\p{N}][\p{L}\p{N}/_-]*)/giu;
    for(const match of value.matchAll(ocr))add(match[1],source,'ocr',80);
  };
  const walk = (value, source = '$', context = '', depth = 0) => {
    if (++nodes > 2000 || depth > 12) { incomplete = true; return; }
    if (typeof value === 'string') {
      if (value.length > 10_000) { incomplete = true; return; }
      if (context === 'ocr') add(value, source, 'ocr', 90);
      else if (context === 'invoice') add(value, source, 'invoice', 85);
      else if (context === 'structured') add(value, source, 'structured', 90);
      else if (context === 'remittance') { add(value, source, 'message', 40); labelled(value, source); }
      else if (context === 'message') labelled(value, source);
      return;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.slice(0, 100).forEach((item, n) => walk(item, `${source}[${n}]`, context, depth + 1)); if (value.length > 100) incomplete = true; return; }
    for (const [key, child] of Object.entries(value)) {
      if (nodes > 2000) { incomplete = true; break; }
      const k = keyName(key), field = `${source}.${key}`;
      if (/^(entryreference|bankreference|transactionid|endtoendid|acctsvcrref|iban|bban|bankgiro|payerbankgiro|creditoraccount|debtoraccount|transactionamount)$/.test(k)) continue;
      const next = /^(ocr|ocrnumber|ocrnummer|ocrreference|ocrreferens)$/.test(k) ? 'ocr'
        : /^(invoicenumber|invoiceno|fakturanummer|fakturanr)$/.test(k) ? 'invoice'
        : /^(referencenumber|paymentreference|betalningsreferens|fakturareferens|betalningsreferensocr)$/.test(k) || k === 'ref' && /CdtrRefInf/i.test(source) ? 'structured'
        : k === 'nb' && /RfrdDocInf/i.test(source) ? 'invoice'
        : /^(remittanceinformation|ustrd|unstructured|remittance)$/.test(k) ? 'remittance'
        : /^(note|message|meddelande|addtltxinf|description)$/.test(k) ? 'message'
        : /^(value|text|reference|number)$/.test(k) ? context : '';
      walk(child, field, next, depth + 1);
    }
  };
  walk(raw);
  candidates.sort((a, b) => b.priority - a.priority || a.source.localeCompare(b.source));
  if (incomplete) warnings.push('Alla referensfält kunde inte analyseras inom säkerhetsgränsen. Granska bankoriginalet.');
  if (candidates.some(c => c.validity === 'checksum_invalid')) warnings.push('En uttrycklig OCR-referens har felaktig kontrollsiffra och behöver granskas.');
  const identities = candidates.filter(c => c.kind !== 'message');
  const selected = identities[0] || candidates[0];
  return {version: REFERENCE_VERSION, candidates, selected: selected || null, incomplete, warnings};
}

/** Keep competing unstructured identifiers visible; narrative cannot override a structured reference. */
export function matchingReferenceValues(evidence, fallback = '') {
  const explicit = evidence?.candidates?.filter(c => c.kind !== 'message') || [];
  const messages=evidence?.candidates?.filter(c=>c.kind==='message')||[];
  const bare=value=>/\d/.test(value)&&(/^[\p{L}\p{N}][\p{L}\p{N}/_-]*$/u.test(value)||/^\d[\d -]*$/.test(value))&&!/^\d{4}-\d{2}-\d{2}$/.test(value);
  const relevant=explicit.length?messages.filter(c=>bare(c.value)):messages;
  return [...new Set([...explicit.map(c=>c.value),...relevant.map(c=>c.value),fallback].filter(Boolean))];
}
