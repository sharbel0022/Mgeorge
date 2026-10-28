import { parseMoney, validDate, suspectedBankCollection, PAYMENT_SPECIFICATION_REQUIRED } from '../domain';
import { extractPaymentReferences } from '../payment-references.js';
import { createHash } from 'node:crypto';
import type { BankRow } from '../imports';
import type { ProviderAccount, ProviderBankIdentity } from './enable-banking';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const missingReference = (value: string) => !value || /^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value);

/** A session uid is deliberately never a fallback: it changes after re-authorisation. */
export function stableAccountKey(account: ProviderAccount, bank: ProviderBankIdentity): string | null {
  if (!object(account) || !object(bank) || typeof bank.country !== 'string' || !/^[A-Z]{2}$/.test(bank.country) || typeof bank.name !== 'string') return null;
  const iban = cleanText(account.account_id?.iban).replace(/\s/g, '').toUpperCase();
  if (iban && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return `iban:${iban}`;
  const identifiers = [account.account_id?.other, ...(Array.isArray(account.all_account_ids) ? account.all_account_ids : [])]
    .filter((id): id is { identification: string; scheme_name: string } => object(id) && typeof id.identification === 'string' && typeof id.scheme_name === 'string');
  // Prefer globally named IBANs even if the bank supplied them in all_account_ids.
  for (const id of identifiers) if (id.scheme_name.toUpperCase() === 'IBAN') {
    const value = id.identification.replace(/\s/g, '').toUpperCase();
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return `iban:${value}`;
  }
  // A local account number is only meaningful with its bank and country.
  const bankName = bank.name.normalize('NFKC').trim().toLowerCase();
  if (!bankName || bankName.length > 60 || /[:\u0000-\u001f]/.test(bankName)) return null;
  const sorted = identifiers.filter(id => ['BBAN', 'CPAN'].includes(id.scheme_name.toUpperCase()))
    .sort((a, b) => a.scheme_name.toUpperCase().localeCompare(b.scheme_name.toUpperCase()) || a.identification.localeCompare(b.identification));
  for (const id of sorted) {
    const value = id.identification.replace(/[\s-]/g, '').toUpperCase();
    if (!value || value.length > 40 || !/^[A-Z0-9]+$/.test(value) || missingReference(value)) continue;
    const key = `${bank.country}:${bankName}:${id.scheme_name.toUpperCase()}:${value}`;
    if (key.length <= 100) return key;
  }
  // Account numbers are optional in AccountResource. The primary hash is the
  // provider's stable cross-session identity; the plural hashes are fuzzy aliases
  // and must never be substituted. Preserve all case-sensitive primary bytes.
  const primaryHash = account.identification_hash;
  if (typeof primaryHash === 'string' && primaryHash.length <= 4096 && !missingReference(primaryHash) && !/[\s\u0000-\u001f\u007f]/.test(primaryHash)) {
    return 'enable-account:' + createHash('sha256').update(JSON.stringify([bank.country, bankName, primaryHash]), 'utf8').digest('hex');
  }
  return null;
}

export type NormalizeTransactionsResult = {
  rows: BankRow[];
  /** unstableId counts retained review-only rows, not dropped rows. */
  skipped: { pending: number; nonSek: number; invalid: number; unstableId: number };
  warnings: string[];
};
export type NormalizeTransactionsOptions = { accountKey: string; accountLabel: string; bankName: string; dateFrom: string; dateTo: string };

async function stableEntryId(accountKey: string, entry: string): Promise<string> {
  // Length-prefixed JSON tuple prevents delimiter ambiguities; SHA-256 avoids truncating IDs.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([accountKey, entry])));
  return 'enable-banking:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function normalizeTransactions(transactions: readonly unknown[], options: NormalizeTransactionsOptions): Promise<NormalizeTransactionsResult> {
  if (!Array.isArray(transactions) || !options.accountKey || options.accountKey.length > 100 ||
    !validDate(options.dateFrom) || !validDate(options.dateTo) || options.dateFrom > options.dateTo) throw new Error('Kontot eller perioden för bankimporten är ogiltig.');
  const rows: BankRow[] = [], skipped = { pending: 0, nonSek: 0, invalid: 0, unstableId: 0 };
  let dateFallbacks = 0, longReferences = 0, ambiguousBatches = 0, negativeAmounts = 0, longParties = 0;
  for (const raw of transactions) {
    if (!object(raw)) { skipped.invalid++; continue; }
    if (raw.status !== 'BOOK') {
      if (typeof raw.status === 'string' && ['CNCL', 'HOLD', 'OTHR', 'PDNG', 'RJCT', 'SCHD'].includes(raw.status)) skipped.pending++;
      else skipped.invalid++;
      continue;
    }
    if (!object(raw.transaction_amount) || typeof raw.transaction_amount.currency !== 'string') { skipped.invalid++; continue; }
    if (raw.transaction_amount.currency !== 'SEK') { skipped.nonSek++; continue; }
    if (!['CRDT', 'DBIT'].includes(String(raw.credit_debit_indicator)) || typeof raw.transaction_amount.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(raw.transaction_amount.amount)) {
      if (typeof raw.transaction_amount.amount === 'string' && /^-/.test(raw.transaction_amount.amount)) negativeAmounts++;
      skipped.invalid++; continue;
    }
    let magnitude: number;
    try { magnitude = parseMoney(raw.transaction_amount.amount); } catch { skipped.invalid++; continue; }
    if (magnitude <= 0) { skipped.invalid++; continue; }
    const booked = cleanText(raw.booking_date), valueDate = cleanText(raw.value_date);
    // value_date is an explicitly documented accounting date; transaction_date can mean
    // purchase/acquisition/receipt date, so it is not a safe replacement for booking date.
    const date = booked || valueDate;
    if (!validDate(date) || date < options.dateFrom || date > options.dateTo) { skipped.invalid++; continue; }
    if (!booked) dateFallbacks++;
    const incoming = raw.credit_debit_indicator === 'CRDT';
    const counterparty = incoming ? raw.debtor : raw.creditor;
    const bankParty = object(counterparty) ? cleanText(counterparty.name) : '';
    // A truncated name may equal a different invoice customer's full name.
    // Keep the bank's complete identity in bankData and hold it for review.
    const party = bankParty.length <= 200 ? bankParty : '';
    if(bankParty.length>200)longParties++;
    const originalEntry = typeof raw.entry_reference === 'string' ? raw.entry_reference : '';
    // Preserve exact provider ID bytes for hashing. Only test emptiness/placeholders with trim.
    const entry = missingReference(originalEntry.trim()) ? '' : originalEntry;
    if (!entry) skipped.unstableId++;
    const structured = cleanText(raw.reference_number);
    const remittance = Array.isArray(raw.remittance_information) ? raw.remittance_information.filter(item => typeof item === 'string').map(cleanText).filter(Boolean).join(' · ') : '';
    const referenceEvidence = extractPaymentReferences(raw);
    const reference = referenceEvidence.incomplete ? '' : referenceEvidence.selected?.value || '';
    if(referenceEvidence.incomplete) longReferences++;
    // Never manufacture a partial invoice/OCR reference by cutting its trailing characters.
    const payerReference = reference.length <= 300 ? reference : '';
    if (reference.length > 300) longReferences++;
    const bankCode = object(raw.bank_transaction_code) ? cleanText(raw.bank_transaction_code.description) : '';
    const collective=suspectedBankCollection(magnitude*(incoming?1:-1),`${bankCode} ${remittance}`,party,!missingReference(structured)?structured:'');
    const description = [collective?PAYMENT_SPECIFICATION_REQUIRED:'',bankCode, remittance, cleanText(raw.note), !booked ? 'Valutadatum används; banken saknar bokföringsdatum.' : ''].filter(Boolean).join(' · ').slice(0, 1_000);
    if (/bankgiro|\bbatch\b|samlings|buntbetal|sammandrag/i.test(`${bankCode} ${remittance}`)) ambiguousBatches++;
    rows.push({ referenceEvidence, bankData: structuredClone(raw), date, amount: magnitude * (incoming ? 1 : -1), party, payerReference,
      bankReference: cleanText(entry).slice(0, 300), description,
      source: `Enable Banking · ${cleanText(options.bankName)} · ${cleanText(options.accountLabel)}`.slice(0, 300),
      currency: 'SEK', externalId: entry ? await stableEntryId(options.accountKey, entry) : '',
      account: options.accountKey, kind: collective?'batch':'unknown', verified: false });
  }
  const warnings: string[] = [];
  if (skipped.pending) warnings.push(`${skipped.pending} bankhändelser var inte bokförda och importerades inte.`);
  if (skipped.nonSek) warnings.push(`${skipped.nonSek} bankhändelser hade en annan valuta än SEK och importerades inte.`);
  if (skipped.invalid) warnings.push(`${skipped.invalid} bankhändelser saknade giltiga uppgifter eller låg utanför perioden och importerades inte.`);
  if (negativeAmounts) warnings.push(`${negativeAmounts} bankhändelser hade ett negativt API-belopp och behöver separat kontroll av betalningsriktning eller återföring.`);
  if (skipped.unstableId) warnings.push(`${skipped.unstableId} importerade bankhändelser saknar stabilt bank-ID. Kontrollera möjliga dubbletter vid återkommande hämtning.`);
  if (dateFallbacks) warnings.push(`${dateFallbacks} bankhändelser använder bankens valutadatum eftersom bokföringsdatum saknas.`);
  if (longReferences) warnings.push(`${longReferences} långa betalningsreferenser behöver kontrolleras i bankunderlaget. De har inte kortats till ett möjligt OCR-nummer.`);
  if (longParties) warnings.push(`${longParties} långa betalaruppgifter behöver kontrolleras i bankoriginalet. Betalaren har inte förkortats till ett möjligt kundnamn.`);
  if (ambiguousBatches) warnings.push('Bankgiro- eller samlingsposter kan sakna uppgifter om enskilda betalare. Komplettera med betalningsspecifikation innan matchning.');
  return { rows, skipped, warnings };
}
