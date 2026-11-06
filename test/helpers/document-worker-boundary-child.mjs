// Test-only dependency faults. The actual worker entrypoint is imported below.
import {createRequire} from 'node:module';
const mode=process.argv[2],privateFailure='PRIVATE_IMAGE_TEXT secret-token /private/customer/original.png';
if(['exit0','exit7','signal','hang'].includes(mode)){
  process.once('message',()=>{
    if(mode==='hang')return setInterval(()=>{},1000);
    if(mode==='signal')return process.kill(process.pid,'SIGTERM');
    process.exit(mode==='exit0'?0:7);
  });
}else{
  const require=createRequire(import.meta.url),tesseract=require('tesseract.js');
  tesseract.createWorker=async()=>({
    setParameters:async()=>{},
    recognize:async()=>{
      if(mode==='read-error-cleanup')throw Error(privateFailure);
      return{data:{text:'SYNTHETIC COMPLETED RECEIPT',confidence:96,blocks:[]}};
    },
    terminate:async()=>{if(mode==='cleanup'||mode==='read-error-cleanup')throw Error(privateFailure);},
  });
  if(mode==='send-callback-error')process.send=(_value,callback)=>{callback(Error(privateFailure));return false;};
  if(mode==='send-throw')process.send=()=>{throw Error(privateFailure);};
  await import('../../src/invoice-worker.js');
}
