import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {emptyState,applyCommand,balance,paid,economicTransactions} from '../lib/domain.ts';
import {parseBankgiroXML} from '../lib/bankgiro-parser.js';

const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){
 let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});
 for(const [name,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(value));
 return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js');
const reconciliationUrl=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const {analyze,reconcileState}=await import(reconciliationUrl);
const {normalizeTransactions}=await import(compiled('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js')}));
const overview=await import(compiled('../lib/payment-overview.ts',{'./domain':domain,'./reconciliation':reconciliationUrl,'./document-triage.js':url('../lib/document-triage.js'),'./economy-summary.js':url('../lib/economy-summary.js')}));
const presentation=await import(compiled('../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':url('../lib/payment-references.js')}));

const account='iban:SE4280000890119146168423';
const options={accountKey:account,accountLabel:'Syntetiskt konto',bankName:'Swedbank',dateFrom:'2026-10-01',dateTo:'2026-10-30'};
const invoice=(state,extra={})=>applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Syntetisk kund AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true,...extra}}).state;
const bankRow=(extra={})=>({entry_reference:'QUALITY-BANK-1',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',status:'BOOK',booking_date:'2026-10-26',debtor:{name:'Syntetisk kund AB'},creditor:{name:'Syntetisk leverantör AB'},reference_number:'000018',remittance_information:['Faktura 0599'],...extra});
async function importBank(state,raw){const {rows}=await normalizeTransactions([raw],options);return applyCommand(state,{type:'transactions.import',rows,trustedBankImport:true}).state;}

test('quality cycle: explicit card refunds, reversals and payroll never automatically pay ordinary invoices',async()=>{
 for(const [description,direction]of [['Card refund','receivable'],['Återbetalning kort','receivable'],['Reversal','receivable'],['Återföring','receivable'],['Card purchase','payable'],['Löneutbetalning','payable']]){
  const outgoing=direction==='payable';
  const state=await importBank(invoice(emptyState(),{direction,party:outgoing?'Syntetisk leverantör AB':'Syntetisk kund AB'}),bankRow({credit_debit_indicator:outgoing?'DBIT':'CRDT',bank_transaction_code:{description}}));
  const result=reconcileState(state);
  assert.equal(result.state.allocations.length,0,description);
  assert.equal(balance(result.state,result.state.invoices[0]),62500,description);
  assert.ok(analyze(state).some(f=>!f.safe&&/åter|kort|lön|betalningstyp/i.test(f.reason)),description);
 }
});

test('quality cycle: a normal exact booked bank transfer still pays its unique invoice',async()=>{
 const state=await importBank(invoice(emptyState()),bankRow({bank_transaction_code:{description:'Kontoöverföring'}}));
 const result=reconcileState(state);assert.equal(result.state.allocations.length,1);assert.equal(balance(result.state,result.state.invoices[0]),0);
});

test('quality cycle: explicit own transfers, salary and card withdrawals cannot pay a plausible invoice',async()=>{
 for(const description of ['Överföring eget konto','Överföring mellan egna konton','Internal transfer','Own transfer','Own account transfer','Salary','Payroll','Card withdrawal','Kontantuttag','Kortuttag']){
  const state=await importBank(invoice(emptyState()),bankRow({bank_transaction_code:{description}}));
  assert.equal(reconcileState(state).state.allocations.length,0,description);
 }
});

test('quality cycle: conflicting payer or OCR on the same bank ID is retained for review and cannot auto allocate',async()=>{
 for(const change of [{debtor:{name:'Annan syntetisk kund AB'}},{reference_number:'000026'},{details:{invoice_number:'0600'}}]){
  let state=await importBank(invoice(emptyState()),bankRow());const original=structuredClone(state.transactions[0]);
  state=await importBank(state,bankRow(change));
  assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].party,original.party);assert.equal(state.transactions[0].payerReference,original.payerReference);assert.deepEqual(state.transactions[0].bankData,original.bankData);
  const result=reconcileState(state);assert.equal(result.state.allocations.length,0,JSON.stringify(change));assert.equal(balance(result.state,result.state.invoices[0]),62500);
  assert.ok(analyze(state).some(f=>f.kind==='bank_evidence_conflict'&&!f.safe));
  assert.ok(overview.buildPaymentOverview(state).queue.some(item=>item.transaction_id===original.id&&/motstrid|bankunderlag/i.test(item.reason)));
  assert.throws(()=>applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:original.id,amount:62500,note:'Kontrollerad referens'}),/motstrid|bankunderlag/i);
  assert.throws(()=>applyCommand(state,{type:'transaction.verify',id:original.id,note:'En anteckning får inte radera bankens konflikt'}),/motstrid|bankunderlag/i);
 }
});

test('quality cycle: a conflict discovered after allocation preserves the allocation and creates a visible review item',async()=>{
 let state=reconcileState(await importBank(invoice(emptyState()),bankRow())).state;const allocation=structuredClone(state.allocations[0]);
 state=await importBank(state,bankRow({debtor:{name:'Annan syntetisk kund AB'}}));
 assert.deepEqual(state.allocations,[allocation]);assert.equal(paid(state,state.invoices[0].id),62500);
 assert.ok(overview.buildPaymentOverview(state).queue.some(item=>item.transaction_id===state.transactions[0].id&&/motstrid|bankunderlag/i.test(item.reason)));
 assert.ok(analyze(state).some(f=>f.kind==='bank_evidence_conflict'&&!f.safe));
});

