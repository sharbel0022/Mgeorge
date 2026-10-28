import {identity,response,failure} from '@/lib/server';
import {searchBankgiroInvoice} from '@/lib/bankgiro-invoice-search';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{const user=await identity(req);const body=await req.json() as any;return response(await searchBankgiroInvoice(user.userId,String(body.transactionId||'')));}catch(e){return failure(e);}}
