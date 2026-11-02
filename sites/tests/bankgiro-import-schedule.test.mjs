import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBankgiroImportSchedule } from '../lib/bankgiro-import-schedule.js';

const now=Date.parse('2026-11-02T12:00:00.000Z');
const owner='synthetic-owner';
const source={id:'synthetic-report-source',adapterId:'synthetic-report-adapter'};
function fixture(overrides={}){
  let fetches=0,verifications=0;
  const evidence={owner,sourceId:source.id,status:'VERIFIED',origin:'provider_authorization',evidenceId:'synthetic-authorization-receipt',checkedAt:new Date(now).toISOString(),validUntil:'2026-11-03T12:00:00.000Z',capabilities:['bankgiro_reports:read'],...overrides};
  const adapter={verifySource:async()=>{verifications++;return evidence;},readReports:async()=>{fetches++;throw Error('The preparation must never fetch reports.');}};
  const adapters=new Map([[source.adapterId,adapter]]);
  return {adapters,adapter,counts:()=>({fetches,verifications})};
}

test('Bankgiro preparation is disabled and blocked when no real source is configured',async()=>{
  const result=await prepareBankgiroImportSchedule({owner,now,requestedEnabled:true});
  assert.equal(result.enabled,false);assert.equal(result.activationAllowed,false);
  assert.equal(result.jobStatus.state,'blocked');assert.equal(result.jobStatus.errorCode,'source_not_configured');
  assert.equal(result.timezone,'Europe/Stockholm');assert.equal(result.intervalMinutes,60);
  assert.equal(result.externalScheduleCreated,false);
});

test('configuration alone and a missing acquisition adapter cannot authorize report downloading',async()=>{
  const f=fixture();
  const absent=await prepareBankgiroImportSchedule({owner,source,now,requestedEnabled:true});
  assert.equal(absent.jobStatus.errorCode,'source_adapter_unavailable');assert.equal(absent.enabled,false);
  delete f.adapter.readReports;
  const missing=await prepareBankgiroImportSchedule({owner,source,now,adapters:f.adapters,requestedEnabled:true});
  assert.equal(missing.jobStatus.errorCode,'source_adapter_unavailable');assert.equal(missing.enabled,false);
});

test('fresh owner-bound source authorization permits a prepared plan but does not create or run it',async()=>{
  const f=fixture();
  const paused=await prepareBankgiroImportSchedule({owner,source,now,adapters:f.adapters});
  assert.equal(paused.activationAllowed,true);assert.equal(paused.enabled,false);assert.equal(paused.jobStatus.state,'paused');
  const ready=await prepareBankgiroImportSchedule({owner,source,now,adapters:f.adapters,requestedEnabled:true});
  assert.equal(ready.enabled,true);assert.equal(ready.jobStatus.state,'queued');assert.equal(ready.jobStatus.evidenceStatus,'REVIEW');
  assert.deepEqual(f.counts(),{fetches:0,verifications:2});
  assert.equal(ready.externalScheduleCreated,false);assert.equal(ready.jobStatus.lastSuccessAt,null);
});

test('owner/source mismatch, manual evidence and AIS capability never enable scheduled Bankgiro import',async()=>{
  for(const overrides of [
    {owner:'another-owner'}, {sourceId:'another-source'}, {status:'REVIEW'},
    {origin:'manual_attestation'}, {capabilities:['ais_transactions:read']}, {evidenceId:''},
  ]){
    const f=fixture(overrides);const result=await prepareBankgiroImportSchedule({owner,source,adapters:f.adapters,requestedEnabled:true,now});
    assert.equal(result.enabled,false,JSON.stringify(overrides));assert.equal(result.jobStatus.evidenceStatus,'BLOCKED');
    assert.equal(f.counts().fetches,0);
  }
});

test('expired, stale, future and malformed authorization is blocked on every preparation',async()=>{
  for(const overrides of [
    {validUntil:'2026-11-02T12:00:00.000Z'}, {validUntil:'invalid'},
    {checkedAt:'2026-11-02T11:50:00.000Z'}, {checkedAt:'2026-11-02T12:00:01.000Z'},
  ]){
    const f=fixture(overrides);const result=await prepareBankgiroImportSchedule({owner,source,adapters:f.adapters,requestedEnabled:true,now});
    assert.equal(result.enabled,false);assert.equal(result.jobStatus.errorCode,'source_evidence_expired');
  }
});

test('provider verification failure is sanitized and never enables a plan',async()=>{
  const f=fixture();f.adapter.verifySource=async()=>{throw Error('https://provider.example?secret=private');};
  const result=await prepareBankgiroImportSchedule({owner,source,adapters:f.adapters,requestedEnabled:true,now});
  assert.equal(result.enabled,false);assert.equal(result.jobStatus.errorCode,'source_not_authorized');
  assert.doesNotMatch(JSON.stringify(result),/provider\.example|secret|private|synthetic-authorization-receipt/);
});

test('a prolonged verification cannot activate authorization which expired while awaiting its response',async()=>{
  const f=fixture({validUntil:'2026-11-02T12:01:00.000Z'});let current=now;
  const verify=f.adapter.verifySource;f.adapter.verifySource=async input=>{const result=await verify(input);current+=120000;return result;};
  const result=await prepareBankgiroImportSchedule({owner,source,adapters:f.adapters,requestedEnabled:true,now:()=>current});
  assert.equal(result.enabled,false);assert.equal(result.jobStatus.errorCode,'source_evidence_expired');
});
