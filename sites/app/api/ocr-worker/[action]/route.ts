import {workerAction} from '@/lib/document-processing';
export const dynamic='force-dynamic';
async function handle(req:Request){
  // Bound streamed input before reading it. No bearer, document or OCR text is logged.
  if(req.method==='POST'){
    const reader=req.body?.getReader();if(reader){const chunks:Uint8Array[]=[];let size=0;try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>600000){await reader.cancel();return Response.json({error:'För stor begäran.'},{status:413});}chunks.push(r.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}req=new Request(req.url,{method:req.method,headers:req.headers,body:bytes});}
  }
  try{return await workerAction(req,new URL(req.url).pathname.split('/').pop()||'');}catch(e){return Response.json({error:e instanceof Error&&e.message==='WORKER_AUTH'?'Åtkomst nekad.':'Dokumentjobbet kunde inte slutföras.'},{status:e instanceof Error&&e.message==='WORKER_AUTH'?401:409,headers:{'Cache-Control':'no-store'}});}
}
export const GET=handle;export const POST=handle;
