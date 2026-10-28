import {paymentControlAction,controlFailure} from '@/lib/payment-control';
export const dynamic='force-dynamic';
async function handle(request:Request){try{return await paymentControlAction(request,new URL(request.url).pathname.split('/').pop()||'');}catch(error){return controlFailure(error);}}
export const GET=handle;
export const POST=handle;
