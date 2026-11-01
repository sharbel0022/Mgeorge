import {identity,readWorkspace,response,failure} from '@/lib/server';
import {readPaymentVerification} from '@/lib/payment-verification';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const user=await identity(),id=new URL(req.url).searchParams.get('transactionId')||'';
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return response({error:'Välj en giltig bankhändelse.'},400);
 const {state,revision}=await readWorkspace(user.userId);
 if(!state.transactions.some(t=>t.id===id))return response({error:'Bankhändelsen finns inte för ditt konto.'},404);
 return response({...await readPaymentVerification(user.userId,state,id),revision});
 }catch(error){return failure(error);}}
