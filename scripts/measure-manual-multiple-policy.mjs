// Synthetic local policy measurement only. No database, HTTP or provider calls.
import {performance} from 'node:perf_hooks';
import {manualFixture,manualRequest} from '../test/helpers/manual-multiple-allocation-cases.mjs';
import {manualMultiplePlan,manualMultipleBinding} from '../sites/lib/manual-multiple-allocation.js';
import {buildReconciliationPreview} from '../sites/lib/reconciliation-contract.js';

const results=[];
for(const [rows,census] of [[2,2],[3,1000],[20,1000],[20,5000]]){
 const input=manualFixture(Array.from({length:rows},(_,index)=>10001+index)),request=manualRequest(input),template=input.invoices[0];
 for(let index=input.invoices.length;index<census;index++)input.invoices.push({...structuredClone(template),id:'synthetic-unrelated-'+index,number:'SYNTHETIC-UNRELATED-'+index,customerName:'Synthetic unrelated customer'});
 const timings=[];let bindingBytes=0;
 for(let sample=0;sample<25;sample++){
  const start=performance.now(),preview=await buildReconciliationPreview(input),plan=manualMultiplePlan(input,preview,request),binding=manualMultipleBinding(input,plan);
  if(plan.allocations.length!==rows||plan.paymentRemainingMinor!==0||preview.decisions[0].status!=='REVIEW')throw Error('Unexpected synthetic benchmark result');
  bindingBytes=new TextEncoder().encode(binding).length;if(sample>=5)timings.push(performance.now()-start);
 }
 timings.sort((a,b)=>a-b);
 results.push({invoiceRows:rows,companyInvoiceCensus:census,samples:timings.length,warmup:5,bindingBytes,p50ms:Number(timings[Math.floor(timings.length*.5)].toFixed(2)),p95ms:Number(timings[Math.ceil(timings.length*.95)-1].toFixed(2)),falseAutomaticVerified:0,notes:'Pure source-policy preview + manual plan + canonical binding; not HTTP/storage/bank latency'});
}
console.log(JSON.stringify({runtime:process.version,syntheticOnly:true,productionCalls:0,results},null,2));
