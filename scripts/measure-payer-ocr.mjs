import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {corpus,account} from '../test/payer-ocr-corpus.js';
import {execFileSync} from 'node:child_process';
const option=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:null,sourceRoot=resolve(option('--source-root')||'.');
const {parseCAMT,parseCSV,normalizeBankApiTransaction}=await import(pathToFileURL(join(sourceRoot,'src/importers.js')).href);
const {parseBankgiroXML,parseBankgiroCSV}=await import(pathToFileURL(join(sourceRoot,'sites/lib/bankgiro-parser.js')).href);
const details=[];
for(const engine of ['node','sites'])for(const sample of corpus){
 if(engine==='sites'&&sample.format==='api')continue;
 const start=performance.now();let row,error='';
 try{row=sample.format==='xml'?(engine==='node'?parseCAMT(sample.input,account):parseBankgiroXML(sample.input))[0]:sample.format==='csv'?(engine==='node'?parseCSV(sample.input,account):parseBankgiroCSV(sample.input))[0]:normalizeBankApiTransaction(sample.input,account);}catch(e){error=e.message;}
 const evidence=row?.reference_evidence||row?.referenceEvidence;
 const references=kind=>[...new Set((evidence?.candidates||[]).filter(c=>c.kind===kind).map(c=>c.value))].sort();
 const payer=row?.payer??row?.party??'',organization=row?.payer_organization_number??row?.organizationNumber??'';
 const ocr=references('ocr'),invoice=references('invoice');
 const expected=sample.expected;
 details.push({engine,id:sample.id,error,ms:performance.now()-start,expected,actual:{payer,organization,ocr,invoice},payerCorrect:!error&&payer===expected.payer&&organization===expected.organization,ocrCorrect:!error&&JSON.stringify(ocr)===JSON.stringify([...expected.ocr].sort()),invoiceCorrect:!error&&JSON.stringify(invoice)===JSON.stringify([...expected.invoice].sort())});
}
const identified=details.filter(d=>d.expected.payer),ocrExpected=details.flatMap(d=>d.expected.ocr),invoiceExpected=details.flatMap(d=>d.expected.invoice);
const rates=kind=>{const tp=details.reduce((n,d)=>n+d.actual[kind].filter(v=>d.expected[kind].includes(v)).length,0),fp=details.reduce((n,d)=>n+d.actual[kind].filter(v=>!d.expected[kind].includes(v)).length,0),total=kind==='ocr'?ocrExpected.length:invoiceExpected.length;return{tp,fp,fn:total-tp,expected:total,precision:tp+fp?tp/(tp+fp):null,recall:total?tp/total:null};};
const files=['src/importers.js','src/payment-references.js','sites/lib/bankgiro-parser.js','sites/lib/camt-xml.js','sites/lib/payer-evidence.js','sites/lib/camt-payer.js'];
const sourceHashes=Object.fromEntries(files.filter(p=>existsSync(join(sourceRoot,p))).map(p=>[p,createHash('sha256').update(readFileSync(join(sourceRoot,p))).digest('hex')]));
const report={version:2,synthetic:true,commit:option('--revision')||execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),sourceHashes,corpusSha256:createHash('sha256').update(readFileSync(new URL('../test/payer-ocr-corpus.js',import.meta.url))).digest('hex'),evaluations:details.length,originals:corpus.length,summary:{payer:{correct:identified.filter(d=>d.payerCorrect).length,total:identified.length,falseNames:details.filter(d=>d.actual.payer&&d.actual.payer!==d.expected.payer).length,falseOrganization:details.filter(d=>d.actual.organization&&d.actual.organization!==d.expected.organization).length},ocr:rates('ocr'),invoice:rates('invoice'),failedImports:details.filter(d=>d.error).length,meanMs:details.reduce((n,d)=>n+d.ms,0)/details.length},details};
const target=process.argv[2];if(target)writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,details:undefined},null,2));
