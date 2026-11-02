import {identity,readWorkspace,response,failure} from '@/lib/server';
import {readBankAccountEvidence} from '@/lib/banking/account-evidence';
import {accountEvidenceTarget} from '@/lib/account-evidence-presentation';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const user=await identity(req);
 if((req.headers.get('content-type')||'').split(';',1)[0].trim().toLowerCase()!=='application/json')return response({error:'JSON krävs.'},415);
 const reader=req.body?.getReader();if(!reader)return response({error:'Välj bankhändelse och rapportoriginal.'},400);
 let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2048){await reader.cancel();return response({error:'För stor begäran.'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 let input:unknown;try{input=JSON.parse(text);}catch{return response({error:'Ogiltig JSON.'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return response({error:'Ogiltigt kontrollval.'},400);
 const body=input as Record<string,unknown>,validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
 if(Object.keys(body).some(key=>!['transactionId','documentId','revision'].includes(key))||!validId(body.transactionId)||!validId(body.documentId)||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)return response({error:'Ogiltigt kontrollval.'},400);
 const {state,revision}=await readWorkspace(user.userId);
 if(!state.transactions.some(t=>t.id===body.transactionId))return response({error:'Bankhändelsen finns inte för ditt konto.'},404);
 const target=accountEvidenceTarget(state,body.transactionId);
 if(revision!==body.revision||!target||target.documentId!==body.documentId)return response({error:'Arbetsytan eller rapportvalet har ändrats. Läs betalningskontrollen på nytt.'},409);
 // The existing reader rechecks identity, retained bytes, consent and snapshot.
 return await readBankAccountEvidence(target,{owner:user.userId,revision,target});
 }catch(error){return failure(error);}}
