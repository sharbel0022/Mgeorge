import assert from 'node:assert/strict';

export function candidates(extra={}){
 return {version:'manual-multiple-allocation-v1',mode:'manual_review',method:'manual_multiple',ownerId:'synthetic-owner',companyId:'synthetic-company',revision:7,transactionId:'synthetic-payment',bankId:'synthetic-bank',accountId:'synthetic-account',currency:'SEK',payer:'Synthetic <payer>',references:['00042','00043'],availableMinor:73100,requiredMinor:73100,shortfallMinor:0,excessMinor:0,invoices:[{invoiceId:'invoice-a',number:'00042',reference:'00042',customer:'Synthetic <customer>',currency:'SEK',invoiceTotalMinor:30001,invoiceRemainingBeforeMinor:30001},{invoiceId:'invoice-b',number:'00043',reference:'00043',customer:'Synthetic <customer>',currency:'SEK',invoiceTotalMinor:43099,invoiceRemainingBeforeMinor:43099}],...extra};
}
export function selection(extra={}){return {allocations:[{invoiceId:'invoice-a',amountMinor:30001},{invoiceId:'invoice-b',amountMinor:43099}],note:'Originalen är granskade.',...extra};}
export function quote(base=candidates(),draft=selection()){
 const {invoices,...summary}=base,allocations=draft.allocations.map(row=>{const i=invoices.find(i=>i.invoiceId===row.invoiceId);return {...i,...row,invoiceRemainingAfterMinor:i.invoiceRemainingBeforeMinor-row.amountMinor};}),allocatedMinor=allocations.reduce((total,row)=>total+row.amountMinor,0);
 return {...summary,allocations,allocatedMinor,paymentRemainingMinor:base.availableMinor-allocatedMinor,note:draft.note,reviewHash:'a'.repeat(64)};
}
export function receipt(body,review=quote()){
 return {receipt:{version:review.version,receiptId:'manual-multiple-'+ 'c'.repeat(64),requestId:body.requestId,ownerId:review.ownerId,companyId:review.companyId,approvedBy:'synthetic-actor',method:'manual_multiple',automatic:false,approvedAt:'2026-11-05T12:00:00.000Z',reviewHash:body.reviewHash,revisionBefore:review.revision,transactionId:review.transactionId,bankId:review.bankId,accountId:review.accountId,currency:'SEK',payer:review.payer,references:review.references,availableBeforeMinor:review.availableMinor,allocatedMinor:review.allocatedMinor,paymentRemainingMinor:review.paymentRemainingMinor,allocations:review.allocations.map((row,n)=>({...row,id:'allocation-'+n,transactionId:review.transactionId})),note:review.note,evidence:{}},replayed:false,changed:true};
}
export function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};}
function fixture(module,options={}){
 const calls=[],memory=options.storage||storage();let sequence=0,lastBody;
 const request=async(path,body)=>{calls.push({path,body:body&&structuredClone(body)});if(options.request)return options.request(path,body);if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote(candidates(),body);if(path.includes('?requestId='))throw Object.assign(Error('Saknas'),{status:404,code:'MANUAL_RECEIPT_NOT_FOUND'});lastBody=body;return receipt(body);};
 const client=module.createManualMultipleClient({transactionId:'synthetic-payment',companyId:'synthetic-company',scopeKey:'synthetic-company:synthetic-payment',storage:memory,request,newRequestId:()=> 'synthetic-request-'+(++sequence),onCommitted:options.onCommitted});
 return {client,calls,memory,last:()=>lastBody};
}
const plain=value=>JSON.parse(JSON.stringify(value));
export function registerManualClientCases(test,module,label){
 test(label+': only canonical SHA-256 or safe integer revisions pass unchanged through discovery, quote and receipt',()=>{
  for(const revision of [0,7,Number.MAX_SAFE_INTEGER,'a'.repeat(64),'0'.repeat(64)]){
   const discovery=candidates({revision}),review=quote(discovery),result=receipt({requestId:'synthetic-revision-request',reviewHash:review.reviewHash},review);
   assert.equal(module.validManualDiscovery(discovery,discovery.transactionId),true,String(revision));assert.equal(module.validManualQuote(review,discovery,selection()),true,String(revision));assert.equal(module.validManualReceipt(result,{transactionId:discovery.transactionId}),true,String(revision));
  }
 });
 test(label+': malformed revisions fail all transport gates without coercion',()=>{
  for(const revision of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,null,undefined,true,{},[], '', '7','a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'g'.repeat(64),' '+ 'a'.repeat(64),'0x'+'a'.repeat(64)]){
   const discovery=candidates({revision}),review=quote(discovery),result=receipt({requestId:'synthetic-revision-request',reviewHash:review.reviewHash},review);
   assert.equal(module.validManualDiscovery(discovery,discovery.transactionId),false,String(revision));assert.equal(module.validManualQuote(review,candidates(),selection()),false,String(revision));assert.equal(module.validManualReceipt(result,{transactionId:discovery.transactionId}),false,String(revision));
  }
 });
 test(label+': a quote revision must retain the exact discovery type and value',()=>{
  for(const [before,after]of [[7,8],[7,'7'],[7,'a'.repeat(64)],['a'.repeat(64),7],['a'.repeat(64),'b'.repeat(64)]]){
   const discovery=candidates({revision:before}),review=quote(discovery);review.revision=after;assert.equal(module.validManualQuote(review,discovery,selection()),false);
  }
 });
 test(label+': exact Swedish amounts reject exponent, rounding, negative, zero and unsafe numbers',()=>{
  for(const [value,minor]of [['300,01',30001],['430.99',43099],['1 234,56',123456],['0,01',1],['731',73100]])assert.equal(module.parseManualAmount(value),minor,value);
  for(const value of ['1e3','0','-1','1,001','12 34,56','1,23.45','NaN','90071992547409.92',''])assert.equal(module.parseManualAmount(value),null,value);
 });
 test(label+': opening and reviewing produce no economic write; confirmation freezes the whole vector',async()=>{
  const f=fixture(module);await f.client.load();assert.equal(f.client.snapshot.phase,'editing');await f.client.confirm(true);assert.equal(f.calls.length,1);
  const draft=selection();await f.client.review(draft);draft.allocations[0].amountMinor=1;f.client.snapshot.quote.allocations[0].amountMinor=2;assert.equal(f.client.snapshot.phase,'review');await f.client.confirm(false);assert.equal(f.calls.length,2);await f.client.confirm(true);
  assert.equal(f.client.snapshot.phase,'saved');assert.equal(f.calls.filter(c=>c.path==='/api/manual-allocations').length,1);assert.deepEqual(plain(f.last().allocations),selection().allocations);assert.equal(f.last().confirm,true);assert.equal(f.last().reviewHash,'a'.repeat(64));assert.equal(f.memory.values.size,0);
 });
 test(label+': editing or workspace invalidation consumes the previous quote and requires new review',async()=>{
  const f=fixture(module);await f.client.load();await f.client.review(selection());f.client.edit();await f.client.confirm(true);assert.equal(f.calls.length,2);assert.equal(f.client.snapshot.quote,null);
  await f.client.review(selection());f.client.invalidate();await f.client.confirm(true);assert.equal(f.calls.length,3);assert.equal(f.client.snapshot.phase,'closed');
 });
 test(label+': corrupted, mismatched or arithmetically false quotes cannot arm approval',async()=>{
  for(const mutate of [q=>q.allocations.pop(),q=>q.allocations[0].amountMinor++,q=>q.allocations[0].invoiceRemainingAfterMinor++,q=>q.paymentRemainingMinor++,q=>q.companyId='another-company',q=>q.ownerId='another-owner',q=>q.references[0]='42',q=>q.payer='',q=>q.reviewHash='not-a-hash',q=>q.revision++,q=>q.note='Changed on server']){
   const f=fixture(module,{request:async(path)=>{if(path.includes('?transactionId='))return candidates();const q=quote();mutate(q);return q;}});await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.notEqual(f.client.snapshot.phase,'review');assert.equal(f.calls.filter(c=>c.path==='/api/manual-allocations').length,0);
  }
 });
 test(label+': forged disclosure and an incomplete client vector cannot proceed',async()=>{
  for(const mutate of [c=>c.invoices[0].invoiceRemainingBeforeMinor=-1,c=>c.invoices[1].invoiceId='invoice-a',c=>c.references.pop(),c=>c.requiredMinor++,c=>c.companyId='other-company']){
   const f=fixture(module,{request:async()=>{const c=candidates();mutate(c);return c;}});await f.client.load();assert.notEqual(f.client.snapshot.phase,'editing');
  }
  const f=fixture(module);await f.client.load();await f.client.review(selection({allocations:[{invoiceId:'invoice-a',amountMinor:30001}]}));assert.equal(f.calls.length,1);
 });
 test(label+': exact underpayment and overpayment remain explicit in the server review',async()=>{
  for(const available of [73000,73201]){
   const base=candidates({availableMinor:available,shortfallMinor:Math.max(0,73100-available),excessMinor:Math.max(0,available-73100)}),draft=selection({allocations:[{invoiceId:'invoice-a',amountMinor:30001},{invoiceId:'invoice-b',amountMinor:available<73100?42999:43099}]}),f=fixture(module,{request:async path=>path.includes('?transactionId=')?base:quote(base,draft)});
   await f.client.load();await f.client.review(draft);assert.equal(f.client.snapshot.phase,'review');assert.equal(f.client.snapshot.quote.paymentRemainingMinor,available>73100?101:0);assert.equal(f.client.snapshot.quote.allocations[1].invoiceRemainingAfterMinor,available<73100?100:0);
  }
 });
 test(label+': lost reply recovers stored historical receipt without a new write',async()=>{
  let saved;const f=fixture(module,{request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();if(path.includes('?requestId='))return {...saved,replayed:true,changed:false};saved=receipt(body);throw Error('Synthetic lost reply');}});
  await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.equal(f.client.snapshot.phase,'saved');assert.equal(f.calls.filter(c=>c.path==='/api/manual-allocations').length,1);assert.equal(f.memory.values.size,0);
 });
 test(label+': unknown outcome survives reopening and retries the identical request only',async()=>{
  const memory=storage();let finalBody,firstBody;const unavailable=()=>Object.assign(Error('unreadable'),{status:503,code:'MANUAL_OUTCOME_UNKNOWN'});
  const f=fixture(module,{storage:memory,request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();if(body)firstBody=structuredClone(body);throw unavailable();}});
  await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.equal(f.client.snapshot.phase,'unknown');assert.equal(memory.values.size,1);f.client.edit();await f.client.review(selection());assert.equal(f.calls.filter(c=>c.path.endsWith('/preview')).length,1);f.client.dispose();
  const g=fixture(module,{storage:memory,request:async(path,body)=>{if(path.includes('?requestId='))throw unavailable();finalBody=body;return receipt(body);}});await g.client.load();assert.equal(g.calls[0].path,'/api/manual-allocations?requestId='+firstBody.requestId);assert.equal(g.client.snapshot.phase,'unknown');await g.client.retry();assert.deepEqual(plain(finalBody),firstBody);assert.equal(g.client.snapshot.phase,'saved');
 });
 for(const status of [400,500,503])test(label+`: unclassified ${status} plus absent receipt retains the same intent even after a later explicit rejection`,async()=>{
  let first,attempt=0;const f=fixture(module,{request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();if(path.includes('?requestId='))throw Object.assign(Error('Temporarily absent'),{status:404,code:'MANUAL_RECEIPT_NOT_FOUND'});if(!attempt++){first=structuredClone(body);throw Object.assign(Error('Network connection lost'),{status});}assert.deepEqual(plain(body),first);throw Object.assign(Error('Stale'),{status:409,code:'MANUAL_STALE_REVIEW'});}});
  await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.equal(f.client.snapshot.phase,'unknown');await f.client.retry();assert.equal(f.client.snapshot.phase,'unknown');assert.equal(f.memory.values.size,1);f.client.edit();await f.client.review(selection());assert.equal(f.calls.filter(call=>call.path.endsWith('/preview')).length,1);
 });
 test(label+': explicit initial stale rejection permits a new review only after an owned absent receipt',async()=>{
  const f=fixture(module,{request:async(path)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();if(path.includes('?requestId='))throw Object.assign(Error('No receipt'),{status:404,code:'MANUAL_RECEIPT_NOT_FOUND'});throw Object.assign(Error('Changed source'),{status:409,code:'MANUAL_STALE_REVIEW'});}});
  await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.equal(f.client.snapshot.phase,'closed');assert.equal(f.memory.values.size,0);assert.match(f.client.snapshot.error,/Changed source/);
 });
 test(label+': fake success, wrong receipt amount or scope never shows a saved result',async()=>{
  for(const mutate of [r=>r.receipt.automatic=true,r=>r.receipt.requestId='different-request',r=>r.receipt.companyId='different-company',r=>r.receipt.allocations[0].amountMinor++,r=>r.receipt.paymentRemainingMinor++,r=>r.changed=false]){
   const f=fixture(module,{request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();if(path.includes('?requestId='))throw Error('unavailable');const r=receipt(body);mutate(r);return r;}});await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.equal(f.client.snapshot.phase,'unknown');assert.equal(f.memory.values.size,1);
  }
 });
 test(label+': storage failure prevents economic POST and leaves the reviewed vector available',async()=>{
  const f=fixture(module,{storage:{getItem:()=>null,setItem(){throw Error('quota');},removeItem(){}}});await f.client.load();await f.client.review(selection());await f.client.confirm(true);assert.equal(f.calls.length,2);assert.equal(f.client.snapshot.phase,'review');assert.match(f.client.snapshot.error,/webbläsaren/i);
 });
 test(label+': double confirmation sends one request and detached UI cannot publish a late result',async()=>{
  let resolve,callbacks=0;const f=fixture(module,{onCommitted:()=>callbacks++,request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();return new Promise(done=>{resolve=()=>done(receipt(body));});}});await f.client.load();await f.client.review(selection());const first=f.client.confirm(true);await f.client.confirm(true);assert.equal(f.calls.filter(c=>c.path==='/api/manual-allocations').length,1);f.client.dispose();resolve();await first;assert.equal(callbacks,0);
 });
 for(const disposed of [true,false])test(label+`: a late ${disposed?'disposed':'still-active'} older controller cannot delete a newer pending request`,async()=>{
  const memory=storage(),options={transactionId:'synthetic-payment',companyId:'synthetic-company',scopeKey:'synthetic-shared-lifecycle',storage:memory};let resolveOld,oldBody,newBody,oldEvents=0;
  const a=module.createManualMultipleClient({...options,newRequestId:()=> 'synthetic-old-request',onCommitted:()=>oldEvents++,request:async(path,body)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();oldBody=body;return new Promise(resolve=>resolveOld=()=>resolve(receipt(body)));}});
  await a.load();await a.review(selection());const oldSend=a.confirm(true);assert.equal(memory.values.size,1);if(disposed)a.dispose();
  // Reopen and recover the committed first request. After the normal external
  // undo workflow, another valid review may exist for the same payment/scope.
  let historical=true;const b=module.createManualMultipleClient({...options,newRequestId:()=> 'synthetic-new-request',request:async(path,body)=>{if(path.includes('?requestId=')){if(historical){historical=false;return {...receipt(oldBody),replayed:true,changed:false};}throw Object.assign(Error('Temporarily absent'),{status:404,code:'MANUAL_RECEIPT_NOT_FOUND'});}if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();newBody=body;throw Object.assign(Error('Unknown new outcome'),{status:503,code:'MANUAL_OUTCOME_UNKNOWN'});}});
  await b.load();assert.equal(b.snapshot.phase,'saved');await b.load();await b.review(selection());await b.confirm(true);assert.equal(b.snapshot.phase,'unknown');assert.equal(JSON.parse([...memory.values.values()][0]).body.requestId,'synthetic-new-request');
  resolveOld();await oldSend;assert.equal(oldEvents,disposed?0:1);assert.equal(b.snapshot.phase,'unknown');assert.equal(memory.values.size,1);assert.deepEqual(JSON.parse([...memory.values.values()][0]).body,plain(newBody));
  const reopened=module.createManualMultipleClient({...options,request:async()=>{throw Error('No read in construction');}});assert.equal(reopened.snapshot.phase,'unknown');assert.equal(reopened.snapshot.requestId,'synthetic-new-request');
 });
 test(label+': a delayed historical receipt read has no ownership of a newer pending recovery record',async()=>{
  const memory=storage(),options={transactionId:'synthetic-payment',companyId:'synthetic-company',scopeKey:'synthetic-shared-history',storage:memory};let resolveRead;
  const history=module.createManualMultipleClient({...options,request:async()=>new Promise(resolve=>resolveRead=()=>resolve({...receipt({requestId:'synthetic-history-request',reviewHash:'a'.repeat(64)}),replayed:true,changed:false}))}),read=history.readReceipt('synthetic-history-request');
  const current=module.createManualMultipleClient({...options,newRequestId:()=> 'synthetic-new-pending',request:async(path)=>{if(path.includes('?transactionId='))return candidates();if(path.endsWith('/preview'))return quote();throw Object.assign(Error('Temporarily unavailable'),{status:503,code:'MANUAL_OUTCOME_UNKNOWN'});}});
  await current.load();await current.review(selection());await current.confirm(true);assert.equal(current.snapshot.phase,'unknown');assert.equal(memory.values.size,1);
  resolveRead();await read;assert.equal(history.snapshot.phase,'saved');assert.equal(memory.values.size,1);assert.equal(JSON.parse([...memory.values.values()][0]).body.requestId,'synthetic-new-pending');
 });
 test(label+': history read uses only owned receipt endpoint and never requests current bank consent',async()=>{
  const value=receipt({requestId:'synthetic-history-request',reviewHash:'a'.repeat(64)}),f=fixture(module,{request:async()=>({...value,replayed:true,changed:false})});await f.client.readReceipt('synthetic-history-request');assert.equal(f.client.snapshot.phase,'saved');assert.equal(f.calls.length,1);assert.match(f.calls[0].path,/requestId=synthetic-history-request/);
 });
}
