import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpsBankgiroSource} from '../lib/bankgiro-http-source.js';
const time=Date.parse('2026-11-04T12:00:00Z'),scopes=['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate'];
const authority=()=>({status:'VERIFIED',origin:'provider_authorization',evidenceId:'synthetic-evidence',checkedAt:new Date(time).toISOString(),validUntil:new Date(time+60000).toISOString(),capabilities:[...scopes]});
const registration=()=>({id:'source',owner:'owner',companyId:'company',bankgiro:'1234567',accountId:'account-a',iban:'SE4280000890119146168423',scopeId:'scope',generation:'generation',profileId:'openpayments-bankgiro-v1',mode:'production',enabled:true,transport:'https-v1',baseUrl:'https://synthetic.example.com',tokenSecret:'TOKEN',allowedFormats:['json'],intervalMinutes:15,entitlement:authority()});
const receipt=r=>({...authority(),owner:r.owner,sourceId:r.id,companyId:r.companyId,bankgiro:r.bankgiro,accountId:r.accountId,iban:r.iban,scopeId:r.scopeId,generation:r.generation,profileId:r.profileId});
function source({reg=registration(),remote,filename='report.opbg.json'}={}){
 return createHttpsBankgiroSource({registration:reg,token:'synthetic-token',now:()=>time,fetchImpl:async url=>Response.json(url.endsWith('/v1/authorization')?remote||receipt(reg):{reports:[{reportId:'report',filename,sha256:'a'.repeat(64)}],nextCursor:null})});
}
test('a specifically authorized capture bridge admits only the Open Payments JSON profile',async()=>{
 const s=source(),authorization=await s.authorize({owner:'owner'}),page=await s.listReports({owner:'owner',authorization});
 assert.equal(page.reports[0].filename,'report.opbg.json');
 for(const filename of ['report.json','report.csv','report.xml']){
  const other=source({filename}),auth=await other.authorize({owner:'owner'});
  await assert.rejects(()=>other.listReports({owner:'owner',authorization:auth}),{code:'INVALID_PAGE'});
 }
});
test('capture registration requires both the concrete provider profile and its corporate enrichment scopes',()=>{
 for(const change of [r=>r.profileId='generic-json',r=>r.entitlement.capabilities=['bankgiro_reports:read'],r=>r.allowedFormats=['json','xml']]){
  const reg=registration();change(reg);assert.throws(()=>source({reg}),{code:'AUTHORIZATION_BLOCKED'});
 }
});
test('a fresh AIS-only remote receipt cannot authorize a Bankgiro capture profile',async()=>{
 const reg=registration(),remote=receipt(reg);remote.capabilities=['bankgiro_reports:read','accountinformation','corporate'];
 const s=source({reg,remote});await assert.rejects(()=>s.authorize({owner:'owner'}),{code:'AUTHORIZATION_BLOCKED'});
});
test('provider account binding is required and cannot change in a remote receipt',async()=>{
 const absent=registration();delete absent.accountId;assert.throws(()=>source({reg:absent}),{code:'AUTHORIZATION_BLOCKED'});
 for(const patch of [{accountId:'account-b'},{iban:'SE3550000000054910000003'}]){
  const reg=registration(),s=source({reg,remote:{...receipt(reg),...patch}});
  await assert.rejects(()=>s.authorize({owner:'owner'}),{code:'AUTHORIZATION_BLOCKED'});
 }
 const s=source(),auth=await s.authorize({owner:'owner'});assert.equal(auth.accountId,'account-a');assert.equal(auth.iban,registration().iban);
});
