import {getDocumentProxy,getResolvedPDFJS} from 'unpdf';
import {reconstructPdfText,pdfPageNeedsOpticalText} from './pdf-text.js';
export const PDF_LIMITS={bytes:5_000_000,pages:10,characters:150000,pixels:12_000_000,timeout:15000};
export async function serverPdfText(bytes:Uint8Array){
  if(bytes.length>PDF_LIMITS.bytes)throw Error('local_ocr_required');
  let pdf:Awaited<ReturnType<typeof getDocumentProxy>>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([
    (async()=>{
      pdf=await getDocumentProxy(bytes,{isEvalSupported:false,useSystemFonts:false,disableFontFace:true,maxImageSize:PDF_LIMITS.pixels,stopAtErrors:true,cMapUrl:undefined,standardFontDataUrl:undefined,verbosity:0} as any);
      if(pdf.numPages>PDF_LIMITS.pages)throw Error('page_limit');
      let text='';
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n),content=await page.getTextContent();
        const part=reconstructPdfText(content.items);
        if(text.length+part.length+1>PDF_LIMITS.characters)throw Error('text_limit');
        const {OPS}=await getResolvedPDFJS(),view=page.getViewport({scale:1});
        if(pdfPageNeedsOpticalText(content.items,part,await page.getOperatorList(),OPS,view.width*view.height))throw Error('local_ocr_required');
        text+=(n>1?'\f\n':'')+part+'\n';if(text.length>PDF_LIMITS.characters)throw Error('text_limit');page.cleanup();
      }
      return {text,method:'pdf' as const,confidence:100};
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('parse_timeout')),PDF_LIMITS.timeout);}),
  ]);}finally{clearTimeout(timer);await pdf?.loadingTask.destroy();}
}
