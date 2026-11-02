import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInvoiceReference} from '../../sites/lib/invoice-reference-policy.js';

const VERSION='mgeorge-reconciliation-v1';
const OWNER='synthetic-owner';
const ACCOUNT='SYNTHETIC-RECEIVING-ACCOUNT';
const CHECKED_AT='2026-09-13T12:00:00.000Z';
const nameField=value=>({value,rawValue:value,source:'$.debtor.name'});
const reference=value=>({value,rawValue:value,source:'$.remittance_information[0]',kind:'invoice',validity:'unchecked'});

/** Entirely artificial facts. No customer original or production account is used. */
export function reconciliationContractFixture(){
 const payerEvidence={version:'bank-payer-2026-11-01.1',origin:'bank_original',role:'debtor',scope:'individual',namespace:'',name:nameField('Synthetic Customer A'),identifiers:[{kind:'organization',scheme:'COID',issuer:'SE',value:'1111111111',rawValue:'1111111111',source:'$.debtor.organisation_id.identification'}],address:null,conflict:false,organizationNumber:'1111111111',warnings:[]};
 return {
  contractVersion:VERSION,ownerId:OWNER,companyId:'synthetic-company',revision:7,checkedAt:CHECKED_AT,complete:true,
  referencePolicy:{version:VERSION,companyId:'synthetic-company',invoiceNumberIsPaymentReference:true,preserveLeadingZeros:true,comparison:'exact',source:'synthetic-business-policy'},
  transactions:[{id:'payment-1',bankId:'SYNTHETIC-BANK-PAYMENT-1',accountId:ACCOUNT,amountMinor:73100,currency:'SEK',bookedDate:'2026-09-12',kind:'payment',economic:true,ignored:false,duplicateOf:'',original:{status:'VERIFIED',source:'bank_api',id:'synthetic-bank-original-1',sha256:'a'.repeat(64)},accountEvidence:{status:'VERIFIED',ownerId:OWNER,accountId:ACCOUNT,currency:'SEK',source:'bank_account_resource',proofId:'synthetic-account-proof-1',validUntil:'2026-10-01T00:00:00.000Z'},payerEvidence,references:[reference('00042')],referenceIncomplete:false,parentId:'',reportId:'',reversal:false,holdReason:'',conflict:false}],
  invoices:[{id:'invoice-1',companyId:'synthetic-company',number:'00042',explicitReference:'',customerName:'Synthetic Customer A',customerOrganizationNumber:'1111111111',direction:'receivable',currency:'SEK',totalMinor:73100,creditMinor:0,reviewed:true,voided:false,issuedDate:'2026-09-01',evidenceIssue:''}],
  allocations:[],reports:[],relationships:[],customerRelationships:[],importJobs:[],evidenceContext:{consentGeneration:'synthetic-consent-v1'}
 };
}

function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}
function envelope(preview){
 assert.equal(preview.mode,'preview');
 assert.equal(preview.changed,false);
 assert.equal(preview.writesAllowed,false);
 assert.equal(preview.approvalRequired,true);
 assert.ok(['VERIFIED','REVIEW','BLOCKED'].includes(preview.status));
 assert.ok(Array.isArray(preview.decisions));
 assert.match(preview.snapshot.sha256,/^[a-f0-9]{64}$/);
}
function decision(preview,id='payment-1'){
 const result=preview.decisions.find(item=>item.transactionId===id);
 assert.ok(result,`Observation ${id} must remain visible`);
 assert.ok(Array.isArray(result.reasonCodes));
 assert.ok(Array.isArray(result.candidateInvoiceIds));
 assert.ok(Array.isArray(result.allocations));
 return result;
}
function noAllocations(preview){
 for(const item of preview.decisions)assert.deepEqual(item.allocations,[],`Unexpected proposal for ${item.transactionId}`);
}
function approved(preview){
 return {contractVersion:VERSION,source:'stored_business_approval',ownerId:OWNER,approvedBy:'synthetic-reviewer',approved:true,requestId:'synthetic-approval-request-1',expiresAt:'2026-09-13T12:30:00.000Z',snapshotSha256:preview.snapshot.sha256,revision:preview.snapshot.revision,decisions:[{transactionId:'payment-1',allocations:[{invoiceId:'invoice-1',amountMinor:73100,currency:'SEK'}]}]};
}
const context=()=>({ownerId:OWNER,now:'2026-09-13T12:05:00.000Z',consumedRequestIds:[]});
function reportFixture(){
 const input=reconciliationContractFixture(),child=input.transactions[0];
 const parent={...structuredClone(child),id:'deposit-1',bankId:'SYNTHETIC-DEPOSIT-1',kind:'aggregate',economic:false,payerEvidence:null,references:[],original:{status:'VERIFIED',source:'bank_api',id:'synthetic-deposit-original-1',sha256:'c'.repeat(64)}};
 child.bankId='SYNTHETIC-INDIVIDUAL-PAYMENT-1';child.parentId=parent.id;child.reportId='report-1';child.original={status:'VERIFIED',source:'bankgiro_file',id:'synthetic-report-original-1',sha256:'b'.repeat(64)};
 input.transactions.unshift(parent);
 input.reports=[{id:'report-1',bankDepositId:parent.bankId,accountId:ACCOUNT,currency:'SEK',bookedDate:'2026-09-12',totalMinor:73100,paymentCount:1,paymentIds:[child.id],original:structuredClone(child.original)}];
 input.relationships=[{id:'report-relationship-1',reportId:'report-1',transactionId:parent.id,method:'bank_identity',status:'VERIFIED',active:true}];
 return input;
}

