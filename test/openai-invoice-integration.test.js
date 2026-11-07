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


// These source details use the parser's raw party/row values; AI claims use
// normalized field wrappers. Keep header amounts absent to expose unsafe fills.
const ownCompany='5560160680',otherCompany='5560125790',counterpartyCompany='5566778899';
function nestedFactsFixture({direction='supplier',parsedCompany=ownCompany,parsedNet=100000}={}){
 const before=baseline(),proposed=candidate(),companyRole=direction==='customer'?'supplier':'recipient';
 before.fields.direction.value=direction;
 proposed.supplierOrgNumber.value=companyRole==='supplier'?ownCompany:counterpartyCompany;
 proposed.recipientOrgNumber.value=companyRole==='recipient'?ownCompany:counterpartyCompany;
 for(const role of ['supplier','recipient']){
  const claim=proposed[role+'OrgNumber'];
  claim.evidence={page:1,quote:role+' org: '+claim.value};
 }
 const party=(role,line)=>({
  name:proposed[role+'Name'].value,
  organization_number:role===companyRole?parsedCompany:counterpartyCompany,
  evidence:[{page:1,line,text:role+' org: '+(role===companyRole?parsedCompany:counterpartyCompany)}],
 });
 const rowText='Synthetic service | 1 | '+(parsedNet/100).toFixed(2)+' | '+(parsedNet/100).toFixed(2)+' | 25 | '+(parsedNet/400).toFixed(2)+' | '+(parsedNet*1.25/100).toFixed(2);
 before.details={
  version:1,supplier:party('supplier',2),recipient:party('recipient',3),
  reference:{kind:null,value:null,checksum_valid:null,formal_verified:false,evidence:[]},
  line_items:[{description:'Synthetic service',quantity:1,unit_price_cents:parsedNet,net_cents:parsedNet,vat_rate:25,vat_cents:parsedNet/4,total_cents:parsedNet+parsedNet/4,evidence:{page:1,line:6,text:rowText}}],
  vat_rates:[25],table_status:'complete',
 };
 const counterpartyRole=direction==='customer'?'recipient':'supplier';
 before.fields.party.value=before.details[counterpartyRole].name;
 before.fields.organization_number.value=before.details[counterpartyRole].organization_number;
 const claim=value=>({value,evidence:{page:1,quote:'Synthetic service | 1 | 1000.00 | 1000.00 | 25 | 250.00 | 1250.00'}});
 proposed.lineItems=[{description:claim('Synthetic service'),quantity:claim('1'),unitPrice:claim(100000),netAmount:claim(100000),vatAmount:claim(25000),totalAmount:claim(125000)}];
 return {before,proposed,companyRole};
}
async function enrichNestedFacts(t,scenario){
 const store=fixture(t),invocations=[],sourceSnapshot=structuredClone(scenario.before);
 const input={
  baseline:scenario.before,owner,documentId:'nested-document-a',sha256:sha,mime:'image/png',
  environment:environment(),store,
  loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),
  adapter:async args=>{invocations.push(args);return ready({candidate:scenario.proposed});},
 };
 const policy=invoiceAiPolicy(input.environment,owner);
 assert.equal(policy.status,'enabled');
 assert.equal(policy.expectedCompanyOrganization,ownCompany);
 const initial=await enrichInvoiceForReview(input);
 const replay=await enrichInvoiceForReview({...input,documentId:'nested-document-b'});
 assert.equal(invocations.length,1);
 assert.equal(invocations[0].policy.expectedCompanyOrganization,ownCompany);
 assert.equal(invocations[0].companyRole,scenario.companyRole);
 assert.equal(replay.ai.replayed,true);
 assert.deepEqual(scenario.before,sourceSnapshot,'the baseline must remain unchanged');
 for(const result of [initial,replay]){
  assert.equal(result.ai.status,'review');
  assert.equal(result.ai.requiresHumanReview,true);
  assert.equal(result.ai.bankEvidence,false);
  assert.notEqual(result.level,'green');
  assert.deepEqual(result.details,sourceSnapshot.details,'parser parties, rows and reference evidence must be preserved');
  assert.deepEqual(result.ai.candidate,scenario.proposed,'keep the conflicting proposal available for human review');
 }
 return [initial,replay];
}
function assertNestedConflict(results,keyPrefix){
 for(const result of results){
  assert.ok(result.ai.conflicts.some(key=>key.startsWith(keyPrefix)),'missing explicit conflict for '+keyPrefix);
  assert.equal(result.ai.economicRisk,true);
  for(const key of ['net_cents','vat_cents','total_cents','reference']){
   assert.equal(result.fields[key].value,null,key+' must not be filled from a contradictory proposal');
  }
  assert.deepEqual(result.ai.filledFields,[],'a nested source conflict must block all prefilling');
 }
}

