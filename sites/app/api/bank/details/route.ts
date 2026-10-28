import {fetchBankDetails} from '@/lib/banking/details-service';
import {bankFailure} from '@/lib/banking/service';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{return await fetchBankDetails(req);}catch(e){return bankFailure(e);}}
