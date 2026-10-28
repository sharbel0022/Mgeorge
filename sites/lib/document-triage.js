/** Deterministic triage only. Never deletes originals or confirms payment. */
export function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
export function fieldValue(extraction, key) {
  const value = jsonObject(extraction).fields?.[key];
  return value && typeof value === 'object' && 'value' in value ? value.value : value ?? null;
}
const decorativeName = name => /(?:^|[-_ .])(?:logo|banner\d*|icon|signature|signatur|facebook|instagram|linkedin)(?:[-_ .]|$)/i.test(name);
/** Exclude only strongly identified inline decoration, never arbitrary image attachments. */
export function isInlineDecoration(part) {
  const headers = Object.fromEntries((part?.headers || []).map(h => [String(h.name).toLowerCase(), String(h.value)]));
  const inline = /^inline(?:;|$)/i.test(headers['content-disposition'] || '') || !!headers['content-id'];
  return inline && /^image\//i.test(part?.mimeType || '') && decorativeName(String(part?.filename || '')) && !/faktura|invoice|kvitto|receipt|scan/i.test(part?.filename || '');
}
export function classifyDocument(input = {}) {
  const d = /** @type {any} */ (input), meta = jsonObject(d.metadata);
  const e = jsonObject(d.processing_extraction || d.extraction);
  const text = String(d.text ?? e.text_excerpt ?? '').normalize('NFKC').slice(0, 150000);
  const filename = String(d.filename || meta.original_filename || '');
  const kind = fieldValue(e, 'kind');
  const hasNumber = /(?:faktura\s*(?:nummer|nr)|invoice\s*(?:number|no))\s*[:#.]?\s*[\p{L}\p{N}]/iu.test(text);
  const hasTotal = /(?:summa\s*att\s*betala|totalsumma|totalbelopp|amount\s*due|total\s*summa)\s*[:.]?\s*\d/i.test(text);
  const clearInvoice = hasNumber && hasTotal;
  let category = kind === 'credit' ? 'credit' : kind === 'invoice' ? 'invoice' : 'unknown';
  let exclude = false, reason = '';
  if (!clearInvoice && /(?:lönebesked|lönespecifikation|avlöningskvitto|payslip)/i.test(text) && /nettolön|preliminär\s*skatt|net\s*pay/i.test(text)) {
    category = 'payroll'; exclude = true; reason = 'Löneunderlag – inte en leverantörsfaktura.';
  } else if (!clearInvoice && /^\s*(?:försäljnings[\s\S]{0,50}betalningsvillkor|allmänna\s+(?:köp|avtals|försäljnings)?villkor|terms\s+(?:and\s+conditions|of\s+(?:sale|service)))/i.test(text)) {
    category = 'terms'; exclude = true; reason = 'Avtalsvillkor – ingen ny faktura eller skuld.';
  } else if (!clearInvoice && /^image\//i.test(d.mime || '') && decorativeName(filename) && !/faktura|invoice|kvitto|receipt|scan/i.test(filename) && text.trim().length < 80 && (!kind || kind === 'other')) {
    category = 'decorative'; exclude = true; reason = 'Logotyp eller dekorativ bild. Originalet finns kvar bland övriga underlag.';
  } else if (kind === 'receipt') {
    category = 'receipt'; reason = 'Kvitto: kontrollera betalningssätt innan någon skuld registreras.';
  }
  return {category, exclude_from_invoice_queue: exclude, reason, version: 1};
}
/** Explicit labels only. Leading zeros and separators are deliberately preserved. */
export function sourceInvoiceNumbers(value) {
  const text = String(value || '').normalize('NFKC').replace(/\.pdf$/i, '');
  return [...text.matchAll(/(?:faktura(?:nummer|\s*nr)?|invoice(?:\s*(?:no|number))?)[\s:#._-]+([\p{L}\p{N}][\p{L}\p{N}/_-]{0,79})/giu)].map(m => m[1].toUpperCase()).filter(value => /\d/.test(value));
}
export function documentConflicts(extraction, metadata = {}) {
  const meta = /** @type {any} */ (metadata), issues = [], number = String(fieldValue(extraction, 'invoice_number') || '').toUpperCase();
  const expected = [...new Set([...sourceInvoiceNumbers(meta.filename || meta.original_filename), ...sourceInvoiceNumbers(meta.subject)])];
  if (number && expected.some(value => value !== number)) issues.push('Motstridigt fakturanummer i dokument, filnamn eller mejlrubrik. Kontrollera originalet; inget nummer ändras automatiskt.');
  if (number && /^\d{4}-\d{2}-\d{2}$/.test(number)) issues.push('Fakturanumret ser ut som ett datum. Kontrollera kolumnerna i originalet.');
  const org = String(fieldValue(extraction, 'organization_number') || '').replace(/\D/g, '');
  if (meta.direction === 'supplier' && org && org === String(meta.company_organization_number || '').replace(/\D/g, '')) issues.push('Leverantörens organisationsnummer verkar vara det egna företagets. Kontrollera utställare och mottagare.');
  return issues;
}
