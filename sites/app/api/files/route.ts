import { env } from "cloudflare:workers";
import { db, identity, response, failure } from "@/lib/server";
import { uid, now } from "@/lib/domain";
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const user=await identity(req);if(Number(req.headers.get('content-length')??0)>16_000_000)return response({error:'Filen får vara högst 15 MB.'},413);
 const data=await req.formData(),file=data.get('file');if(!(file instanceof File)||!file.size||file.size>15_000_000)throw new Error('Välj en fil mellan 1 byte och 15 MB.');
 const allowed:Record<string,string>={pdf:'application/pdf',eml:'message/rfc822',txt:'text/plain',csv:'text/csv',xml:'application/xml',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
 const ext=file.name.split('.').pop()?.toLowerCase()??'';if(!allowed[ext])throw new Error('Välj PDF, EML, TXT, XLSX, CSV, XML, PNG eller JPG.');
 const bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const known=await db().prepare('SELECT id, filename FROM documents WHERE owner=? AND sha256=? LIMIT 1').bind(user.userId,hash).first();if(known)return response({...known,duplicate:true,sha256:hash});
 if(!env.BUCKET)throw new Error('Bilagelagringen är inte tillgänglig.');const id=uid(),filename=file.name.replace(/[\r\n\x00-\x1f]/g,'').slice(0,200);
 await env.BUCKET.put(`${user.userId}/${id}`,bytes,{httpMetadata:{contentType:allowed[ext]}});
 // The read above is only a fast path. This single SQLite statement also
 // guards against Gmail/manual uploads reaching R2 at the same time.
 try{await db().prepare('INSERT INTO documents (id,owner,filename,mime,size,sha256,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM documents WHERE owner=? AND sha256=?)').bind(id,user.userId,filename,allowed[ext],file.size,hash,now(),user.userId,hash).run();}catch(e){
  // The insert can commit even if its response is lost. Only remove bytes
  // when an owned read confirms that no document references this upload.
  try{if(!await db().prepare('SELECT id FROM documents WHERE owner=? AND id=?').bind(user.userId,id).first())await env.BUCKET.delete(`${user.userId}/${id}`);}catch{}
  throw e;
 }
 // A successful statement may have inserted nothing because another writer
 // won. A failed outcome read remains unknown: retain our bytes for recovery.
 const retained=await db().prepare('SELECT id, filename FROM documents WHERE owner=? AND sha256=? LIMIT 1').bind(user.userId,hash).first<{id:string;filename:string}>();
 if(!retained)throw Error('D1_ERROR: document insertion outcome unavailable');
 if(retained.id!==id){
  try{if(!await db().prepare('SELECT id FROM documents WHERE owner=? AND id=?').bind(user.userId,id).first())await env.BUCKET.delete(`${user.userId}/${id}`);}catch{}
 }
 return response({...retained,...(retained.id!==id?{duplicate:true}:{}),sha256:hash});
 }catch(e){return failure(e);}}
export async function GET(req:Request){try{const user=await identity(),id=new URL(req.url).searchParams.get('id')??'';if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Ogiltig filreferens.');const doc=await db().prepare('SELECT filename,mime FROM documents WHERE id=? AND owner=?').bind(id,user.userId).first<{filename:string,mime:string}>();if(!doc)return response({error:'Filen finns inte.'},404);const obj=await env.BUCKET?.get(`${user.userId}/${id}`);if(!obj)return response({error:'Filen finns inte.'},404);return new Response(obj.body,{headers:{'Content-Type':doc.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'}});}catch(e){return failure(e);}}
