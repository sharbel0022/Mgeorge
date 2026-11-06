import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const workerUrl=pathToFileURL(process.env.OCR_DIAGNOSTIC_WORKER).href;
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='tesseract.js'&&context.parentURL===workerUrl)return {url:new URL('./capture-tesseract.mjs',import.meta.url).href,shortCircuit:true};
  return nextResolve(specifier,context);
}});
