import {createHash} from 'node:crypto';
import {canonicalBankAccount,suspectedBankCollection,PAYMENT_SPECIFICATION_REQUIRED} from '../../lib/domain.ts';
import {extractPaymentReferences} from '../../lib/payment-references.js';

const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim():'';
const absent=value=>!value||/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value.trim());
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
export const syntheticBankId=(account,entry)=>entry?'enable-banking:'+hash(JSON.stringify([canonicalBankAccount(account),entry])):'';

/** Construct a NEW synthetic provider response from the scenario's explicit
 * facts. Never reseal an existing bankData object or repair an altered receipt.
 * This synchronous fixture follows normalizeTransactions' received-JSON
 * contract so existing synchronous domain/UI tests can keep their assertions.
 * Supply rawFields for a scenario requiring OCR types or multiple references.
 */
export function syntheticBankRow(values={},rawFields={}){
 const amount=values.amount??62500,account=canonicalBankAccount(values.account??'synthetic-account');
 if(!Number.isSafeInteger(amount)||amount===0)throw Error('Synthetic provider amount must be nonzero integer öre');
 const magnitude=Math.abs(amount),entry=values.externalId===''?'':String(values.bankReference??values.externalId??'SYNTHETIC-ENTRY');
 const raw={status:'BOOK',transaction_amount:{amount:Math.trunc(magnitude/100)+'.'+String(magnitude%100).padStart(2,'0'),currency:values.currency??'SEK'},credit_debit_indicator:amount>0?'CRDT':'DBIT',booking_date:values.date??'2026-10-26',[amount>0?'debtor':'creditor']:{name:values.party??''},reference_number:values.payerReference??'',entry_reference:entry,...(values.description?{bank_transaction_code:{description:values.description}}:{}),...structuredClone(rawFields)};
 const incoming=raw.credit_debit_indicator==='CRDT',bankParty=clean(raw[incoming?'debtor':'creditor']?.name),party=bankParty.length<=200?bankParty:'';
 const referenceEvidence=extractPaymentReferences(raw),reference=referenceEvidence.incomplete?'':referenceEvidence.selected?.value||'',payerReference=reference.length<=300?reference:'';
 const remittance=Array.isArray(raw.remittance_information)?raw.remittance_information.filter(item=>typeof item==='string').map(clean).filter(Boolean).join(' · '):'';
 const code=clean(raw.bank_transaction_code?.description),structured=clean(raw.reference_number),collection=suspectedBankCollection(amount,`${code} ${remittance}`,party,absent(structured)?'':structured);
 const booked=clean(raw.booking_date),date=booked||clean(raw.value_date),originalEntry=typeof raw.entry_reference==='string'?raw.entry_reference:'',stableEntry=absent(originalEntry.trim())?'':originalEntry;
 const description=[collection?PAYMENT_SPECIFICATION_REQUIRED:'',code,remittance,clean(raw.note),!booked?'Valutadatum används; banken saknar bokföringsdatum.':''].filter(Boolean).join(' · ').slice(0,1000);
 return {...values,date,amount,currency:raw.transaction_amount.currency,account,party,payerReference,bankReference:clean(stableEntry).slice(0,300),description,source:values.source??'Enable Banking · Synthetic bank · Synthetic account',externalId:syntheticBankId(account,stableEntry),kind:collection?'batch':values.kind??'unknown',verified:values.verified??false,referenceEvidence,bankData:raw,bankDataVersion:'bank-api-original-v1',bankDataSha256:hash(JSON.stringify(raw))};
}

/** A persisted transaction with complete original fields. Manual verification
 * remains a separate current projection of the synthetic received original. */
export function syntheticBankTransaction(values={},rawFields={}){
 const received=syntheticBankRow({...values,...values.original},rawFields);
 const original=Object.fromEntries(['party','payerReference','description','amount','date','account','bankReference'].map(key=>[key,received[key]]));
 return {id:'synthetic-payment',duplicateOf:'',ignored:false,parentId:'',importId:'',createdAt:'2026-10-26T00:00:00.000Z',...values,...received,original,evidence:values.evidence??'bank_api',...(values.verification?{party:values.party,payerReference:values.payerReference,verification:structuredClone(values.verification)}:{})};
}
