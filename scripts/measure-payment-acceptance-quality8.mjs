import {performance} from 'node:perf_hooks';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildReconciliationPreview} from '../sites/lib/reconciliation-contract.js';
import {paymentAcceptanceCases,paymentAcceptanceInput} from '../test/helpers/payment-acceptance-quality8.mjs';
const rows=[];
for(const scenario of paymentAcceptanceCases){
 const input=paymentAcceptanceInput(scenario.id),before=JSON.stringify(input),start=performance.now(),preview=await buildReconciliationPreview(input),elapsed=performance.now()-start,row=preview.decisions.find(item=>item.transactionId==='payment-1');
 rows.push({id:scenario.id,expected:scenario.expected,actual:row?.status,correct:row?.status===scenario.expected&&row.allocations.length===scenario.allocations,expected_allocations:scenario.allocations,proposed_allocations:row?.allocations.map(({invoiceId,amountMinor,settlement})=>({invoiceId,amountMinor,settlement})),reason_codes:row?.reasonCodes,changed:preview.changed,writes_allowed:preview.writesAllowed,input_mutated:JSON.stringify(input)!==before,elapsed_ms:elapsed});
}
const hash=path=>createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex');
const report={schema:'payment-acceptance-quality8-v1',generated_at:new Date().toISOString(),runtime:process.version,scope:'Independent synthetic read-only matching acceptance corpus; not provider-confirmed payer/OCR evidence or production accuracy. Existing SQLite concurrency/crash tests are reported separately.',sources:{contract_sha256:hash('../sites/lib/reconciliation-contract.js'),corpus_sha256:hash('../test/helpers/payment-acceptance-quality8.mjs')},metrics:{cases:rows.length,correct_cases:rows.filter(row=>row.correct).length,expected_verified:rows.filter(row=>row.expected==='VERIFIED').length,false_verified:rows.filter(row=>row.expected!=='VERIFIED'&&row.actual==='VERIFIED').length,abstentions:rows.filter(row=>row.actual!=='VERIFIED').length,explained_abstentions:rows.filter(row=>row.actual!=='VERIFIED'&&row.reason_codes?.length).length,input_mutations:rows.filter(row=>row.input_mutated).length,financial_writes:0},cases:rows};
const output=process.argv[2]||'docs/quality8/payment-acceptance-measurement.json';writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,metrics:report.metrics},null,2));
if(report.metrics.correct_cases!==rows.length||report.metrics.false_verified||report.metrics.input_mutations)process.exitCode=1;
