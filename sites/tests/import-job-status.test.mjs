import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportJobStatus } from '../lib/import-job-status.js';

const now = Date.parse('2026-11-02T12:00:00.000Z');
const previous = '2026-11-02T11:00:00.000Z';
const attempt = '2026-11-02T11:59:00.000Z';
const future = '2026-11-02T12:01:00.000Z';
const status = input => createImportJobStatus({jobType:'gmail_sync',state:'queued',...input},{now});

test('the operational contract separates attempts, committed success and live ownership', () => {
  const result = status({state:'running',lastAttemptAt:attempt,lastSuccessAt:previous,leaseExpiresAt:future,attemptCount:4,fenceVersion:8});
  assert.deepEqual(result,{contractVersion:'1.0',jobType:'gmail_sync',state:'running',evidenceStatus:'REVIEW',lastAttemptAt:attempt,lastSuccessAt:previous,nextAttemptAt:null,leaseExpiresAt:future,running:true,attemptCount:4,fenceVersion:8,errorCode:null});
});

test('expired and missing leases never report a running worker', () => {
  for(const leaseExpiresAt of [previous,null,'invalid',now]){
    const result=status({state:'running',leaseExpiresAt,lastSuccessAt:previous});
    assert.equal(result.running,false);assert.equal(result.state,'retry_wait');assert.equal(result.errorCode,'lease_lost');
    assert.equal(result.lastSuccessAt,previous);
  }
});

test('success requires a committed timestamp and cannot hide a newer failed attempt', () => {
  for(const lastSuccessAt of [null,'invalid',future]){
    const result=status({state:'succeeded',lastSuccessAt});
    assert.equal(result.state,'blocked');assert.equal(result.errorCode,'success_unverified');
  }
  const stale=status({state:'succeeded',lastSuccessAt:previous,lastAttemptAt:attempt});
  assert.equal(stale.state,'retry_wait');assert.equal(stale.errorCode,'integration_interrupted');
  assert.equal(status({state:'succeeded',lastAttemptAt:previous,lastSuccessAt:attempt}).state,'succeeded');
});

test('pause and provider waiting preserve the previous successful result', () => {
  for(const state of ['paused','retry_wait','blocked','failed']){
    const result=status({state,lastSuccessAt:previous,lastAttemptAt:attempt,nextAttemptAt:future,errorCode:'rate_limited'});
    assert.equal(result.lastSuccessAt,previous);assert.equal(result.nextAttemptAt,future);assert.equal(result.running,false);
    assert.equal(result.evidenceStatus,['blocked','failed'].includes(state)?'BLOCKED':'REVIEW');
  }
});

test('unknown counters and transition timestamps remain unknown rather than becoming heartbeats', () => {
  const result=status({lastAttemptAt:future,lastSuccessAt:0,attemptCount:-1,fenceVersion:NaN,worker_seen:attempt,updated_at:attempt});
  assert.equal(result.lastAttemptAt,null);assert.equal(result.lastSuccessAt,null);assert.equal(result.attemptCount,null);assert.equal(result.fenceVersion,null);
});

test('the contract omits arbitrary payloads and sanitizes errors without claiming bank VERIFIED', () => {
  const result=status({state:'succeeded',lastSuccessAt:attempt,evidenceStatus:'VERIFIED',errorCode:'https://private.example/?token=secret',tokens:'secret',lease:'private-token',account:'synthetic-account',provider:{ocr:'0599'}});
  assert.equal(result.evidenceStatus,'REVIEW');assert.equal(result.errorCode,'job_failed');
  assert.doesNotMatch(JSON.stringify(result),/secret|private-token|synthetic-account|0599|https:|VERIFIED/);
  assert.equal(status({errorCode:'BANK_RATE_LIMIT'}).errorCode,'provider_rate_limited');
  assert.equal(status({errorCode:'retry_after_unknown'}).errorCode,'retry_after_unknown');
});

test('unknown lifecycle values fail closed and unknown job types are rejected', () => {
  assert.equal(status({state:'made_up'}).state,'blocked');
  assert.equal(status({state:'made_up'}).errorCode,'invalid_status');
  assert.throws(()=>status({jobType:'invented_provider'}),/job type/i);
});

test('a normalized impossible calendar date cannot be successful execution evidence',()=>{
  const result=status({state:'succeeded',lastSuccessAt:'2026-02-30T12:00:00.000Z'});
  assert.equal(result.lastSuccessAt,null);assert.equal(result.state,'blocked');
});
