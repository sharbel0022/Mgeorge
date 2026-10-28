import {identity,db,readWorkspace,response,failure} from '@/lib/server';
import {bankInvoiceCandidates} from '@/lib/banking/invoice-candidates';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await identity(),{state}=await readWorkspace(user.userId);
 const docs=await db().prepare("SELECT s.document_id,s.status,s.extraction,j.extraction job_extraction FROM gmail_sources s LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=? AND s.status<>'rejected' ORDER BY s.created_at DESC LIMIT 1000").bind(user.userId).all<any>();
 const candidates:Record<string,unknown>={};for(const t of state.transactions){const found=bankInvoiceCandidates(state,t,docs.results);if(found.length)candidates[t.id]=found;}
 return response({candidates});
 }catch(e){return failure(e);}}
