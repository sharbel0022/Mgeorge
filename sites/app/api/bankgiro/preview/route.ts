import {identity,response,failure} from '@/lib/server';
import {bankgiroPreview} from '@/lib/bankgiro-service';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const user=await identity(req);if(Number(req.headers.get('content-length')||0)>16_000_000)return response({error:'Filen får vara högst 15 MB.'},413);
 const data=await req.formData(),file=data.get('file');if(!(file instanceof File)||!file.size||file.size>15_000_000)throw Error('Välj en fil på högst 15 MB.');
 return response(await bankgiroPreview(user.userId,file,String(data.get('targetId')||'')));
 }catch(e){return failure(e);}}
