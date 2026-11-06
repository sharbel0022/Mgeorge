import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,statSync,realpathSync,existsSync} from 'node:fs';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {cpus,loadavg,release} from 'node:os';
import {hash,fileHash,freezeSource,verifySource,verifyCorpus,runtimeDependencies,localGraph,resolveLocal,mandatoryFields,criticalFields} from '../../../../scripts/quality8/ocr-holdout-v2-provenance.mjs';
import {projectReviewedFields,evaluateDocument,summarizeDocuments} from '../../../../test/helpers/ocr-quality-metrics.mjs';

export {hash,fileHash,freezeSource,verifySource,verifyCorpus,runtimeDependencies,localGraph,mandatoryFields,criticalFields};
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
export const folder=join(root,'docs/quality8/ocr-v2-psm6-diagnostic');
export const packet=join(folder,'packet');
export const target='41aadcef5fc6f65cc73979997b195c7b4f12eec1';
export const corpusCommit='9d9d0736d5f9f02e87ea055f328b9e44518badea';
export const fixture=join(root,'test/fixtures/quality8/ocr-holdout-v2');
export const firstPath=join(root,'docs/quality8/ocr-independent-holdout-v2-result.json');
export const baselinePath=join(root,'docs/quality8/ocr-v2-stored-text-reparse-result.json');
export const json=path=>JSON.parse(readFileSync(path,'utf8'));
export const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:30_000_000}).trim();
export const percentCount=text=>(String(text||'').match(/%/g)||[]).length;

export function runtimeInventory(){
  const req=createRequire(join(root,'package.json')),packages={},missingOptional=[];
  const locate=(request,name)=>{
    try{return request.resolve(name+'/package.json');}catch{}
    let entry;try{entry=request.resolve(name);}catch{return null;}
    for(let dir=dirname(entry);dirname(dir)!==dir;dir=dirname(dir)){
      const file=join(dir,'package.json');if(existsSync(file)&&json(file).name===name)return file;
    }
    return null;
  };
  const visit=(request,name,optional=false)=>{
    const pkgFile=locate(request,name);if(!pkgFile){if(optional){missingOptional.push(name);return;}throw Error('Missing runtime dependency '+name);}
    const dir=realpathSync(dirname(pkgFile));if(packages[dir])return;
    const pkg=json(pkgFile),files={};packages[dir]={name:pkg.name,version:pkg.version,files};
    const walk=base=>{for(const item of readdirSync(base).sort()){if(item==='node_modules'||item==='.git')continue;const full=join(base,item);if(statSync(full).isDirectory())walk(full);else if(statSync(full).isFile())files[relative(dir,full)]=fileHash(full);}};walk(dir);
    const child=createRequire(pkgFile),optionalNames=pkg.optionalDependencies||{};
    for(const dependency of Object.keys(pkg.dependencies||{}).sort())visit(child,dependency,dependency in optionalNames);
    for(const dependency of Object.keys(optionalNames).sort())if(!(dependency in (pkg.dependencies||{})))visit(child,dependency,true);
  };
  for(const name of [...new Set([...Object.keys(json(join(root,'package.json')).dependencies),'tesseract.js-core'])].sort())visit(req,name);
  return {node:process.version,nodeExecutable:realpathSync(process.execPath),nodeExecutableSha256:fileHash(realpathSync(process.execPath)),versions:process.versions,platform:process.platform,architecture:process.arch,osRelease:release(),cpuModel:cpus()[0]?.model,cpuCount:cpus().length,dependencies:runtimeDependencies(root),nodeModules:realpathSync(join(root,'node_modules')),packageTrees:packages,missingOptional:[...new Set(missingOptional)].sort()};
}
export const hostObservation=()=>({at:new Date().toISOString(),load:loadavg()});

export async function parsers(){
  const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
  const entry=join(root,'sites/lib/invoice-fields.js');
  const source=readFileSync(entry,'utf8').replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,_quote,specifier)=>prefix+JSON.stringify(pathToFileURL(resolveLocal(root,entry,specifier)).href));
  const sites=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  return [['node',node.interpretInvoice],['sites',sites.interpretInvoice]];
}
export function parseRows(engines,item,processed,gold,error=null){
  return engines.map(([engine,parse])=>{
    let extraction,parserError=null;
    try{extraction=parse(processed.text||'',{...item.metadata,method:processed.method||'ocr',ocrConfidence:processed.confidence??0,ocrEvidence:processed.ocrEvidence,ocrInputSha256:item.sha256});}
    catch(e){extraction={fields:{},level:'red',issues:[]};parserError=String(e);}
    if(error)extraction.level='red';
    const row=evaluateDocument({id:item.id,family:item.layout,subset:item.population,engine,...projectReviewedFields(extraction,gold.cases[item.id]),level:extraction.level,requireReview:gold.cases[item.id].requireReview,durationMs:null,error:error||parserError,issues:extraction.issues||[],fieldEvidence:extraction.fields});
    row.falseGreenCritical=row.green&&Boolean(row.error||row.requireReview||item.population==='stress'||row.fields.some(field=>criticalFields.includes(field.name)&&!field.correct));
    return row;
  });
}
function scope(rows,names){return rows.map(row=>evaluateDocument({id:row.id,family:row.family,subset:row.subset,engine:row.engine,expected:Object.fromEntries(row.fields.filter(f=>names.includes(f.name)).map(f=>[f.name,f.expected])),actual:Object.fromEntries(row.fields.filter(f=>names.includes(f.name)).map(f=>[f.name,f.actual])),level:row.level,requireReview:row.requireReview,durationMs:null,error:row.error}));}
export function summaries(rows){
  return Object.fromEntries(['node','sites'].map(engine=>{
    const selected=rows.filter(row=>row.engine===engine),normal=selected.filter(row=>row.subset==='normal-readable'),stress=selected.filter(row=>row.subset==='stress');
    const summarize=population=>({all13:summarizeDocuments(population),mandatory10:summarizeDocuments(scope(population,mandatoryFields)),mandatoryImage9:summarizeDocuments(scope(population,mandatoryFields.filter(f=>f!=='direction')))});
    return [engine,{normal:summarize(normal),stress:summarize(stress),falseGreenCritical:selected.filter(row=>row.falseGreenCritical).length}];
  }));
}
export function compareFields(before,after){
  return after.map(row=>{
    const old=before.find(r=>r.id===row.id&&r.engine===row.engine);assert.ok(old);
    return {id:row.id,engine:row.engine,population:row.subset,fields:row.fields.map(field=>{
      const previous=old.fields.find(f=>f.name===field.name);assert.ok(previous);
      return {name:field.name,expected:field.expected,psm3:previous.actual,psm6:field.actual,psm3Correct:previous.correct,psm6Correct:field.correct,change:previous.correct&&!field.correct?'regression':!previous.correct&&field.correct?'recovery':JSON.stringify(previous.actual)!==JSON.stringify(field.actual)?'different-output':'unchanged'};
    })};
  });
}
