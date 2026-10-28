import {parseMoney,individualParty,usablePaymentReference,type Transaction,type State,now} from '../domain';
import type {ProviderTransaction} from './enable-banking';
import {extractPaymentReferences} from '../payment-references.js';

const text=(v:unknown)=>typeof v==='string'?v.trim():'';
/** Details enrich presentation only; they cannot split a batch or create an allocation. */
export function transactionDetailEvidence(target:Transaction,listed:ProviderTransaction,detail:ProviderTransaction){
 for(const raw of [listed,detail]){
  if(raw.entry_reference!==target.bankReference||raw.status!=='BOOK'||raw.transaction_amount?.currency!==target.currency||raw.credit_debit_indicator!==(target.amount>0?'CRDT':'DBIT')||typeof raw.transaction_amount?.amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(raw.transaction_amount.amount)||parseMoney(raw.transaction_amount.amount)*(target.amount>0?1:-1)!==target.amount||(raw.booking_date||raw.value_date)!==target.date)throw Error('Bankens betalningsdetaljer stämmer inte med konto­postens identifierare, datum, valuta, riktning eller belopp. Inga uppgifter ändrades.');
 }
 const party=text(target.amount>0?detail.debtor?.name:detail.creditor?.name),schema=text(detail.reference_number_schema);
 const referenceEvidence=extractPaymentReferences({detail});
 const structured=!referenceEvidence.incomplete&&referenceEvidence.selected?.kind!=='message'?referenceEvidence.selected?.value||'':'';
 // Remittance is not promoted to OCR on a batch. It may merely be bank reference text.
 const payerReference=usablePaymentReference(structured)&&(individualParty(party)||schema==='SEBG'||schema==='SEPG')?structured:'';
 if(party.length>200||payerReference.length>300)throw Error('Bankens betalaruppgifter är för långa och behöver granskas i originalet.');
 return {referenceEvidence,party:individualParty(party)?party:'',payerReference,referenceSchema:schema,status:individualParty(party)&&payerReference?'identified' as const:'missing' as const,reason:individualParty(party)&&payerReference?'Bankens separata detaljsvar innehåller betalare och betalningsreferens. Fakturakopplingen behöver fortfarande kontrolleras.':'Bankens detaljsvar innehåller inte tillräckliga individuella betalar- och OCR-uppgifter. Betalningsspecifikationen behövs från Bankgiro.'};
}
export function enrichBankDetails(current:State,id:string,evidence:ReturnType<typeof transactionDetailEvidence>,documentId:string){
 const state=structuredClone(current),t=state.transactions.find(t=>t.id===id);if(!t)throw Error('Bankhändelsen finns inte.');
 t.bankDetails={...evidence,checkedAt:now(),documentId,bankReferenceText:t.bankDetails?.bankReferenceText||t.original?.payerReference||t.payerReference};
 // Preserve original financial fields, kind, references and verification. Render evidence separately.
 return state;
}