test('quality cycle: allocated conflicting bank evidence cannot keep a verified bank presentation',async()=>{
 let state=reconcileState(await importBank(invoice(emptyState()),bankRow())).state;
 state=await importBank(state,bankRow({debtor:{name:'Annan syntetisk kund AB'}}));
 const view=presentation.bankPaymentView(state,state.transactions[0]);
 assert.equal(view.verified,false);assert.equal(view.invoiceVerified,false);assert.match(view.status,/konflikt|motstrid/i);assert.deepEqual(view.invoiceNumbers,['0599']);
 assert.equal(presentation.bankPaymentCounts(state).verified,0);assert.equal(presentation.bankPaymentCounts(state).review,1);
});

test('quality cycle: contradictory booked amount, date or direction is preserved without overwriting original money',async()=>{
 for(const change of [{transaction_amount:{amount:'700.00',currency:'SEK'}},{booking_date:'2026-10-27'},{credit_debit_indicator:'DBIT'}]){
  let state=await importBank(invoice(emptyState()),bankRow());const original=structuredClone(state.transactions[0]);
  state=await importBank(state,bankRow(change));
  assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].amount,62500);assert.equal(state.transactions[0].date,'2026-10-26');assert.deepEqual(state.transactions[0].bankData,original.bankData);
  assert.equal(reconcileState(state).state.allocations.length,0);
  assert.ok(analyze(state).some(f=>f.kind==='bank_evidence_conflict'));
 }
});

test('quality cycle: repeated conflicting evidence keeps one original contradiction and a durable hold',async()=>{
 let state=await importBank(invoice(emptyState()),bankRow());const changed=bankRow({debtor:{name:'Annan syntetisk kund AB'}});
 state=await importBank(state,changed);const retained=structuredClone(state.transactions[0].bankEvidenceConflicts);
 state=await importBank(state,changed);state=await importBank(state,bankRow());
 assert.equal(reconcileState(state).state.allocations.length,0);
 assert.deepEqual(state.transactions[0].bankEvidenceConflicts,retained);assert.equal(retained.length,1);assert.equal(retained[0].incoming.bankData.debtor.name,'Annan syntetisk kund AB');
});

test('quality cycle: a contradicted allocation cannot teach a payer relation for another invoice',async()=>{
 let state=await importBank(invoice(emptyState()),bankRow({debtor:{name:'Privat betalare'}}));
 state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:62500,note:'Manuellt styrkt kundrelation'}).state;
 state=await importBank(state,bankRow({debtor:{name:'Motstridig privat betalare'}}));
 state=invoice(state,{number:'0600',ocr:'000026'});
 state=await importBank(state,bankRow({entry_reference:'QUALITY-BANK-2',booking_date:'2026-10-27',debtor:{name:'Privat betalare'},reference_number:'000026',remittance_information:['Faktura 0600']}));
 state=reconcileState(state).state;assert.equal(state.allocations.length,1);assert.equal(balance(state,state.invoices[1]),62500);
});

test('quality cycle: repeating original bank evidence after a manual correction is idempotent',async()=>{
 let state=await importBank(emptyState(),bankRow());
 state=applyCommand(state,{type:'transaction.verify',id:state.transactions[0].id,party:'Manuellt verifierad relation AB',payerReference:'0999',note:'Korrigerat mot separat underlag'}).state;
 state=await importBank(state,bankRow());
 assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].party,'Manuellt verifierad relation AB');assert.ok(analyze(state).every(f=>f.kind!=='bank_evidence_conflict'));
});

const specification=(payer,reference,id)=>`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>SE4280000890119146168423</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>QUALITY-AGGREGATE</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>${id}</TxId></Refs><RltdPties><Dbtr><Nm>${payer}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${reference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
const importSpecification=(state,text,hash)=>applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-original-'+hash,hash,name:'Synthetic.xml',rows:parseBankgiroXML(text)}).state;

test('quality cycle: a second report cannot spend an already replaced aggregate again',async()=>{
 let state=invoice(invoice(emptyState()),{party:'Andra syntetiska kunden AB',number:'0600',ocr:'000026'});
 state=await importBank(state,bankRow({entry_reference:'QUALITY-AGGREGATE',debtor:{name:''},reference_number:'',remittance_information:[],bank_transaction_code:{description:'Bankgiro inbetalning'}}));
 state=reconcileState(importSpecification(state,specification('Syntetisk kund AB','000018','QUALITY-CHILD-A'),'a')).state;
 assert.equal(state.allocations.length,1);
 state=reconcileState(importSpecification(state,specification('Andra syntetiska kunden AB','000026','QUALITY-CHILD-B'),'b')).state;
 assert.equal(state.allocations.length,1);assert.equal(balance(state,state.invoices[1]),62500);assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.equal(state.transactions.find(row=>row.bankReference==='QUALITY-CHILD-B').specificationStatus,'review');
});
