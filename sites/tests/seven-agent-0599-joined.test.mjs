import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInvoiceReference} from '../lib/invoice-reference-policy.js';
import {balance,economicTransactions} from '../lib/domain.ts';
import {joinedFixture,joinedReport} from './helpers/seven-agent-joined-fixture.mjs';

const child=state=>state.transactions.find(row=>row.specification);
const decision=(preview,id)=>preview.decisions.find(row=>row.transactionId===id);

test('joined source identity conflict invalidates the retained payment preview and snapshot without changing money',async t=>{
 const f=await joinedFixture(t);await f.worker().run(f.owner);const payment=child(f.read().state),before=await f.preview(payment.id),workspace=f.read();
 assert.equal(decision(before,payment.id).status,'VERIFIED');
 f.source.reports.push({...joinedReport({reference:'599'}),reportId:f.report.reportId});const status=await f.worker().run(f.owner);
 assert.equal(status.counts.BLOCKED,1);assert.ok(status.jobs.some(job=>job.lastError==='IDENTITY_CONFLICT'));
 const after=await readOnly(t,f,payment.id);assert.equal(after.selected.status,'BLOCKED');assert.equal(after.selected.allocations.length,0);assert.notEqual(after.preview.snapshot.sha256,before.snapshot.sha256);assert.deepEqual(f.read(),workspace);
});

for(const assignment of ["authorization_status='BLOCKED'","authorization_generation='replacement'","missing_report_ids='[\"missing-report\"]'"])test('joined preview binds current C3 authority '+assignment,async t=>{
 const f=await joinedFixture(t);await f.worker().run(f.owner);const payment=child(f.read().state),before=await f.preview(payment.id);assert.equal(decision(before,payment.id).status,'VERIFIED');
 f.sql.exec('UPDATE bankgiro_ingest_sources SET '+assignment);const after=await readOnly(t,f,payment.id);
 assert.equal(after.selected.status,'BLOCKED');assert.equal(after.selected.allocations.length,0);assert.notEqual(after.preview.snapshot.sha256,before.snapshot.sha256);
});
function conserved(state){
 assert.equal(economicTransactions(state).length,1,'AIS aggregate and report cannot both count as money');
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.deepEqual(state.allocations,[],'intake and read-only proposals cannot book a payment');
 for(const invoice of state.invoices)assert.equal(balance(state,invoice),62500);
}
async function readOnly(t,f,id){
 const before=f.read(),audits=f.audits(),objects=structuredClone(f.objects),prepare=f.database.prepare.bind(f.database);
 const guard=t.mock.method(f.database,'prepare',query=>{assert.match(query,/^\s*SELECT\b/i,'joined preview must not attempt SQL writes');return prepare(query);});
 f.beforeBatch=()=>assert.fail('joined preview must not attempt a write batch');
 f.onPut=()=>assert.fail('joined preview must not attempt an R2 write');
 const deletion=t.mock.method(f.bucket,'delete',async()=>assert.fail('joined preview must not delete an original'));
 try{
  const preview=await f.preview(id),state=f.read().state,row=state.transactions.find(row=>row.id===id),view=f.presentation.bankPaymentView(state,row),html=f.render();
  assert.equal(preview.mode,'preview');assert.equal(preview.changed,false);assert.equal(preview.writesAllowed,false);assert.equal(preview.approvalRequired,true);
  assert.deepEqual(f.read(),before);assert.deepEqual(f.audits(),audits);assert.deepEqual(f.objects,objects);conserved(f.read().state);
  return {preview,selected:decision(preview,id),view,html};
 }finally{guard.mock.restore();deletion.mock.restore();f.beforeBatch=null;f.onPut=null;}
}

