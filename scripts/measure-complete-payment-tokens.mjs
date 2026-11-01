import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined,root=resolve(option('--source-root')||'.');
const bad=[['OCR','000018x','000018'],['OCR','000018.9','000018'],['OCR','000018/99','000018'],['Fakturanr','00606.9','00606'],['Fakturanr','AB/00606.9','AB/00606'],['OCR','000018,9','000018'],['OCR','000018;99','000018'],['Fakturanr','00606,9','00606'],['Fakturanr','00606;99','00606'],['OCR','000018, 9','000018'],['OCR','000018; 99','000018'],['Fakturanr','00606, 9','00606'],['Fakturanr','00606; 99','00606']].map(([label,value,prefix])=>({message:label+':'+value,number:label==='OCR'?'00606':prefix,ocr:label==='OCR'?prefix:'1234567897',expectedSafe:false}));
const good=['OCR: 000018 Fakturanr: 00606','Fakturanr: 00606 OCR: 000018','OCR: 000018; Fakturanr: 00606','OCR: 000 018, Fakturanr: 00606','OCR: 000018, Fakturanr: 00606','OCR:000018,Fakturanr:00606','OCR:000018;Fakturanr:00606'].map(message=>({message,number:'00606',ocr:'000018',expectedSafe:true}));
const corpus=[...bad,...good],details=[],hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const engine of ['node','sites']){
 const references=await import(pathToFileURL(join(root,engine==='node'?'src/payment-references.js':'sites/lib/payment-references.js'))),matching=await import(pathToFileURL(join(root,engine==='node'?'src/reconciliation.js':'sites/lib/reconciliation-engine.js')));
 for(const sample of corpus){
  const evidence=references.extractPaymentReferences({message:sample.message}),invoice={id:'synthetic-invoice',invoice_number:sample.number,reference:sample.ocr,party:'Testkund AB',direction:'customer',kind:'invoice',currency:'SEK',issued_at:'2026-10-01',remaining_cents:62500};
  const tx={id:'synthetic-payment',account:'synthetic-account',bank_reference:'SYNTHETIC',booked_at:'2026-10-26',amount_cents:62500,available_cents:62500,currency:'SEK',payer:'Testkund AB',reference:evidence.selected?.value||'',reference_evidence:evidence,verified:true};
  const findings=matching.analyzeReconciliation({invoices:[invoice],transactions:[tx]}),safe=findings.some(f=>f.safe);
  details.push({engine,...sample,safe,correct:safe===sample.expectedSafe,incomplete:evidence.incomplete,candidates:evidence.candidates.map(c=>({value:c.value,validity:c.validity})),warnings:evidence.warnings});
 }
}
const report={schema:'mgeorge-complete-payment-tokens-v1',synthetic:true,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),corpusSha256:hash(JSON.stringify(corpus)),sourceHashes:Object.fromEntries(['src/payment-references.js','sites/lib/payment-references.js','src/reconciliation.js','sites/lib/reconciliation-engine.js'].map(p=>[p,hash(readFileSync(join(root,p)))])),cases:corpus.length,evaluations:details.length,summary:{correct:details.filter(d=>d.correct).length,falseSafe:details.filter(d=>!d.expectedSafe&&d.safe).length,positiveSafe:details.filter(d=>d.expectedSafe&&d.safe).length,positiveTotal:details.filter(d=>d.expectedSafe).length},scope:'Synthetic complete-token references through the real reconciliation engines; no original bank identity or real allocation is inferred.',details};
if(option('--output'))writeFileSync(option('--output'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,details:undefined},null,2));
