import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createWorker,PSM} from 'tesseract.js';
import {imageDimensions} from './image-dimensions.js';
import {ocrRasterSize} from './ocr-raster-size.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence} from '../sites/lib/ocr-bankgiro-evidence.js';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {reconstructPdfText,pdfPageNeedsOpticalText} from './pdf-text.js';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';

const require=createRequire(import.meta.url);
let ocr;
async function recognize(canvas,page=1){
  // Give small glyphs more sampling resolution without discarding gray/color
  // detail. Keep the original raster size when 1.5x would exceed the pixel cap.
  const size=ocrRasterSize(canvas.width,canvas.height);
  if(size.width!==canvas.width||size.height!==canvas.height){
    const enlarged=createCanvas(size.width,size.height),context=enlarged.getContext('2d');
    context.imageSmoothingQuality='high';context.drawImage(canvas,0,0,size.width,size.height);canvas=enlarged;
  }
  if(!ocr){
    ocr=await createWorker('swe',1,{langPath:require('@tesseract.js-data/swe').langPath,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
    await ocr.setParameters({tessedit_pageseg_mode:PSM.AUTO});
  }
  const {data}=await ocr.recognize(canvas.toBuffer('image/png'),{},{text:true,blocks:true});
  const layout=reconstructOcrLayout(data.text,data.blocks);
  return {text:layout.text,confidence:data.confidence,pageEvidence:collectOcrBankgiroPage(layout.text,layout.blocks,page)};
}
// Language packages each have a separate directory. Resolve local files using
// the package's documented langPath rather than making network OCR requests.
async function run(workerData){
  const bytes=new Uint8Array(workerData.bytes);
  if(bytes.length>15_000_000)throw Error('size');
  const inputSha256=ocrInputHash(bytes);
  if(workerData.mime_type!=='application/pdf'){
    imageDimensions(bytes,workerData.mime_type);
    const image=await loadImage(Buffer.from(bytes));
    if(image.width*image.height>12_000_000)throw Error('pixels');
    const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
    const result=await recognize(canvas);
    return {text:result.text,confidence:result.confidence,method:'ocr',ocrEvidence:bindOcrBankgiroEvidence(inputSha256,result.text,[result.pageEvidence])};
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
    let method='pdf',text='',confidence=100;const wordPages=[];
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n),content=await page.getTextContent();
      let pageText=reconstructPdfText(content.items);
      let pageEvidence=collectOcrBankgiroPage(pageText,null,n);
      if(text.length+pageText.length>150000)throw Error('text');
      const viewAtOne=page.getViewport({scale:1});
      const needsOpticalText=pdfPageNeedsOpticalText(content.items,pageText,await page.getOperatorList(),OPS,viewAtOne.width*viewAtOne.height);
      if(needsOpticalText){
        method='ocr';const view=page.getViewport({scale:2});
        if(view.width*view.height>12_000_000)throw Error('pixels');
        const canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
        const result=await recognize(canvas,n);pageText=result.text;pageEvidence=result.pageEvidence;confidence=Math.min(confidence,result.confidence);
      }
      wordPages.push(pageEvidence);
      text+=(n>1?'\f\n':'')+pageText+'\n';if(text.length>150000)throw Error('text');
      page.cleanup();
    }
    return {text,method,confidence,...(method==='ocr'?{ocrEvidence:bindOcrBankgiroEvidence(inputSha256,text,wordPages)}:{})};
  }finally{await pdf.destroy();}
}
process.once('message',async data=>{
  let result;try{result=await run(data);}catch{result={error:true};}
  finally{if(ocr)await ocr.terminate();}
  process.send(result,()=>process.exit(0));
});
