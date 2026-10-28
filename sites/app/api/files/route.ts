import { env } from "cloudflare:workers";
import { db, identity, response, failure } from "@/lib/server";
import { uid, now } from "@/lib/domain";
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const user=await identity(req);if(Number(req.headers.get('content-length')??0)>16_000_000)return response({error:'Filen får vara högst 15 MB.'},413);
 const data=await req.formData(),file=data.get('file');if(!(file instanceof File)||!file.size||file.size>15_000_000)throw new Error('Välj en fil mellan 1 byte och 15 MB.');
 const allowed:Record<string,string>={pdf:'application/pdf',eml:'message/rfc822',txt:'text/plain',csv:'text/csv',xml:'application/xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
 const ext=file.name.split('.').pop()?.toLowerCase()??'';if(!allowed[ext])throw new Error('Välj PDF, EML, TXT, CSV, XML, PNG eller JPG.');
 const bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const known=await db().prepare('SELECT id, filename FROM documents WHERE owner=? AND sha256=? LIMIT 1').bind(user.userId,hash).first();if(known)return response({...known,duplicate:true,sha256:hash});
 if(!env.BUCKET)throw new Error('Bilagelagringen är inte tillgänglig.');const id=uid(),filename=file.name.replace(/[\r\n\x00-\x1f]/g,'').slice(0,200);
 await env.BUCKET.put(`${user.userId}/${id}`,bytes,{httpMetadata:{contentType:allowed[ext]}});
 try{await db().prepare('INSERT INTO documents (id,owner,filename,mime,size,sha256,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,user.userId,filename,allowed[ext],file.size,hash,now()).run();}catch(e){await env.BUCKET.delete(`${user.userId}/${id}`);throw e;}
 return response({id,filename,sha256:hash});
 }catch(e){return failure(e);}}
export async function GET(req:Request){try{const user=await identity(),id=new URL(req.url).searchParams.get('id')??'';if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Ogiltig filreferens.');const doc=await db().prepare('SELECT filename,mime FROM documents WHERE id=? AND owner=?').bind(id,user.userId).first<{filename:string,mime:string}>();if(!doc)return response({error:'Filen finns inte.'},404);const obj=await env.BUCKET?.get(`${user.userId}/${id}`);if(!obj)return response({error:'Filen finns inte.'},404);return new Response(obj.body,{headers:{'Content-Type':doc.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'}});}catch(e){return failure(e);}}
