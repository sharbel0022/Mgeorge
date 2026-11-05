import api from "file:///workspace/scratch/4d79ab4bea8e/onboarding/node_modules/tesseract.js/src/index.js";
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {serialize} from 'node:v8';
const dir="/tmp/mgeorge-v2-documents-diagnosis-7xwb632e/diagnostic/holdout-v2-normal-09",sha=b=>createHash('sha256').update(b).digest('hex');
const write=(name,value)=>writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let calls=0;export const PSM=api.PSM;
export async function createWorker(...workerArgs){
 const parameters=[],worker=await api.createWorker(...workerArgs),recognize=worker.recognize,setParameters=worker.setParameters;
 worker.setParameters=async function(...args){parameters.push(structuredClone(args));return Reflect.apply(setParameters,this,args);};
 worker.recognize=async function(...args){
  if(++calls!==1)throw Error('More than one diagnostic recognition was attempted');
  const png=Buffer.from(args[0]);writeFileSync(dir+'/recognition-input.png',png,{flag:'wx'});
  write('recognition-start.json',{calls,startedAt:new Date().toISOString(),workerLanguage:workerArgs[0],workerOEM:workerArgs[1],workerOptions:workerArgs[2],parameters,recognitionOptions:args[1],outputOptions:args[2],rasterSha256:sha(png),rasterBytes:png.length,rasterWidth:png.readUInt32BE(16),rasterHeight:png.readUInt32BE(20)});
  const result=await Reflect.apply(recognize,this,args);
  const binary=serialize(result);writeFileSync(dir+'/raw-response.v8',binary,{flag:'wx'});write('raw-response.json',result);
  write('recognition-finished.json',{calls,completedAt:new Date().toISOString(),rawResponseV8Sha256:sha(binary),globalConfidence:result.data?.confidence,rawTextSha256:sha(result.data?.text||''),topLevelKeys:Object.keys(result),dataKeys:Object.keys(result.data||{})});
  return result;
 };
 return worker;
}
