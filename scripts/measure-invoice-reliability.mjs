// Measures this declared synthetic text corpus only; not optical or production accuracy.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadInvoiceParsers} from '../test/helpers/load-invoice-parsers.mjs';
import {reliabilityCases,reliabilityContext} from '../test/helpers/invoice-reliability-cases.mjs';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const root=resolve(option('--source-root')||'.'),parsers=await loadInvoiceParsers(root);
const hash=value=>createHash('sha256').update(value).digest('hex');
const report={synthetic:true,scope:'Declared synthetic labelled text only. Does not measure OCR, arbitrary invoices or production accuracy.',corpusSha256:hash(JSON.stringify(reliabilityCases)),metricDefinitions:{exactAccuracy:'Correct field values including correct nulls / all 13 declared fields per case',precision:'Correct non-null values / all returned non-null values',recall:'Correct non-null values / all expected non-null values',unsafeFalseAcceptRate:'Green results / explicitly must-hold cases'},sourceHashes:Object.fromEntries(['src/invoice-extraction.js','src/invoice-details.js','sites/lib/invoice-fields.js','sites/lib/invoice-details.js'].map(path=>[path,hash(readFileSync(join(root,path)))])),engines:{}};
for(const [engine,interpret] of Object.entries(parsers)){
 const cases=reliabilityCases.map(fixture=>{
  const result=interpret(fixture.text,{...reliabilityContext,...fixture.context});
  const mismatches=Object.entries(fixture.expected).filter(([field,value])=>result.fields[field].value!==value).map(([field,expected])=>({field,expected,actual:result.fields[field].value}));
  const truePositives=Object.entries(fixture.expected).filter(([field,value])=>value!==null&&result.fields[field].value===value).length;
  const falsePositives=Object.entries(fixture.expected).filter(([field,value])=>result.fields[field].value!==null&&result.fields[field].value!==value).length;
  const falseNegatives=Object.entries(fixture.expected).filter(([field,value])=>value!==null&&result.fields[field].value!==value).length;
  const correctNulls=Object.entries(fixture.expected).filter(([field,value])=>value===null&&result.fields[field].value===null).length;
  const detailsCorrect=(!fixture.tableStatus||result.details.table_status===fixture.tableStatus)&&(!fixture.rowCount||result.details.line_items.length===fixture.rowCount);
  const levelCorrect=fixture.mustHold?result.level!=='green':result.level===fixture.expectedLevel;
  return {id:fixture.id,truePositives,falsePositives,falseNegatives,correctNulls,fieldCount:Object.keys(fixture.expected).length,fieldsCorrect:Object.keys(fixture.expected).length-mismatches.length,mismatches,expectedHold:!!fixture.mustHold,level:result.level,levelCorrect,detailsCorrect,caseCorrect:!mismatches.length&&detailsCorrect&&levelCorrect};
 });
 const sum=key=>cases.reduce((n,item)=>n+item[key],0),unsafe=cases.filter(item=>item.expectedHold),positive=cases.filter(item=>!item.expectedHold);
 report.engines[engine]={cases:cases.length,fieldsCorrect:sum('fieldsCorrect'),fieldsTotal:sum('fieldCount'),truePositives:sum('truePositives'),falsePositives:sum('falsePositives'),falseNegatives:sum('falseNegatives'),correctNulls:sum('correctNulls'),precision:sum('truePositives')/(sum('truePositives')+sum('falsePositives')),recall:sum('truePositives')/(sum('truePositives')+sum('falseNegatives')),casesCorrect:cases.filter(item=>item.caseCorrect).length,positiveCasesCorrect:positive.filter(item=>item.caseCorrect).length,positiveCasesTotal:positive.length,unsafeFalseAccepts:unsafe.filter(item=>item.level==='green').length,unsafeCasesTotal:unsafe.length,details:cases};
}
const output=JSON.stringify(report,null,2)+'\n';
if(option('--output'))writeFileSync(resolve(option('--output')),output);else process.stdout.write(output);
for(const [engine,{details,...summary}] of Object.entries(report.engines))console.error(JSON.stringify({engine,...summary,corpusSha256:report.corpusSha256}));
