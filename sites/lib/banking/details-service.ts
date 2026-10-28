import {env} from 'cloudflare:workers';
import {db,identity,readWorkspace,response} from '../server';
import {canonicalBankAccount,now,uid} from '../domain';
import {application,connection,accounts,providerConfig,sessionId,withBankLock} from './store';
import {getSession,getTransactions,getTransactionDetails,ProviderError,type ProviderTransaction} from './enable-banking';
import {stableAccountKey} from './transactions';
import {transactionDetailEvidence,enrichBankDetails} from './detail-evidence';

export async function fetchBankDetails(req:Request){
 const user=await identity(req),body=await req.json() as any;
 if(typeof body.transactionId!=='string'||body.transactionId.length>100||Object.keys(body).some(k=>k!=='transactionId'))throw Error('Välj en sparad bankhändelse.');
 return withBankLock(user.userId,async lease=>{
  const old=await readWorkspace(user.userId),target=old.state.transactions.find(t=>t.id===body.transactionId);
  if(!target||!target.source.startsWith('Enable Banking')||!target.bankReference||target.parentId)throw Error('Bankhändelsen saknar en verifierbar bankidentifierare för detaljhämtning.');
  if(target.bankDetails&&Date.now()-Date.parse(target.bankDetails.checkedAt)<3600_000)return response({...old,details:target.bankDetails,cached:true});
  const app=await application(user.userId),conn=await connection(user.userId);
  if(!app||!conn||conn.status!=='connected'||app.generation!==conn.app_generation||conn.environment!=='PRODUCTION'||Date.parse(conn.valid_until)<=Date.now())throw Error('En giltig bankanslutning behövs för att hämta betalningsuppgifter.');
  if(Date.parse(conn.retry_after||'')>Date.now())throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Banken har begränsat hämtningen. Vänta till nästa tillåtna försök.',429,true),{retryAfter:Math.ceil((Date.parse(conn.retry_after)-Date.now())/1000)});
  try{
  const selected=JSON.parse(conn.selected_accounts),available=await accounts(conn),matches=available.filter(a=>selected.includes(a.uid)&&a.currency==='SEK'&&stableAccountKey(a,{name:conn.bank_name,country:conn.country})===canonicalBankAccount(target.account));
  if(matches.length!==1)throw Error('Bankhändelsens konto ingår inte entydigt i det valda företagskontot.');
  const account=matches[0],config=await providerConfig(app),live=await getSession(config,await sessionId(conn));
  if(live.status!=='AUTHORIZED'||!(Date.parse(live.access?.valid_until)>Date.now())||!live.accounts.includes(account.uid)||live.psu_type!=='business'||live.aspsp?.name!==conn.bank_name||live.aspsp?.country!==conn.country)throw Error('Bankens medgivande behöver förnyas.');
  const psu={ipAddress:req.headers.get('cf-connecting-ip')||undefined,userAgent:req.headers.get('user-agent')||undefined};
  let key:string|undefined,listed:ProviderTransaction[]=[];const seen=new Set<string>();
  do{const page=await getTransactions(config,account.uid,{dateFrom:target.date,dateTo:target.date,continuationKey:key,psu});listed.push(...page.transactions.filter(t=>t.entry_reference===target.bankReference));key=page.continuation_key||undefined;if(key){if(seen.has(key)||seen.size>=10)throw Error('Bankens detaljsökning kunde inte slutföras.');seen.add(key);}}while(key);
  if(listed.length!==1)throw Error('Bankposten kunde inte hittas entydigt hos banken. Ingen OCR har gissats.');
  const original=listed[0];let detail=original,unsupported=false;
  if(original.transaction_id){try{detail=await getTransactionDetails(config,account.uid,original.transaction_id,psu);}catch(e){if(e instanceof ProviderError&&e.code==='BANK_RESOURCE_UNAVAILABLE')unsupported=true;else throw e;}}else unsupported=true;
  const evidence=transactionDetailEvidence(target,original,detail);
  if(unsupported&&evidence.status==='missing')evidence.reason='Swedbank erbjuder inga ytterligare betalardetaljer för den här posten via den befintliga bankanslutningen. Lägg till Bankgiros individuella betalningsspecifikation.';
  if(!env.BUCKET)throw Error('Originalfilen kan inte sparas just nu.');
  const at=now(),documentId=uid(),content=JSON.stringify({source:'Enable Banking transaction details',account:target.account,bankReference:target.bankReference,checkedAt:at,supported:!unsupported,listed:original,detail});
  const bytes=new TextEncoder().encode(content),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  await lease.assert();
  await env.BUCKET.put(`${user.userId}/${documentId}`,bytes,{httpMetadata:{contentType:'application/json'}});
  const current=await readWorkspace(user.userId);if(current.revision!==old.revision)throw Error('Uppgifterna ändrades under hämtningen. Uppdatera sidan och försök igen.');
  const state=enrichBankDetails(old.state,target.id,evidence,documentId),auditId=uid();
  const committed=await lease.write([
   db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(auditId,user.userId,old.revision+1,'bank.details',JSON.stringify({transactionId:target.id,status:evidence.status,documentId,reason:evidence.reason}),at,user.userId,old.revision),
   db().prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=? AND owner=?)').bind(documentId,user.userId,`bankuppgifter-${target.date}.json`,'application/json',bytes.length,hash,at,auditId,user.userId),
   db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(state),at,user.userId,old.revision)
  ]);
  if(committed[2].meta.changes!==1)throw Error('Arbetsytan ändrades samtidigt. Försök igen.');
  return response({state,revision:old.revision+1,details:state.transactions.find(t=>t.id===target.id)?.bankDetails});
  }catch(error){
   if(error instanceof ProviderError&&error.status===429){
    const retry=error.retryBlocked?'9999-12-31T23:59:59.999Z':new Date(Date.now()+Math.max(60,error.retryAfter||60)*1000).toISOString();
    await lease.run(db().prepare('UPDATE bank_connections SET retry_after=?,sync_failures=CASE WHEN ? THEN 3 ELSE sync_failures END,last_error=?,updated_at=? WHERE owner=? AND id=?').bind(retry,error.retryBlocked?1:0,error.message,now(),user.userId,conn.id));
   }
   throw error;
  }
 });
}
