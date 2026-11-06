import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {enrichInvoiceForReview,invoiceAiPolicy,mergeInvoiceSuggestion} from '../sites/lib/openai-invoices/integration.js';
import {createNodeAuditStore} from '../sites/lib/openai-invoices/audit-store.js';

const sha='a'.repeat(64),owner='owner-a';
const baseline=()=>({version:3,method:'ocr',level:'yellow',issues:['Kontrollera underlaget.'],fields:Object.fromEntries(['invoice_number','party','organization_number','issued_at','due_at','total_cents','vat_cents','net_cents','reference','bankgiro','direction','kind','currency'].map(k=>[k,{value:({direction:'supplier',kind:'invoice',currency:'SEK'})[k]??null,confidence:0,evidence:null,warning:null}])),details:{supplier:{},recipient:{},line_items:[],reference:{formal_verified:false},table_status:'absent'},text_excerpt:''});
const environment=()=>({OPENAI_INVOICES_ENABLED:'true',OPENAI_INVOICES_PRIVACY_APPROVED:'true',OPENAI_INVOICES_SECURITY_APPROVED:'true',OPENAI_INVOICES_COST_APPROVED:'true',OPENAI_INVOICES_APPROVAL_ID:'synthetic-test-approval',OPENAI_INVOICES_ALLOWED_OWNERS:JSON.stringify([owner]),OPENAI_INVOICES_COMPANY_ORGANIZATIONS:JSON.stringify({[owner]:'5560160680'}),OPENAI_INVOICES_PROFILE:'luna-v1',OPENAI_API_KEY:'synthetic-key-not-a-credential',OPENAI_INVOICES_DAILY_BUDGET_MICRO_USD:'1000000',OPENAI_INVOICES_MAX_DOCUMENT_MICRO_USD:'250000'});
function fixture(t){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE audit_events(id TEXT PRIMARY KEY,action TEXT,details TEXT,created_at TEXT)');t.after(()=>sql.close());
 return createNodeAuditStore(sql,{owner});
}
const candidate=()=>({invoiceNumber:{value:'00017',evidence:{page:1,quote:'Invoice number: 00017'}},paymentReference:{value:'00000599',evidence:{page:1,quote:'OCR: 00000599'}},supplierName:{value:'Synthetic Supplier AB',evidence:{page:1,quote:'Supplier: Synthetic Supplier AB'}},recipientName:{value:'Synthetic Recipient AB',evidence:{page:1,quote:'Bill to: Synthetic Recipient AB'}},supplierOrgNumber:{value:'5560160680',evidence:{page:1,quote:'Org: 556016-0680'}},recipientOrgNumber:{value:'5560160680',evidence:{page:1,quote:'Recipient org: 556016-0680'}},invoiceDate:{value:'2026-11-01',evidence:{page:1,quote:'Date: 2026-11-01'}},dueDate:{value:'2026-12-01',evidence:{page:1,quote:'Due: 2026-12-01'}},netAmount:{value:100000,evidence:{page:1,quote:'Net: 1000.00 SEK'}},vatAmount:{value:25000,evidence:{page:1,quote:'VAT: 250.00 SEK'}},totalAmount:{value:125000,evidence:{page:1,quote:'Total: 1250.00 SEK'}},currency:{value:'SEK',evidence:{page:1,quote:'SEK'}},lineItems:[]});
const ready=(changes={})=>({status:'review',candidate:candidate(),issues:[],usage:{inputTokens:100,outputTokens:100},costMicroUsd:60,model:'gpt-6-luna',...changes});

