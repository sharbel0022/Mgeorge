import {createHash} from 'node:crypto';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {dirname,resolve,join,relative,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

export const scalarFields=['invoice_number','party','organization_number','issued_at','due_at','total_cents','vat_cents','net_cents','reference','bankgiro','direction','kind','currency'];
export const mandatoryFields=['invoice_number','party','organization_number','issued_at','due_at','total_cents','net_cents','vat_cents','direction','currency'];
export const criticalFields=['invoice_number','party','organization_number','due_at','total_cents','net_cents','vat_cents','reference','bankgiro','direction','currency'];
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const fileHash=file=>hash(readFileSync(file));
export const ordered=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')));
export const graphEntries=['src/invoice-extraction.js','src/invoice-worker.js','sites/lib/invoice-fields.js'];
export const downstreamEntries=['src/payment-overview.js','sites/lib/economy-summary.js','sites/lib/domain.ts','sites/lib/payment-presentation.ts','sites/lib/local-ocr.ts','sites/lib/document-processing.ts','sites/lib/imports.ts'];
export const fixturePath='test/fixtures/quality8/ocr-holdout-v2';
export const harnessFiles=['scripts/quality8/generate-ocr-holdout-v2.py','scripts/quality8/freeze-ocr-holdout-v2.mjs','scripts/quality8/bind-ocr-holdout-v2.mjs','scripts/quality8/measure-ocr-holdout-v2.mjs','scripts/quality8/ocr-holdout-v2-provenance.mjs','test/helpers/ocr-quality-metrics.mjs'];

export function resolveLocal(root,importer,specifier){
  const target=resolve(dirname(importer),specifier);
  const choices=extname(target)?[target]:[target,target+'.js',target+'.mjs',target+'.ts',join(target,'index.js')];
  const match=choices.find(file=>existsSync(file));
  if(!match||!match.startsWith(root+'/'))throw Error('Unresolvable local source import: '+specifier+' from '+relative(root,importer));
  return match;
}

export function localGraph(root,entries){
  const pending=entries.map(file=>join(root,file)),seen=new Set();
  while(pending.length){
    const file=pending.pop();if(seen.has(file))continue;seen.add(file);
    const source=readFileSync(file,'utf8');
    for(const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\1/g))pending.push(resolveLocal(root,file,match[2]));
  }
  return [...seen].map(file=>relative(root,file)).sort();
}

export function freezeSource(root,targetCommit,repository=root){
  if(!/^[a-f0-9]{40}$/.test(targetCommit))throw Error('An exact delivered source commit is required');
  const git=(...args)=>execFileSync('git',args,{cwd:repository,encoding:'utf8'}).trim();
  // Include every tracked file in both runtime source trees, as well as the
  // precise traversed OCR/parser and downstream decision graphs. This is
  // intentionally broader than the modules executed by this measurement.
  const productFiles=git('ls-tree','-r','--name-only',targetCommit,'--','src','sites/lib').split('\n').filter(Boolean);
  const locks=['package.json','package-lock.json','sites/package.json','sites/package-lock.json'];
  const files=[...new Set([...productFiles,...locks])].sort();
  const hashes={};
  for(const file of files){
    const bytes=readFileSync(join(root,file));
    const committed=execFileSync('git',['show',targetCommit+':'+file],{cwd:repository,maxBuffer:10_000_000});
    if(!bytes.equals(committed))throw Error('Selected source differs from target commit: '+file);
    hashes[file]=hash(bytes);
  }
  const opticalGraph=localGraph(root,graphEntries),downstreamGraph=localGraph(root,downstreamEntries);
  if([...opticalGraph,...downstreamGraph].some(file=>!hashes[file]))throw Error('Source graph is not fully represented by the frozen inventory');
  return {targetCommit,targetTree:git('rev-parse',targetCommit+'^{tree}'),hashAlgorithm:'SHA-256',sourceSha256:hash(JSON.stringify(hashes)),hashes,opticalGraph,downstreamGraph,
    graphScope:'All tracked src/ and sites/lib/ files plus dependency manifests. opticalGraph is the local transitive import graph of the actual worker and both parsers; downstreamGraph records contextual import, domain, economy and payment-presentation code, without claiming those services were executed.'};
}

export function verifySource(root,source){
  const differences=[];
  for(const [file,want] of Object.entries(source.hashes))if(!existsSync(join(root,file))||fileHash(join(root,file))!==want)differences.push(file);
  if(differences.length)throw Error('Frozen source mismatch: '+differences.join(', '));
  return true;
}

export function runtimeDependencies(root){
  const require=createRequire(join(root,'package.json'));
  const versions=Object.fromEntries(['@napi-rs/canvas','@tesseract.js-data/swe','tesseract.js','tesseract.js-core','pdfjs-dist'].map(name=>[name,JSON.parse(readFileSync(require.resolve(name+'/package.json'),'utf8')).version]));
  const langPath=require('@tesseract.js-data/swe').langPath,coreRoot=dirname(require.resolve('tesseract.js-core/package.json'));
  const artifacts={};
  for(const [prefix,directory,pattern] of [['swe',langPath,/\.traineddata(?:\.gz)?$/],['tesseract-core',coreRoot,/\.wasm$/]]){
    for(const name of readdirSync(directory).sort())if(pattern.test(name))artifacts[prefix+'/'+name]=fileHash(join(directory,name));
  }
  if(!Object.keys(artifacts).some(file=>file.startsWith('swe/')))throw Error('Local Swedish trained data unavailable');
  return {versions,artifacts};
}


/** Only the corpus and harness are frozen first. Source binding is a separate,
 * committed artifact after the implementation's exact delivery SHA is known. */
export function verifyCorpus(root,freezeCommit){
  if(!/^[a-f0-9]{40}$/.test(freezeCommit))throw Error('An exact corpus freeze commit is required');
  const manifestPath=join(root,fixturePath,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(manifest.schema!=='mgeorge-independent-ocr-holdout-v2'||manifest.sourceBinding.status!=='pending-delivery-sha-at-corpus-freeze')throw Error('Unexpected v2 preregistration');
  const fixed={...manifest.corpusHashes,...manifest.harnessHashes};
  for(const [file,want] of Object.entries(fixed)){
    if(fileHash(join(root,file))!==want)throw Error('Frozen corpus or harness changed: '+file);
    const committed=execFileSync('git',['show',freezeCommit+':'+file],{cwd:root,maxBuffer:20_000_000});
    if(hash(committed)!==want)throw Error('Corpus or harness not present in freeze commit: '+file);
  }
  const manifestCommitted=execFileSync('git',['show',freezeCommit+':'+fixturePath+'/manifest.json'],{cwd:root,maxBuffer:20_000_000});
  if(hash(manifestCommitted)!==fileHash(manifestPath))throw Error('Preregistration changed after freeze');
  if(manifest.images.length!==12||manifest.images.filter(image=>image.population==='normal-readable').length!==10||manifest.images.filter(image=>image.population==='stress').length!==2)throw Error('Predetermined population changed');
  return manifest;
}
