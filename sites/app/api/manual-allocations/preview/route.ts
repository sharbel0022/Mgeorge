import {identity,response} from '@/lib/server';
import {previewManualMultiple,manualMultipleFailure} from '@/lib/manual-multiple-allocation-service';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const user=await identity(req),text=await req.text();if(text.length>100_000)return response({error:'Fördelningen är för stor.'},413);
 return response(await previewManualMultiple(user.userId,JSON.parse(text)));
}catch(error){return manualMultipleFailure(error);}}