test('disabled mode returns the identical OCR result with no external or persistence work',async()=>{
 const before=baseline();const result=await enrichInvoiceForReview({baseline:before,owner,environment:{},loadOriginal(){throw Error('unexpected original read');},store:{load(){throw Error('unexpected store');}}});
 assert.equal(result,before);
});
for(const patch of [{OPENAI_INVOICES_PRIVACY_APPROVED:'false'},{OPENAI_INVOICES_SECURITY_APPROVED:'false'},{OPENAI_INVOICES_COST_APPROVED:'false'},{OPENAI_INVOICES_ALLOWED_OWNERS:'[]'},{OPENAI_API_KEY:''},{OPENAI_INVOICES_COMPANY_ORGANIZATIONS:'{}'}]){
 test('server approval gate blocks before original read: '+Object.keys(patch)[0],async()=>{
  const result=await enrichInvoiceForReview({baseline:baseline(),owner,environment:{...environment(),...patch},loadOriginal(){throw Error('unexpected disclosure');}});
  assert.equal(result.ai.status,'blocked');assert.notEqual(result.level,'green');
 });
}
test('model candidates fill missing fields for review and cannot become bank evidence',()=>{
 const before=baseline(),result=mergeInvoiceSuggestion(before,ready());
 assert.equal(result.fields.invoice_number.value,'00017');
 assert.equal(result.fields.reference.value,'00000599');
 assert.notEqual(result.level,'green');assert.equal(result.ai.requiresHumanReview,true);
 assert.equal(result.ai.bankEvidence,false);assert.equal(result.details.reference.formal_verified,false);
 assert.equal(before.fields.invoice_number.value,null);
});
test('AI disagreements preserve the original-derived value and record the conflict',()=>{
 const before=baseline();before.fields.invoice_number.value='17';
 const result=mergeInvoiceSuggestion(before,ready());
 assert.equal(result.fields.invoice_number.value,'17');assert.ok(result.ai.conflicts.includes('invoice_number'));assert.notEqual(result.level,'green');
});
test('model-declared economic conflicts cannot be filled into accounting fields',()=>{
 const result=mergeInvoiceSuggestion(baseline(),ready({issues:['TOTAL_MISMATCH']}));
 assert.equal(result.fields.total_cents.value,null);assert.notEqual(result.level,'green');
});
test('uncertain reservation never triggers a second provider call after failure/restart',async t=>{
 const store=fixture(t);let calls=0;
 const input={baseline:baseline(),owner,documentId:'document-a',sha256:sha,mime:'image/png',environment:environment(),store,loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async()=>{calls++;throw Error('synthetic transport failure with PRIVATE content');}};
 const first=await enrichInvoiceForReview(input),second=await enrichInvoiceForReview(input);
 assert.equal(calls,1);assert.notEqual(first.level,'green');assert.notEqual(second.level,'green');
 assert.ok(!JSON.stringify([first,second]).includes('PRIVATE'));
});
test('successful candidate is reused by original hash without another provider call',async t=>{
 const store=fixture(t);let calls=0;const input={baseline:baseline(),owner,documentId:'document-a',sha256:sha,mime:'image/png',environment:environment(),store,loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async()=>{calls++;return ready();}};
 await enrichInvoiceForReview(input);const next=await enrichInvoiceForReview({...input,documentId:'document-b'});
 assert.equal(calls,1);assert.equal(next.ai.replayed,true);assert.equal(next.fields.invoice_number.value,'00017');
});
test('original preflight failure falls back before reservation or external processing',async t=>{
 let calls=0;const result=await enrichInvoiceForReview({baseline:baseline(),owner,documentId:'document-a',sha256:sha,mime:'application/pdf',environment:environment(),store:fixture(t),loadOriginal:async()=>{throw Error('corrupt pdf PRIVATE');},adapter:async()=>{calls++;return ready();}});
 assert.equal(calls,0);assert.equal(result.ai.code,'ORIGINAL_PREFLIGHT_FAILED');assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('lower-case adapter issue codes block financial prefilling for a wrong company',()=>{
 const result=mergeInvoiceSuggestion(baseline(),ready({issues:['company_organization_mismatch']}));
 assert.equal(result.fields.total_cents.value,null);assert.equal(result.ai.economicRisk,true);assert.notEqual(result.level,'green');
});
test('conflicting original total does not combine with AI tax/net amounts',()=>{
 const before=baseline();before.fields.total_cents.value=130000;
 const result=mergeInvoiceSuggestion(before,ready());
 assert.equal(result.fields.total_cents.value,130000);assert.equal(result.fields.net_cents.value,null);assert.equal(result.fields.vat_cents.value,null);
 assert.ok(result.ai.conflicts.includes('total_cents'));assert.equal(result.ai.economicRisk,true);
});
