import test from 'node:test';
import assert from 'node:assert/strict';
import { companyFixture } from './helpers/company-storage-fixture.mjs';
import { changeCompanyMembership, companyDirectory, selectCompany } from '../lib/company-storage.js';
import { onboardingDirectory, onboardingCsrf, assertOnboardingMutation, csrfCookieName } from '../lib/onboarding/directory-adapter.ts';
import { createOnboardingCompany } from '../lib/onboarding/provisioning.js';
import { parseDirectory } from '../lib/onboarding/contract.ts';
const cookie = 'a'.repeat(64);
test('real foundation catalogue maps current selection and unknown organization without leaking storage owner', async t => {
 const f = companyFixture(t); await f.create('company-a'); await f.create('company-b');
 const before = await companyDirectory(f.raw,'actor-a'); await selectCompany(f.raw,'actor-a','company-b',before.contextVersion);
 const mapped = parseDirectory(onboardingDirectory(await companyDirectory(f.raw,'actor-a'),await onboardingCsrf('actor-a',cookie)));
 assert.equal(mapped.activeCompanyId,'company-b'); assert.equal(mapped.contextVersion,2); assert.equal(mapped.companies[0].organizationNumber,null);
 assert.ok(!JSON.stringify(mapped).includes('storageOwner')); assert.ok(mapped.companies.every(c=>c.role==='owner'));
});
test('foundation company registration is idempotent across retries and rejects key reuse for changed name', async t => {
 const f=companyFixture(t), body={name:'Synthetic empty company'}, key='synthetic-key-123456789';
 const first=await createOnboardingCompany(f.raw,'actor-a',body,key);
 const second=await createOnboardingCompany(f.raw,'actor-a',body,key);
 assert.equal(first.id,second.id); assert.equal((await companyDirectory(f.raw,'actor-a')).companies.length,1);
 await assert.rejects(createOnboardingCompany(f.raw,'actor-a',{name:'Different'},key),e=>e.status===409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM workspaces').get().n,1);
});
test('different authenticated actors never share deterministic registration resources', async t => {
 const f=companyFixture(t), key='synthetic-key-123456789';
 const a=await createOnboardingCompany(f.raw,'actor-a',{name:'A'},key),b=await createOnboardingCompany(f.raw,'actor-b',{name:'B'},key);
 assert.notEqual(a.id,b.id);assert.deepEqual((await companyDirectory(f.raw,'actor-a')).companies.map(c=>c.id),[a.id]);
});
test('CSRF checks same origin, actor binding, exact cookie and JSON idempotency header before writes', async()=>{
 const token=await onboardingCsrf('actor-a',cookie);
 const make=overrides=>new Request('https://example.test/api/onboarding/companies',{method:'POST',headers:{origin:'https://example.test',cookie:`${csrfCookieName}=${cookie}`,'x-csrf-token':token,'content-type':'application/json','idempotency-key':'synthetic-key-123456789',...overrides}});
 await assertOnboardingMutation(make(),'actor-a');
 await assert.rejects(assertOnboardingMutation(make(),'actor-b'),e=>e.status===403);
 for(const headers of [{origin:'https://evil.test'},{cookie:''},{cookie:`${csrfCookieName}=${cookie}; ${csrfCookieName}=${cookie}`},{'x-csrf-token':'fabricated'}])await assert.rejects(assertOnboardingMutation(make(headers),'actor-a'),e=>e.status===403);
 for(const headers of [{'content-type':'text/plain'},{'idempotency-key':''}])await assert.rejects(assertOnboardingMutation(make(headers),'actor-a'),e=>e.status===400);
});
test('accountant role remains read-only in onboarding and unknown legal identity stays explicitly unknown', async t=>{
 const f=companyFixture(t);await f.create('company-a');await changeCompanyMembership(f.raw,await f.scope(),{actorId:'actor-b',role:'accountant',status:'active'});
 const d=parseDirectory(onboardingDirectory(await companyDirectory(f.raw,'actor-b'),'synthetic-csrf-token-0123456789'));
 assert.equal(d.companies[0].role,'accountant');assert.equal(d.companies[0].organizationNumber,null);
 const {mutationAllowed}=await import('../lib/onboarding/client.ts');const {snapshotFixture}=await import('./helpers/saas-onboarding-fixture.mjs');
 for(const action of ['connect','renew','disconnect','accounts','sync'])assert.equal(mutationAllowed(snapshotFixture(),'accountant',action),false);
});
test('actual consent runtime disabled snapshot satisfies browser contract without provider access or fake availability', async()=>{
 const {createSaasBankRuntime}=await import('../lib/banking/saas-bank-runtime.js');
 const {parseSnapshot}=await import('../lib/onboarding/contract.ts');
 const context={version:'company-context-v1',companyId:'company-a',storageOwner:'company:synthetic',actorId:'actor-a',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1};let reads=0;
 const runtime=createSaasBankRuntime({context,config:null,registration:null,enabled:false,store:{async read(){reads++;return{revision:0,value:null};},async compareAndSet(){throw Error('Unexpected write');}},codec:{},assertCurrent:async()=>{},requestKey:'synthetic-idempotency-123',sessionHash:'synthetic-session',redirectUri:'https://example.test/api/companies/company-a/bank/callback'});
 const s=parseSnapshot(await runtime.snapshot(),'company-a');assert.equal(reads,1);assert.equal(s.sync.state,'blocked');assert.equal(s.sync.errorCode,'configuration_required');assert.deepEqual(s.banks,[]);assert.deepEqual(s.accounts,[]);assert.deepEqual(s.payments,[]);assert.equal(s.connection,null);assert.ok(Object.values(s.actions).every(value=>value===false));
 await assert.rejects(runtime.start({bankId:'guessed',expectedRevision:0}),e=>e.code==='SAAS_BANK_DISABLED');
});
