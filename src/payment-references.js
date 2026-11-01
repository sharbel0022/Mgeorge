// Pure, bounded extraction. Bank IDs, account numbers and amounts are never payer references.
export const REFERENCE_VERSION = 'payment-references-2026-11-01.1';
export const AIS_NULL_SCHEMA_VERSION = 'payment-references-ais-null-schema-v1';
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

/**
 * Logical OCR checks against explicitly supplied rules, not proof of a bank
 * agreement or bank acceptance. Soft control can permit another reference after
 * a warning. Source: Bankgirot's OCR-referenskontroll (checked 2026-11-01).
 */
export function validateOcrAgreement(value, agreement) {
  const checksumValid = ocrChecksum(value);
  const formatValid = typeof value === 'string' && /^\d{2,25}$/.test(value);
  const unknown = {status:'unknown', checksumValid, formatValid, lengthValid:null};
  if (!agreement || typeof agreement !== 'object' || Array.isArray(agreement)) return unknown;
  const {control, lengths} = agreement;
  if (!['soft','hard','variable_length','fixed_length'].includes(control)) return unknown;
  if (control === 'fixed_length' && (!Array.isArray(lengths) || lengths.length < 1 || lengths.length > 2 || lengths.some(n => !Number.isInteger(n) || n < 2 || n > 25) || new Set(lengths).size !== lengths.length)) return unknown;
  const lengthValid = control === 'variable_length' ? formatValid && Number(value.at(-2)) === value.length % 10
    : control === 'fixed_length' ? formatValid && lengths.includes(value.length) : null;
  return {status:formatValid && checksumValid && lengthValid !== false ? 'valid' : 'invalid', checksumValid, formatValid, lengthValid};
}

