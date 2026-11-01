// Compare identical synthetic labelled-field cases against an explicit source
// checkout. Optical character recognition is measured separately with rasters.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {context,exactFieldCases,exactFieldPositiveCases} from '../test/helpers/invoice-parser-corpus.mjs';

const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const root=resolve(option('--source-root')||'.'),output=option('--output');
const hash=value=>createHash('sha256').update(value).digest('hex');
const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')));
const sitePath=join(root,'sites/lib/invoice-fields.js');
const siteSource=readFileSync(sitePath,'utf8')
 .replace("'./domain'",JSON.stringify(pathToFileURL(join(root,'sites/lib/domain.ts')).href))
 .replace("'./document-triage.js'",JSON.stringify(pathToFileURL(join(root,'sites/lib/document-triage.js')).href));
const site=await import('data:text/javascript;base64,'+Buffer.from(siteSource).toString('base64'));
const corpus=[...exactFieldCases.map(c=>({...c,expected:'hold'})),...exactFieldPositiveCases.map(c=>({...c,expected:'exact'}))];
const details=[];
for(const [engine,parser] of [['node',node.interpretInvoice],['sites',site.interpretInvoice]])for(const sample of corpus){
 const result=parser(sample.text,context),values=Object.fromEntries(Object.entries(result.fields).map(([key,f])=>[key,f.value]));
 const correct=sample.expected==='hold'?result.level!=='green'&&values[sample.field]===null:
  result.level==='green'&&values.invoice_number===sample.number&&values.reference===sample.reference&&values.total_cents===375000;
 details.push({engine,name:sample.name,expected:sample.expected,field:sample.field,correct,level:result.level,
  ...(sample.expected==='hold'?{actual:values[sample.field]}:{actual:{invoice_number:values.invoice_number,reference:values.reference,total_cents:values.total_cents}})});
}
const report={schema:'mgeorge-exact-invoice-fields-v1',synthetic:true,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 sourceHashes:Object.fromEntries(['src/invoice-extraction.js','sites/lib/invoice-fields.js'].map(p=>[p,hash(readFileSync(join(root,p)))])),
 corpusSha256:hash(JSON.stringify(corpus)),cases:corpus.length,evaluations:details.length,
 summary:{correct:details.filter(d=>d.correct).length,invalidGreen:details.filter(d=>d.expected==='hold'&&d.level==='green').length,
  exactPositive:details.filter(d=>d.expected==='exact'&&d.correct).length,positiveTotal:details.filter(d=>d.expected==='exact').length},
 scope:'Deterministic labelled-text extraction only; synthetic rasters and real originals are separate evidence. Dirty source hashes identify actual measured code.',details};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,details:undefined},null,2));
