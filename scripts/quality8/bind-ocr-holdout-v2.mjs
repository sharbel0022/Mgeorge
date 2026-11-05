// Bind a previously committed corpus to a separately delivered implementation.
// This script only reads git objects, source files and dependency metadata.
// It never imports an application parser or invokes OCR.
import {writeFileSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {freezeSource,verifyCorpus,runtimeDependencies,fixturePath,fileHash} from './ocr-holdout-v2-provenance.mjs';

const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),options={};
const names=['--source-root','--target-sha','--freeze-commit','--repository','--output'];
const args=process.argv.slice(2);
for(let n=0;n<args.length;n+=2){
  if(!names.includes(args[n])||!args[n+1]||options[args[n]])throw Error('Usage: bind-ocr-holdout-v2.mjs --source-root FROZEN_SOURCE --target-sha DELIVERED_SHA --freeze-commit CORPUS_SHA --repository SOURCE_REPOSITORY --output NEW_BINDING.json');
  options[args[n]]=args[n+1];
}
if(names.some(name=>!options[name]))throw Error('All binding options are required; do not bind before the implementation delivery is frozen.');
const sourceRoot=resolve(options['--source-root']),repository=resolve(options['--repository']),output=resolve(options['--output']);
const relativeOutput=relative(harnessRoot,output);
if(relativeOutput.startsWith('..')||relativeOutput.startsWith('/'))throw Error('The source binding must be saved and committed in the harness repository before OCR.');
if(existsSync(output))throw Error('Refusing to overwrite a source binding');
const manifest=verifyCorpus(harnessRoot,options['--freeze-commit']);
const source=freezeSource(sourceRoot,options['--target-sha'],repository);
const runtime=runtimeDependencies(sourceRoot);
if(JSON.stringify(runtime)!==JSON.stringify(manifest.runtime))throw Error('Installed dependencies or trained data differ from the preregistered runtime.');
const gold=JSON.parse(readFileSync(join(harnessRoot,fixturePath,'gold.json'),'utf8'));
if(Object.keys(gold.cases).length!==12)throw Error('Literal gold population changed');
const binding={schema:'mgeorge-independent-ocr-source-binding-v2',createdAt:new Date().toISOString(),corpusFreezeCommit:options['--freeze-commit'],
  manifestSha256:fileHash(join(harnessRoot,fixturePath,'manifest.json')),datasetSha256:manifest.datasetSha256,goldSha256:manifest.goldSha256,harnessSha256:manifest.harnessSha256,
  source,runtime,noOcrInvoked:true,rule:'Commit this binding before the first OCR invocation. The corpus, gold and measurement contract remain at their original freeze commit.'};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(binding,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,corpusFreezeCommit:binding.corpusFreezeCommit,targetSourceCommit:source.targetCommit,targetSourceTree:source.targetTree,sourceFiles:Object.keys(source.hashes).length,noOcrInvoked:true},null,2));
