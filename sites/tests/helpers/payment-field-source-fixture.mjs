import {applyCommand,emptyState} from '../../lib/domain.ts';
import {syntheticBankRow} from './bank-api-fixture.mjs';
import {apiPayerEvidence} from '../../lib/payer-evidence.js';
import {extractPaymentReferences} from '../../lib/payment-references.js';
import {parseSpecificationBytes} from '../../lib/bankgiro-parser.js';

/** Distinct synthetic originals make accidental provenance mixing observable. */
export function paymentFieldSourceFixture({linked=true,detailReference='0800',collective=true}={}){
 const account='iban:SE4280000890119146168423',debtor={name:' AIS source payer AB ',organisation_id:{identification:'111111-1111',scheme_name:'COID',issuer:'SE'}};
 let state=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:62500,account,party:'AIS source payer AB',payerReference:'0700',bankReference:'SYNTHETIC-FIELD-SOURCE',description:collective?'Samlingsinsättning':'',kind:collective?'batch':'payment',payerEvidence:apiPayerEvidence({debtor},true,{collective})},{debtor})]}).state;
 const target=state.transactions[0],detail={...structuredClone(target.bankData),reference_number:detailReference,debtor:{name:' Detail source payer AB ',organisation_id:{identification:'222222-2222',scheme_name:'COID',issuer:'SE'}}};
 target.bankDetails={status:'identified',checkedAt:'2026-11-01T20:00:00.000Z',party:'Detail source payer AB',payerReference:detailReference,referenceSchema:'',reason:'Synthetic detail original',documentId:'synthetic-detail-original',bankReferenceText:'0700',payerEvidence:apiPayerEvidence(detail,true),referenceEvidence:extractPaymentReferences({detail})};
 const csv='Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto;Organisationsnummer\n2026-10-26;Report source payer AB;0599;987-6543;625,00;SEK;'+account.slice(5)+';333333-3333';
 const reportRows=parseSpecificationBytes(new TextEncoder().encode(csv),'synthetic-source.csv');
 state=applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-report-original',hash:'a'.repeat(64),name:'synthetic-source.csv',rows:reportRows}).state;
 const report=state.transactions.find(t=>t.specification);
 if(linked)state=applyCommand(state,{type:'bankgiro.link',transactionId:target.id,specificationId:report.id,note:'Synthetic source relation only, no invoice decision',confirmOriginals:true,confirmAccount:true}).state;
 return {state,target:state.transactions.find(t=>t.id===target.id),report:state.transactions.find(t=>t.id===report.id),reportRows};
}

export function paymentFieldInvoiceFixture({booked=false}={}){
 const f=paymentFieldSourceFixture();let state=f.state;
 for(const [number,party,organizationNumber,documentId]of [['0599','Report source payer AB','3333333333','synthetic-invoice-0599'],['0800','Detail source payer AB','2222222222','synthetic-invoice-0800']])state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',number,party,organizationNumber,documentId,total:62500,ocr:'',issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 // A pre-existing synthetic historical booking is loaded, never recreated by
 // the current read-only source association or verification service.
 if(booked)state.allocations.push({id:'synthetic-historical-allocation',transactionId:f.target.id,invoiceId:state.invoices.find(i=>i.number==='0800').id,amount:62500,effect:'payment',active:true,note:'Synthetic retained prior decision',createdAt:'2026-10-27T12:00:00.000Z'});
 return {...f,state,target:state.transactions.find(t=>t.id===f.target.id),report:state.transactions.find(t=>t.id===f.report.id)};
}
