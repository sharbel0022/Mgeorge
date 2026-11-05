import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the same module that both runtimes consume. Missing exports should
// fail assertions in the initial RED run instead of hiding a broken fixture.
const api = await import('../sites/lib/company-contract.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const context = overrides => ({version:'company-context-v1',companyId:'company-a',storageOwner:'owner-a',actorId:'user-a',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1,...overrides});

test('company roles deny writes and management unless explicitly granted', () => {
  assert.equal(typeof api.hasCompanyPermission, 'function');
  for (const [role,action,allowed] of [
    ['owner','restore',true],['owner','manage_members',true],['admin','manage_integrations',true],
    ['admin','manage_reference_policy',true],['admin','manage_members',false],['admin','restore',false],
    ['accountant','write',true],['accountant','manage_company',false],['accountant','manage_integrations',false],
    ['viewer','read',true],['viewer','write',false],['viewer','manage_reference_policy',false],
    ['administrator','read',false],['owner','unknown_action',false],['__proto__','read',false],
  ]) assert.equal(api.hasCompanyPermission(role,action),allowed,`${role}:${action}`);
  assert.throws(()=>api.assertCompanyPermission('viewer','write'),{code:'COMPANY_FORBIDDEN',status:403});
});

test('company contexts are validated immutable snapshots, never coercing identities or versions', () => {
  assert.equal(typeof api.assertCompanyContext,'function');
  const input=context(), bound=api.assertCompanyContext(input);input.companyId='company-b';
  assert.equal(bound.companyId,'company-a');assert.ok(Object.isFrozen(bound));
  for(const bad of [{companyId:123},{companyId:'../company-b'},{storageOwner:'owner/a'},{actorId:''},{role:'root'},
    {membershipVersion:0},{companyVersion:-1},{contextVersion:'1'},{contextVersion:Infinity},{version:'company-context-v2'}]){
    assert.throws(()=>api.assertCompanyContext(context(bad)),{code:'COMPANY_CONTEXT_INVALID'});
  }
});

test('company cache identity separates actors, roles, companies, namespaces and revoked memberships', () => {
  assert.equal(typeof api.companyCacheKey,'function');
  const key=api.companyCacheKey(context());
  for(const changed of [{companyId:'company-b'},{storageOwner:'owner-b'},{actorId:'user-b'},{role:'viewer'},
    {membershipVersion:2},{companyVersion:2},{contextVersion:2}])assert.notEqual(api.companyCacheKey(context(changed)),key);
});

test('original and restore boundaries reject a different company even with identical owner or original hash', () => {
  assert.equal(typeof api.companyDataBoundary,'function');
  const original=api.companyDataBoundary(context());
  assert.deepEqual(original,{version:'company-data-boundary-v1',companyId:'company-a',storageOwner:'owner-a',boundaryVersion:1});
  assert.deepEqual(api.assertCompanyBoundary(original,context()),original);
  assert.throws(()=>api.assertCompanyBoundary(original,context({companyId:'company-b'})),{code:'COMPANY_BOUNDARY_MISMATCH'});
  assert.throws(()=>api.assertCompanyBoundary(original,context({storageOwner:'owner-b'})),{code:'COMPANY_BOUNDARY_MISMATCH'});
  assert.throws(()=>api.assertCompanyBoundary({...original,boundaryVersion:2},context()),{code:'COMPANY_BOUNDARY_INVALID'});
});

test('a background job stays with its original company and live membership after UI context changes',()=>{
  assert.equal(typeof api.pinCompanyJob,'function');
  const job=api.pinCompanyJob(context(),'job-a');assert.ok(Object.isFrozen(job));
  assert.doesNotThrow(()=>api.assertCompanyJob(context({contextVersion:2}),job));
  for(const changed of [{companyId:'company-b'},{storageOwner:'owner-b'},{actorId:'user-b'},
    {membershipVersion:2},{companyVersion:2},{role:'viewer'}]){
    assert.throws(()=>api.assertCompanyJob(context(changed),job),{code:'COMPANY_JOB_MISMATCH'});
  }
});

const policy=overrides=>({version:'company-reference-policy-v1',companyId:'company-a',policyVersion:1,mode:'invoice_number',updatedBy:'user-a',provenance:'Verified company instruction',...overrides});
test('reference policy is bound by company identity, preserves zeroes and never rewrites explicit evidence',()=>{
  assert.equal(typeof api.resolveCompanyReference,'function');
  const invoice={invoice_number:'0599',reference:'',direction:'customer'}, original=structuredClone(invoice);
  const result=api.resolveCompanyReference(invoice,{context:context(),companyName:'Synthetic A AB',policy:policy()});
  assert.equal(result.intendedPaymentReference,'0599');assert.equal(result.source,'invoice_number_policy');
  assert.equal(result.companyId,'company-a');assert.equal(result.policyVersion,1);assert.deepEqual(invoice,original);
  const conflict=api.resolveCompanyReference({...invoice,reference:'599'},{context:context(),companyName:'Synthetic A AB',policy:policy()});
  assert.equal(conflict.status,'BLOCKED');assert.equal(conflict.declaredPaymentReference,'599');
  const numeric=api.resolveCompanyReference({...invoice,invoice_number:599},{context:context(),companyName:'Synthetic A AB',policy:policy()});
  assert.equal(numeric.status,'BLOCKED');
  assert.throws(()=>api.resolveCompanyReference(invoice,{context:context({companyId:'company-b'}),companyName:'Synthetic A AB',policy:policy()}),{code:'COMPANY_BOUNDARY_MISMATCH'});
});

test('new company policy defaults to explicit reference and cannot silently adopt M.George settings',()=>{
  assert.equal(typeof api.resolveCompanyReference,'function');
  const result=api.resolveCompanyReference({invoice_number:'0599',reference:'',direction:'customer'},
    {context:context(),companyName:'M.George Vitvaror AB'});
  assert.equal(result.intendedPaymentReference,null);assert.equal(result.source,'none');
  const explicit=api.resolveCompanyReference({invoice_number:'0599',reference:'ABC-7',direction:'customer'},
    {context:context(),companyName:'Synthetic A AB',policy:policy({mode:'explicit_only'})});
  assert.equal(explicit.intendedPaymentReference,'ABC-7');assert.equal(explicit.source,'explicit_invoice_reference');
  for(const bad of [{mode:'ocr'},{companyId:1},{policyVersion:0},{provenance:''},{updatedBy:''}]){
    assert.throws(()=>api.validateCompanyReferencePolicy(policy(bad),context()));
  }
});
