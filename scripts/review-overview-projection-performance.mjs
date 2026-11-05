import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const root=resolve(process.argv[2]||'.');
const counts=process.argv[3]?process.argv[3].split(',').map(Number):[100,500];
// A frozen git archive can be measured while reading the old summary from its repository.
const repository=resolve(process.argv[4]||root);
const url=path=>pathToFileURL(root+'/'+path).href;
const {economySummary}=await import(url('sites/lib/economy-summary.js'));
const {genericCompanyState}=await import(url('sites/tests/helpers/reference-policy-fixture.mjs'));
const {syntheticBankTransaction}=await import(url('sites/tests/helpers/bank-api-fixture.mjs'));
const old=execFileSync('git',['show','407f5f9c3cbe04af49a3c4a7fea92ad80597696e:sites/lib/economy-summary.js'],{cwd:repository,encoding:'utf8'}).replace("'./domain.ts'",JSON.stringify(url('sites/lib/domain.ts')));
const before=(await import('data:text/javascript;base64,'+Buffer.from(old).toString('base64'))).economySummary;
process.stdout.write(JSON.stringify({runtime:process.version,beforeSummary:'407f5f9',sharedDomain:'The original projection and current projection use the same domain module from the selected root.',hashes:Object.fromEntries(['sites/lib/economy-summary.js','sites/lib/domain.ts','sites/tests/helpers/reference-policy-fixture.mjs','sites/tests/helpers/bank-api-fixture.mjs'].map(path=>[path,createHash('sha256').update(readFileSync(root+'/'+path)).digest('hex')]))})+'\n');
for(const count of counts){
 if(!Number.isSafeInteger(count)||count<1||count>10000)throw Error('Synthetic count must be an integer from 1 through 10000');
 const state=genericCompanyState();
 for(let n=0;n<count;n++){
  const number=String(50000+n),id='synthetic-'+n;
  state.invoices.push({id,number,ocr:number,direction:'receivable',party:'Synthetic invoice customer',total:10000,currency:'SEK',issued:'2026-01-01',due:'2026-11-05',reviewed:true,documentId:'synthetic-original-'+n});
  state.transactions.push(syntheticBankTransaction({id,date:'2026-11-05',amount:10000,party:'Synthetic bank payer',payerReference:number,account:'synthetic-account',kind:'payment',verified:true}));
  state.allocations.push({id,transactionId:id,invoiceId:id,active:true,amount:10000,effect:'payment'});
 }
 const result={count};
 for(const [key,run]of [['before',before],['after',economySummary]]){
  const start=performance.now(),summary=run(state,'2026-11-05');
  result[key]={ms:Math.round((performance.now()-start)*100)/100,received:summary.received_month_cents,held:summary.unverified_allocation_count};
 }
 process.stdout.write(JSON.stringify(result)+'\n');
}
