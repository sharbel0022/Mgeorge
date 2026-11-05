import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOpenPaymentsBookedTransaction,normalizeOpenPaymentsWorkspaceRows,openPaymentsAccountIdentity} from '../sites/lib/banking/openpayments-normalization.js';
import {bankApiOriginalIssue,bankApiReceiptState} from '../sites/lib/bank-api-original.js';
import {applyCommand,emptyState,paymentOriginalIssue} from '../sites/lib/domain.ts';
const raw={entryReference:'synthetic-entry',transactionId:'temporary-lookup',bookingDate:'2026-11-05',transactionAmount:{amount:'625.00',currency:'SEK'},debtorName:'Synthetic Customer AB',remittanceInformationStructured:'0000599'};
const options={account:'iban:SE4550000000058398257466',dateFrom:'2026-11-01',dateTo:'2026-11-05'};
function imported(){const rows=normalizeOpenPaymentsWorkspaceRows([raw],options);const state=emptyState();state.company.name='Synthetic Company';return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows,name:'Synthetic OP'}).state;}
test('Open Payments signed decimal and actual bank paths preserve payer/reference without EB fields',()=>{
 const row=normalizeOpenPaymentsBookedTransaction(raw,options);assert.equal(row.amount_cents,62500);assert.equal(row.reference,'0000599');assert.equal(row.reference_evidence.selected.source,'$.remittanceInformationStructured');assert.equal(row.payer_evidence.name.source,'$.debtorName');assert.deepEqual(row.raw_bank_data,raw);assert.ok(!Object.hasOwn(row.raw_bank_data,'status'));
 const debit=normalizeOpenPaymentsBookedTransaction({...raw,transactionAmount:{amount:'-0.01',currency:'SEK'},creditorName:'Synthetic Payee'},options);assert.equal(debit.amount_cents,-1);assert.equal(debit.payer,'Synthetic Payee');
});
for(const [name,damage]of [['fraction',r=>r.transactionAmount.amount='1.001'],['currency',r=>r.transactionAmount.currency='EUR'],['date',r=>r.bookingDate='2026-02-30'],['identity',r=>delete r.entryReference],['numeric reference',r=>r.remittanceInformationStructured=599],['range',r=>r.bookingDate='2026-10-01']])test('reject invalid OP '+name+' rather than silently omitting the booked row',()=>{const copy=structuredClone(raw);damage(copy);assert.throws(()=>normalizeOpenPaymentsBookedTransaction(copy,options));});
test('provider-specific original checks accept OP receipt and reject altered bank facts',()=>{
 const s=imported(),row=s.transactions[0];assert.equal(bankApiReceiptState(row),'checked');assert.equal(paymentOriginalIssue(s,row),'');
 for(const change of [t=>t.bankData.debtorName='FORGED',t=>t.amount++,t=>t.externalId='enable-banking:forged',t=>t.referenceEvidence.selected.value='599',t=>t.original.account='iban:SE4280000890119146168423']){const copy=structuredClone(row);change(copy);assert.ok(bankApiOriginalIssue(copy,()=>false,''));}
});
test('even a forged verified flag on trusted OP input cannot authorize automatic financial effects',()=>{
 const rows=normalizeOpenPaymentsWorkspaceRows([raw],options);rows[0].verified=true;rows[0].kind='payment';
 const s=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows,name:'Synthetic OP'}).state;
 assert.equal(s.transactions[0].verified,false);assert.equal(s.allocations.length,0);assert.equal(s.transactions[0].bankDataVersion,'openpayments-response-v1');
});
test('refreshing an old missing receipt preserves the actual OP version without adding money',()=>{
 const state=imported();delete state.transactions[0].bankDataVersion;delete state.transactions[0].bankDataSha256;
 const result=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:normalizeOpenPaymentsWorkspaceRows([raw],options),name:'Fresh synthetic OP'}).state;
 assert.equal(result.transactions.length,1);assert.equal(result.transactions[0].bankDataVersion,'openpayments-response-v1');assert.equal(paymentOriginalIssue(result,result.transactions[0]),'');assert.equal(result.allocations.length,0);
});
test('stable typed account identities distinguish local clearing numbers and never use provider handles',()=>{
 assert.equal(openPaymentsAccountIdentity({iban:'se45 50000000058398257466',currency:'SEK'}),'iban:SE4550000000058398257466');
 assert.notEqual(openPaymentsAccountIdentity({accountNumber:'123',clearingNumber:'1111',currency:'SEK'}),openPaymentsAccountIdentity({accountNumber:'123',clearingNumber:'2222',currency:'SEK'}));assert.throws(()=>openPaymentsAccountIdentity({currency:'SEK',handle:'secret'}));
});
