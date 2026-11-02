import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const path=new URL('../lib/banking/account-read-cooldown.ts',import.meta.url);
const helpers=existsSync(path)?await import(path):{};
const at=Date.parse('2026-11-02T10:00:00.000Z');
const known={status:'known',checkedAt:'2026-11-02T09:00:00.000Z',notBefore:'2026-11-02T12:00:00.000Z',provenance:'retry_after_seconds'};
const unknown={status:'unknown',checkedAt:'2026-11-02T09:00:00.000Z',provenance:'retry_after_missing'};

test('only an empty guard or an expired explicit deadline permits account reads',()=>{
 assert.equal(typeof helpers.accountReadCooldown,'function');
 assert.equal(helpers.accountReadCooldown('',at).blocked,false);
 assert.equal(helpers.accountReadCooldown(JSON.stringify(known),at).blocked,true);
 assert.equal(helpers.accountReadCooldown(JSON.stringify(known),Date.parse(known.notBefore)).blocked,false);
 assert.equal(helpers.accountReadCooldown(JSON.stringify(unknown),at+10*86400000).blocked,true);
});
test('missing, malformed and forged persisted diagnostics fail closed',()=>{
 assert.equal(typeof helpers.accountReadCooldown,'function');
 for(const value of [undefined,null,'broken','{}','null',JSON.stringify({...known,notBefore:'bad'}),JSON.stringify({...known,notBefore:'2000-01-01T00:00:00.000Z'}),JSON.stringify({...known,notBefore:'2099-01-01T00:00:00.000Z'}),JSON.stringify({...known,private:'secret'}),JSON.stringify({...unknown,status:'known'})]){
  const out=helpers.accountReadCooldown(value,at);assert.equal(out.blocked,true);assert.equal(out.retryAdvice,null);
 }
});
test('a later successful sync cannot erase an unknown account cooldown',()=>{
 assert.equal(typeof helpers.mergeAccountReadCooldown,'function');
 const saved=JSON.stringify(unknown);assert.equal(helpers.mergeAccountReadCooldown(saved,null),saved);
 assert.equal(helpers.mergeAccountReadCooldown(saved,known),saved);
 assert.equal(helpers.mergeAccountReadCooldown('broken',known),'broken');
});
test('merging a retry preserves the longer known wait and never weakens an unknown or manual block',()=>{
 assert.equal(typeof helpers.mergeAccountReadCooldown,'function');
 const later={...known,notBefore:'2026-11-03T12:00:00.000Z'},manual={status:'manual_block',checkedAt:known.checkedAt,provenance:'retry_after_exceeds_limit'};
 assert.deepEqual(JSON.parse(helpers.mergeAccountReadCooldown(JSON.stringify(later),known)),later);
 assert.deepEqual(JSON.parse(helpers.mergeAccountReadCooldown(JSON.stringify(known),later)),later);
 assert.deepEqual(JSON.parse(helpers.mergeAccountReadCooldown(JSON.stringify(known),unknown)),unknown);
 assert.deepEqual(JSON.parse(helpers.mergeAccountReadCooldown(JSON.stringify(manual),known)),manual);
 assert.deepEqual(JSON.parse(helpers.mergeAccountReadCooldown('',known)),known);
});
