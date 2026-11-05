import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualMultipleClient} from '../../sites/lib/manual-multiple-client.js';
import {candidates,quote,selection,receipt,storage} from '../helpers/manual-multiple-client-cases.mjs';
const missing=()=>Object.assign(Error('Temporarily absent'),{status:404,code:'MANUAL_RECEIPT_NOT_FOUND'});
const options=memory=>({transactionId:'synthetic-payment',companyId:'synthetic-company',scopeKey:'synthetic-company:synthetic-payment',storage:memory});
test('independent disposed controller must not clear a newer pending intent from shared storage',async()=>{
 const memory=storage();let resolveOld,oldBody,newBody,oldEvents=0;
 const a=createManualMultipleClient({...options(memory),newRequestId:()=> 'synthetic-old-request',onCommitted:()=>oldEvents++,request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();oldBody=body;return new Promise(resolve=>resolveOld=()=>resolve(receipt(body)));}});
 await a.load();await a.review(selection());const oldSend=a.confirm(true);assert.equal(memory.values.size,1);a.dispose();
 // Reopened UI recovers the old committed receipt, then the operator undoes it
 // through the existing flow and reviews another complete vector for this payment.
 let historical=true;
 const b=createManualMultipleClient({...options(memory),newRequestId:()=> 'synthetic-new-request',request:async(path,body)=>{if(path.includes('?requestId=')){if(historical){historical=false;return {...receipt(oldBody),replayed:true,changed:false};}throw missing();}if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();newBody=body;throw Object.assign(Error('Unknown new outcome'),{status:503,code:'MANUAL_OUTCOME_UNKNOWN'});}});
 await b.load();assert.equal(b.snapshot.phase,'saved');await b.load();await b.review(selection());await b.confirm(true);assert.equal(b.snapshot.phase,'unknown');assert.equal(newBody.requestId,'synthetic-new-request');assert.equal(JSON.parse([...memory.values.values()][0]).body.requestId,newBody.requestId);
 resolveOld();await oldSend;assert.equal(oldEvents,0);assert.equal(b.snapshot.phase,'unknown');
 assert.equal(memory.values.size,1,'The newer recovery record must remain after an older disposed request returns');assert.deepEqual(JSON.parse([...memory.values.values()][0]).body,newBody);
 const c=createManualMultipleClient({...options(memory),request:async()=>candidates()});assert.equal(c.snapshot.phase,'unknown');assert.equal(c.snapshot.requestId,newBody.requestId);
});
