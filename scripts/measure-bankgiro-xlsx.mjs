import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {makeBankgiroXLSX,syntheticPayment} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map(value=>value.replace(/^--/,'').split('=')));
const phase=args.phase||'after',baseline=args.baseline||'a8ec37a';
let parser;
if(phase==='before'){
 let source=execFileSync('git',['show',`${baseline}:sites/lib/bankgiro-parser.js`],{cwd:root,encoding:'utf8'});
 source=source.replace(/from\s+(['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${JSON.stringify(pathToFileURL(resolve(root,'sites/lib',path)).href)}`);
 parser=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).parseSpecificationBytes;
}else if(phase==='after')parser=(await import('../sites/lib/bankgiro-parser.js')).parseSpecificationBytes;
else throw Error('Use --phase=before or --phase=after');

const second={party:'Testbutiken AB',reference:'0008',payerBankgiro:'444-5555',amount:90000};
const valid=[
 {id:'single',options:{},expected:[syntheticPayment]},
 {id:'multiple',options:{payments:[syntheticPayment,second]},expected:[syntheticPayment,second]},
 {id:'multi-day-blocks',options:{blocks:[{},{date:'2026-10-21',sequence:'42',payments:[second]}]},expected:[syntheticPayment,second]},
 {id:'shifted-headings',options:{shiftRows:7},expected:[syntheticPayment]},
 {id:'swedish-text-money',options:{mutate:wb=>{const s=wb.Sheets[wb.SheetNames[0]];s.B12={t:'s',v:'123,45'};s.E19={t:'s',v:'123,45'};}},expected:[syntheticPayment]},
 {id:'formatted-numeric-reference',options:{mutate:wb=>{wb.Sheets[wb.SheetNames[0]].C19={t:'n',v:17,z:'0000'};}},expected:[syntheticPayment]},
 {id:'excel-date',options:{mutate:wb=>{wb.Sheets[wb.SheetNames[0]].A5={t:'n',v:46315,z:'yyyy-mm-dd'};}},expected:[syntheticPayment]},
 {id:'original-export-conventions',options:{legacyCells:true},expected:[syntheticPayment]},
 {id:'explicit-account',options:{account:'SE3550000000054910000003'},expected:[syntheticPayment]}
].map(c=>({...c,bytes:makeBankgiroXLSX(c.options)}));
const invalid=[
 {id:'wrong-total',options:{totalAmount:1}},
 {id:'wrong-count',options:{declaredCount:2}},
 {id:'invalid-recipient-bg',options:{recipientBankgiro:'bad'}},
 {id:'invalid-date',options:{date:'2026-02-30'}},
 {id:'missing-reference',options:{payments:[{...syntheticPayment,reference:''}]}},
 {id:'missing-payer',options:{payments:[{...syntheticPayment,party:''}]}},
 {id:'numeric-reference-no-zero-format',options:{mutate:wb=>{wb.Sheets[wb.SheetNames[0]].C19={t:'n',v:17,z:'General'};}}},
 {id:'negative-payment',options:{payments:[{...syntheticPayment,amount:-1}]}},
 {id:'duplicate-payment',options:{payments:[syntheticPayment,syntheticPayment]}},
 {id:'duplicate-report',options:{blocks:[{sequence:'41'},{sequence:'41'}]}},
 {id:'cached-formula',options:{mutate:wb=>{wb.Sheets[wb.SheetNames[0]].E19.f='123.45';}}}
].map(c=>({...c,bytes:makeBankgiroXLSX(c.options)}));
invalid.push({id:'corrupt-archive',bytes:new Uint8Array([80,75,3,4,1])},{id:'oversized-file',bytes:new Uint8Array(15_000_001)});
let correctSenders=0,correctReferences=0,correctRows=0,parsedRows=0,acceptedValid=0,falseAccepted=0,processingMs=0;
const outcomes=[];
for(const c of [...valid.map(c=>({...c,valid:true})),...invalid.map(c=>({...c,valid:false}))]){
 let rows=[],accepted=false;const started=performance.now();try{rows=parser(c.bytes,`synthetic-${c.id}.xlsx`);accepted=true;}catch{}processingMs+=performance.now()-started;
 if(c.valid){if(accepted)acceptedValid++;parsedRows+=rows.length;for(let n=0;n<c.expected.length;n++){const r=rows[n],expected=c.expected[n];if(r?.party===expected.party)correctSenders++;if(r?.payerReference===expected.reference)correctReferences++;if(r?.party===expected.party&&r?.payerReference===expected.reference&&r?.amount===expected.amount&&r?.payerBankgiro===expected.payerBankgiro&&r?.recipientBankgiro==='1234-5678')correctRows++;}}
 else if(accepted)falseAccepted++;
 outcomes.push({case:c.id,valid:c.valid,accepted,rows:rows.length});
}
const expectedRows=valid.reduce((n,c)=>n+c.expected.length,0),pct=n=>Math.round(n/expectedRows*10000)/100;
const corpusHash=createHash('sha256');for(const c of [...valid,...invalid])corpusHash.update(c.id).update(c.bytes);
const report={phase,measuredAt:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse',baseline],{cwd:root,encoding:'utf8'}).trim(),candidateCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),candidateWorktreeDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),corpusSha256:corpusHash.digest('hex'),scope:'Identical synthetic XLSX byte corpus, public specification parser; database/reconciliation outcomes require separate integration tests.',validFiles:valid.length,invalidFiles:invalid.length,expectedRows,acceptedValidFiles:acceptedValid,correctSenders,correctReferences,correctParsedRows:correctRows,parsedRows,senderAccuracyPercent:pct(correctSenders),referenceAccuracyPercent:pct(correctReferences),rowAccuracyPercent:pct(correctRows),falseAcceptedInvalidFiles:falseAccepted,falseAcceptancePercent:Math.round(falseAccepted/invalid.length*10000)/100,rejectedInvalidFiles:invalid.length-falseAccepted,processingMs:Math.round(processingMs*1000)/1000,databaseImportedRows:null,falseAutomaticMatches:null,financialDuplicates:null,manualReviewCases:null,outcomes};
if(args.output){const output=resolve(root,args.output);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
