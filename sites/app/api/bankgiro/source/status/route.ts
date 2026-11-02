import {identity,response,failure} from '@/lib/server';
import {bankgiroSourceStatus} from '@/lib/bankgiro-ingest-service';
export const dynamic='force-dynamic';
export async function GET(){try{
 const user=await identity();return response(await bankgiroSourceStatus(user.userId));
}catch(error){return failure(error);}}
