// Frozen before observations; reads preserved first-pass outputs without invoking parsers.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../..');
const raw=resolve(root,'../independent-ocr-raw/completion-independent-20261106/first-pass');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const corpus=read(join(here,'corpus.json')),binding=read(join(here,'runtime-binding.json')),receipt=read(join(raw,'run-receipt.json'));
if(hash(join(here,'score-first-pass.mjs'))!==binding.harnessHashes['score-first-pass.mjs'])throw Error('Scorer changed after runtime freeze');
if(receipt.opticalCalls!==19||receipt.parserCalls!==38)throw Error('Incomplete fixed denominator');
const mandatory=['invoice_number','party','organization_number','issued_at','due_at','total_cents','net_cents','vat_cents','direction','currency'];
const imageFields=mandatory.filter(x=>x!=='direction');
const critical=['invoice_number','party','organization_number','due_at','total_cents','net_cents','vat_cents','reference','bankgiro','direction','currency'];
const absent=v=>v===null||v===undefined||(typeof v==='string'&&v.trim()==='');
function canonical(field,v){
  if(absent(v))return null;
  if(field.endsWith('_cents'))return Number.isSafeInteger(v)?v:'INVALID_MINOR_UNIT:'+String(v);
  if(field==='party')return String(v).normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('sv-SE');
  if(field==='organization_number')return String(v).replace(/\D/g,'');
  if(field==='invoice_number'||field==='currency')return String(v).trim().toLocaleLowerCase('en-US');
  if(field==='direction')return ({supplier:'incoming',customer:'outgoing'})[v]??v;
  return String(v).trim();
}
function interval(success,total){
  if(!total)return null;
  const z=1.959963984540054,p=success/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return {method:'Wilson 95% descriptive field interval; correlated fields are not independent invoices',lower:Math.max(0,c-h),upper:Math.min(1,c+h)};
}
const details=[];
for(const c of corpus.cases)for(const engine of ['node','sites']){
  const stored=receipt.parsers.find(x=>x.id===c.id&&x.engine===engine);
  if(hash(stored.path)!==stored.sha256)throw Error('Preserved parser output changed: '+c.id+' '+engine);
  const row=read(stored.path),values=Object.fromEntries(Object.entries(row.extraction?.fields??{}).map(([k,v])=>[k,v?.value??null]));
  const fields=Object.keys(c.gold).map(name=>{
    const expected=canonical(name,c.gold[name]),actual=canonical(name,values[name]);
    const correct=expected===actual,emitted=actual!==null,expectedPresent=expected!==null;
    return {name,expected:c.gold[name],actual:values[name]??null,canonicalExpected:expected,canonicalActual:actual,correct,abstained:!emitted,tp:correct&&expectedPresent?1:0,fp:!correct&&emitted?1:0,fn:!correct&&expectedPresent?1:0};
  });
  const error=row.processingError||row.parserError,originalLevel=row.extraction?.level??null;
  const falseGreen=originalLevel==='green'&&Boolean(error||c.review_required||c.population==='stress'||fields.some(f=>critical.includes(f.name)&&!f.correct));
  details.push({id:c.id,engine,population:c.population,language:c.language,layout:c.layout,variation:c.variation,reviewRequired:c.review_required,originalLevel,effectiveLevel:row.effectiveLevel,error,falseGreen,completeImage9:!error&&fields.filter(f=>imageFields.includes(f.name)).every(f=>f.correct),completeMandatory10:!error&&fields.filter(f=>mandatory.includes(f.name)).every(f=>f.correct),fields,issues:row.extraction?.issues??[],parserMs:row.durationMs});
}
function summarize(rows,names){
  const fields=rows.flatMap(r=>r.fields.filter(f=>names.includes(f.name)));
  const sum=k=>fields.reduce((s,f)=>s+f[k],0),tp=sum('tp'),fp=sum('fp'),fn=sum('fn');
  const precision=tp+fp?tp/(tp+fp):null,recall=tp+fn?tp/(tp+fn):null;
  const statuses=rows.reduce((s,r)=>(s[r.effectiveLevel]=(s[r.effectiveLevel]??0)+1,s),{});
  return {documents:rows.length,expectedFields:fields.filter(f=>f.canonicalExpected!==null).length,tp,fp,fn,abstentions:fields.filter(f=>f.canonicalExpected!==null&&f.abstained).length,wrongEmissions:fields.filter(f=>!f.correct&&!f.abstained).length,precision,recall,precisionWilson95:interval(tp,tp+fp),recallWilson95:interval(tp,tp+fn),exactDocuments:rows.filter(r=>!r.error&&r.fields.filter(f=>names.includes(f.name)).every(f=>f.correct)).length,statuses,errors:rows.filter(r=>r.error).length,falseGreens:rows.filter(r=>r.falseGreen).length};
}
const summaries={},acceptance={};
for(const engine of ['node','sites']){
  summaries[engine]={};
  for(const population of ['normal','stress']){
    const rows=details.filter(x=>x.engine===engine&&x.population===population);
    summaries[engine][population]={image9:summarize(rows,imageFields),mandatory10:summarize(rows,mandatory),perField:Object.fromEntries(mandatory.map(f=>[f,summarize(rows,[f])])),inventedPaymentFields:rows.flatMap(r=>r.fields.filter(f=>['reference','bankgiro'].includes(f.name)&&f.fp)).length,byLanguage:Object.fromEntries(['sv','en'].map(l=>[l,summarize(rows.filter(r=>r.language===l),imageFields)]))};
  }
  const normal=summaries[engine].normal.image9,all=details.filter(x=>x.engine===engine);
  acceptance[engine]={precisionTarget:.98,recallTarget:.85,precisionPassed:normal.precision!==null&&normal.precision>=.98,recallPassed:normal.recall!==null&&normal.recall>=.85,zeroFalseGreen:all.every(r=>!r.falseGreen),normalErrors:normal.errors,passed:normal.precision!==null&&normal.precision>=.98&&normal.recall!==null&&normal.recall>=.85&&all.every(r=>!r.falseGreen)&&normal.errors===0};
}
const out={schema:'mgeorge-independent-ocr-score-v1',evaluationId:corpus.id,scoredAt:new Date().toISOString(),manifestSha256:receipt.manifestSha256,runtimeBindingSha256:receipt.runtimeBindingSha256,runReceiptSha256:hash(join(raw,'run-receipt.json')),normalDocuments:16,stressDocuments:3,opticalCalls:receipt.opticalCalls,parserCalls:receipt.parserCalls,opticalErrors:receipt.optical.filter(x=>x.error).length,parserErrors:receipt.parsers.filter(x=>x.parserError).length,summaries,acceptance,details};
const destination=join(here,'scores.json');if(existsSync(destination))throw Error('Refusing to overwrite first scoring');
writeFileSync(destination,JSON.stringify(out,null,2)+'\n',{flag:'wx',flush:true});
console.log(JSON.stringify({acceptance,summaries:Object.fromEntries(Object.entries(summaries).map(([k,v])=>[k,{normal:v.normal.image9,withDirection:v.normal.mandatory10,stress:v.stress.image9}]))},null,2));
