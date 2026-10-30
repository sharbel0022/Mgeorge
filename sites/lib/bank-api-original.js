import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {extractPaymentReferences} from './payment-references.js';

export const BANK_API_ORIGINAL_VERSION='bank-api-original-v1';
const encoder=new TextEncoder(),cache=new WeakMap();
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim():'';
const absent=value=>!value||/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value.trim());
const account=value=>{const original=text(value),iban=original.replace(/^iban:/i,'').replace(/\s/g,'').toUpperCase();return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)?'iban:'+iban:original;};
const digest=value=>bytesToHex(sha256(encoder.encode(value)));
const missing='Bankoriginalet saknar ett verifierbart ankomstkvitto. Hämta bankuppgifterna igen eller granska originalunderlaget.';
const changed='Bankoriginalets kontrollsumma stämmer inte. Bevara underlaget och granska bankuppgifterna innan nya matchningar.';
const inconsistent='Bankuppgifterna stämmer inte med det bevarade API-originalet. Granska originalet och eventuell separat manuell komplettering.';

export function hasBankApiOrigin(transaction){return transaction?.evidence==='bank_api'||typeof transaction?.source==='string'&&transaction.source.startsWith('Enable Banking')||transaction?.bankDataVersion!==undefined||transaction?.bankDataSha256!==undefined;}
/** A checksum of the retained provider JSON representation, not the HTTP wire format.
 * Re-serialize before cache reuse: an in-place mutation must never inherit trust. */
export function bankApiDataHash(raw){
 if(!record(raw))return '';
 let serialized;try{serialized=JSON.stringify(raw);}catch{return '';}
 if(!serialized||serialized.length>2_000_000)return '';
 const before=cache.get(raw);if(before?.serialized===serialized)return before.hash;
 const hash=digest(serialized);cache.set(raw,{serialized,hash});return hash;
}
/** Bind file-specific reference metadata only when an owned original is freshly
 * parsed. Its file ID and byte hash remain subject to the separate R2 boundary. */
export const bankFileReferenceHash=(proof,references)=>bankApiDataHash({documentId:proof.documentId,sha256:proof.sha256,referenceEvidence:references??null});
function amountOf(raw){
 if(!record(raw.transaction_amount)||raw.transaction_amount.currency!=='SEK'||typeof raw.transaction_amount.amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(raw.transaction_amount.amount)||!['CRDT','DBIT'].includes(raw.credit_debit_indicator))return null;
 const [whole,part='']=raw.transaction_amount.amount.split('.');
 if(whole.length>16)return null;
 const cents=BigInt(whole)*100n+BigInt(part.padEnd(2,'0'));
 return cents>0n&&cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents)*(raw.credit_debit_indicator==='CRDT'?1:-1):null;
}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
/** Synchronous so every UI, export, draft and allocation predicate can use current proof. */
export function bankApiOriginalIssue(transaction,isCollection,collectionNotice){
 if(!hasBankApiOrigin(transaction))return '';
 const raw=transaction.bankData;
 if(!record(raw))return missing;
 if(transaction.bankDataVersion!==BANK_API_ORIGINAL_VERSION||typeof transaction.bankDataSha256!=='string'||!/^[a-f0-9]{64}$/i.test(transaction.bankDataSha256))return missing;
 if(bankApiDataHash(raw)!==transaction.bankDataSha256.toLowerCase())return changed;
 const amount=amountOf(raw),date=text(raw.booking_date)||text(raw.value_date),original=transaction.original;
 if(raw.status!=='BOOK'||amount===null||!validDate(date)||!record(original)||transaction.currency!=='SEK')return inconsistent;
 const bankParty=record(raw[amount>0?'debtor':'creditor'])?text(raw[amount>0?'debtor':'creditor'].name):'';
 const party=bankParty.length<=200?bankParty:'';
 const references=extractPaymentReferences(raw),reference=references.incomplete?'':references.selected?.value||'',payerReference=reference.length<=300?reference:'';
 const remittance=Array.isArray(raw.remittance_information)?raw.remittance_information.filter(item=>typeof item==='string').map(text).filter(Boolean).join(' · '):'';
 const bankCode=record(raw.bank_transaction_code)?text(raw.bank_transaction_code.description):'',structured=text(raw.reference_number);
 const collection=isCollection(amount,`${bankCode} ${remittance}`,party,absent(structured)?'':structured);
 const description=[collection?collectionNotice:'',bankCode,remittance,text(raw.note),!text(raw.booking_date)?'Valutadatum används; banken saknar bokföringsdatum.':''].filter(Boolean).join(' · ').slice(0,1000).trim();
 if(original.description!==description||transaction.description!==description||collection&&transaction.kind!=='batch')return inconsistent;
 const rawEntry=typeof raw.entry_reference==='string'?raw.entry_reference:'',entry=absent(rawEntry.trim())?'':rawEntry;
 const expectedId=entry?'enable-banking:'+digest(JSON.stringify([account(original.account),entry])):'';
 if(original.amount!==amount||transaction.amount!==amount||original.date!==date||transaction.date!==date||account(transaction.account)!==account(original.account)||original.bankReference!==text(entry).slice(0,300)||transaction.bankReference!==original.bankReference||transaction.externalId!==expectedId)return inconsistent;
 // Evidence labels are mutable presentation state. They cannot replace either
 // the original bank tuple or a separately retained manual identity decision.
 if(original.party!==party||original.payerReference!==payerReference)return inconsistent;
 const manual=transaction.verification;
 if(manual){if(!record(manual)||!text(manual.note)||!Number.isFinite(Date.parse(manual.at))||transaction.party!==manual.party||transaction.payerReference!==manual.payerReference)return inconsistent;}
 else if(transaction.party!==party||transaction.payerReference!==payerReference)return inconsistent;
 const file=transaction.bankFileProof;
 const fileReferences=transaction.evidence==='bank_file'&&record(file)&&file.version==='bank-file-original-v1'&&typeof file.documentId==='string'&&!!file.documentId&&/^[a-f0-9]{64}$/.test(file.sha256)&&file.referenceEvidenceSha256===bankFileReferenceHash(file,transaction.referenceEvidence);
 if(JSON.stringify(transaction.referenceEvidence)!==JSON.stringify(references)&&!fileReferences)return inconsistent;
 return '';
}

/** Archival copies preserve unknown evidence. A present receipt must still validate;
 * only a freshly received provider object may create a new financial receipt. */
export function bankApiReceiptState(transaction){
 if(!hasBankApiOrigin(transaction))return 'not_api';
 if(transaction.bankDataSha256===undefined&&transaction.bankDataVersion===undefined)return 'without_receipt';
 const raw=transaction.bankData;
 if(!record(raw)||!Object.keys(raw).length||transaction.bankDataVersion!==BANK_API_ORIGINAL_VERSION||typeof transaction.bankDataSha256!=='string'||!/^[a-f0-9]{64}$/i.test(transaction.bankDataSha256)||bankApiDataHash(raw)!==transaction.bankDataSha256.toLowerCase())return 'invalid';
 return 'checked';
}