test('parsed supplier-invoice recipient B conflicts with configured/model company A on enrichment and replay',async t=>{
 const scenario=nestedFactsFixture({direction:'supplier',parsedCompany:otherCompany});
 assert.equal(scenario.before.details.recipient.organization_number,otherCompany);
 assert.equal(scenario.proposed.recipientOrgNumber.value,ownCompany);
 const results=await enrichNestedFacts(t,scenario);
 assertNestedConflict(results,'details.recipient.organization_number');
});
test('parsed customer-invoice supplier B conflicts with configured/model company A on enrichment and replay',async t=>{
 const scenario=nestedFactsFixture({direction:'customer',parsedCompany:otherCompany});
 assert.equal(scenario.before.details.supplier.organization_number,otherCompany);
 assert.equal(scenario.proposed.supplierOrgNumber.value,ownCompany);
 const results=await enrichNestedFacts(t,scenario);
 assertNestedConflict(results,'details.supplier.organization_number');
});
test('internally balanced AI line amounts cannot fill missing totals or reference over different parsed lines',async t=>{
 const scenario=nestedFactsFixture({parsedNet:200000}),line=scenario.proposed.lineItems[0];
 assert.equal(scenario.before.details.table_status,'complete');
 assert.equal(line.netAmount.value+line.vatAmount.value,line.totalAmount.value);
 assert.equal(scenario.proposed.netAmount.value+scenario.proposed.vatAmount.value,scenario.proposed.totalAmount.value);
 assert.equal(line.totalAmount.value,scenario.proposed.totalAmount.value);
 assert.notEqual(scenario.before.details.line_items[0].total_cents,line.totalAmount.value);
 const results=await enrichNestedFacts(t,scenario);
 assertNestedConflict(results,'details.line_items');
});
test('consistent parsed company and line facts still allow review-only filling on enrichment and replay',async t=>{
 const results=await enrichNestedFacts(t,nestedFactsFixture());
 for(const result of results){
  assert.deepEqual(result.ai.conflicts,[]);
  assert.equal(result.ai.economicRisk,false);
  for(const [key,value] of Object.entries({net_cents:100000,vat_cents:25000,total_cents:125000,reference:'00000599'})){
   assert.equal(result.fields[key].value,value);
   assert.ok(result.ai.filledFields.includes(key));
   assert.equal(result.fields[key].provenance.kind,'openai_document_claim');
   assert.equal(result.fields[key].provenance.verified,false);
  }
 }
});

for(const direction of ['supplier','customer']){
 test('configured company blocks matching wrong-company parser and AI facts: '+direction,async t=>{
  const scenario=nestedFactsFixture({direction,parsedCompany:otherCompany});
  scenario.proposed[scenario.companyRole+'OrgNumber']={value:otherCompany,evidence:{page:1,quote:'Organization: '+otherCompany}};
  const results=await enrichNestedFacts(t,scenario);
  assertNestedConflict(results,'details.'+scenario.companyRole+'.organization_number');
 });
}
test('parsed VAT rate conflicts with AI row tax even when original tax and gross columns are absent',async t=>{
 const scenario=nestedFactsFixture(),row=scenario.before.details.line_items[0];
 row.vat_rate=12;row.vat_cents=null;row.total_cents=null;
 scenario.before.details.vat_rates=[12];
 const results=await enrichNestedFacts(t,scenario);
 assertNestedConflict(results,'details.line_items');
});

