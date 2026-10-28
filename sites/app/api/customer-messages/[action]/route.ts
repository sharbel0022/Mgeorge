import {messagesAction} from '@/lib/customer-messages';
import {failure,response} from '@/lib/server';
export const dynamic='force-dynamic';
async function handle(req:Request){try{return await messagesAction(req,new URL(req.url).pathname.split('/').pop()||'');}catch(e:any){if(e?.safe)return response({error:e.message},e.status||409);return failure(e);}}
export const GET=handle;
export const POST=handle;
