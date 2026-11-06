import {readFileSync,writeFileSync,appendFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join,extname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const base=dirname(fileURLToPath(import.meta.url));
const root=resolve(process.argv[2]||join(base,'../../..'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const save=(file,obj)=>writeFileSync(join(base,file),JSON.stringify(obj,null,2)+'\n',{flag:'wx'});
const freeze=JSON.parse(readFileSync(join(base,'freeze.json'),'utf8'));
for(const [file,hash] of Object.entries(freeze.files)) if(sha(readFileSync(join(base,file)))!==hash) throw Error('Frozen file changed: '+file);
const productSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(productSha!=='f5d178ea816d276457685fbc0421cf144f7cf655' && execFileSync('git',['diff','f5d178ea816d276457685fbc0421cf144f7cf655','HEAD','--','src','sites/lib','package-lock.json'],{cwd:root,encoding:'utf8'})) throw Error('Product differs from preregistered source');
const trackedDiff=execFileSync('git',['diff','--','src','sites/lib','package-lock.json'],{cwd:root,encoding:'utf8'});
if(trackedDiff) throw Error('Uncommitted product changes');
const require=createRequire(join(root,'package.json'));
const dependencies={};
for(const name of ['@napi-rs/canvas','@tesseract.js-data/swe','tesseract.js','tesseract.js-core','pdfjs-dist']) dependencies[name]=JSON.parse(readFileSync(require.resolve(name+'/package.json'),'utf8')).version;
const sourceFiles=['src/invoice-extraction.js','src/invoice-worker.js','sites/lib/invoice-fields.js','package-lock.json'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,sha(readFileSync(join(root,file)))]));
const modelFiles={};
function hashTree(dir){for(const entry of readdirSync(dir)){const p=join(dir,entry);if(statSync(p).isDirectory())hashTree(p);else if(/\.(?:gz|traineddata|wasm)$/.test(p))modelFiles[p]=sha(readFileSync(p));}}
hashTree(require('@tesseract.js-data/swe').langPath);
hashTree(dirname(require.resolve('tesseract.js-core/package.json')));
save('run-claim.json',{startedAt:new Date().toISOString(),sourceCommit:productSha,approvedProductCommit:'f5d178ea816d276457685fbc0421cf144f7cf655',freezeSha256:sha(readFileSync(join(base,'freeze.json'))),node:process.version,platform:process.platform,arch:process.arch,dependencies,sourceHashes,modelFiles,preflightCalls:0});
function resolveLocal(importer,specifier){const target=resolve(dirname(importer),specifier);const choices=extname(target)?[target]:[target,target+'.js',target+'.mjs',target+'.ts',join(target,'index.js')];const match=choices.find(p=>existsSync(p));if(!match||!match.startsWith(root+'/'))throw Error('Unresolvable local import');return match;}
const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
const sitesEntry=join(root,'sites/lib/invoice-fields.js');
// Loading adapter only: no implementation inspection or changes.
let sitesSource=readFileSync(sitesEntry,'utf8');
sitesSource=sitesSource.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_quote,specifier)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(sitesEntry,specifier)).href));
const sites=await import('data:text/javascript;base64,'+Buffer.from(sitesSource).toString('base64'));
const corpus=JSON.parse(readFileSync(join(base,'gold.json'),'utf8'));
const engines=[['node',node.interpretInvoice],['sites',sites.interpretInvoice]];
const records=[];const calls={worker:0,node:0,sites:0};
const event=obj=>appendFileSync(join(base,'call-events.jsonl'),JSON.stringify({at:new Date().toISOString(),...obj})+'\n');
for(const sample of corpus.samples){
 const bytes=readFileSync(join(base,sample.image));const inputSha256=sha(bytes);
 calls.worker++;event({id:sample.id,call:'worker',phase:'start'});
 let processed,workerThrown=null;const start=Date.now();
 try{processed=await node.runDocumentProcess(bytes,sample.mimeType);}catch(e){workerThrown={name:e.name,message:e.message,stack:e.stack};processed={};}
 const workerCompleted=!workerThrown&&!processed.error;
 const raw={id:sample.id,inputSha256,workerCompleted,workerThrown,elapsedMs:Date.now()-start,processed};
 save('observations/'+sample.id+'.json',raw);event({id:sample.id,call:'worker',phase:'end',workerCompleted});
 const parsers={};
 for(const [name,parse] of engines){calls[name]++;event({id:sample.id,call:name,phase:'start'});let extraction=null,error=null;try{extraction=await parse(processed.text||'',{...sample.metadata,method:processed.method||'pdf',ocrConfidence:processed.confidence??0,ocrEvidence:processed.ocrEvidence,ocrInputSha256:inputSha256});}catch(e){error={name:e.name,message:e.message,stack:e.stack};}parsers[name]={extraction,error};event({id:sample.id,call:name,phase:'end',error});}
 const record={id:sample.id,cohort:sample.cohort,language:sample.language,workerCompleted,parsers};save('observations/'+sample.id+'-parsers.json',record);records.push(record);
 console.log(JSON.stringify({id:sample.id,workerCompleted,elapsedMs:raw.elapsedMs,levels:Object.fromEntries(engines.map(([e])=>[e,parsers[e].extraction?.level??'error']))}));
}
function norm(field,value){if(value===undefined||value===null||value==='')return null;if(field.endsWith('_cents'))return typeof value==='number'&&Number.isInteger(value)?value:String(value);let text=String(value).normalize('NFC').trim();if(field==='organization_number')return text.replace(/\D/g,'');if(field==='party')return text.replace(/\s+/g,' ').toLowerCase();if(field==='currency')return text.toUpperCase();return text;}
function score(selected,engine){const result={documents:selected.length,workerCompleted:0,workerFailed:0,parserFailed:0,allNineCorrect:0,green:0,falseGreen:0,levels:{},directionMetadataCorrect:0,perField:Object.fromEntries(corpus.fields.map(f=>[f,{TP:0,FP:0,FN:0}])),cases:[]};for(const sample of selected){const rec=records.find(r=>r.id===sample.id);const p=rec.parsers[engine];if(rec.workerCompleted)result.workerCompleted++;else result.workerFailed++;if(p.error)result.parserFailed++;const level=p.extraction?.level??'error';result.levels[level]=(result.levels[level]||0)+1;let correct=0;const wrong=[];for(const field of corpus.fields){const actual=p.extraction?.fields?.[field]?.value??null;const eligible=rec.workerCompleted&&!p.error;const expected=sample.gold[field];const got=norm(field,actual);if(eligible&&got===norm(field,expected)){result.perField[field].TP++;correct++;}else{result.perField[field].FN++;if(eligible&&got!==null)result.perField[field].FP++;wrong.push({field,expected,actual,workerCompleted:rec.workerCompleted});}}if(correct===9)result.allNineCorrect++;if(level==='green'){result.green++;if(correct!==9)result.falseGreen++;}if(p.extraction?.fields?.direction?.value==='supplier')result.directionMetadataCorrect++;result.cases.push({id:sample.id,correct,level,wrong});}const total=Object.values(result.perField).reduce((a,v)=>({TP:a.TP+v.TP,FP:a.FP+v.FP,FN:a.FN+v.FN}),{TP:0,FP:0,FN:0});result.total={...total,recall:total.TP/(total.TP+total.FN)||0,precision:total.TP+total.FP?total.TP/(total.TP+total.FP):null};result.targetMet=result.total.recall>=.85&&result.total.precision!==null&&result.total.precision>=.98;return result;}
const normal=corpus.samples.filter(s=>s.cohort==='normal');const results={finishedAt:new Date().toISOString(),calls,workerCompleted:records.filter(r=>r.workerCompleted).length,workerFailed:records.filter(r=>!r.workerCompleted).length,engines:{}};
for(const [name] of engines)results.engines[name]={normal:score(normal,name),normalSwedish:score(normal.filter(s=>s.language==='sv'),name),normalEnglish:score(normal.filter(s=>s.language==='en'),name),completedOnlyNormal:score(normal.filter(s=>records.find(r=>r.id===s.id).workerCompleted),name),stress:score(corpus.samples.filter(s=>s.cohort==='stress'),name)};
save('first-results.json',results);
console.log(JSON.stringify({calls,workerCompleted:results.workerCompleted,workerFailed:results.workerFailed,normal:Object.fromEntries(engines.map(([n])=>[n,results.engines[n].normal.total])),stress:Object.fromEntries(engines.map(([n])=>[n,results.engines[n].stress.total]))},null,2));
