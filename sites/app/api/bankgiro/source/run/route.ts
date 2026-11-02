import {identity,response,failure} from '@/lib/server';
import {runBankgiroSource} from '@/lib/bankgiro-ingest-service';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const user=await identity(req),limit=2048;
 if(Number(req.headers.get('content-length')||0)>limit)return response({error:'För stor begäran.'},413);
 const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit){await reader.cancel();return response({error:'För stor begäran.'},413);}chunks.push(next.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const text=new TextDecoder().decode(bytes).trim();let body:unknown={};
 if(text)try{body=JSON.parse(text);}catch{return response({error:'Begäran måste vara ett tomt JSON-objekt.'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return response({error:'Källans ägare och konfiguration kan inte anges i begäran.'},400);
 return response(await runBankgiroSource(user.userId));
}catch(error){return failure(error);}}
