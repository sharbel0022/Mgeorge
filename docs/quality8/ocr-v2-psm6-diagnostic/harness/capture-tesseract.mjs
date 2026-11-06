import assert from 'node:assert/strict';
import api from 'tesseract.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {serialize} from 'node:v8';

const dir=process.env.OCR_DIAGNOSTIC_CASE;
const intent=JSON.parse(readFileSync(join(dir,'intent.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(name,value)=>writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
let workers=0,calls=0;
export const PSM=api.PSM;
export async function createWorker(...workerArgs){
  assert.equal(++workers,1,'One cold worker per image');
  assert.equal(workerArgs[0],'swe');assert.equal(workerArgs[1],1);
  assert.equal(workerArgs[2]?.cacheMethod,'none');
  const parameters=[],worker=await api.createWorker(...workerArgs);
  const recognize=worker.recognize,setParameters=worker.setParameters;
  worker.setParameters=async function(...args){parameters.push(structuredClone(args));return Reflect.apply(setParameters,this,args);};
  worker.recognize=async function(...args){
    assert.equal(++calls,1,'A second recognition is forbidden');
    assert.deepEqual(parameters,[[{tessedit_pageseg_mode:PSM.SINGLE_BLOCK}]]);
    assert.deepEqual(args[1],{});assert.deepEqual(args[2],{text:true,blocks:true});
    const png=Buffer.from(args[0]);
    assert.equal(sha(png),intent.expectedRasterSha256,'Actual raster differs from preregistered raster');
    assert.equal(png.readUInt32BE(16),intent.rasterWidth);assert.equal(png.readUInt32BE(20),intent.rasterHeight);
    writeFileSync(join(dir,'recognition-input.png'),png,{flag:'wx'});
    write('recognition-start.json',{calls,startedAt:new Date().toISOString(),workerLanguage:workerArgs[0],workerOEM:workerArgs[1],workerOptions:workerArgs[2],parameters,recognitionOptions:args[1],outputOptions:args[2],rasterSha256:sha(png),rasterBytes:png.length,rasterWidth:png.readUInt32BE(16),rasterHeight:png.readUInt32BE(20)});
    const result=await Reflect.apply(recognize,this,args);
    const bytes=serialize(result);
    writeFileSync(join(dir,'raw-response.v8'),bytes,{flag:'wx'});
    write('raw-response.json',result);
    write('recognition-finished.json',{calls,completedAt:new Date().toISOString(),rawResponseV8Sha256:sha(bytes),globalConfidence:result.data?.confidence,rawTextSha256:sha(result.data?.text||''),topLevelKeys:Object.keys(result),dataKeys:Object.keys(result.data||{})});
    return result;
  };
  return worker;
}
