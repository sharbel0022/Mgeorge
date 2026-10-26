import { readFileSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';

export const apiBase='https://api.enablebanking.com';
export function isConfigured(){return !!(process.env.ENABLEBANKING_APP_ID&&process.env.ENABLEBANKING_PRIVATE_KEY_FILE);}
export function jwt() {
  if(!isConfigured())throw new Error('Enable Banking är inte konfigurerad.');
  const now=Math.floor(Date.now()/1000);
  const header={typ:'JWT',alg:'RS256',kid:process.env.ENABLEBANKING_APP_ID};
  const payload={iss:'enablebanking.com',aud:'api.enablebanking.com',iat:now,exp:now+3600};
  const base=[header,payload].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  const key=readFileSync(process.env.ENABLEBANKING_PRIVATE_KEY_FILE,'utf8');
  const sign=createSign('RSA-SHA256');sign.update(base);sign.end();
  return `${base}.${sign.sign(key).toString('base64url')}`;
}
export async function bankingRequest(path,{method='GET',body}={}){
  // Fixed host: never accept arbitrary external URLs from clients.
  if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Ogiltig API-sökväg');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),18000);
  try{
    const result=await fetch(apiBase+path,{method,signal:controller.signal,headers:{Authorization:`Bearer ${jwt()}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const json=await result.json().catch(()=>({}));
    if(!result.ok)throw new Error(`Enable Banking: ${result.status} ${json.message||json.error||'Kunde inte ansluta'}`.slice(0,230));
    return json;
  }finally{clearTimeout(timeout);}
}
export async function findSwedbank(){
  const result=await bankingRequest('/aspsps?country=SE');
  const found=(result.aspsps||[]).filter(x=>/swedbank/i.test(x.name));
  return found;
}
export function startConsentBody(aspsp,state,origin){
  const max=Number(aspsp.maximum_consent_validity)||86400;
  const duration=Math.min(max,90*86400);
  if(duration<3600)throw new Error('Bankens medgivande är för kort. Kontrollera bankens inställningar.');
  const valid_until=new Date(Date.now()+duration*1000-30000).toISOString();
  return {access:{valid_until,transactions:true,balances:false},aspsp:{name:aspsp.name,country:aspsp.country||'SE'},state,redirect_url:`${origin}/api/bank/callback`,psu_type:'business',language:'sv'};
}
export async function fetchBookedTransactions(accountId,{dateFrom,dateTo}){
  const out=[];let cursor='';const seen=new Set();
  for(let page=0;page<15;page++){
    const search=new URLSearchParams({date_from:dateFrom,date_to:dateTo,transaction_status:'BOOK'});
    if(cursor)search.set('continuation_key',cursor);
    const data=await bankingRequest(`/accounts/${encodeURIComponent(accountId)}/transactions?${search}`);
    out.push(...(data.transactions||[]));
    if(out.length>5000)throw new Error('För många händelser – välj kortare datumintervall');
    if(!data.continuation_key)return out;
    if(seen.has(data.continuation_key))throw new Error('Upprepad sidmarkör från banken');
    cursor=data.continuation_key;seen.add(cursor);
  }
  throw new Error('För många banksidor – välj kortare datumintervall');
}
