import test from 'node:test';
import assert from 'node:assert/strict';
import {companyReferencePolicyFromWorkspace,companyInvoiceReview} from '../sites/lib/company-reconciliation-policy.js';
const context={version:'company-context-v1',companyId:'company-a',storageOwner:'scope-a',actorId:'owner-a',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1};
const workspace=source=>({company:{id:'forged-profile-id',name:'Synthetic A AB',invoiceReferencePolicies:[{version:'invoice-reference-policy-v1',id:'reference-a',companyName:'Synthetic A AB',referenceSource:source,direction:'customer',matchMode:'exact'}]}});
test('stored company reference settings preserve explicit references without claiming formal OCR',()=>{
 const policy=companyReferencePolicyFromWorkspace(context,workspace('explicit_reference'));
 assert.equal(policy.companyId,'company-a');assert.equal(policy.owner,'scope-a');assert.equal(policy.mode,'explicit_only');
 assert.equal(companyInvoiceReview({direction:'customer',reference:'0000599'},[{reference:'0000599'}],policy.mode),'');
 assert.notEqual(companyInvoiceReview({direction:'customer',reference:'0000599'},[{reference:'599'}],policy.mode),'');
 assert.notEqual(companyInvoiceReview({direction:'customer',reference:'0000599'},[{reference:'0000599'}],'ocr'),'');
});
test('reference settings have a stable revision until the actual company rule changes',()=>{
 const first=companyReferencePolicyFromWorkspace(context,workspace('explicit_reference'));
 assert.deepEqual(companyReferencePolicyFromWorkspace(context,workspace('explicit_reference'),first),first);
 const next=companyReferencePolicyFromWorkspace(context,workspace('invoice_number'),first);
 assert.equal(next.revision,first.revision+1);assert.notEqual(next.evidenceId,first.evidenceId);
 assert.throws(()=>companyReferencePolicyFromWorkspace({...context,companyId:'company-b'},workspace('invoice_number'),first),{code:'COMPANY_SCOPE_MISMATCH'});
});
test('missing or ambiguous company policy never adopts the legacy M.George default',()=>{
 assert.equal(companyReferencePolicyFromWorkspace(context,{company:{name:'Synthetic A AB',invoiceReferencePolicies:[]}}),null);
 const foreign=workspace('invoice_number');foreign.company.name='Synthetic B AB';assert.equal(companyReferencePolicyFromWorkspace(context,foreign),null);
 const bad=workspace('invoice_number');bad.company.invoiceReferencePolicies.push({...bad.company.invoiceReferencePolicies[0],id:'duplicate'});
 assert.throws(()=>companyReferencePolicyFromWorkspace(context,bad),{code:'REFERENCE_POLICY_UNVERIFIED'});
});
