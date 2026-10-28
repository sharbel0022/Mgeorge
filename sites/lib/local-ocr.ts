// Only same-origin language/core assets are loaded. Invoice bytes remain in the browser.
export async function imageText(image:Blob|HTMLCanvasElement){
  const {createWorker}=await import('tesseract.js');
  const worker=await createWorker('swe',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',cacheMethod:'none',logger:()=>{}});
  try{const input=image instanceof HTMLCanvasElement?image.toDataURL('image/png'):image;const {data}=await worker.recognize(input);return {text:data.text,ocr:true,confidence:data.confidence};}finally{await worker.terminate();}
}
export async function pdfInvoiceText(bytes:ArrayBuffer){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}),doc=await task.promise;
  try{
    if(doc.numPages>10)throw Error('Dela upp PDF-filer med fler än 10 sidor före tolkning.');
    let text='',ocr=false,confidence=100;
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p),content=await page.getTextContent();let part=content.items.map((i:any)=>'str' in i?i.str+(i.hasEOL?'\n':' '):'').join('');
      if(part.replace(/\s/g,'').length<60){
        const view=page.getViewport({scale:2});if(view.width*view.height>12000000)throw Error('PDF-sidan är för stor för OCR.');
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
        await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport:view}).promise;
        const result=await imageText(canvas);part=result.text;ocr=true;confidence=Math.min(confidence,result.confidence);canvas.width=0;canvas.height=0;
      }
      text+=part+'\n';if(text.length>150000)throw Error('PDF-filen innehåller för mycket text.');page.cleanup();
    }
    return {text,ocr,confidence};
  }finally{await task.destroy();}
}
export async function pdfPreview(file:File){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true}),doc=await task.promise;
  try{const page=await doc.getPage(1),view=page.getViewport({scale:1.4});if(view.width*view.height>12000000)throw Error('För stor PDF-sida.');const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport:view}).promise;return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Förhandsvisningen misslyckades.')),'image/png'));}finally{await task.destroy();}
}