/** The same real implementation and synthetic behavioral corpus run in both suites. */
export function runReconciliationContractCases(api){
 const ensure=()=>{
  assert.equal(api.RECONCILIATION_CONTRACT_VERSION,VERSION,'Shared versioned reconciliation contract must be exported');
  assert.equal(typeof api.buildReconciliationPreview,'function','Read-only preview builder must be exported');
  assert.equal(typeof api.validateReconciliationApproval,'function','Pure approval validator must be exported');
 };
 const build=async input=>{ensure();const result=await api.buildReconciliationPreview(input);envelope(result);return result;};
 const validate=(preview,approval,options=context())=>{ensure();const result=api.validateReconciliationApproval(preview,approval,options);assert.equal(result.writesAllowed,false);assert.ok(Array.isArray(result.reasonCodes));return result;};
 const check=(name,body)=>test('shared reconciliation contract: '+name,body);

 check('trusted C1 company configuration activates only its supported invoice-number policy',async()=>{
  assert.equal(typeof api.invoiceReferencePolicyFromContext,'function');
  const configured={version:'invoice-reference-policy-v1',id:'synthetic-custom-policy',companyName:'Synthetic Other Issuer AB',direction:'customer',referenceSource:'invoice_number',matchMode:'exact'};
  for(const context of [{company:{name:'M.George Vitvaror AB'}},{company:{name:' m.george   vitvaror ab '}},{company:{name:configured.companyName},policies:[configured]}]){
   const input=reconciliationContractFixture();input.referencePolicy=api.invoiceReferencePolicyFromContext(context,input.companyId);
   const preview=await build(input);assert.equal(decision(preview).status,'VERIFIED');assert.equal(preview.writesAllowed,false);
   assert.match(input.referencePolicy.source,/invoice-reference-policy-v1:/);
  }
  for(const context of [{company:{name:'Synthetic Unconfigured Issuer AB'}},{company:{name:'M.George Vitvaror AB'},policies:[]},{company:{name:'M.George Vitvaror AB'},policies:[{...configured,version:'unknown'}]},{company:{name:configured.companyName},policies:[{...configured,referenceSource:'explicit_reference'}]},{}]){
   const input=reconciliationContractFixture();input.referencePolicy=api.invoiceReferencePolicyFromContext(context,input.companyId);
   assert.equal(input.referencePolicy,null);const preview=await build(input);assert.ok(decision(preview).reasonCodes.includes('REFERENCE_POLICY_REQUIRED'));noAllocations(preview);
  }
 });

 check('C1 outer-space original ownership aliases block another exact invoice proposal',async()=>{
  const input=reconciliationContractFixture(),held={invoice_number:'00043',reference:'',direction:'customer',original:{invoice_number:' 00042 ',reference:''}};
  const policy=resolveInvoiceReference(held,{company:{name:'M.George Vitvaror AB'}});
  assert.equal(policy.status,'BLOCKED');
  const mapped=api.adaptInvoiceReferenceEvidence({...held,referencePolicy:policy,referencePolicyIdentifiers:['00043',' 00042 ']});
  input.invoices.push({...structuredClone(input.invoices[0]),id:'held-original-owner',number:'00043',referenceClaims:mapped.referenceClaims,referenceClaimsComplete:mapped.complete,evidenceIssue:mapped.issue});
  const preview=await build(input),item=decision(preview);assert.equal(item.status,'BLOCKED');assert.deepEqual(item.conflictingInvoiceIds,['held-original-owner','invoice-1']);noAllocations(preview);
  assert.ok(mapped.referenceClaims.includes(' 00042 '));assert.ok(mapped.referenceClaims.includes('00042'));
 });

 check('C1 ownership normalization never repairs zeros separators Unicode or numeric identifiers',async()=>{
  for(const originalNumber of ['42','000042','00-042','00042/1','\t00042','０００４２',42]){
   const input=reconciliationContractFixture(),held={invoice_number:'00043',reference:'',direction:'customer',original:{invoice_number:originalNumber}};
   const mapped=api.adaptInvoiceReferenceEvidence({...held,referencePolicy:resolveInvoiceReference(held,{company:{name:'M.George Vitvaror AB'}}),referencePolicyIdentifiers:['00043',originalNumber]});
   input.invoices.push({...structuredClone(input.invoices[0]),id:'held-other-owner',number:'00043',referenceClaims:mapped.referenceClaims,referenceClaimsComplete:mapped.complete,evidenceIssue:mapped.issue});
   const item=decision(await build(input));assert.deepEqual(item.conflictingInvoiceIds,[]);assert.ok(!mapped.referenceClaims.includes('00042'));
   if(typeof originalNumber==='string')assert.equal(item.status,'VERIFIED');else assert.equal(item.status,'BLOCKED');
  }
 });

 check('incoming customer policy keeps supplier number and declaration ownership in the payable scope',async()=>{
  for(const supplierState of [{},{reviewed:false},{voided:true},{creditMinor:73100}]){
   const input=reconciliationContractFixture();input.invoices.push({...structuredClone(input.invoices[0]),id:'supplier-same-number',direction:'payable',explicitReference:'000018',referenceClaims:['00042','000018'],evidenceIssue:'C1_REFERENCE_POLICY_NOT_APPLICABLE',...supplierState});
   const preview=await build(input),item=decision(preview);assert.equal(item.status,'VERIFIED');assert.deepEqual(item.candidateInvoiceIds,['invoice-1']);assert.deepEqual(item.conflictingInvoiceIds,[]);assert.equal(item.allocations.length,1);assert.equal(item.allocations[0].invoiceId,'invoice-1');
  }
 });

 check('direction scoping preserves held same-direction original owners and rejects mixed references',async()=>{
  const input=reconciliationContractFixture();input.invoices.push({...structuredClone(input.invoices[0]),id:'supplier-owner',number:'000018',direction:'payable',referenceClaims:['00042'],evidenceIssue:'C1_REFERENCE_POLICY_NOT_APPLICABLE'});
  input.invoices.push({...structuredClone(input.invoices[0]),id:'held-customer-owner',number:'00043',referenceClaims:['00042'],reviewed:false});
  const ambiguous=decision(await build(input));assert.equal(ambiguous.status,'BLOCKED');assert.deepEqual(ambiguous.candidateInvoiceIds,['invoice-1']);assert.deepEqual(ambiguous.conflictingInvoiceIds,['held-customer-owner','invoice-1']);assert.deepEqual(ambiguous.allocations,[]);
  input.invoices.pop();input.transactions[0].references.push(reference('000018'));
  const mixed=decision(await build(input));assert.equal(mixed.status,'BLOCKED');assert.deepEqual(mixed.candidateInvoiceIds,['invoice-1']);assert.ok(mixed.reasonCodes.includes('CONFLICTING_PAYMENT_REFERENCES'));assert.deepEqual(mixed.allocations,[]);
 });

 check('outgoing matches select payable owners without permitting a v1 outgoing proposal',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].amountMinor=-73100;input.invoices.push({...structuredClone(input.invoices[0]),id:'supplier-owner',direction:'payable'});
  const item=decision(await build(input));assert.equal(item.status,'BLOCKED');assert.deepEqual(item.candidateInvoiceIds,['supplier-owner']);assert.deepEqual(item.conflictingInvoiceIds,[]);assert.ok(item.reasonCodes.includes('REVERSAL_OR_OUTGOING_PAYMENT'));assert.deepEqual(item.allocations,[]);
 });

 check('exports a versioned preview and approval boundary',()=>ensure());
 check('complete exact payment produces a deterministic proposal without mutating frozen input',async()=>{
  const input=deepFreeze(reconciliationContractFixture()),before=structuredClone(input),preview=await build(input),item=decision(preview);
  assert.equal(preview.status,'VERIFIED');assert.equal(item.status,'VERIFIED');assert.equal(item.bankEvidenceStatus,'VERIFIED');
  assert.deepEqual(item.candidateInvoiceIds,['invoice-1']);assert.equal(item.availableMinor,73100);assert.equal(item.unallocatedMinor,0);
  assert.deepEqual(item.allocations,[{invoiceId:'invoice-1',amountMinor:73100,currency:'SEK',invoiceRemainingBeforeMinor:73100,invoiceRemainingAfterMinor:0,settlement:'full'}]);
  assert.deepEqual(item.payer,before.transactions[0].payerEvidence);assert.deepEqual(item.references,before.transactions[0].references);assert.notStrictEqual(item.payer,input.transactions[0].payerEvidence);assert.notStrictEqual(item.references,input.transactions[0].references);
  assert.equal(preview.snapshot.revision,7);assert.deepEqual(await build(input),preview);assert.deepEqual(input,before);
 });
 check('leading zeros never match a shorter or numeric invoice number',async()=>{
  for(const number of ['42',42]){
   const input=reconciliationContractFixture();input.invoices[0].number=number;
   const preview=await build(input),item=decision(preview);assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);assert.deepEqual(item.references,[reference('00042')]);
  }
 });
 check('missing bank original blocks despite otherwise complete matching facts',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].original={status:'BLOCKED',source:'unknown',id:'',sha256:''};
  const preview=await build(input),item=decision(preview);assert.equal(preview.status,'BLOCKED');assert.equal(item.status,'BLOCKED');assert.ok(item.reasonCodes.includes('ORIGINAL_MISSING_OR_INVALID'));noAllocations(preview);
 });
 check('unproven receiving account blocks exact payment',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].accountEvidence={status:'BLOCKED',ownerId:OWNER,accountId:ACCOUNT,currency:'SEK',source:'missing',proofId:''};
  const preview=await build(input),item=decision(preview);assert.equal(item.status,'BLOCKED');assert.ok(item.reasonCodes.includes('ACCOUNT_EVIDENCE_REQUIRED'));noAllocations(preview);
 });
 check('stored exact approval is admissible but never grants writes',async()=>{
  const preview=await build(reconciliationContractFixture()),approval=deepFreeze(approved(preview)),before=structuredClone(approval),result=validate(preview,approval);
  assert.equal(result.valid,true);assert.deepEqual(approval,before);
 });
 check('checking the same facts at another valid time preserves the snapshot identity',async()=>{
  const input=reconciliationContractFixture(),first=await build(input);input.checkedAt='2026-09-13T12:01:00.000Z';
  const second=await build(input);assert.equal(second.status,'VERIFIED');assert.equal(second.snapshot.sha256,first.snapshot.sha256);
 });
 check('raw reference text and parser kind survive without being promoted to OCR',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].references[0].rawValue=' 00042 ';
  const preview=await build(input),item=decision(preview);assert.equal(item.status,'VERIFIED');assert.deepEqual(item.references,[{...reference('00042'),rawValue:' 00042 '}]);
  for(const value of ['00042 ','00-042','Faktura 00042']){
   const other=reconciliationContractFixture();other.transactions[0].references=[reference(value)];
   assert.deepEqual(decision(await build(other)).allocations,[],`Exact comparison must reject ${JSON.stringify(value)}`);
  }
 });
 check('absent or incompatible company policies fail closed',async()=>{
  const changes=[input=>{input.referencePolicy=null;},input=>{input.contractVersion='future-contract-v2';},input=>{input.referencePolicy.version='future-policy-v2';},input=>{input.referencePolicy.companyId='other-company';},input=>{input.referencePolicy.preserveLeadingZeros=false;},input=>{input.referencePolicy.comparison='numeric';},input=>{input.referencePolicy.invoiceNumberIsPaymentReference=false;}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
 });
 check('explicit invoice references survive and a policy cannot erase their conflict',async()=>{
  for(const explicitReference of ['ANOTHER-REFERENCE','42','00042 ',42]){
   const input=reconciliationContractFixture();input.invoices[0].explicitReference=explicitReference;
   const before=structuredClone(input),item=decision(await build(input));
   assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);assert.deepEqual(input,before);
  }
  const input=reconciliationContractFixture();input.invoices[0].explicitReference='00042';
  assert.equal(decision(await build(input)).status,'VERIFIED');
 });
 check('declared and original reference claims reserve every invoice including closed or held owners',async()=>{
  for(const fields of [{explicitReference:'00042'},{explicitReference:'00042',reviewed:false},{explicitReference:'00042',voided:true},{explicitReference:'',referenceClaims:['00043','00042']}]){
   const input=reconciliationContractFixture();input.invoices.push({...structuredClone(input.invoices[0]),id:'claim-owner',number:'00043',...fields});
   const before=structuredClone(input),item=decision(await build(input));
   assert.equal(item.status,'BLOCKED');assert.ok(item.reasonCodes.includes('AMBIGUOUS_INVOICE_REFERENCE'));assert.deepEqual(item.allocations,[]);
   assert.deepEqual(item.candidateInvoiceIds,['invoice-1']);assert.deepEqual(item.conflictingInvoiceIds,['claim-owner','invoice-1']);assert.deepEqual(input,before);
  }
 });
 check('additional reference claims are exact snapshot facts and malformed claims fail closed',async()=>{
  const input=reconciliationContractFixture(),first=await build(input);
  input.invoices[0].referenceClaims=['00042','00042','OLD-00042'];
  const second=await build(input);assert.equal(decision(second).status,'VERIFIED');assert.notEqual(second.snapshot.sha256,first.snapshot.sha256);
  for(const referenceClaims of ['00042',[42],[''],[null],new Array(1)]){
   const bad=reconciliationContractFixture();bad.invoices[0].referenceClaims=referenceClaims;
   assert.equal(decision(await build(bad)).status,'BLOCKED');
  }
  const incomplete=reconciliationContractFixture();incomplete.invoices.push({...structuredClone(incomplete.invoices[0]),id:'incomplete-owner',number:'00043',referenceClaimsComplete:false,evidenceIssue:'Unknown C1 census'});
  const blocked=decision(await build(incomplete));assert.equal(blocked.status,'BLOCKED');assert.ok(blocked.reasonCodes.includes('INCOMPLETE_REFERENCE_OWNERSHIP'));
 });
 const c1Facts=()=>({invoice_number:'00042',reference:'00042',referencePolicyIdentifiers:['00042','OLD-00042'],referencePolicy:{version:'invoice-reference-policy-v1',policyId:'synthetic-c1-policy',applies:true,status:'REVIEW',invoiceNumber:'00042',intendedPaymentReference:'00042',declaredPaymentReference:'00042',source:'invoice_number_policy',issues:[],reason:'Synthetic company intention; no bank claim.'}});
 check('C1 projection adapter preserves complete reservations without treating intention as bank evidence',()=>{
  ensure();assert.equal(typeof api.adaptInvoiceReferenceEvidence,'function');
  const facts=deepFreeze(c1Facts()),before=structuredClone(facts),mapped=api.adaptInvoiceReferenceEvidence(facts);
  assert.deepEqual(mapped,{referenceClaims:['00042','OLD-00042'],issue:'',complete:true});assert.notStrictEqual(mapped.referenceClaims,facts.referencePolicyIdentifiers);assert.deepEqual(facts,before);
  assert.deepEqual(api.adaptInvoiceReferenceEvidence({invoice_number:'00042',reference:'00042'}),{referenceClaims:[],issue:'',complete:true});
 });
 check('unknown blocked incomplete or unsupported C1 projections hold proposals and preserve possible owners',()=>{
  ensure();assert.equal(typeof api.adaptInvoiceReferenceEvidence,'function');
  const changes=[f=>{f.referencePolicy.version='future-c1-v2';},f=>{f.referencePolicy.status='BLOCKED';},f=>{f.referencePolicy.status='VERIFIED';},f=>{f.referencePolicy.applies=false;},f=>{f.referencePolicy.source='explicit_invoice_reference';},f=>{f.referencePolicy.intendedPaymentReference='OTHER';},f=>{f.referencePolicy.invoiceNumber='OTHER';},f=>{f.referencePolicy.declaredPaymentReference='OTHER';},f=>{delete f.referencePolicy;},f=>{delete f.referencePolicyIdentifiers;},f=>{f.referencePolicyIdentifiers=['OLD-00042',42];},f=>{f.referencePolicyIdentifiers=['OLD-00042'];}];
  for(const change of changes){const facts=c1Facts();change(facts);const mapped=api.adaptInvoiceReferenceEvidence(facts);assert.ok(mapped.issue);assert.equal(mapped.complete,mapped.issue!=='C1_REFERENCE_POLICY_INVALID');assert.deepEqual(mapped.referenceClaims,Array.isArray(facts.referencePolicyIdentifiers)?facts.referencePolicyIdentifiers.filter(v=>typeof v==='string'&&v.length>0):[]);}
 });
 check('C1 projections cannot certify a census omitting known current decision or original references',async()=>{
  ensure();assert.equal(typeof api.adaptInvoiceReferenceEvidence,'function');
  for(const hold of [()=>{},f=>{f.referencePolicy.status='BLOCKED';},f=>{f.referencePolicy.applies=false;},f=>{f.referencePolicy.source='explicit_invoice_reference';}]){
   for(const omit of [f=>{f.referencePolicyIdentifiers=[];},f=>{f.referencePolicy.intendedPaymentReference='UNLISTED-ORIGINAL';},f=>{f.reference='UNLISTED-DECLARED';f.referencePolicy.declaredPaymentReference='UNLISTED-DECLARED';},f=>{f.referenceOriginal={invoice_number:'UNLISTED-ORIGINAL',reference:'00042'};},f=>{f.referenceOriginal={invoice_number:'00042',reference:'UNLISTED-ORIGINAL'};}]){
    const facts=c1Facts();hold(facts);omit(facts);const before=structuredClone(facts),mapped=api.adaptInvoiceReferenceEvidence(facts);
    assert.equal(mapped.complete,false);assert.equal(mapped.issue,'C1_REFERENCE_POLICY_INVALID');assert.deepEqual(facts,before);
    const input=reconciliationContractFixture();input.invoices.push({...structuredClone(input.invoices[0]),id:'held-claim-owner',number:'00043',referenceClaims:mapped.referenceClaims,referenceClaimsComplete:mapped.complete,evidenceIssue:mapped.issue});
    const item=decision(await build(input));assert.equal(item.status,'BLOCKED');assert.ok(item.reasonCodes.includes('INCOMPLETE_REFERENCE_OWNERSHIP'));assert.deepEqual(item.allocations,[]);
   }
  }
 });
 check('claimed original verification cannot mask absent hash or a bank conflict',async()=>{
  const changes=[input=>{input.transactions[0].original.sha256='';},input=>{input.transactions[0].original.sha256='not-a-sha256';},input=>{input.transactions[0].original.id='';},input=>{input.transactions[0].original.status='REVIEW';},input=>{input.transactions[0].conflict=true;},input=>{input.transactions[0].payerEvidence.conflict=true;}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const preview=await build(input);assert.equal(decision(preview).status,'BLOCKED');noAllocations(preview);}
 });
 check('account evidence is bound to owner account currency source and expiry',async()=>{
  const changes=[e=>{e.ownerId='another-owner';},e=>{e.accountId='ANOTHER-ACCOUNT';},e=>{e.currency='EUR';},e=>{e.source='missing';},e=>{e.proofId='';},e=>{e.validUntil=CHECKED_AT;},e=>{e.validUntil='invalid-date';}];
  for(const change of changes){const input=reconciliationContractFixture();change(input.transactions[0].accountEvidence);const preview=await build(input);assert.equal(decision(preview).status,'BLOCKED');noAllocations(preview);}
 });
 check('missing collective or manually supplied payer facts cannot be invented from the invoice',async()=>{
  const changes=[input=>{input.transactions[0].payerEvidence=null;},input=>{input.transactions[0].payerEvidence.scope='collective';},input=>{input.transactions[0].payerEvidence.origin='manual_observation';},input=>{input.transactions[0].payerEvidence.name=null;input.transactions[0].payerEvidence.organizationNumber='';input.transactions[0].payerEvidence.identifiers=[];}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const preview=await build(input),item=decision(preview);assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);assert.deepEqual(item.payer,input.transactions[0].payerEvidence);}
 });
 check('same customer name with contradictory organization identity blocks without an approved third-party relation',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].payerEvidence.organizationNumber='2222222222';input.transactions[0].payerEvidence.identifiers[0].value='2222222222';input.transactions[0].payerEvidence.identifiers[0].rawValue='2222222222';
  // The user contract treats this explicit identity contradiction as blocked;
  // a separately approved third-party relationship is covered in the next case.
  const item=decision(await build(input));assert.equal(item.status,'BLOCKED');assert.deepEqual(item.allocations,[]);assert.equal(item.payer.organizationNumber,'2222222222');
 });
 check('an approved third party remains a manual review and revocation removes its proposal',async()=>{
  const input=reconciliationContractFixture(),payer=input.transactions[0].payerEvidence;payer.name=nameField('Synthetic Third Party');payer.organizationNumber='2222222222';payer.identifiers=[{kind:'organization',scheme:'COID',issuer:'SE',value:'2222222222',rawValue:'2222222222',source:'$.debtor.organisation_id.identification'}];
  input.customerRelationships=[{id:'synthetic-customer-relation',invoiceId:'invoice-1',accountId:ACCOUNT,payerName:'Synthetic Third Party',payerOrganizationNumber:'2222222222',approved:true,active:true,evidence:'Synthetic recorded business review'}];
  const first=await build(input),item=decision(first);assert.equal(item.status,'REVIEW');assert.deepEqual(item.payer,payer);assert.equal(item.allocations.length,1);assert.equal(item.allocations[0].amountMinor,73100);
  for(const field of ['active','approved']){const revoked=structuredClone(input);revoked.customerRelationships[0][field]=false;const preview=await build(revoked);assert.notEqual(decision(preview).status,'VERIFIED');assert.deepEqual(decision(preview).allocations,[]);assert.notEqual(preview.snapshot.sha256,first.snapshot.sha256);}
 });
 check('conflicting incomplete or invalid OCR candidates cannot be hidden by an exact candidate',async()=>{
  const changes=[input=>{input.transactions[0].references.push(reference('UNRELATED-REFERENCE-99'));},input=>{input.transactions[0].referenceIncomplete=true;},input=>{input.transactions[0].references[0].kind='ocr';input.transactions[0].references[0].validity='checksum_invalid';}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const item=decision(await build(input));assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);assert.deepEqual(item.references,input.transactions[0].references);}
 });
 check('unreviewed voided future wrong-company and wrong-currency invoices cannot receive a proposal',async()=>{
  const changes=[i=>{i.reviewed=false;},i=>{i.voided=true;},i=>{i.issuedDate='2026-09-13';},i=>{i.companyId='another-company';},i=>{i.currency='EUR';},i=>{i.direction='payable';},i=>{i.evidenceIssue='Synthetic unresolved original';}];
  for(const change of changes){const input=reconciliationContractFixture();change(input.invoices[0]);const item=decision(await build(input));assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);}
  const malformed=reconciliationContractFixture();malformed.transactions[0].bookedDate='2026-09-31';const invalid=await build(malformed);assert.equal(invalid.status,'BLOCKED');noAllocations(invalid);
  const invalidClock=reconciliationContractFixture();invalidClock.checkedAt='not-a-time';const badClock=await build(invalidClock);assert.equal(badClock.status,'BLOCKED');noAllocations(badClock);
 });
 check('observations without any invoice remain explicit including missing evidence',async()=>{
  const input=reconciliationContractFixture();input.invoices=[];const first=await build(input),item=decision(first);assert.equal(item.status,'REVIEW');assert.deepEqual(item.candidateInvoiceIds,[]);assert.deepEqual(item.allocations,[]);assert.equal(item.unallocatedMinor,73100);
  input.transactions[0].original.status='BLOCKED';const blocked=await build(input);assert.equal(decision(blocked).status,'BLOCKED');assert.equal(blocked.decisions.length,1);noAllocations(blocked);
 });
 check('partial payment proposes only its available amount and leaves the invoice remainder',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].amountMinor=30000;
  const item=decision(await build(input));assert.equal(item.status,'REVIEW');assert.equal(item.bankEvidenceStatus,'VERIFIED');assert.equal(item.availableMinor,30000);assert.equal(item.unallocatedMinor,0);
  assert.deepEqual(item.allocations,[{invoiceId:'invoice-1',amountMinor:30000,currency:'SEK',invoiceRemainingBeforeMinor:73100,invoiceRemainingAfterMinor:43100,settlement:'partial'}]);
 });
 check('overpayment leaves excess unallocated without manufacturing credit or refund',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].amountMinor=80000;const before=structuredClone(input),item=decision(await build(input));
  assert.equal(item.status,'REVIEW');assert.equal(item.availableMinor,80000);assert.equal(item.unallocatedMinor,6900);
  assert.deepEqual(item.allocations,[{invoiceId:'invoice-1',amountMinor:73100,currency:'SEK',invoiceRemainingBeforeMinor:73100,invoiceRemainingAfterMinor:0,settlement:'excess'}]);assert.deepEqual(input,before);
 });
 check('explicit multi-invoice reference yields an exact reviewed split independent of invoice ordering',async()=>{
  const input=reconciliationContractFixture();input.invoices[0].totalMinor=30000;input.invoices.push({...input.invoices[0],id:'invoice-2',number:'00043',totalMinor:43100});input.transactions[0].references.push(reference('00043'));
  const first=decision(await build(input));assert.equal(first.status,'REVIEW');assert.equal(first.unallocatedMinor,0);
  const expected=[{invoiceId:'invoice-1',amountMinor:30000,currency:'SEK',invoiceRemainingBeforeMinor:30000,invoiceRemainingAfterMinor:0,settlement:'multiple'},{invoiceId:'invoice-2',amountMinor:43100,currency:'SEK',invoiceRemainingBeforeMinor:43100,invoiceRemainingAfterMinor:0,settlement:'multiple'}];
  assert.deepEqual([...first.allocations].sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId)),expected);input.invoices.reverse();assert.deepEqual([...decision(await build(input)).allocations].sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId)),expected);
 });
 check('active allocations and credits determine remaining balance while inactive allocations do not',async()=>{
  const input=reconciliationContractFixture();input.invoices[0].creditMinor=3100;input.transactions[0].amountMinor=50000;
  input.transactions.push({...structuredClone(input.transactions[0]),id:'historical-payment',bankId:'SYNTHETIC-HISTORICAL-PAYMENT',amountMinor:20000,original:{status:'VERIFIED',source:'bank_api',id:'synthetic-historical-original',sha256:'d'.repeat(64)}});
  input.allocations=[{id:'historical-allocation',invoiceId:'invoice-1',transactionId:'historical-payment',amountMinor:20000,active:true,effect:'payment'},{id:'inactive-allocation',invoiceId:'invoice-1',transactionId:'historical-payment',amountMinor:20000,active:false,effect:'payment'}];
  const preview=await build(input),item=decision(preview);assert.equal(item.status,'VERIFIED');assert.deepEqual(item.allocations,[{invoiceId:'invoice-1',amountMinor:50000,currency:'SEK',invoiceRemainingBeforeMinor:50000,invoiceRemainingAfterMinor:0,settlement:'full'}]);assert.equal(decision(preview,'historical-payment').availableMinor,0);assert.deepEqual(decision(preview,'historical-payment').allocations,[]);
  input.transactions[0].amountMinor=55000;input.transactions.push({...structuredClone(input.transactions[0]),id:'historical-refund',bankId:'SYNTHETIC-HISTORICAL-REFUND',amountMinor:-5000,original:{status:'VERIFIED',source:'bank_api',id:'synthetic-refund-original',sha256:'e'.repeat(64)}});input.allocations.push({id:'refund-allocation',invoiceId:'invoice-1',transactionId:'historical-refund',amountMinor:5000,active:true,effect:'refund'});
  const refunded=await build(input);assert.equal(decision(refunded).status,'VERIFIED');assert.deepEqual(decision(refunded).allocations,[{invoiceId:'invoice-1',amountMinor:55000,currency:'SEK',invoiceRemainingBeforeMinor:55000,invoiceRemainingAfterMinor:0,settlement:'full'}]);assert.equal(decision(refunded,'historical-refund').availableMinor,0);assert.deepEqual(decision(refunded,'historical-refund').allocations,[]);
 });
 check('fully allocated payment remains visible and cannot be spent again',async()=>{
  const input=reconciliationContractFixture();input.allocations=[{id:'allocated-once',invoiceId:'invoice-1',transactionId:'payment-1',amountMinor:73100,active:true,effect:'payment'}];
  const preview=await build(input),item=decision(preview);assert.equal(item.availableMinor,0);assert.equal(item.unallocatedMinor,0);assert.deepEqual(item.allocations,[]);
  input.transactions[0].original.status='BLOCKED';assert.equal(decision(await build(input)).status,'BLOCKED');assert.equal(input.allocations[0].amountMinor,73100);
 });
 check('competing payments cannot independently consume the same invoice balance',async()=>{
  const input=reconciliationContractFixture();input.transactions.push({...structuredClone(input.transactions[0]),id:'payment-2',bankId:'SYNTHETIC-BANK-PAYMENT-2',original:{status:'VERIFIED',source:'bank_api',id:'synthetic-bank-original-2',sha256:'d'.repeat(64)}});
  const preview=await build(input);assert.equal(decision(preview).status,'REVIEW');assert.equal(decision(preview,'payment-2').status,'REVIEW');
  const proposed=preview.decisions.flatMap(d=>d.allocations).reduce((sum,a)=>sum+a.amountMinor,0);assert.ok(proposed<=73100,'Competing proposals must not over-allocate one invoice');
 });
 check('reversal flags and undone-match holds prevent immediate rematching',async()=>{
  for(const change of [t=>{t.reversal=true;},t=>{t.holdReason='Synthetic prior allocation was undone';}]){const input=reconciliationContractFixture();change(input.transactions[0]);const item=decision(await build(input));assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);}
  const inherited=reportFixture();inherited.transactions[0].reversal=true;const item=decision(await build(inherited));assert.notEqual(item.status,'VERIFIED');assert.deepEqual(item.allocations,[]);
 });
 check('incomplete snapshots or imports cannot certify complete reconciliation',async()=>{
  const changes=[i=>{i.complete=false;},i=>{i.importJobs=[{id:'synthetic-import',status:'pending',complete:false}];},i=>{i.importJobs=[{id:'synthetic-import',status:'blocked',complete:false}];},i=>{i.importJobs=[{id:'synthetic-import',status:'complete',complete:false}];}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
 });
 check('money requires finite safe integers and valid nonnegative ledger components',async()=>{
  const changes=[i=>{i.transactions[0].amountMinor=0;},i=>{i.transactions[0].amountMinor=73100.5;},i=>{i.transactions[0].amountMinor='73100';},i=>{i.transactions[0].amountMinor=NaN;},i=>{i.transactions[0].amountMinor=Infinity;},i=>{i.transactions[0].amountMinor=Number.MAX_SAFE_INTEGER+1;},i=>{i.invoices[0].totalMinor=0;},i=>{i.invoices[0].creditMinor=-1;},i=>{i.invoices[0].creditMinor=73101;},i=>{i.allocations=[{id:'invalid-allocation',invoiceId:'invoice-1',transactionId:'payment-1',amountMinor:-1,active:true,effect:'payment'}];}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
 });
 check('individually safe allocations cannot overflow their combined transaction amount',async()=>{
  const input=reconciliationContractFixture();input.transactions[0].amountMinor=Number.MAX_SAFE_INTEGER;input.invoices[0].totalMinor=Number.MAX_SAFE_INTEGER;input.invoices.push({...input.invoices[0],id:'invoice-2',number:'00043'});
  input.allocations=[{id:'large-allocation',invoiceId:'invoice-1',transactionId:'payment-1',amountMinor:Number.MAX_SAFE_INTEGER-1,active:true,effect:'payment'},{id:'overflow-allocation',invoiceId:'invoice-2',transactionId:'payment-1',amountMinor:2,active:true,effect:'payment'}];
  const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);
 });
 check('duplicate record identifiers and duplicate active allocation pairs fail closed',async()=>{
  for(const key of ['transactions','invoices']){const input=reconciliationContractFixture();input[key].push(structuredClone(input[key][0]));const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
  for(const key of ['reports','relationships']){const input=reportFixture();input[key].push(structuredClone(input[key][0]));const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
  for(const id of ['same-id','different-id']){const input=reconciliationContractFixture();input.allocations=[{id:'same-id',invoiceId:'invoice-1',transactionId:'payment-1',amountMinor:1,active:true,effect:'payment'},{id,invoiceId:'invoice-1',transactionId:'payment-1',amountMinor:1,active:true,effect:'payment'}];const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
 });
 check('missing or cyclic payment ancestry blocks even a complete child original',async()=>{
  const missing=reconciliationContractFixture();missing.transactions[0].parentId='absent-parent';const one=await build(missing);assert.equal(decision(one).status,'BLOCKED');noAllocations(one);
  const cyclic=reportFixture();cyclic.transactions[0].parentId='payment-1';const two=await build(cyclic);assert.equal(decision(two).status,'BLOCKED');noAllocations(two);
  const damaged=reportFixture();damaged.transactions[0].original.status='BLOCKED';const three=await build(damaged);assert.equal(decision(three).status,'BLOCKED');noAllocations(three);
 });
 check('complete bank-identified report exposes only the individual economic payment',async()=>{
  const input=deepFreeze(reportFixture()),before=structuredClone(input),preview=await build(input),child=decision(preview),parent=decision(preview,'deposit-1');
  assert.equal(child.status,'VERIFIED');assert.equal(child.availableMinor,73100);assert.equal(child.allocations[0].amountMinor,73100);assert.equal(child.economic,true);
  assert.equal(parent.availableMinor,0);assert.equal(parent.economic,false);assert.deepEqual(parent.allocations,[]);assert.deepEqual(input,before);
 });
 check('report count total original and membership completeness are mandatory',async()=>{
  const changes=[i=>{delete i.reports[0].paymentCount;},i=>{i.reports[0].paymentCount=2;},i=>{i.reports[0].totalMinor=73101;},i=>{i.reports[0].paymentIds=[];},i=>{i.reports[0].paymentIds=['payment-1','payment-1'];},i=>{i.reports[0].paymentIds=['missing-payment'];},i=>{i.reports[0].original.status='BLOCKED';}];
  for(const change of changes){const input=reportFixture();change(input);const preview=await build(input);assert.equal(preview.status,'BLOCKED');assert.equal(decision(preview).status,'BLOCKED');noAllocations(preview);}
 });
 check('manual report relationship stays review and cannot promote report rows into money',async()=>{
  const input=reportFixture();input.transactions[0].economic=true;input.transactions[1].economic=false;input.relationships[0].method='manual_review';input.relationships[0].status='REVIEW';
  const preview=await build(input),parent=decision(preview,'deposit-1'),child=decision(preview);assert.equal(parent.status,'REVIEW');assert.equal(child.status,'REVIEW');assert.equal(parent.availableMinor,73100);assert.equal(child.availableMinor,0);assert.equal(child.unallocatedMinor,0);noAllocations(preview);
 });
 check('equal report amount and date never substitute for stable bank deposit identity',async()=>{
  const changes=[i=>{i.reports[0].bankDepositId='';},i=>{i.reports[0].bankDepositId='ANOTHER-DEPOSIT';},i=>{i.reports[0].accountId='ANOTHER-ACCOUNT';},i=>{i.reports[0].currency='EUR';},i=>{i.reports[0].bookedDate='2026-09-11';},i=>{i.relationships=[];},i=>{i.relationships[0].active=false;}];
  for(const change of changes){const input=reportFixture();change(input);const preview=await build(input);assert.equal(decision(preview).status,'BLOCKED');noAllocations(preview);}
 });
 check('a deposit and its report children cannot both remain economically spendable',async()=>{
  const input=reportFixture();input.transactions[0].economic=true;const preview=await build(input);assert.equal(preview.status,'BLOCKED');assert.ok([...preview.reasonCodes,...preview.decisions.flatMap(d=>d.reasonCodes)].includes('DOUBLE_COUNTED_DEPOSIT'));noAllocations(preview);
 });
 check('one stable bank identity with contradictory financial facts blocks all copies',async()=>{
  for(const [field,value]of [['amountMinor',73101],['currency','EUR'],['bookedDate','2026-09-11']]){const input=reconciliationContractFixture(),copy=structuredClone(input.transactions[0]);copy.id='conflicting-copy';copy[field]=value;input.transactions.push(copy);const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
 });
 check('reimported duplicate and ignored observations stay visible without restoring funds',async()=>{
  const input=reconciliationContractFixture();input.transactions.push({...structuredClone(input.transactions[0]),id:'duplicate-observation',duplicateOf:'payment-1',economic:false});
  const preview=await build(input),original=decision(preview),duplicate=decision(preview,'duplicate-observation');assert.equal(original.status,'VERIFIED');assert.equal(duplicate.availableMinor,0);assert.deepEqual(duplicate.allocations,[]);assert.equal(preview.decisions.length,2);assert.equal(preview.decisions.flatMap(d=>d.allocations).reduce((sum,a)=>sum+a.amountMinor,0),73100);
  const ignored=reconciliationContractFixture();ignored.transactions[0].ignored=true;const hidden=decision(await build(ignored));assert.equal(hidden.availableMinor,0);assert.deepEqual(hidden.allocations,[]);
 });
 check('missing claimed expired consumed or owner-mismatched approvals are rejected',async()=>{
  const preview=await build(reconciliationContractFixture());
  for(const approval of [null,undefined,true,{approved:true}])assert.equal(validate(preview,approval).valid,false);
  const changes=[a=>{a.source='browser_claim';},a=>{a.approved=false;},a=>{a.approvedBy='';},a=>{a.requestId='';},a=>{a.expiresAt='invalid';},a=>{a.expiresAt='2026-09-13T12:05:00.000Z';},a=>{a.decisions=[];}];
  for(const change of changes){const approval=approved(preview);change(approval);assert.equal(validate(preview,approval).valid,false);}
  assert.equal(validate(preview,approved(preview),{...context(),ownerId:'another-owner'}).valid,false);assert.equal(validate(preview,approved(preview),{...context(),consumedRequestIds:['synthetic-approval-request-1']}).valid,false);
 });
 check('approval binds exact version snapshot revision transaction invoice amount and currency',async()=>{
  const preview=await build(reconciliationContractFixture());
  const changes=[a=>{a.contractVersion='other-version';},a=>{a.ownerId='other-owner';},a=>{a.revision=8;},a=>{a.snapshotSha256='f'.repeat(64);},a=>{a.decisions[0].transactionId='other-payment';},a=>{a.decisions[0].allocations[0].invoiceId='other-invoice';},a=>{a.decisions[0].allocations[0].amountMinor=73101;},a=>{a.decisions[0].allocations[0].currency='EUR';},a=>{a.decisions.push(structuredClone(a.decisions[0]));},a=>{a.decisions[0].allocations.push(structuredClone(a.decisions[0].allocations[0]));}];
  for(const change of changes){const approval=approved(preview);change(approval);assert.equal(validate(preview,approval).valid,false);}
  const stale=approved(preview);stale.snapshotSha256='f'.repeat(64);assert.ok(validate(preview,stale).reasonCodes.includes('STALE_APPROVAL'));
 });
 check('new competing records raw originals policy or consent state invalidate an earlier snapshot',async()=>{
  const initial=await build(reconciliationContractFixture()),approval=approved(initial);
  const changes=[i=>{i.revision=8;},i=>{i.transactions[0].references[0].rawValue=' 00042 ';},i=>{i.transactions[0].payerEvidence.name.rawValue='Synthetic Customer A ';},i=>{i.transactions[0].original.sha256='b'.repeat(64);},i=>{i.referencePolicy.source='new-synthetic-policy';},i=>{i.evidenceContext.consentGeneration='synthetic-consent-v2';},i=>{i.transactions.push({...structuredClone(i.transactions[0]),id:'new-competing-payment',bankId:'NEW-SYNTHETIC-BANK-ID'});},i=>{i.customerRelationships=[{id:'new-relation',invoiceId:'invoice-1',accountId:ACCOUNT,payerName:'Other Synthetic Payer',payerOrganizationNumber:'',approved:false,active:false,evidence:'Synthetic historical relation'}];}];
  for(const change of changes){const input=reconciliationContractFixture();change(input);const preview=await build(input);assert.notEqual(preview.snapshot.sha256,initial.snapshot.sha256);const result=validate(preview,approval);assert.equal(result.valid,false);assert.ok(result.reasonCodes.includes('STALE_APPROVAL'));}
 });
 check('business approval cannot make a reviewed or blocked decision executable',async()=>{
  const partial=reconciliationContractFixture();partial.transactions[0].amountMinor=30000;const review=await build(partial),reviewApproval=approved(review);reviewApproval.decisions[0].allocations[0].amountMinor=30000;assert.equal(validate(review,reviewApproval).valid,false);
  const missing=reconciliationContractFixture();missing.transactions[0].original.status='BLOCKED';const blocked=await build(missing),blockedApproval=approved(blocked);blockedApproval.decisions[0].allocations=[];assert.equal(validate(blocked,blockedApproval).valid,false);
 });
 check('malformed arrays null records and scalar candidates return blocked previews rather than throwing',async()=>{
  for(const malformed of [null,undefined,[],42]){const preview=await build(malformed);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
  for(const field of ['transactions','invoices','allocations','reports','relationships','customerRelationships','importJobs']){
   for(const value of [null,{},[null]]){const input=reconciliationContractFixture();input[field]=value;const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
  }
  for(const value of [null,{},[null],[42]]){const input=reconciliationContractFixture();input.transactions[0].references=value;const preview=await build(input);assert.equal(preview.status,'BLOCKED');noAllocations(preview);}
 });
}
