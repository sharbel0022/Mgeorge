import {reconstructPdfText,pdfPageNeedsOpticalText} from './pdf-text.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence} from './ocr-bankgiro-evidence.js';
import {reconstructOcrLayout} from './ocr-layout.js';
// Only same-origin language/core assets are loaded. Invoice bytes remain in the browser.
export async function imageText(image:Blob|HTMLCanvasElement){
  const {createWorker,PSM}=await import('tesseract.js');
  const worker=await createWorker('swe',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',cacheMethod:'none',logger:()=>{}});
  try{
    await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});
    const input=image instanceof HTMLCanvasElement?image.toDataURL('image/png'):image;
    const bytes=typeof input==='string'?Uint8Array.from(atob(input.slice(input.indexOf(',')+1)),char=>char.charCodeAt(0)):new Uint8Array(await input.arrayBuffer());
    const inputSha256=ocrInputHash(bytes),{data}=await worker.recognize(input,{},{text:true,blocks:true});
    const layout=reconstructOcrLayout(data.text,data.blocks),pageEvidence=collectOcrBankgiroPage(layout.text,layout.blocks,1);
    return {text:layout.text,ocr:true,confidence:data.confidence,inputSha256,pageEvidence,ocrEvidence:bindOcrBankgiroEvidence(inputSha256,layout.text,[pageEvidence])};
  }finally{await worker.terminate();}
}
export async function pdfInvoiceText(bytes:ArrayBuffer){
  // PDF.js may transfer/detach its input buffer. Bind the original beforehand.
  const inputSha256=ocrInputHash(new Uint8Array(bytes));
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}),doc=await task.promise;
  try{
    if(doc.numPages>10)throw Error('Dela upp PDF-filer med fler än 10 sidor före tolkning.');
    let text='',ocr=false,confidence=100;const wordPages=[];
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p),content=await page.getTextContent();let part=reconstructPdfText(content.items),pageEvidence=collectOcrBankgiroPage(part,null,p);
      if(text.length+part.length>150000)throw Error('PDF-filen innehåller för mycket text.');
      const viewAtOne=page.getViewport({scale:1});
      if(pdfPageNeedsOpticalText(content.items,part,await page.getOperatorList(),pdfjs.OPS,viewAtOne.width*viewAtOne.height)){
        const view=page.getViewport({scale:2});if(view.width*view.height>12000000)throw Error('PDF-sidan är för stor för OCR.');
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
        await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport:view}).promise;
        const result=await imageText(canvas);part=result.text;pageEvidence={...result.pageEvidence,page:p};ocr=true;confidence=Math.min(confidence,result.confidence);canvas.width=0;canvas.height=0;
      }
      wordPages.push(pageEvidence);
      text+=(p>1?'\f\n':'')+part+'\n';if(text.length>150000)throw Error('PDF-filen innehåller för mycket text.');page.cleanup();
    }
    return {text,ocr,confidence,inputSha256,ocrEvidence:ocr?bindOcrBankgiroEvidence(inputSha256,text,wordPages):null};
  }finally{await task.destroy();}
}
export async function pdfPreview(file:File){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true}),doc=await task.promise;
  try{const page=await doc.getPage(1),view=page.getViewport({scale:1.4});if(view.width*view.height>12000000)throw Error('För stor PDF-sida.');const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport:view}).promise;return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Förhandsvisningen misslyckades.')),'image/png'));}finally{await task.destroy();}
}