test('configured fallback needs its own durable budget reservation and is replayed without provider calls',async t=>{
 const store=fixture(t),models=[];
 const input={baseline:baseline(),owner,documentId:'fallback-doc',sha256:sha,mime:'image/png',environment:{...environment(),OPENAI_MODEL:'gpt-6.1-sol',OPENAI_FALLBACK_MODEL:'gpt-6-luna'},store,loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async args=>{models.push(args.policy.model);return args.policy.model==='gpt-6.1-sol'?{status:'fallback',issues:['api_model_unavailable'],costUnknown:false,attempts:0}:ready();}};
 const result=await enrichInvoiceForReview(input);assert.deepEqual(models,['gpt-6.1-sol','gpt-6-luna']);assert.equal(result.ai.status,'review');assert.equal(result.ai.fallbackFromModel,'gpt-6.1-sol');
 await enrichInvoiceForReview(input);assert.equal(models.length,2);
});
test('fallback is never issued after an ambiguous provider failure or when combined reservations exhaust budget',async t=>{
 for(const ambiguous of [true,false]){
  let calls=0;const result=await enrichInvoiceForReview({baseline:baseline(),owner,documentId:'no-fallback-'+ambiguous,sha256:sha,mime:'image/png',environment:{...environment(),OPENAI_MODEL:'gpt-6.1-sol',OPENAI_FALLBACK_MODEL:'gpt-6-luna',OPENAI_DAILY_BUDGET_USD:'0.25'},store:fixture(t),loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async()=>{calls++;return{status:'fallback',issues:[ambiguous?'api_network_error':'api_model_unavailable'],costUnknown:ambiguous};}});
  assert.equal(calls,1);assert.notEqual(result.level,'green');
 }
});

test('a cached primary rejection cannot mark a newly executed fallback as a replay',async t=>{
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE audit_events(id TEXT PRIMARY KEY,action TEXT,details TEXT,created_at TEXT)');t.after(()=>sql.close());let date='2026-11-07T12:00:00Z',calls=0;
 const store=createNodeAuditStore(sql,{owner,now:()=>new Date(date)});
 const input={baseline:baseline(),owner,documentId:'late-fallback',sha256:sha,mime:'image/png',environment:{...environment(),OPENAI_MODEL:'gpt-6.1-sol',OPENAI_FALLBACK_MODEL:'gpt-6-luna',OPENAI_DAILY_BUDGET_USD:'0.25'},store,loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async args=>{calls++;return args.policy.model==='gpt-6.1-sol'?{status:'fallback',issues:['api_model_unavailable'],costUnknown:false}:ready();}};
 await enrichInvoiceForReview(input);date='2026-11-08T12:00:00Z';const next=await enrichInvoiceForReview(input);assert.equal(calls,2);assert.equal(next.ai.status,'review');assert.notEqual(next.ai.replayed,true);
});

for(const completed of [true,false])test('upgrade preserves legacy '+(completed?'receipt':'uncertain reservation')+' even when token and budget settings change',async t=>{
 const {getInvoiceAiProfile}=await import('../sites/lib/openai-invoices/profiles.js');const {INVOICE_AI_SCHEMA,INVOICE_AI_INSTRUCTIONS}=await import('../sites/lib/openai-invoices/schema.js');
 const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const key=await hash(JSON.stringify(['invoice-ai-integration-2026-11-06.v1',INVOICE_AI_SCHEMA,INVOICE_AI_INSTRUCTIONS,getInvoiceAiProfile('luna-v1'),owner,sha,'image/png','5560160680','recipient']));
 const store=fixture(t);await store.reserve({key,documentId:'historical-doc',sha256:sha,profileVersion:'invoice-ai-integration-2026-11-06.v1',reservedMicroUsd:250000,dailyBudgetMicroUsd:1000000});if(completed)await store.record(key,ready());let calls=0;
 const result=await enrichInvoiceForReview({baseline:baseline(),owner,documentId:'new-job',sha256:sha,mime:'image/png',environment:{...environment(),OPENAI_MODEL:'gpt-6-luna',OPENAI_MAX_OUTPUT_TOKENS:'1200',OPENAI_DAILY_BUDGET_USD:'2',OPENAI_MONTHLY_BUDGET_USD:'40'},store,loadOriginal:async()=>({bytes:new Uint8Array([1,2]),pageCount:1}),adapter:async()=>{calls++;return ready();}});
 assert.equal(calls,0);if(completed)assert.equal(result.ai.replayed,true);else assert.equal(result.ai.code,'AI_REQUEST_ALREADY_RESERVED');
});
