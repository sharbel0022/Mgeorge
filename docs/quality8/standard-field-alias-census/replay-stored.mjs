// One authorized development replay of already consumed observations. No OCR.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {loadInvoiceParsers} from '../../../test/helpers/load-invoice-parsers.mjs';

const out=dirname(fileURLToPath(import.meta.url)),root=resolve(out,'../../..');
const inputs=join(root,'docs/quality8/independent-supported-20261106');
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=file=>readFileSync(join(inputs,file));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(sourceCommit!=='0132d4537c5fd24e6a0af7f3cadf499a73706ed0')throw Error('Replay requires the frozen product commit');
if(execFileSync('git',['diff','HEAD','--','src','sites/lib'],{cwd:root,encoding:'utf8'}))throw Error('Product source is dirty');
const corpus=JSON.parse(read('gold.json')),first=JSON.parse(read('first-results.json'));
const firstHash=sha(read('first-results.json'));
const inputFiles=['first-results.json','gold.json','freeze.json',...corpus.samples.map(sample=>'observations/'+sample.id+'.json')];
const inputHashes=Object.fromEntries(inputFiles.map(file=>[file,sha(read(file))]));
const sourceFiles=['src/invoice-extraction.js','src/invoice-details.js','sites/lib/invoice-fields.js','sites/lib/invoice-details.js','sites/lib/ocr-layout.js','package-lock.json','sites/package-lock.json'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,sha(readFileSync(join(root,file)))]));
const save=(name,data)=>writeFileSync(join(out,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
save('replay-claim.json',{kind:'development replay; already consumed observations',startedAt:new Date().toISOString(),sourceCommit,sourceHashes,inputHashes,scriptSha256:sha(readFileSync(fileURLToPath(import.meta.url))),opticalCalls:0});
const parsers=await loadInvoiceParsers(root),calls={ocr:0,node:0,sites:0},records=[];
for(const sample of corpus.samples){
  const raw=JSON.parse(read('observations/'+sample.id+'.json')),processed=raw.processed;
  const record={id:sample.id,cohort:sample.cohort,language:sample.language,workerCompleted:raw.workerCompleted,parsers:{}};
  for(const [engine,parse]of Object.entries(parsers)){
    calls[engine]++;
    let extraction=null,error=null;
    try{extraction=await parse(processed.text||'',{...sample.metadata,method:processed.method||'pdf',ocrConfidence:processed.confidence??0,ocrEvidence:processed.ocrEvidence,ocrInputSha256:raw.inputSha256});}
    catch(e){error={name:e.name,message:e.message};}
    record.parsers[engine]={extraction,error};
  }
  records.push(record);
}
function norm(field,value){
  if(value===undefined||value===null||value==='')return null;
  if(field.endsWith('_cents'))return typeof value==='number'&&Number.isInteger(value)?value:String(value);
  let text=String(value).normalize('NFC').trim();
  if(field==='organization_number')return text.replace(/\D/g,'');
  if(field==='party')return text.replace(/\s+/g,' ').toLowerCase();
  if(field==='currency')return text.toUpperCase();
  return text;
}
function score(cohort,engine){
  const selected=corpus.samples.filter(sample=>sample.cohort===cohort),baseline=first.engines[engine][cohort];
  const result={documents:selected.length,perField:Object.fromEntries(corpus.fields.map(field=>[field,{TP:0,FP:0,FN:0}])),green:0,falseGreen:0,allNineCorrect:0,parserErrors:0,delta:{recovered:[],lost:[],newWrong:[]}};
  for(const sample of selected){
    const record=records.find(record=>record.id===sample.id),parsed=record.parsers[engine];
    const before=baseline.cases.find(item=>item.id===sample.id),previousWrong=new Set(before.wrong.map(item=>item.field));
    let correct=0;if(parsed.error)result.parserErrors++;
    for(const field of corpus.fields){
      const actual=parsed.extraction?.fields?.[field]?.value??null,eligible=record.workerCompleted&&!parsed.error;
      const matches=eligible&&norm(field,actual)===norm(field,sample.gold[field]);
      if(matches){result.perField[field].TP++;correct++;if(previousWrong.has(field))result.delta.recovered.push({id:sample.id,field,value:actual});}
      else{
        result.perField[field].FN++;if(eligible&&norm(field,actual)!==null)result.perField[field].FP++;
        if(!previousWrong.has(field))result.delta.lost.push({id:sample.id,field,actual});
        if(eligible&&norm(field,actual)!==null)result.delta.newWrong.push({id:sample.id,field,actual,expected:sample.gold[field]});
      }
    }
    if(correct===corpus.fields.length)result.allNineCorrect++;
    if(parsed.extraction?.level==='green'){result.green++;if(correct!==corpus.fields.length)result.falseGreen++;}
  }
  result.total=Object.values(result.perField).reduce((total,item)=>({TP:total.TP+item.TP,FP:total.FP+item.FP,FN:total.FN+item.FN}),{TP:0,FP:0,FN:0});
  result.total.recall=result.total.TP/(result.total.TP+result.total.FN);
  result.total.precision=result.total.TP+result.total.FP?result.total.TP/(result.total.TP+result.total.FP):null;
  result.frozenFirstTotal=baseline.total;
  return result;
}
for(const[file,hash]of Object.entries(inputHashes))if(sha(read(file))!==hash)throw Error('Frozen input changed during replay: '+file);
const result={kind:'development replay of consumed first-pass observations; not independent or optical',finishedAt:new Date().toISOString(),sourceCommit,firstResultsSha256:firstHash,calls,limitations:['Stored text has already passed the old layout reconstruction. Full OCR word/block geometry was not retained, so this replay cannot measure the layout alias changes.','No OCR, rate correction, image editing, source-text rewriting or replacement of the frozen first result.'],engines:{},records};
for(const engine of Object.keys(parsers))result.engines[engine]={normal:score('normal',engine),stress:score('stress',engine)};
save('development-replay.json',result);
console.log(JSON.stringify({calls,sourceCommit,engines:Object.fromEntries(Object.entries(result.engines).map(([name,value])=>[name,{normal:value.normal.total,normalRecovered:value.normal.delta.recovered,normalLost:value.normal.delta.lost,stress:value.stress.total}]))},null,2));
