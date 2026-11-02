// Identical synthetic projection cases against an explicit source checkout.
// Uses that checkout's existing isolated production-module loader; no I/O service,
// provider, credentials or real data is invoked by the pure projection.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const argv=process.argv.slice(2),option=n=>argv.includes(n)?argv[argv.indexOf(n)+1]:undefined;
const root=resolve(option('--source-root')||'.'),output=option('--output'),file=join(root,'sites/tests/payment-verification.test.mjs'),fileURL=pathToFileURL(file);
let loader=readFileSync(file,'utf8').split(/\ntest\(/,1)[0];
loader=loader.replaceAll('import.meta.url',JSON.stringify(fileURL.href)).replace(/\bfrom\s*(['"])(\.[^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(new URL(p,fileURL).href));
loader+='\nexport {build,fixture,step,applyCommand,makeBankgiroXLSX,parseSpecificationBytes}; export const analysis=(await import(reconciliation)).analyze;';
const {build,fixture,step,analysis,applyCommand,makeBankgiroXLSX,parseSpecificationBytes}=await import('data:text/javascript;base64,'+Buffer.from(loader).toString('base64'));
const document=(id,values)=>({document_id:id,status:'needs_review',extraction:JSON.stringify({direction:'customer',kind:'invoice',currency:'SEK',invoice_number:'0599',party:'Synthetic customer AB',total_cents:62500,issued_at:'2026-10-01',...values})});
const cases=[
 {name:'registered positive control',registered:true,docs:[],check:r=>r.automaticEligible===true},
 {name:'registered original with one competing reference original',registered:true,docs:[document('different-synthetic-original',{invoice_number:'0606',reference:'0599',party:'Another synthetic customer AB'})],check:r=>step(r,'invoice').status==='blocked'&&step(r,'customer').status==='review'&&step(r,'reconciliation').status==='blocked'&&r.automaticEligible===false&&r.invoiceHint===undefined&&step(r,'original').status==='passed'&&step(r,'reference').facts.some(f=>f.label==='Referens'&&f.value==='0599')&&step(r,'invoice').facts.some(f=>f.label==='Original tillgängligt'&&f.value==='Ja')&&step(r,'invoice').facts.some(f=>f.label==='Fakturanummer'&&f.value==='0599')},
 {name:'registered original also found in Gmail is one subject',registered:true,docs:[document('synthetic-invoice-original',{})],check:r=>step(r,'invoice').status==='passed'&&step(r,'customer').status==='passed'&&r.automaticEligible===true&&step(r,'original').status==='passed'&&step(r,'invoice').facts.some(f=>f.label==='Fakturanummer'&&f.value==='0599')},
 {name:'intact unregistered original availability',docs:[document('synthetic-original',{})],check:r=>step(r,'invoice').facts.some(f=>f.label==='Original tillgängligt'&&f.value==='Ja')&&step(r,'invoice').facts.some(f=>f.label==='Fakturaregistrering'&&f.value==='Ej registrerad')},
 {name:'current extracted reference differs from invoice number',docs:[document('synthetic-reference',{invoice_number:'0606',reference:'0599'})],check:r=>step(r,'invoice').status==='review'&&step(r,'invoice').facts.some(f=>f.label==='Fakturanummer'&&f.value==='0606')},
 {name:'legacy extracted OCR differs from invoice number',docs:[document('synthetic-ocr',{invoice_number:'0606',ocr:'0599'})],check:r=>step(r,'invoice').status==='review'&&step(r,'invoice').facts.some(f=>f.label==='Fakturanummer'&&f.value==='0606')},
 {name:'leading zeros remain distinct',docs:[document('synthetic-short',{invoice_number:'599'})],check:r=>step(r,'invoice').status==='missing'},
 {name:'current extraction never merges stale source',docs:[{...document('synthetic-precedence',{}),job_extraction:document('unused',{invoice_number:'0777',reference:'0777'}).extraction}],check:r=>step(r,'invoice').status==='missing'},
 {name:'multiple original candidates without register',docs:[document('synthetic-a',{}),document('synthetic-b',{})],check:r=>step(r,'invoice').status==='blocked'&&!r.automaticEligible},
 {name:'multiple reference candidates alongside reviewed register',registered:true,docs:[document('synthetic-a',{invoice_number:'0606',reference:'0599'}),document('synthetic-b',{invoice_number:'0606',reference:'0599'})],check:r=>step(r,'invoice').status==='blocked'&&step(r,'customer').status==='review'&&!r.automaticEligible},
 {name:'conflicting reference and OCR alongside reviewed register',registered:true,docs:[document('synthetic-conflict',{reference:'0599',ocr:'000026'})],check:r=>step(r,'invoice').status==='blocked'&&step(r,'customer').status==='review'&&!r.automaticEligible},
 {name:'economic record is explicitly identified',docs:[],check:r=>r.countedEconomically===true},
 {name:'review report is not a second economic deposit',report:true,docs:[],check:r=>r.countedEconomically===false}
];
const details=[];
for(const c of cases){
 let state=fixture({invoice:!!c.registered,batch:!!c.report}),id=state.transactions[0].id;
 if(c.report){const target=state.transactions[0],bytes=makeBankgiroXLSX({currency:'SEK',account:target.account.slice(5),date:target.date,payments:[{party:'Report payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]});state=applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-report',hash:'a'.repeat(64),name:'synthetic.xlsx',rows:parseSpecificationBytes(bytes,'synthetic.xlsx')}).state;id=state.transactions.find(t=>t.specification).id;}
 const before=JSON.stringify(state),result=build(state,id,{documents:c.docs,findings:analysis(state)}),correct=c.check(result),unchanged=before===JSON.stringify(state);
 if(!unchanged)throw Error('Read projection mutated synthetic state');
 details.push({name:c.name,correct,unchanged,invoiceStatus:step(result,'invoice').status,customerStatus:step(result,'customer').status,automaticEligible:result.automaticEligible,countedEconomically:result.countedEconomically??null});
}
const sha=v=>createHash('sha256').update(v).digest('hex'),sourceFiles=['sites/lib/payment-verification.ts','sites/lib/banking/invoice-candidates.ts','sites/lib/payment-presentation.ts'];
const corpus=cases.map(({name,registered=false,report=false,docs,check})=>({name,registered,report,docs,assertion:check.toString()}));
const result={schema:'mgeorge-payment-preview-v1',synthetic:true,runnerSha256:sha(readFileSync(new URL(import.meta.url))),harnessSha256:sha(readFileSync(file)),loadedHarnessSha256:sha(loader),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceModifiedFromCommit:execFileSync('git',['diff','--name-only','HEAD','--',...sourceFiles],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean),sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(join(root,p)))])),corpusSha256:sha(JSON.stringify(corpus)),cases:cases.length,correct:details.filter(c=>c.correct).length,stateUnchanged:details.filter(c=>c.unchanged).length,scope:'Pure real verification projection with controlled intact-original/current-account context and actual reconciliation findings; existing test loader, synthetic bank fixtures. runnerSha256 covers this runner; harnessSha256 covers the source checkout test file; loadedHarnessSha256 covers the imported prelude. sourceCommit identifies HEAD at measurement time, with modified measured files listed separately; sourceHashes cover only the three named projection files, not the entire dependency tree. Opaque fixture IDs/receipt timestamps are generated; no production authorization, external bank relation or OCR accuracy is measured.',details};
if(output)writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,details:undefined},null,2));
