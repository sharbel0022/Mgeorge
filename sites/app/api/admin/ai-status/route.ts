import {env} from 'cloudflare:workers';
import {identity,withCompanyOwner,response,failure} from '@/lib/server';
import {invoiceAiConfigurationStatus,invoiceAiPolicy} from '@/lib/openai-invoices/index.js';
export const dynamic='force-dynamic';
/** Runtime adapter: diagnostics require current integration administration. */
export async function GET(request:Request){
 try{
  const user=await identity(request);
  return await withCompanyOwner(user.userId,'manage_integrations',async()=>{
   const environment=env as unknown as Record<string,string>;
   const policy=invoiceAiPolicy(environment,user.userId);
   return response({...invoiceAiConfigurationStatus(environment),policyStatus:policy.status,policyCode:'code' in policy?policy.code:null});
  });
 }catch(error){return failure(error);}
}