// Catches a missing C1→C4 mapper, reference coercion, fabricated formal OCR,
// source-only verification labels, allocations during intake and double money.
test('new joined 0599 chain: actual policy, authorized synthetic source, retained report, exact preview and payment view conserve money on replay',async t=>{
 const f=await joinedFixture(t),seed=f.read(),invoice=seed.state.invoices.find(row=>row.number==='0599');
 const c1=resolveInvoiceReference({invoice_number:invoice.number,reference:invoice.ocr,direction:'customer'},{company:seed.state.company,policies:seed.state.company.invoiceReferencePolicies});
 assert.equal(c1.applies,true);assert.equal(c1.status,'REVIEW');assert.equal(c1.intendedPaymentReference,'0599');assert.equal(c1.source,'invoice_number_policy');assert.equal(invoice.ocr,'');
 assert.equal(f.reconciliation.invoiceFacts(seed.state,invoice).intendedPaymentReference,'0599');
 const status=await f.worker().run(f.owner),current=f.read(),payment=child(current.state);
 assert.equal(status.counts.IMPORTED,1);assert.equal(status.jobs[0].status,'IMPORTED');assert.equal(payment.payerReference,'0599');assert.equal(payment.party,'Synthetic customer AB');
 assert.equal(payment.parentId,seed.state.transactions[0].id);assert.equal(payment.parentBankReference,'SYNTHETIC-DEPOSIT');assert.equal(payment.bankReference,'SYNTHETIC-CHILD-1');assert.equal(payment.specificationStatus,'linked');
 assert.equal(payment.bankFileProof.sha256,f.report.sha256);assert.deepEqual(f.objects.get(f.owner+'/'+payment.bankFileProof.documentId),f.report.bytes);
 assert.equal(payment.referenceEvidence.selected.kind,'invoice');assert.equal(payment.referenceEvidence.candidates.some(row=>row.kind==='ocr'),false);
 assert.deepEqual(current.state.invoices,seed.state.invoices);conserved(current.state);
 const {selected,view,html}=await readOnly(t,f,payment.id);
 assert.equal(selected.status,'VERIFIED',JSON.stringify(selected.reasonCodes));
 assert.deepEqual(selected.allocations.map(row=>[row.invoiceId,row.amountMinor]),[[invoice.id,62500]]);
 assert.equal(view.reference.value,'0599');assert.equal(view.reference.kind,'invoice');assert.equal(view.reference.ocr,'');assert.equal(view.verified,false);assert.equal(view.invoiceVerified,false);
 assert.deepEqual(view.intendedReferences.map(row=>[row.number,row.value]),[['0599','0599']]);
 const layouts=html.split('<div class="bank-mobile-list"');assert.equal(layouts.length,2);assert.match(layouts[0],/bank-desktop-list/);
 for(const layout of layouts){assert.match(layout,/Synthetic customer AB/);assert.match(layout,/<strong class="mono">0599<\/strong>/);assert.match(layout,/Fakturareferens/);assert.match(layout,/Bank-OCR saknas\./);assert.doesNotMatch(layout,/is-verified/);}
 assert.equal(f.audits().length,1);assert.equal(f.audits()[0].action,'bankgiro.import');
 assert.equal(JSON.parse(f.audits()[0].detail).allocationsCreated,0);
 const replay=await f.worker().run(f.owner);assert.equal(replay.counts.IMPORTED,1);assert.deepEqual(f.read(),current);
 f.source.reports.push({...f.report,reportId:'SYNTHETIC-RENAMED-DELIVERY',filename:'Renamed.xml'});
 const renamed=await f.worker().run(f.owner);assert.equal(renamed.counts.DUPLICATE,1);assert.deepEqual(f.read(),current);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents WHERE mime=?').get('application/xml').n,1);assert.equal(f.audits().length,1);conserved(f.read().state);
});

// Catches zero-padding or numeric matching across C3 import → C4 → C6.
test('new joined 0599 chain: observed 599 stays 599 and proposes only invoice 599',async t=>{
 const f=await joinedFixture(t,{reference:'599'});await f.worker().run(f.owner);const state=f.read().state,payment=child(state),invoice=state.invoices.find(row=>row.number==='599');
 const {selected,view,html}=await readOnly(t,f,payment.id);
 assert.equal(selected.status,'VERIFIED',JSON.stringify(selected.reasonCodes));assert.deepEqual(selected.allocations.map(row=>row.invoiceId),[invoice.id]);
 assert.equal(view.reference.value,'599');assert.deepEqual(view.possible,['599']);assert.deepEqual(view.intendedReferences.map(row=>row.value),['599']);
 assert.doesNotMatch(html,/<strong class="mono">0599<\/strong>|Möjlig: 0599/);conserved(state);
});

