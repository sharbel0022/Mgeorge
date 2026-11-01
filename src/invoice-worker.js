import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createWorker} from 'tesseract.js';
import {imageDimensions} from './image-dimensions.js';
import {ocrRasterSize} from './ocr-raster-size.js';
import {reconstructPdfText} from './pdf-text.js';
import {interpretInvoice} from './invoice-extraction.js';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';

const require=createRequire(import.meta.url);
const rasterOperations=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat]);
function usableInvoiceText(text){
  const {fields}=interpretInvoice(text);
  return fields.invoice_number.value!=null&&fields.total_cents.value!=null;
}
let ocr;
async function recognize(canvas){
  // Give small glyphs more sampling resolution without discarding gray/color
  // detail. Keep the original raster size when 1.5x would exceed the pixel cap.
  const size=ocrRasterSize(canvas.width,canvas.height);
  if(size.width!==canvas.width||size.height!==canvas.height){
    const enlarged=createCanvas(size.width,size.height),context=enlarged.getContext('2d');
    context.imageSmoothingQuality='high';context.drawImage(canvas,0,0,size.width,size.height);canvas=enlarged;
  }
  ocr ||= await createWorker('swe',1,{langPath:require('@tesseract.js-data/swe').langPath,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  const {data}=await ocr.recognize(canvas.toBuffer('image/png'));
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
    return {...await recognize(canvas),method:'ocr'};
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
      let pageText=reconstructPdfText(content.items);
      if(text.length+pageText.length>150000)throw Error('text');
      // A digital archive footer can be long while every invoice field is in a
      // scanned image. Inspect content, not just text length; a native invoice
      // with a logo retains PDF provenance when its text already has the fields.
      const needsOpticalText=pageText.replace(/\s/g,'').length<60||(!usableInvoiceText(pageText)&&(await page.getOperatorList()).fnArray.some(op=>rasterOperations.has(op)));
      if(needsOpticalText){
        method='ocr';const view=page.getViewport({scale:2});
        if(view.width*view.height>12_000_000)throw Error('pixels');
        const canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
        const result=await recognize(canvas);pageText=result.text;confidence=Math.min(confidence,result.confidence);
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
