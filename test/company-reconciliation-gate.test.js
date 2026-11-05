import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const url=new URL('../sites/lib/company-reconciliation-policy.js',import.meta.url);
const implementation=existsSync(url)?await import(url):{};
const at=Date.parse('2026-11-04T12:00:00Z');
const context=(mode='invoice_number')=>({
 companyId:'company-A',owner:'scope-A',connectionId:'connection-A',provider:'synthetic-bank',
 accountKey:'iban:SE4280000890119146168423',accountUid:'account-A',consentId:'consent-A',
 generation:'generation-1',revision:1,validUntil:'2099-01-01T00:00:00Z',authorizationStatus:'VERIFIED',
 ratePolicy:{verified:true,evidenceId:'synthetic-quota',maxRequests:3,windowMs:60000},bankgiroEnabled:false,
 scope:{companyId:'company-A',owner:'scope-A',evidenceId:'synthetic-scope',revision:1},
 referencePolicy:{companyId:'company-A',owner:'scope-A',revision:1,companyName:'Synthetic company A AB',mode,evidenceId:'synthetic-policy'},
});
const request={companyId:'company-A',connectionId:'connection-A',expectedGeneration:'generation-1',expectedRevision:1};
function gate(value=context(),wanted=request,owner='scope-A'){
 assert.equal(typeof implementation.companyReconciliationGate,'function','an explicit company-bound reconciliation gate is required');
 return implementation.companyReconciliationGate(wanted,value,{owner,now:at});
}
const code=value=>error=>error?.code===value;

test('company scope produces one exact policy without modifying or reusing legacy configuration',()=>{
 const current=context(),before=structuredClone(current),result=gate(current);
 assert.equal(result.referenceContext.company.name,'Synthetic company A AB');
 assert.equal(result.referenceContext.policies.length,1);
 assert.equal(result.referenceContext.policies[0].referenceSource,'invoice_number');
 assert.equal(result.referenceContext.companyReferenceMode,'invoice_number');
 assert.equal(result.scopeBindingRevision,1);assert.equal(result.dataScopeId,'scope-A');
 assert.deepEqual(current,before);
});

test('OCR policy selects only the explicit invoice OCR field',()=>{
 const result=gate(context('ocr'));
 assert.equal(result.referenceContext.policies[0].referenceSource,'explicit_reference');
 assert.equal(result.referenceContext.companyReferenceMode,'ocr');
});

for(const change of [
 value=>{delete value.scope;},
 value=>{value.scope.companyId='company-B';},
 value=>{value.scope.owner='scope-B';},
 value=>{value.scope.evidenceId='';},
 value=>{value.scope.revision=0;},
])test('unbound or foreign storage scope cannot relabel a legacy ledger: '+change.toString(),()=>{
 const current=context();change(current);assert.throws(()=>gate(current),code('COMPANY_SCOPE_MISMATCH'));
});
for(const change of [
 value=>{delete value.referencePolicy;},
 value=>{value.referencePolicy.companyId='company-B';},
 value=>{value.referencePolicy.owner='scope-B';},
 value=>{value.referencePolicy.evidenceId='';},
 value=>{value.referencePolicy.revision=0;},
 value=>{value.referencePolicy.mode='legacy_default';},
])test('missing or foreign reference configuration fails closed: '+change.toString(),()=>{
 const current=context();change(current);assert.throws(()=>gate(current),code('REFERENCE_POLICY_UNVERIFIED'));
});

test('request cannot replace the stored company, storage owner, or connection',()=>{
 assert.throws(()=>gate(context(),{...request,companyId:'company-B'}),code('COMPANY_SCOPE_MISMATCH'));
 assert.throws(()=>gate(context(),request,'scope-B'),code('COMPANY_SCOPE_MISMATCH'));
 assert.throws(()=>gate(context(),{...request,connectionId:'connection-B'}),code('AUTHORIZATION_CHANGED'));
 const result=gate(context(),{...request,owner:'scope-B',referencePolicy:context('ocr').referencePolicy});
 assert.equal(result.owner,'scope-A');assert.equal(result.referencePolicy.mode,'invoice_number');
});

test('renewed, expired, or unverified authority cannot allocate under an old request',()=>{
 assert.throws(()=>gate({...context(),generation:'generation-2'}),code('AUTHORIZATION_CHANGED'));
 assert.throws(()=>gate({...context(),revision:2}),code('AUTHORIZATION_CHANGED'));
 assert.throws(()=>gate({...context(),generation:1}),code('AUTHORIZATION_UNVERIFIED'));
 assert.throws(()=>gate({...context(),validUntil:'2026-11-04T11:59:59Z'}),code('CONSENT_EXPIRED'));
 assert.throws(()=>gate({...context(),authorizationStatus:'UNKNOWN'}),code('AUTHORIZATION_UNVERIFIED'));
});

test('OCR requires exact preserved original reference and a valid numeric checksum',()=>{
 assert.equal(typeof implementation.companyInvoiceReview,'function');
 const invoice={direction:'customer',reference:'000018'},review=implementation.companyInvoiceReview;
 assert.equal(review(invoice,[{reference:'000018'}],'ocr'),'');
 for(const [reference,originals]of [['',[{reference:''}]],['0599',[{reference:'0599'}]],['00001A',[{reference:'00001A'}]],['000018',[]],['000018',[{reference:'18'}]],['000018',[{reference:'000017'}]]]){
  assert.ok(review({...invoice,reference},originals,'ocr'));
 }
 assert.ok(review({...invoice,direction:'supplier'},[{reference:'000018'}],'ocr'));
 assert.equal(review({direction:'customer',reference:''},[],'invoice_number'),'');
});
