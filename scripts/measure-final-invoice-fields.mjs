// Same synthetic corpus for an explicit baseline checkout and a candidate.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {context,invoiceText,exactFieldCases,exactFieldPositiveCases,metadataIdentifierCases} from '../test/helpers/invoice-parser-corpus.mjs';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const root=resolve(option('--source-root')||'.'),output=option('--output');
const hash=value=>createHash('sha256').update(value).digest('hex');
const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')));
const siteSource=readFileSync(join(root,'sites/lib/invoice-fields.js'),'utf8')
 .replace("'./domain'",JSON.stringify(pathToFileURL(join(root,'sites/lib/domain.ts')).href))
 .replace("'./document-triage.js'",JSON.stringify(pathToFileURL(join(root,'sites/lib/document-triage.js')).href));
const site=await import('data:text/javascript;base64,'+Buffer.from(siteSource).toString('base64'));
const corpus=[...exactFieldCases.map(c=>({...c,expected:'hold'})),...exactFieldPositiveCases.map(c=>({...c,expected:'exact'})),
 ...metadataIdentifierCases.map(c=>({...c,text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: '+c.number),expected:c.held?'hold':'exact',metadata:true}))];
const details=[];
for(const [engine,parser]of [['node',node.interpretInvoice],['sites',site.interpretInvoice]])for(const sample of corpus){
 const result=parser(sample.text,{...context,...(sample.metadata?{[sample.source]:sample.value}:{})});
 const values=Object.fromEntries(Object.entries(result.fields).map(([key,field])=>[key,field.value]));
 const correct=sample.expected==='hold'?result.level!=='green'&&(sample.metadata?values.invoice_number===sample.number:values[sample.field]===null):
  result.level==='green'&&values.invoice_number===sample.number&&values.reference===(sample.metadata?'000018':sample.reference)&&values.total_cents===375000;
 details.push({engine,name:sample.name,expected:sample.expected,correct,level:result.level});
}
const summary=Object.fromEntries(['node','sites'].map(engine=>{
 const rows=details.filter(row=>row.engine===engine),positive=rows.filter(row=>row.expected==='exact'),green=rows.filter(row=>row.level==='green');
 const truePositive=positive.filter(row=>row.correct).length,falsePositive=green.filter(row=>!row.correct).length;
 return [engine,{cases:rows.length,correct:rows.filter(row=>row.correct).length,positive:positive.length,truePositive,falsePositive,
  held:rows.filter(row=>row.expected==='hold'&&row.correct).length,precision:green.length?truePositive/green.length:null,recall:positive.length?truePositive/positive.length:null,coverage:rows.length?green.length/rows.length:null}];
}));
const report={schema:'mgeorge-final-invoice-fields-v1',synthetic:true,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 sourceHashes:Object.fromEntries(['src/invoice-extraction.js','src/document-triage.js','sites/lib/invoice-fields.js','sites/lib/document-triage.js'].map(file=>[file,hash(readFileSync(join(root,file)))])),
 runnerSha256:hash(readFileSync(new URL(import.meta.url))),corpusSha256:hash(JSON.stringify(corpus)),cases:corpus.length,evaluations:details.length,summary,
 scope:'Declared labelled-text and explicit-metadata corpus only. Green coverage is not recall for arbitrary invoices or optical OCR; actual registration, images, private originals and production are verified separately.',details};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,details:undefined},null,2));