export function extractPaymentReferences(raw, {sourcePrefix = '$', profile = 'legacy'} = {}) {
  if (typeof sourcePrefix !== 'string' || !sourcePrefix.startsWith('$') || sourcePrefix.length > 1000) throw new TypeError('Ogiltig källsökväg för betalningsreferenser.');
  if (!['legacy','ais-null-schema-v1'].includes(profile)) throw new TypeError('Okänd referensprofil.');
  const candidates = [], warnings = [], visited = new WeakSet();
  let nodes = 0, incomplete = false;
  const add = (input, source, kind, priority, rawValue = input, schema = '') => {
    if (typeof input !== 'string') return;
    const value = input.trim();
    if (missing(value)) return;
    if (value.length > 300 || candidates.length >= 40) { incomplete = true; return; }
    if (candidates.some(c => c.value === value && c.source === source && c.kind === kind && (c.schema || '') === schema)) return;
    const validity = kind === 'ocr' ? ocrChecksum(value) ? 'checksum_valid' : 'checksum_invalid' : 'unchecked';
    candidates.push({value, rawValue, source, kind, priority: validity === 'checksum_valid' ? 100 : priority, validity, ...(schema ? {schema} : {})});
  };
  const labelled = (value, source) => {
    // Boundaries preserve AB/12, hyphens and leading zeros. Never guess from bare dates or amounts.
    const pattern = /(?:^|[\s,;])(?:faktura(?:nummer|\s*nr\.?)?|invoice(?:\s*(?:no\.?|number))?)\s*[:#]?\s*([^\s,;]+(?:[,;][ \t]*\d[^\s,;]*)*)/giu;
    for (const match of value.matchAll(pattern)) {
      if (/\d/.test(match[1])) {
        if (!/^[\p{L}\p{N}][\p{L}\p{N}/_-]*$/u.test(match[1])) incomplete = true;
        add(match[1], source, 'invoice', 80, value);
      }
    }
    // Capture the whole final token, including unsupported punctuation. A
    // checksum-valid numeric prefix is never evidence for the supplied value.
    // Comma/semicolon plus another number is ambiguous, not a label delimiter.
    const ocr=/(?:^|[\s,;])OCR(?:[- ]?(?:nummer|referens))?\s*[:#]?\s*((?:\d+(?:[ -]+\d+)*[^\s,;]*|[^\s,;]+)(?:[,;][ \t]*\d[^\s,;]*)*)/giu;
    for(const match of value.matchAll(ocr))add(match[1],source,'ocr',80,value);
  };
  // XML-to-JSON readers retain repeated elements as arrays, including singleton
  // elements. A repeated type is ambiguous and must not downgrade an OCR to a
  // generic, unchecked reference.
  const single = value => {
    let depth = 0;
    while (Array.isArray(value)) {
      if (value.length !== 1 || ++depth > 5) { incomplete = true; return undefined; }
      value = value[0];
    }
    return value;
  };
  const readField = (object, name) => {
    object = single(object);
    if (!object || typeof object !== 'object') return undefined;
    const found = Object.entries(object).filter(([key]) => keyName(key) === name);
    if (found.length > 1) { incomplete = true; return undefined; }
    return found.length ? single(found[0][1]) : undefined;
  };
  const schemaText = input => {
    const value = single(input);
    if (value === undefined) return '';
    if (typeof value !== 'string' || !value.trim() || value.length > 300) { incomplete = true; return ''; }
    return value.trim();
  };
  const isoReferenceType = object => {
    const type = readField(object, 'tp');
    if (type === undefined) return '';
    const choice = readField(type, 'cdorprtry');
    if (!choice || typeof choice !== 'object') { incomplete = true; return ''; }
    const code = readField(choice, 'cd'), proprietary = readField(choice, 'prtry');
    if ((code !== undefined) === (proprietary !== undefined)) { incomplete = true; return ''; }
    return {schema:schemaText(proprietary ?? code), ocr:proprietary !== undefined && /^(?:SE)?OCR$/i.test(schemaText(proprietary))};
  };
  const walk = (value, source = sourcePrefix, context = '', depth = 0, schema = '') => {
    if (++nodes > 2000 || depth > 12) { incomplete = true; return; }
    if (typeof value === 'string') {
      if (value.length > 10_000) { incomplete = true; return; }
      if (context === 'ocr') add(value, source, 'ocr', 90, value, schema);
      else if (context === 'invoice') add(value, source, 'invoice', 85);
      else if (context === 'structured') add(value, source, 'structured', 90, value, schema);
      else if (context === 'remittance') { add(value, source, 'message', 40); labelled(value, source); }
      else if (context === 'message') labelled(value, source);
      return;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.slice(0, 100).forEach((item, n) => walk(item, `${source}[${n}]`, context, depth + 1, schema)); if (value.length > 100) incomplete = true; return; }
    const isoType = context === 'iso-creditor' ? isoReferenceType(value) : null;
    for (const [key, child] of Object.entries(value)) {
      if (nodes > 2000) { incomplete = true; break; }
      const k = keyName(key), field = `${source}.${key}`;
      if (/^(entryreference|bankreference|transactionid|endtoendid|acctsvcrref|iban|bban|bankgiro|payerbankgiro|creditoraccount|debtoraccount|transactionamount)$/.test(k)) continue;
      // AIS explicitly permits an absent optional schema as JSON null. Opt in
      // only for its literal field; arrays, aliases/duplicates and ISO types
      // retain the legacy strict handling. The raw response is never rewritten.
      const apiSchemaValue = k === 'referencenumber' ? readField(value, 'referencenumberschema') : undefined;
      const malformedAisSchema = profile === 'ais-null-schema-v1' && Object.hasOwn(value,'reference_number_schema') && value.reference_number_schema !== null && typeof value.reference_number_schema !== 'string';
      if (k === 'referencenumber' && malformedAisSchema) incomplete = true;
      const absentAisSchema = profile === 'ais-null-schema-v1' && Object.hasOwn(value,'reference_number_schema') && value.reference_number_schema === null && apiSchemaValue === null;
      const apiSchema = k === 'referencenumber' && !absentAisSchema && !malformedAisSchema ? schemaText(apiSchemaValue) : '';
      const referenceSchema = k === 'ref' && context === 'iso-creditor' ? isoType?.schema || '' : apiSchema;
      const next = k === 'cdtrrefinf' ? 'iso-creditor'
        : k === 'ref' && context === 'iso-creditor' ? isoType?.ocr ? 'ocr' : 'structured'
        : k === 'referencenumber' && apiSchema.toUpperCase() === 'SEBG' ? 'ocr'
        : /^(ocr|ocrnumber|ocrnummer|ocrreference|ocrreferens)$/.test(k) ? 'ocr'
        : /^(invoicenumber|invoiceno|fakturanummer|fakturanr)$/.test(k) ? 'invoice'
        : /^(referencenumber|paymentreference|betalningsreferens|fakturareferens|betalningsreferensocr|referens|referensnummer)$/.test(k) || k === 'ref' && /CdtrRefInf/i.test(source) ? 'structured'
        : k === 'nb' && /RfrdDocInf/i.test(source) ? 'invoice'
        : /^(remittanceinformation|ustrd|unstructured|remittance)$/.test(k) ? 'remittance'
        : /^(note|message|meddelande|addtltxinf|description)$/.test(k) ? 'message'
        : /^(value|text|reference|number)$/.test(k) ? context : '';
      walk(child, field, next, depth + 1, referenceSchema || (/^(value|text|reference|number)$/.test(k) ? schema : ''));
    }
  };
  walk(raw);
  candidates.sort((a, b) => b.priority - a.priority || a.source.localeCompare(b.source));
  if (incomplete) warnings.push('Alla referensfält kunde inte analyseras inom säkerhetsgränsen. Granska bankoriginalet.');
  if (candidates.some(c => c.validity === 'checksum_invalid')) warnings.push('En uttrycklig OCR-referens har felaktig kontrollsiffra och behöver granskas.');
  const identities = candidates.filter(c => c.kind !== 'message');
  const selected = identities[0] || candidates[0];
  return {version: profile === 'ais-null-schema-v1' ? AIS_NULL_SCHEMA_VERSION : REFERENCE_VERSION, candidates, selected: selected || null, incomplete, warnings};
}

/** Keep competing unstructured identifiers visible; narrative cannot override a structured reference. */
export function matchingReferenceValues(evidence, fallback = '') {
  const explicit = evidence?.candidates?.filter(c => c.kind !== 'message') || [];
  const messages=evidence?.candidates?.filter(c=>c.kind==='message')||[];
  const bare=value=>/\d/.test(value)&&(/^[\p{L}\p{N}][\p{L}\p{N}/_-]*$/u.test(value)||/^\d[\d -]*$/.test(value))&&!/^\d{4}-\d{2}-\d{2}$/.test(value);
  const relevant=explicit.length?messages.filter(c=>bare(c.value)):messages;
  return [...new Set([...explicit.map(c=>c.value),...relevant.map(c=>c.value),fallback].filter(Boolean))];
}
