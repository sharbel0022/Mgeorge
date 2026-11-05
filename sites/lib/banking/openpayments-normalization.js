import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {normalizePayerEvidence,payerField} from '../payer-evidence.js';
import {REFERENCE_VERSION} from '../payment-references.js';
const fail=()=>{throw Object.assign(Error('OPENPAYMENTS_BOOKED_ROW_INVALID'),{code:'IMPORT_FAILED'});};
const text=(value,max=1000)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const hash=value=>bytesToHex(sha256(new TextEncoder().encode(value)));
export function openPaymentsAccountIdentity(identity){
 if(!identity||identity.currency!=='SEK')fail();
 if(text(identity.iban,40)&&identity.iban.trim()){const iban=identity.iban.replace(/\s/g,'').toUpperCase();if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban))fail();return'iban:'+iban;}
 if(text(identity.bban,100)&&identity.bban.trim()===identity.bban&&identity.bban)return'bban:'+identity.bban;
 if(text(identity.accountNumber,100)&&identity.accountNumber.trim()===identity.accountNumber&&identity.accountNumber){if(identity.clearingNumber!==undefined&&!text(identity.clearingNumber,40))fail();return'account:'+JSON.stringify([identity.clearingNumber||'',identity.accountNumber]);}
 fail();
}
/** Strict Open Payments/Berlin Group observations, never rewritten as Enable Banking. */
export function normalizeOpenPaymentsBookedTransaction(raw,{account,dateFrom,dateTo}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!text(account,300)||!account||!date(dateFrom)||!date(dateTo)||dateFrom>dateTo||!date(raw.bookingDate)||raw.bookingDate<dateFrom||raw.bookingDate>dateTo)fail();
 const amount=raw.transactionAmount;
 if(!amount||amount.currency!=='SEK'||typeof amount.amount!=='string'||! /^-?\d{1,14}(?:\.\d{1,2})?$/.test(amount.amount))fail();
 const [whole,fraction='']=amount.amount.replace(/^-/,'').split('.');const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(cents===0n||cents>BigInt(Number.MAX_SAFE_INTEGER))fail();const signed=Number(cents)*(amount.amount.startsWith('-')?-1:1);
 // Only the bank's entry reference deduplicates financial rows. A lookup ID
 // cannot replace it across renewed sessions; missing identity blocks the batch.
 if(!text(raw.entryReference,300)||!raw.entryReference||raw.entryReference.trim()!==raw.entryReference||/^(NOTPROVIDED|NONREF|N\/A)$/i.test(raw.entryReference))fail();
 for(const key of ['transactionId','debtorName','creditorName','remittanceInformationStructured','remittanceInformationUnstructured'])if(raw[key]!=null&&!text(raw[key],key.endsWith('Name')?200:1000))fail();
 const structured=raw.remittanceInformationStructured?.trim()||'',message=raw.remittanceInformationUnstructured?.trim()||'';
 if(structured.length>300)fail();
 const candidates=[];if(structured&&!/^(NOTPROVIDED|NONREF|N\/A)$/i.test(structured))candidates.push({value:structured,rawValue:raw.remittanceInformationStructured,source:'$.remittanceInformationStructured',kind:'structured',priority:90,validity:'unchecked'});
 if(message)candidates.push({value:message,rawValue:raw.remittanceInformationUnstructured,source:'$.remittanceInformationUnstructured',kind:'message',priority:40,validity:'unchecked'});
 const reference_evidence={version:REFERENCE_VERSION,candidates,selected:candidates.find(c=>c.kind==='structured')||null,incomplete:false,warnings:[]};
 const role=signed>0?'debtor':'creditor',partyKey=role+'Name',payer=raw[partyKey]?.trim()||'';
 const collective=/bankgiro|samlings|buntbetal|\bbatch\b/i.test(message)||/^(bankgirot?|bankgirot? ab|bg)$/i.test(payer);
 const payer_evidence=normalizePayerEvidence({role,scope:collective?'collective':'individual',name:raw[partyKey]?payerField(raw[partyKey],'$.'+partyKey):null,namespace:'open_payments'});
 return {account,booked_at:raw.bookingDate,amount_cents:signed,currency:'SEK',payer,reference:reference_evidence.selected?.value||'',bank_reference:raw.entryReference,provider_transaction_id:raw.transactionId||'',description:message,source:'open_payments',raw_bank_data:structuredClone(raw),reference_evidence,payer_evidence,payer_organization_number:'',needs_review:1,is_aggregate:collective?1:0,review_reason:'Open Payments-underlaget kräver granskning innan avstämning.'};
}
export function normalizeOpenPaymentsBooked(rows,options){if(!Array.isArray(rows)||rows.length>5000)fail();return rows.map(row=>normalizeOpenPaymentsBookedTransaction(row,options));}
export function normalizeOpenPaymentsWorkspaceRows(rows,options){return normalizeOpenPaymentsBooked(rows,options).map(row=>({externalId:'openpayments:'+hash(JSON.stringify([row.account,row.bank_reference,Math.sign(row.amount_cents)])),date:row.booked_at,amount:row.amount_cents,currency:'SEK',party:row.payer,payerReference:row.reference,description:row.description,account:row.account,bankReference:row.bank_reference,source:'Open Payments',bankData:row.raw_bank_data,bankDataVersion:'openpayments-response-v1',bankDataSha256:hash(JSON.stringify(row.raw_bank_data)),payerEvidence:row.payer_evidence,referenceEvidence:row.reference_evidence,organizationNumber:'',kind:row.is_aggregate?'batch':'unknown',verified:false}));}
