import { callback } from '@/lib/banking/service';
import {providerCallback} from '@/lib/banking/company-provider-service';
import {withCompanyRequest} from '@/lib/server';
export const dynamic = 'force-dynamic';
export const GET=withCompanyRequest(async(request: Request)=>{
  try { return await providerCallback(request)??await callback(request); }
  catch { return new Response(null, { status: 303, headers: { Location: '/bank?result=failed', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } }); }
});
