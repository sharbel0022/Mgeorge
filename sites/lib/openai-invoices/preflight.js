import {getDocumentProxy} from 'unpdf';
export const AI_DOCUMENT_LIMITS=Object.freeze({bytes:5_000_000,pages:10,pixels:12_000_000,timeoutMs:15_000});
const failure=()=>{throw Error('AI_DOCUMENT_UNREADABLE');};
const starts=(b,a,at=0)=>a.every((n,i)=>b[at+i]===n);
function imageSize(b,mime){
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);let width=0,height=0;
  if(mime==='image/png'&&b.length>=24&&starts(b,[137,80,78,71,13,10,26,10])){
    width=v.getUint32(16);height=v.getUint32(20);
  }else if(mime==='image/jpeg'&&starts(b,[255,216])){
    let at=2;while(at+8<b.length&&at<65536){
      if(b[at++]!==255)break;while(b[at]===255)at++;const marker=b[at++];
      if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;
      if(at+2>b.length)break;const size=v.getUint16(at);if(size<2||at+size>b.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=v.getUint16(at+3);width=v.getUint16(at+5);break;}at+=size;
    }
  }else if(mime==='image/webp'&&b.length>=30&&starts(b,[82,73,70,70])&&starts(b,[87,69,66,80],8)){
    if(starts(b,[86,80,56,88],12)){if(b[20]&2)failure();width=1+b[24]+256*b[25]+65536*b[26];height=1+b[27]+256*b[28]+65536*b[29];}
    else if(starts(b,[86,80,56,32],12)&&starts(b,[157,1,42],23)){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
    else if(starts(b,[86,80,56,76],12)&&b[20]===47){const bits=v.getUint32(21,true);width=1+(bits&16383);height=1+((bits>>>14)&16383);}
  }
  if(!width||!height||width>12000||height>12000||width*height>AI_DOCUMENT_LIMITS.pixels)failure();
}

/** Bounded server-side parsing: no page count or MIME assertion from a client. */
export async function preflightOriginal(bytes,mime){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>AI_DOCUMENT_LIMITS.bytes)failure();
  if(mime!=='application/pdf'){
    imageSize(bytes,mime);return {bytes,pageCount:1};
  }
  if(!starts(bytes,[37,80,68,70,45]))failure();
  let pdf,timer,expired=false;
  const task=(async()=>{
    // Copy because PDF.js may transfer its input buffer; retain the original.
    pdf=await getDocumentProxy(Uint8Array.from(bytes),{isEvalSupported:false,useSystemFonts:false,disableFontFace:true,maxImageSize:AI_DOCUMENT_LIMITS.pixels,stopAtErrors:true,cMapUrl:undefined,standardFontDataUrl:undefined,verbosity:0});
    if(expired){await pdf.loadingTask.destroy();failure();}
    if(!Number.isSafeInteger(pdf.numPages)||pdf.numPages<1||pdf.numPages>AI_DOCUMENT_LIMITS.pages)failure();
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n),view=page.getViewport({scale:2});
      if(!Number.isFinite(view.width*view.height)||view.width*view.height>AI_DOCUMENT_LIMITS.pixels)failure();
      await page.getTextContent();await page.getOperatorList();page.cleanup();if(expired)failure();
    }
    return {bytes,pageCount:pdf.numPages};
  })();
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('AI_DOCUMENT_TIMEOUT'));},AI_DOCUMENT_LIMITS.timeoutMs);})]);}
  finally{clearTimeout(timer);if(pdf)try{await pdf.loadingTask.destroy();}catch{}}
}
