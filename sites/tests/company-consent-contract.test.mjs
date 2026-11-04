import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../lib/bank-consent-policy.js';

const context=(role='owner')=>({version:'company-context-v1',companyId:'company-a',storageOwner:'owner-a',actorId:'actor-a',role,membershipVersion:3,companyVersion:2,contextVersion:7});
for(const role of ['owner','admin','accountant','viewer'])test('consent accepts canonical numeric current membership for '+role+' reads',()=>{
 const c={...context(role),storageOwnerId:'owner-a',active:true};
 assert.equal(policy.assertCompanyBankAccess(c,{actorId:'actor-a',companyId:'company-a',action:'read'}),c);
});
test('company bank context preserves actual company, actor, owner and generations',()=>{
 const c=context(),mapped=policy.companyBankContext(c,'actor-a','company-a','manage');
 assert.equal(mapped.companyId,'company-a');assert.equal(mapped.actorId,'actor-a');assert.equal(mapped.storageOwnerId,'owner-a');
 for(const key of ['membershipVersion','companyVersion','contextVersion'])assert.equal(mapped[key],c[key]);
 assert.equal(Object.isFrozen(mapped),true);
});
for(const role of ['accountant','viewer'])test('current '+role+' cannot manage bank consent',()=>{
 assert.throws(()=>policy.companyBankContext(context(role),'actor-a','company-a','manage'),{code:'COMPANY_ACCESS_DENIED'});
});
test('company bank context refuses foreign selectors, actor and malformed generations',()=>{
 for(const [c,actor,id] of [[context(),'actor-b','company-a'],[context(),'actor-a','company-b'],[{...context(),membershipVersion:0},'actor-a','company-a']])
  assert.throws(()=>policy.companyBankContext(c,actor,id,'read'),{code:'COMPANY_ACCESS_DENIED'});
});
test('a real company cannot fall back to the legacy workspace ID',()=>{
 assert.throws(()=>policy.companyBankContext(context(),'actor-a','workspace:actor-a','read'),{code:'COMPANY_ACCESS_DENIED'});
 assert.equal(policy.companyBankContext(context(),'actor-a',undefined,'read').companyId,'company-a');
});
test('only absent server company context uses the retained legacy mapping',()=>{
 assert.deepEqual(policy.companyBankContext(null,'legacy-actor',undefined,'read'),policy.legacyCompanyContext('legacy-actor'));
 assert.throws(()=>policy.companyBankContext(null,'legacy-actor','company-a','read'),{code:'COMPANY_ACCESS_DENIED'});
});
