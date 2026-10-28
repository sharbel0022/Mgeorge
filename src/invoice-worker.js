import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createWorker} from 'tesseract.js';
import {imageDimensions} from './image-dimensions.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const require=createRequire(import.meta.url);
let ocr;
async function recognize(bytes){
  ocr ||= await createWorker('swe',1,{langPath:require('@tesseract.js-data/swe').langPath,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  const {data}=await ocr.recognize(bytes);
  return {text:data.text,confidence:data.confidence};
}
// Language packages each have a separate directory. Resolve local files using
// the package's documented langPath rather than making network OCR requests.
async function run(workerData){
  const bytes=new Uint8Array(workerData.bytes);
  if(bytes.length>15_000_000)throw Error('size');
  if(workerData.mime_type!=='application/pdf'){
    imageDimensions(bytes,workerData.mime_type);
    const image=await loadImage(Buffer.from(bytes));
    if(image.width*image.height>12_000_000)throw Error('pixels');
    const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
    return {...await recognize(canvas.toBuffer('image/png')),method:'ocr'};
  }
  const loading=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true,disableFontFace:true,verbosity:0});
  const pdf=await loading.promise;
  try{
    if(workerData.preview){
      const page=await pdf.getPage(1),view=page.getViewport({scale:1.4});
      if(view.width*view.height>12000000)throw Error('pixels');
      const canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));
      await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
      return {preview:canvas.toBuffer('image/png')};
    }
    if(pdf.numPages>10)throw Error('pages');
    let method='pdf',text='',confidence=100;
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n),content=await page.getTextContent();
      let pageText=content.items.map(i=>(i.str||'')+(i.hasEOL?'\n':' ')).join('');
      if(pageText.replace(/\s/g,'').length<60){
        method='ocr';const view=page.getViewport({scale:2});
        if(view.width*view.height>12_000_000)throw Error('pixels');
        const canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
        const result=await recognize(canvas.toBuffer('image/png'));pageText=result.text;confidence=Math.min(confidence,result.confidence);
      }
      text+=pageText+'\n';if(text.length>150000)throw Error('text');
      page.cleanup();
    }
    return {text,method,confidence};
  }finally{await pdf.destroy();}
}
process.once('message',async data=>{
  let result;try{result=await run(data);}catch{result={error:true};}
  finally{if(ocr)await ocr.terminate();}
  process.send(result,()=>process.exit(0));
});
