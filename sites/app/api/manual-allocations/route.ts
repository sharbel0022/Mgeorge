import {identity,response} from '@/lib/server';
import {discoverManualMultiple,commitManualMultiple,readManualMultipleReceipt,manualMultipleFailure} from '@/lib/manual-multiple-allocation-service';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const user=await identity(req),parameters=new URL(req.url).searchParams,keys=[...parameters.keys()];
 if(keys.length!==1||!['transactionId','requestId'].includes(keys[0]))return response({error:'Välj en bankhändelse eller en kvittoidentifierare.'},400);
 return response(keys[0]==='requestId'?await readManualMultipleReceipt(user.userId,parameters.get('requestId')!):await discoverManualMultiple(user.userId,parameters.get('transactionId')!));
}catch(error){return manualMultipleFailure(error);}}
export async function POST(req:Request){try{
 const user=await identity(req),text=await req.text();if(text.length>100_000)return response({error:'Fördelningen är för stor.'},413);
 const result=await commitManualMultiple(user.userId,JSON.parse(text));return response(result,result.replayed?200:201);
}catch(error){return manualMultipleFailure(error);}}