// Catches treating absent report transport/AIS credentials as authorized intake.
test('new joined 0599 chain: missing report source remains disabled with one economic AIS aggregate',async t=>{
 const f=await joinedFixture(t,{sourceEnabled:false}),before=f.read(),objects=structuredClone(f.objects),status=await f.worker().run(f.owner);
 assert.equal(status.enabled,false);assert.equal(status.state,'DISABLED');assert.equal(status.reason,'SOURCE_NOT_CONFIGURED');assert.equal(status.jobs.length,0);
 assert.deepEqual(f.read(),before);assert.deepEqual(f.objects,objects);assert.equal(f.audits().length,0);
 const {selected,view}=await readOnly(t,f,before.state.transactions[0].id);assert.equal(selected.status,'BLOCKED');assert.deepEqual(selected.allocations,[]);assert.equal(view.reference.value,'');assert.equal(view.verified,false);
});

for(const [name,options,reason] of [
 ['missing bank-reported alias',{withAlias:false},'ACCOUNT_EVIDENCE_REQUIRED'],
 ['missing shared deposit identifier',{relation:false},'REPORT_DEPOSIT_RELATION_REQUIRED'],
])test('new joined 0599 chain: '+name+' preserves a separate non-economic report observation',async t=>{
 const f=await joinedFixture(t,options),seed=f.read(),status=await f.worker().run(f.owner),state=f.read().state,payment=child(state);
 assert.equal(status.counts.REVIEW,1);assert.equal(payment.specificationStatus,'review');assert.equal(payment.parentId,'');assert.equal(payment.verified,false);assert.equal(payment.payerReference,'0599');
 assert.deepEqual(state.transactions.find(row=>row.id===seed.state.transactions[0].id),seed.state.transactions[0]);
 assert.deepEqual(economicTransactions(state).map(row=>row.id),[seed.state.transactions[0].id]);
 const {selected,view}=await readOnly(t,f,payment.id);assert.equal(selected.status,'BLOCKED');assert.ok(selected.reasonCodes.includes(reason),JSON.stringify(selected.reasonCodes));assert.deepEqual(selected.allocations,[]);assert.equal(view.verified,false);
 assert.deepEqual(f.objects.get(f.owner+'/'+payment.bankFileProof.documentId),f.report.bytes);conserved(state);
});

// Catches accepting transport metadata SHA, or trusting stored flags after the
// same retained bytes have changed at the C3→C4 boundary.
test('new joined 0599 chain: wrong delivery SHA blocks before retention and changed retained bytes block preview',async t=>{
 const f=await joinedFixture(t),before=f.read(),originals=f.objects.size;
 f.source.reports[0].sha256='0'.repeat(64);
 const rejected=await f.worker().run(f.owner);assert.equal(rejected.counts.BLOCKED,1);assert.equal(rejected.jobs[0].lastError,'HASH_MISMATCH');
 assert.deepEqual(f.read(),before);assert.equal(f.objects.size,originals);assert.equal(f.audits().length,0);conserved(f.read().state);
 const good=await joinedFixture(t);await good.worker().run(good.owner);const payment=child(good.read().state),saved=good.read();
 const key=good.owner+'/'+payment.bankFileProof.documentId;good.objects.set(key,joinedReport({reference:'0600'}).bytes);
 const {selected}=await readOnly(t,good,payment.id);assert.equal(selected.status,'BLOCKED');assert.deepEqual(selected.allocations,[]);assert.ok(selected.reasonCodes.includes('REPORT_ORIGINAL_MISSING_OR_INVALID'),JSON.stringify(selected.reasonCodes));assert.deepEqual(good.read(),saved);
});

// Catches a supplier's same-number record stealing customer reference scope;
// C1 must preserve the supplier's explicit reference independently.
test('new joined 0599 chain: same-number supplier stays outside the customer policy and incoming payment decision',async t=>{
 const f=await joinedFixture(t,{supplierControl:true}),seed=f.read().state,supplier=seed.invoices.find(row=>row.direction==='payable'),customer=seed.invoices.find(row=>row.direction==='receivable'&&row.number==='0599');
 const facts=f.reconciliation.invoiceFacts(seed,supplier);assert.equal(facts.referencePolicy.applies,false);assert.equal(facts.intendedPaymentReference,'000018');assert.equal(supplier.number,'0599');assert.equal(supplier.ocr,'000018');
 await f.worker().run(f.owner);const payment=child(f.read().state),{selected,view}=await readOnly(t,f,payment.id);
 assert.equal(selected.status,'VERIFIED',JSON.stringify(selected.reasonCodes));assert.deepEqual(selected.allocations.map(row=>row.invoiceId),[customer.id]);
 assert.deepEqual(view.intendedReferences.map(row=>row.value),['0599']);assert.equal(balance(f.read().state,supplier),62500);conserved(f.read().state);
});
