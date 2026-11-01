import {getDocumentProxy,getResolvedPDFJS} from 'unpdf';
import {reconstructPdfText} from './pdf-text.js';
export const PDF_LIMITS={bytes:5_000_000,pages:10,characters:150000,pixels:12_000_000,timeout:15000};
function hasInvoiceTextAnchors(text:string){
  // These plausible labelled anchors ONLY select the extraction route. They do
  // not validate fields or grant trust; invoice-fields remains the validator.
  const invoice=/(?:faktura[ \t]*(?:nummer|nr|no)|invoice[ \t]*(?:number|no))[ \t]*[:.#-]?[ \t]*[\p{L}\p{N}][\p{L}\p{N}/_-]{0,79}(?=[\s;|]|$)/iu;
  const total=/(?:att betala|summa att betala|totalsumma|totalbelopp|amount due|totalt inklusive moms|totalt inkl\.? moms)[ \t]*[:.]?[ \t]*(?:SEK[ \t]*)?-?\d[\d \t\u00a0.,]*(?:SEK|kr)?(?=[\s;|]|$)/iu;
  return invoice.test(text)&&total.test(text);
}
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
        if(part.replace(/\s/g,'').length<60)throw Error('local_ocr_required');
        if(!hasInvoiceTextAnchors(part)){
          const {OPS}=await getResolvedPDFJS(),rasterOperations=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat]);
          if((await page.getOperatorList()).fnArray.some(op=>rasterOperations.has(op)))throw Error('local_ocr_required');
        }
        text+=part+'\n';if(text.length>PDF_LIMITS.characters)throw Error('text_limit');page.cleanup();
      }
      return {text,method:'pdf' as const,confidence:100};
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('parse_timeout')),PDF_LIMITS.timeout);}),
  ]);}finally{clearTimeout(timer);await pdf?.loadingTask.destroy();}
}
