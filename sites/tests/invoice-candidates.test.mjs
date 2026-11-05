import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {emptyState,applyCommand,bankApiOriginalIssue} from '../lib/domain.ts';
import {paymentFieldSourceFixture,paymentFieldInvoiceFixture} from './helpers/payment-field-source-fixture.mjs';
const domain=new URL('../lib/domain.ts',import.meta.url).href;
const engine=new URL('../lib/reconciliation-engine.js',import.meta.url).href;
function compiled(path,imports){let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [name,url]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(url));return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const presentation=compiled('../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':new URL('../lib/payment-references.js',import.meta.url).href});
const {bankPaymentView,bankPaymentFieldSources}=await import(presentation);
const {readInvoiceFields,candidateDocuments,bankInvoiceCandidates}=await import(compiled('../lib/banking/invoice-candidates.ts',{'../domain':domain,'../reconciliation-engine.js':engine,'../payment-presentation':presentation}));
const bank=(extra={})=>({id:'bank',amount:62500,date:'2026-10-26',kind:'batch',ignored:false,duplicateOf:'',payerReference:'99990004',bankReference:'archive',...extra});
const doc=(extra={})=>({document_id:'document-0599',status:'needs_review',extraction:JSON.stringify({fields:Object.fromEntries(Object.entries({invoice_number:'0599',party:'Synthetic Customer AB',total_cents:62500,issued_at:'2026-10-10',direction:'customer',kind:'invoice',currency:'SEK',...extra}).map(([k,v])=>[k,{value:v,confidence:.96,evidence:'Originalfaktura'}]))})});
// Exact-reference proposals need a received AIS original and saved detail
// provenance. This read-only unit fixture does not claim a fresh R2 byte check.
const bankWithDetailReference=reference=>{
 const {target}=paymentFieldSourceFixture({linked:false,detailReference:reference});
 assert.equal(bankApiOriginalIssue(target),'');
 assert.equal(target.bankDetails.status,'identified');
 assert.equal(target.bankDetails.documentId,'synthetic-detail-original');
 return target;
};
test('real field wrappers expose 0599 as a suggestion without inventing bank OCR or changing state',()=>{const s=emptyState(),t=bank(),before=JSON.stringify({s,t}),found=bankInvoiceCandidates(s,t,[doc()]);assert.equal(found.length,1);assert.equal(found[0].number,'0599');assert.equal(found[0].party,'Synthetic Customer AB');assert.equal(found[0].needsReview,true);assert.match(found[0].reason,/inte verifierade/);assert.equal(JSON.stringify({s,t}),before);assert.equal(t.payerReference,'99990004');});
test('a 625 payment does not propose invoice 0594 for 4375 kronor',()=>{assert.equal(bankInvoiceCandidates(emptyState(),bank(),[doc({invoice_number:'0594',total_cents:437500})]).length,0);});
test('multiple equal-amount invoices remain separate uncertain candidates',()=>{const a=doc(),b={...doc({invoice_number:'0600',party:'Annan kund'}),document_id:'other'};const found=bankInvoiceCandidates(emptyState(),bank(),[a,b]);assert.equal(found.length,2);assert.ok(found.every(c=>/inte verifierade/.test(c.reason)));});
test('future invoices, supplier documents, credit invoices and negative transactions are not proposed',()=>{for(const fields of [{issued_at:'2026-10-27'},{direction:'supplier'},{kind:'credit'},{currency:'EUR'}])assert.equal(bankInvoiceCandidates(emptyState(),bank(),[doc(fields)]).length,0);assert.equal(bankInvoiceCandidates(emptyState(),bank({amount:-62500}),[doc()]).length,0);});
test('registered documents are deduplicated and already paid invoices are not proposed',()=>{let s=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',number:'0599',party:'Synthetic Customer AB',total:62500,issued:'2026-10-10',due:'2026-10-24',documentId:'document-0599',reviewed:true}}).state;const f=bankInvoiceCandidates(s,bank(),[doc()]);assert.equal(f.length,1);assert.equal(f[0].source,'invoice');s.allocations.push({invoiceId:s.invoices[0].id,transactionId:'prior',amount:62500,effect:'payment',active:true});assert.equal(bankInvoiceCandidates(s,bank(),[doc()]).length,0);s.invoices[0].voided=true;assert.equal(bankInvoiceCandidates(s,bank(),[doc()]).length,0);});
test('an actual structured bank reference takes precedence over amount-only suggestions',()=>{const t=bankWithDetailReference('0599'),a=doc(),b={...doc({invoice_number:'0600'}),document_id:'other'},before=structuredClone({t,a,b});assert.deepEqual(bankInvoiceCandidates(emptyState(),t,[a,b]).map(x=>x.number),['0599']);assert.equal(bankPaymentFieldSources(emptyState(),t).reference.kind,'detail');assert.deepEqual({t,a,b},before);});
test('field unwrapping preserves leading zeros and handles both current and legacy extraction shapes',()=>{assert.equal(readInvoiceFields(doc().extraction).invoice_number,'0599');assert.equal(readInvoiceFields({fields:{invoice_number:'0599'}}).invoice_number,'0599');assert.deepEqual(readInvoiceFields('invalid json'),{});assert.equal(candidateDocuments([doc(),doc()]).length,1);});

// Removing shared identifier metadata or falling back to stale source fields must fail these contracts.
test('document candidates preserve current extraction identifiers and never merge a stale source',()=>{
 const row={...doc({reference:'000018',ocr:'000026'}),job_extraction:JSON.stringify({fields:{invoice_number:{value:'0606'},reference:{value:'000034'},direction:{value:'customer'},kind:{value:'invoice'},currency:{value:'SEK'},party:{value:'Current parsed customer'},total_cents:{value:62500},issued_at:{value:'2026-10-10'}}})};
 const before=structuredClone(row),candidate=candidateDocuments([row])[0];
 assert.equal(candidate.number,'0606');assert.equal(candidate.extractionSource,'document_jobs');assert.deepEqual(candidate.referenceFields,[{field:'reference',value:'000034'}]);assert.equal(candidate.referenceConflict,false);assert.deepEqual(row,before);
});
test('document reference and legacy OCR stay distinct searchable review candidates with leading zeros',()=>{
 const s=emptyState(),row=doc({invoice_number:'0606',reference:'000018',ocr:'000026'}),before=structuredClone(s);
 for(const reference of ['000018','000026']){const found=bankInvoiceCandidates(s,bankWithDetailReference(reference),[row]);assert.equal(found.length,1);assert.equal(found[0].number,'0606');assert.equal(found[0].referenceConflict,true);assert.deepEqual(found[0].referenceFields,[{field:'reference',value:'000018'},{field:'ocr',value:'000026'}]);assert.equal(found[0].needsReview,true);}
 for(const reference of ['18','26','606'])assert.equal(bankInvoiceCandidates(s,bankWithDetailReference(reference),[row]).length,0);
 assert.deepEqual(s,before);
});

const sourceDocuments=(numbers=['0599','0800'])=>numbers.map(number=>({...doc({invoice_number:number}),document_id:'synthetic-source-doc-'+number}));
test('an active linked report selects its matching unregistered original over a conflicting detail reference',()=>{
 const {state,target}=paymentFieldSourceFixture(),documents=sourceDocuments(),before=structuredClone({state,documents});
 const candidates=bankInvoiceCandidates(state,target,documents),view=bankPaymentView(state,target,candidates);
 assert.deepEqual(candidates.map(candidate=>candidate.number),['0599']);
 assert.equal(candidates[0].documentId,'synthetic-source-doc-0599');assert.equal(candidates[0].needsReview,true);
 assert.equal(view.reference.value,'0599');assert.equal(view.fieldSources.reference.kind,'report');assert.deepEqual(view.possible,['0599']);
 assert.deepEqual({state,documents},before);
});
test('an active linked report selects its registered invoice while preserving separate detail evidence',()=>{
 const {state,target}=paymentFieldInvoiceFixture(),before=structuredClone(state),documents=sourceDocuments().map(row=>({...row,document_id:'synthetic-invoice-'+JSON.parse(row.extraction).fields.invoice_number.value})),candidates=bankInvoiceCandidates(state,target,documents);
 assert.deepEqual(candidates.map(candidate=>[candidate.number,candidate.source]),[['0599','invoice']]);
 assert.equal(candidates[0].invoiceId,state.invoices.find(invoice=>invoice.number==='0599').id);
 assert.equal(target.bankDetails.payerReference,'0800');assert.equal(target.payerReference,'0700');assert.deepEqual(state,before);
});
test('an unlinked report cannot override the actual detail reference in candidate discovery',()=>{
 const {state,target}=paymentFieldSourceFixture({linked:false}),before=structuredClone(state),candidates=bankInvoiceCandidates(state,target,sourceDocuments());
 assert.deepEqual(candidates.map(candidate=>candidate.number),['0800']);assert.equal(bankPaymentView(state,target,candidates).fieldSources.reference.kind,'detail');assert.deepEqual(state,before);
});
test('a revoked report relation falls back to actual detail evidence without rewriting the originals',()=>{
 const original=paymentFieldSourceFixture(),state=applyCommand(original.state,{type:'bankgiro.unlink',id:original.state.bankgiroLinks[0].id,note:'Synthetic revoked relation'}).state,target=state.transactions.find(row=>row.id===original.target.id),before=structuredClone(state);
 assert.deepEqual(bankInvoiceCandidates(state,target,sourceDocuments()).map(candidate=>candidate.number),['0800']);assert.deepEqual(state,before);
});
test('a collective transaction without a displayed reference retains amount-only review proposals',()=>{
 const {state,target}=paymentFieldSourceFixture({linked:false,detailReference:''}),documents=[...sourceDocuments(['0599']),{...doc({invoice_number:'0700',total_cents:437500}),document_id:'synthetic-nonmatching-amount'}],before=structuredClone(state);
 assert.equal(bankPaymentView(state,target).reference.value,'');assert.equal(target.payerReference,'0700');
 assert.deepEqual(bankInvoiceCandidates(state,target,documents).map(candidate=>candidate.number),['0599']);assert.deepEqual(state,before);
});
test('linked report matching preserves leading zeros and does not promote a near identifier',()=>{
 const {state,target}=paymentFieldSourceFixture(),documents=sourceDocuments(['599','0599','0800']),before=structuredClone({state,documents});
 assert.deepEqual(bankInvoiceCandidates(state,target,documents).map(candidate=>candidate.number),['0599']);assert.deepEqual({state,documents},before);
});


// Registered invoices and unregistered originals use the same exact identifier boundary.
for(const [reference,number,expected] of [
 ['AB12','AB-12',false],
 ['AB-12','AB12',false],
 ['Faktura 0599','0599',true],
 ['0599','599',false],
 ['0599','0599',true]
])test('registered and unregistered proposals agree for '+reference+' and '+number,()=>{
 const t=bankWithDetailReference(reference),documents=[doc({invoice_number:number})];
 const state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',number,party:'Synthetic Customer AB',total:62500,issued:'2026-10-10',due:'2026-10-24',reviewed:true}}).state,before=structuredClone({state,t,documents});
 assert.deepEqual(bankInvoiceCandidates(state,t).map(row=>row.number),expected?[number]:[]);
 assert.deepEqual(bankInvoiceCandidates(emptyState(),t,documents).map(row=>row.number),expected?[number]:[]);
 assert.deepEqual({state,t,documents},before);assert.equal(t.bankDetails.payerReference,reference);
 assert.equal(state.allocations.length,0);
});

test('bare bankDetails cannot turn equal-amount review suggestions into an exact bank-reference selection',()=>{
 const state=emptyState(),t=bank({party:'',description:'',account:'',currency:'SEK',bankDetails:{payerReference:'0599'}}),documents=sourceDocuments(['0599','0600']),before=structuredClone({state,t,documents});
 const candidates=bankInvoiceCandidates(state,t,documents),fields=bankPaymentFieldSources(state,t),view=bankPaymentView(state,t,candidates);
 assert.equal(fields.reference.value.value,'');assert.equal(fields.reference.kind,'transaction');
 assert.deepEqual(candidates.map(row=>row.number),['0599','0600']);
 assert.ok(candidates.every(row=>row.needsReview&&!row.matchedFields));
 assert.notEqual(view.decision.code,'VERIFIED');assert.equal(view.invoiceVerified,false);
 assert.deepEqual({state,t,documents},before);assert.equal(state.allocations.length,0);
});

for(const [name,mutate] of [
 ['missing detail original',t=>{delete t.bankDetails.documentId;}],
 ['blank detail original',t=>{t.bankDetails.documentId=' ';}],
 ['unsupported detail response',t=>{t.bankDetails.status='unsupported';}],
 ['missing detail status',t=>{delete t.bankDetails.status;}],
 ['no AIS provenance',t=>{delete t.evidence;delete t.bankDataVersion;delete t.bankDataSha256;t.source='Manuellt registrerad';}]
])test('detail reference requires its saved source: '+name,()=>{
 const state=emptyState(),t=bankWithDetailReference('0599'),documents=sourceDocuments(['0599','0600']);mutate(t);
 const before=structuredClone({state,t,documents}),candidates=bankInvoiceCandidates(state,t,documents),fields=bankPaymentFieldSources(state,t),view=bankPaymentView(state,t,candidates);
 assert.equal(fields.reference.value.value,'');assert.equal(fields.reference.kind,'transaction');
 assert.deepEqual(candidates.map(row=>row.number),['0599','0600']);
 assert.ok(candidates.every(row=>row.needsReview&&!row.matchedFields));
 assert.notEqual(view.decision.code,'VERIFIED');assert.equal(view.invoiceVerified,false);
 assert.deepEqual({state,t,documents},before);assert.equal(state.allocations.length,0);
});

for(const [name,mutate] of [
 ['changed received JSON',t=>{t.bankData.reference_number='0599';}],
 ['changed receipt hash',t=>{t.bankDataSha256='f'.repeat(64);}],
 ['changed original reference',t=>{t.original.payerReference='0599';}]
])test('review candidates cannot verify a mutated AIS original: '+name,()=>{
 const state=emptyState(),t=bankWithDetailReference('0599'),documents=sourceDocuments(['0599','0600']);mutate(t);
 const before=structuredClone({state,t,documents}),issue=bankApiOriginalIssue(t),candidates=bankInvoiceCandidates(state,t,documents),view=bankPaymentView(state,t,candidates);
 assert.ok(issue);assert.ok(candidates.every(row=>row.needsReview));
 assert.equal(view.decision.code,'BLOCKED');assert.equal(view.decision.reason,issue);assert.equal(view.invoiceVerified,false);
 assert.deepEqual({state,t,documents},before);assert.equal(state.allocations.length,0);
});

for(const backed of [true,false])test('manual overlays never become a bank reference with '+(backed?'backed':'unbacked')+' details',()=>{
 const state=emptyState(),t=bankWithDetailReference('0599'),documents=sourceDocuments(['0599','0600']),original=structuredClone(t.original);
 if(!backed)delete t.bankDetails.documentId;
 t.verification={party:'Synthetic manual customer AB',payerReference:'0600',note:'Synthetic manual overlay only',at:'2026-11-01T21:00:00.000Z'};
 t.party=t.verification.party;t.payerReference=t.verification.payerReference;t.verified=true;
 assert.equal(bankApiOriginalIssue(t),'');
 const before=structuredClone({state,t,documents}),candidates=bankInvoiceCandidates(state,t,documents),fields=bankPaymentFieldSources(state,t),view=bankPaymentView(state,t,candidates);
 assert.equal(fields.reference.value.value,backed?'0599':'');assert.equal(fields.reference.kind,backed?'detail':'transaction');
 assert.deepEqual(candidates.map(row=>row.number),backed?['0599']:['0599','0600']);
 assert.ok(candidates.every(row=>row.needsReview));assert.notEqual(view.decision.code,'VERIFIED');assert.equal(view.invoiceVerified,false);
 assert.equal(t.verification.payerReference,'0600');assert.deepEqual(t.original,original);
 assert.deepEqual({state,t,documents},before);assert.equal(state.allocations.length,0);
});
