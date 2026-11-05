import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createCanvas} from '../../node_modules/@napi-rs/canvas/index.js';
import ts from 'typescript';
// Tesseract chooses its path resolver at import time. Resolve its real Node
// backend before the adapter installs the minimal browser canvas document.
import 'tesseract.js';
import {dataModule,libUrl} from './invoice-module-loader.mjs';

// Run the browser algorithm with real PDF.js, real raster rendering and local
// Tesseract. Only browser asset URLs/DOM canvas allocation need Node adapters.
export async function browserOcrFixture(t){
  const originalDocument=globalThis.document,originalCanvas=globalThis.HTMLCanvasElement;
  globalThis.HTMLCanvasElement=createCanvas(1,1).constructor;
  globalThis.document={createElement(name){if(name!=='canvas')throw Error('Unexpected DOM operation');return createCanvas(1,1);}};
  t.after(()=>{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;if(originalCanvas===undefined)delete globalThis.HTMLCanvasElement;else globalThis.HTMLCanvasElement=originalCanvas;});
  const pdf=new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.mjs',import.meta.url).href,worker=new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',import.meta.url).href;
  const pdfModule=dataModule(`import * as pdf from ${JSON.stringify(pdf)};export const OPS=pdf.OPS;export const GlobalWorkerOptions={};export function getDocument(options){pdf.GlobalWorkerOptions.workerSrc=${JSON.stringify(worker)};return pdf.getDocument({...options,verbosity:0});}`);
  const require=createRequire(import.meta.url),tesseract=pathToFileURL(require.resolve('tesseract.js')).href,langPath=require('@tesseract.js-data/swe').langPath;
  const ocrModule=dataModule(`import {createWorker as createNodeWorker,PSM} from ${JSON.stringify(tesseract)};export {PSM};export function createWorker(language,oem){return createNodeWorker(language,oem,{langPath:${JSON.stringify(langPath)},cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});}`);
  let source=ts.transpileModule(readFileSync(new URL('../../lib/local-ocr.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [name,url]of Object.entries({'pdfjs-dist':pdfModule,'tesseract.js':ocrModule,'./pdf-text.js':libUrl('pdf-text.js'),'./ocr-bankgiro-evidence.js':libUrl('ocr-bankgiro-evidence.js'),'./ocr-layout.js':libUrl('ocr-layout.js')}))for(const quote of ["'",'"'])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
  return import(dataModule(source));
}
