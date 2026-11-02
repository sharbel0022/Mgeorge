/**
 * Synthetic, read-only Node presentation measurement. No server, network,
 * credentials, actual originals, financial matching or DOM layout is measured.
 *
 * Prepare baseline public/app.js, messages.js and payment-control.js with
 * `git show <ref>:public/<file>.js` into a separate directory, then run:
 *   node scripts/measure-ui-node.mjs --baseline-dir /tmp/node-ui-baseline \
 *     --baseline-ref a9f88ae --output docs/measurements/final-ui-node.json
 *
 * Directory mode does not authenticate a caller-supplied commit label. The
 * source hashes are the reproducible identity of the files actually executed.
 * The caller must compare them with the requested git revision independently.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';

const args=new Map();
for(let n=2;n<process.argv.length;n+=2){
  const key=process.argv[n],value=process.argv[n+1];
  if(!['--baseline-dir','--baseline-ref','--output'].includes(key)||!value)throw new Error('Use --baseline-dir PATH [--baseline-ref REF] [--output FILE].');
  args.set(key,value);
}
if(!args.has('--baseline-dir'))throw new Error('A separate baseline directory is required; see the usage comment.');
const repository=fileURLToPath(new URL('../',import.meta.url));
const baselineDirectory=resolve(args.get('--baseline-dir'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const files=['app','messages','payment-control'];
const sources=[baselineDirectory,resolve(repository,'public')].map(directory=>Object.fromEntries(files.map(file=>[file,readFileSync(resolve(directory,file+'.js'),'utf8')])));
const sourceHashes=sources.map(source=>Object.fromEntries(files.map(file=>['public/'+file+'.js',sha(source[file])])));
const fixedDate='2026-11-02T12:00:00.000Z';
class FixtureDate extends Date{
  constructor(...values){super(...(values.length?values:[fixedDate]));}
  static now(){return Date.parse(fixedDate);}
}
const rows=Array.from({length:5001},(_,n)=>({id:'invoice-'+n,direction:'customer',kind:'invoice',invoice_number:String(n).padStart(6,'0'),party:'Syntetisk kund '+n,reference:'REF/'+String(n).padStart(6,'0'),issued_at:'2026-10-01',due_at:n%2?'2026-11-30':'2026-12-31',created_at:'2026-10-01',total_cents:12500,paid_cents:5000,remaining_cents:7500,status:'partial',reconciliation_state:'verified',payment_evidence_issue:''}));
const inputJSON=JSON.stringify(rows),inputHash=sha(inputJSON);

function presentation(source){
  const element=()=>({innerHTML:'',querySelector:element,querySelectorAll:()=>[],setAttribute(){},addEventListener(){}});
  const context=vm.createContext({document:{querySelector:element,getElementById:element,addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){},scrollTo(){}},location:{search:'?tab=customers'},history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl,Date:FixtureDate,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout(){}});
  for(const file of files)vm.runInContext(source[file],context,{filename:'public/'+file+'.js'});
  context.input=JSON.parse(inputJSON);
  vm.runInContext('state.invoices=input;state.filters.customers.size=50',context);
  return code=>vm.runInContext(code,context);
}
const views=sources.map(presentation),results=[],runs=7,warmups=1;
for(const [name,setup,operation,expectedCount] of [
  ['invoice-page-with-summary',"state.filters.customers.q='';state.filters.customers.date='all'",'invoicePage()',50],
  ['first-page-50',"state.filters.customers.q='';state.filters.customers.date='all'",'invoiceResults()',50],
  ['reference-search',"state.filters.customers.q='REF/004';state.filters.customers.date='all'",'filteredInvoices().map(i=>i.id)',1000],
  ['month-filter',"state.filters.customers.q='';state.filters.customers.date='month'",'filteredInvoices().map(i=>i.id)',2500],
]){
  const samples=[[],[]],outputs=[];
  for(const run of views){run(setup);for(let n=0;n<warmups;n++)run(operation);}
  for(let n=0;n<runs;n++){
    for(const index of n%2?[1,0]:[0,1]){
      const start=performance.now();views[index](operation);samples[index].push(performance.now()-start);
    }
  }
  for(const run of views)outputs.push(run(operation));
  const invoiceIds=outputs.map(output=>typeof output==='string'?[...new Set([...output.matchAll(/data-invoice="(invoice-\d+)"/g)].map(match=>match[1]))]:Array.from(output));
  const equal=JSON.stringify(invoiceIds[0])===JSON.stringify(invoiceIds[1]);
  if(!equal||invoiceIds.some(ids=>ids.length!==expectedCount))throw new Error('Invoice order or fixture row count changed for '+name);
  const medians=samples.map(values=>values.slice().sort((a,b)=>a-b)[Math.floor(runs/2)]);
  results.push({name,before_ms:+medians[0].toFixed(3),after_ms:+medians[1].toFixed(3),before_samples_ms:samples[0].map(n=>+n.toFixed(3)),after_samples_ms:samples[1].map(n=>+n.toFixed(3)),same_invoice_order:equal,invoice_order_sha256:sha(JSON.stringify(invoiceIds[1])),invoice_count:invoiceIds[1].length});
}
const unchanged=views.every(run=>sha(run('JSON.stringify(state.invoices)'))===inputHash);
if(!unchanged)throw new Error('The presentation changed fixture data.');
const report={generated_at:new Date().toISOString(),scope:'Local synthetic presentation only; shared host; no production SLA or browser layout claim.',mode:'Supplied baseline directory; caller-provided reference label is not authenticated by this runner. Compare the recorded source hashes with git before attributing this result to a commit.',baseline_ref_label:args.get('--baseline-ref')||null,baseline_source_sha256:sourceHashes[0],current_source_sha256:sourceHashes[1],runner_sha256:sha(readFileSync(fileURLToPath(import.meta.url))),runtime:{node:process.version,platform:process.platform,arch:process.arch,v8:process.versions.v8,icu:process.versions.icu},fixture:{rows:rows.length,fixed_clock:fixedDate,input_sha256:inputHash,transactions:0,allocations:0,documents:0},method:{median_runs:runs,warmups,paired_alternating:true,timing_boundary:'Production template/filter functions in VM. API, DOM, layout and network are synthetic boundaries; real formatters and list logic execute.'},inputs_unchanged:unchanged,results};
const json=JSON.stringify(report,null,2)+'\n';
if(args.has('--output')){const output=resolve(args.get('--output'));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,json);}
process.stdout.write(json);
