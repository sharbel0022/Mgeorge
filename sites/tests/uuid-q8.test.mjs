import test from 'node:test';
import assert from 'node:assert/strict';
import {uid,demoState} from '../lib/domain.ts';
import {createWorkspaceHistory} from '../lib/workspace-location.ts';

const uuid4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function useCrypto(t,value){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 Object.defineProperty(globalThis,'crypto',{configurable:true,value});
 t.after(()=>Object.defineProperty(globalThis,'crypto',previous));
}
function browser(){
 const value=new EventTarget();value.location=new URL('http://workspace.example/?view=bank');
 value.history={state:{framework:'preserved'},replaceState(state,unused,href){this.state=state;value.location=new URL(href,value.location);},pushState(state,unused,href){this.replaceState(state,unused,href);}};
 return value;
}

test('actual workspace history initializes without randomUUID when browser cryptographic bytes are available',t=>{
 let reads=0;useCrypto(t,{getRandomValues(bytes){reads++;assert.equal(bytes.length,16);return bytes.fill(255);}});
 const window=browser(),seen=[],history=createWorkspaceHistory(window,(location,reason)=>seen.push([location.view,reason]));
 assert.equal(window.history.state.__mg_workspace.session,'ffffffff-ffff-4fff-bfff-ffffffffffff');
 assert.equal(window.history.state.framework,'preserved');assert.equal(reads,1);assert.deepEqual(seen,[['bank','initial']]);
 assert.equal(history.navigate('settings'),true);assert.equal(window.location.search,'?view=settings');assert.equal(reads,1);assert.equal(window.history.state.__mg_workspace.index,1);
 history.dispose();
});
test('domain ID fallback sets the exact UUID version and variant bits from 16 cryptographic bytes',t=>{
 let fill=0,reads=0;useCrypto(t,{getRandomValues(bytes){reads++;assert.equal(bytes.length,16);return bytes.fill(fill);}});
 assert.equal(uid(),'00000000-0000-4000-8000-000000000000');fill=255;
 assert.equal(uid(),'ffffffff-ffff-4fff-bfff-ffffffffffff');assert.equal(reads,2);
});
test('fallback generates distinct UUID-shaped domain and actual demo identifiers using real cryptographic bytes',t=>{
 const nativeCrypto=globalThis.crypto;let reads=0;
 useCrypto(t,{getRandomValues(bytes){reads++;return nativeCrypto.getRandomValues(bytes);}});
 const generated=Array.from({length:1024},()=>uid()),state=demoState();
 const demoIds=[...state.invoices,...state.transactions,...state.allocations,...state.credits,...state.imports].map(row=>row.id),all=[...generated,...demoIds];
 assert.ok(demoIds.length>5);for(const id of all)assert.match(id,uuid4);assert.equal(new Set(all).size,all.length);assert.equal(reads,all.length);
});
test('native randomUUID remains preferred and is called with its Crypto receiver',t=>{
 const expected='12345678-1234-4234-8234-123456789abc';let calls=0;
 const secure={randomUUID(){assert.equal(this,secure);calls++;return expected;},getRandomValues(){throw Error('Native UUID must not request fallback bytes');}};useCrypto(t,secure);
 assert.equal(uid(),expected);const window=browser(),history=createWorkspaceHistory(window,()=>{});assert.equal(window.history.state.__mg_workspace.session,expected);assert.equal(calls,2);history.dispose();
});
test('missing cryptographic entropy fails closed instead of using Math.random',t=>{
 useCrypto(t,{});t.mock.method(Math,'random',()=>{throw Error('Insecure entropy must never be used');});
 assert.throws(()=>uid(),TypeError);assert.throws(()=>createWorkspaceHistory(browser(),()=>{}),TypeError);
});
