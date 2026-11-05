/**
 * MG FAKTURAKOLL – SWEDBANK / ENABLE BANKING
 * ANSVAR: Bygger signerade API-anrop för läsning av konton och bokförda bankhändelser. Skapar medgivandeuppgifter och hanterar paginerade banksvar.
 * FLÖDE: server.js initierar → bank.js anropar Enable Banking → server.js validerar och lagrar via db.js. Inga betalningar startas.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { createPrivateKey, createPublicKey, createHash, createSign } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// AIS only. Both environments use the same host; /application confirms which
// environment the certificate is registered for. Never override this URL.
export const apiBase='https://api.enablebanking.com';
const projectRoot=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
function bankError(code,message,status=409,extra={}){
  return Object.assign(new Error(message),{code,status,...extra});
}
function alias(...names){
  const values=names.map(name=>process.env[name]?.trim()).filter(Boolean);
  if(new Set(values).size>1)throw bankError('ambiguous_configuration','Banktjänstens miljövariabler innehåller motstridiga inställningar.');
  return values[0]||'';
}
function configuration(){
  const applicationId=alias('ENABLE_BANKING_APPLICATION_ID','ENABLEBANKING_APP_ID');
  const privateKey=alias('ENABLE_BANKING_PRIVATE_KEY');
  const keyFile=alias('ENABLE_BANKING_PRIVATE_KEY_FILE','ENABLEBANKING_PRIVATE_KEY_FILE');
  const environment=alias('ENABLE_BANKING_ENVIRONMENT','ENABLEBANKING_ENVIRONMENT').toUpperCase();
  if(!applicationId||(!privateKey&&!keyFile))throw bankError('not_configured','Banktjänsten behöver aktiveras av systemadministratören.');
  if(!['SANDBOX','PRODUCTION'].includes(environment))throw bankError('environment_required','Systemadministratören behöver välja SANDBOX eller PRODUCTION för banktjänsten.');
  // A leaked key must not be used even to make a readiness request.
  if(environment==='PRODUCTION'&&process.env.ENABLE_BANKING_KEY_ROTATED!=='true')throw bankError('key_rotation_required','En ny produktionsnyckel måste registreras och den tidigare nyckeln återkallas innan banken kan anslutas.');
  if(privateKey&&keyFile)throw bankError('ambiguous_configuration','Ange endast en serverkälla för bankens privata nyckel.');
  if(environment==='PRODUCTION')validatedOrigin(process.env.APP_ORIGIN,environment);
  let key;
  try{
    if(keyFile){
      const target=realpathSync(keyFile),rel=relative(projectRoot,target);
      if(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw new Error('key inside repository');
    }
    key=createPrivateKey(privateKey?privateKey.replace(/\\n/g,'\n'):readFileSync(keyFile,'utf8'));
    if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength||0)<2048)throw new Error('RSA key required');
  }catch{throw bankError('invalid_private_key','Banktjänstens privata RSA-nyckel är ogiltig eller otillgänglig. Nyckelfiler ska ligga utanför repositoryt.');}
  return {applicationId,key,environment};
}
export function configStatus(){
  try{const {environment}=configuration();return {configured:true,environment,code:'configured',message:''};}
  catch(e){return {configured:false,environment:undefined,code:e.code||'not_configured',message:e.code?e.message:'Banktjänsten behöver aktiveras av systemadministratören.'};}
}
export function isConfigured(){return configStatus().configured;}
/** Bind a pending consent to the actual application and signing-key generation. */
export function consentApplicationFingerprint(){
  const {applicationId,key,environment}=configuration();
  return createHash('sha256').update(JSON.stringify([applicationId,environment,createPublicKey(key).export({type:'spki',format:'der'}).toString('base64')])).digest('hex');
}
/** Skapar RS256-signerad JWT för att autentisera serverns API-anrop mot Enable Banking. Privat RSA-nyckel stannar på servern. */
export function jwt(){
  const {applicationId,key}=configuration(),now=Math.floor(Date.now()/1000);
  const header={typ:'JWT',alg:'RS256',kid:applicationId};
  const payload={iss:'enablebanking.com',aud:'api.enablebanking.com',iat:now,exp:now+3600};
  const base=[header,payload].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  const signer=createSign('RSA-SHA256');signer.update(base);signer.end();
  return `${base}.${signer.sign(key).toString('base64url')}`;
}
function validatedOrigin(origin,environment){
  try{
    const parsed=new URL(origin);
    if(parsed.origin!==origin||parsed.username||parsed.password||parsed.hash||parsed.search)throw Error();
    if(parsed.protocol!=='https:'&&!(environment!=='PRODUCTION'&&parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname)))throw Error();
    return parsed.origin;
  }catch{throw bankError('invalid_origin','Bankens returadress måste använda HTTPS i produktion och vara en giltig APP_ORIGIN utan sökväg.');}
}
export function validateAuthorizationUrl(value){
  try{
    const url=new URL(value);
    if(!['https://auth.enablebanking.com','https://tilisy.enablebanking.com'].includes(url.origin)||url.pathname!=='/ais/start'||url.username||url.password||url.hash)throw Error();
    return url.href;
  }catch{throw bankError('invalid_authorization_url','Bankleverantören returnerade en ogiltig autentiseringsadress.',502);}
}
function requestUrl(path,method){
  if(typeof path!=='string'||/[\\\r\n#]/.test(path)||!path.startsWith('/')||path.startsWith('//'))throw bankError('invalid_path','Ogiltig API-sökväg',400);
  const url=new URL(apiBase+path),pathname=path.split('?')[0];
  if(url.origin!==apiBase||url.pathname!==pathname)throw bankError('invalid_path','Ogiltig API-sökväg',400);
  const allowed=(method==='GET'&&(/^\/(application|aspsps)$/.test(pathname)||/^\/sessions\/[^/]+$/.test(pathname)||/^\/accounts\/[^/]+\/transactions$/.test(pathname)))||
    (method==='POST'&&['/auth','/sessions'].includes(pathname))||
    (method==='DELETE'&&/^\/sessions\/[^/]+$/.test(pathname));
  if(!allowed||(method!=='GET'&&url.search))throw bankError('read_only','Bankintegrationen tillåter endast läsåtkomst och hantering av medgivanden.',400);
  return url.href;
}
function retryAfterSeconds(value,fallback=60){
  const text=(value||'').trim(),numeric=/^\d+$/.test(text),time=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)?Date.parse(text):NaN;
  const validDate=Number.isFinite(time)&&new Date(time).toUTCString()===text&&time>Date.now();
  const seconds=numeric?Number(text):validDate?Math.ceil((time-Date.now())/1000):NaN;
  const retryBlocked=numeric&&!Number.isFinite(seconds)||Number.isFinite(seconds)&&seconds>365*86400;
  return {retryAfter:retryBlocked?Math.ceil((Date.UTC(9999,11,31)-Date.now())/1000):Number.isFinite(seconds)&&seconds>=0?Math.max(1,seconds):fallback,retryBlocked,retryKnown:numeric||validDate};
}
/** Skickar tidsbegränsade anrop till Enable Bankings fasta API-domän med signerad token; leverantörsfel hanteras centralt. */
export async function bankingRequest(path,{method='GET',body,deadline=Date.now()+18000,signal}={}){
  const url=requestUrl(path,method),authorization=`Bearer ${jwt()}`;
  const remaining=Math.min(18000,deadline-Date.now());
  const timedOut=()=>bankError('bank_timeout','Bankförfrågan tog för lång tid. Försök igen.',502);
  if(!Number.isFinite(remaining)||remaining<=0)throw timedOut();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),remaining),requestSignal=signal?AbortSignal.any([controller.signal,signal]):controller.signal;
  try{
    let result;
    try{result=await fetch(url,{method,redirect:'error',signal:requestSignal,headers:{Authorization:authorization,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
    catch{throw bankError(requestSignal.aborted?'bank_timeout':'bank_unavailable',requestSignal.aborted?'Bankförfrågan tog för lång tid. Försök igen.':'Banktjänsten kunde inte nås. Försök igen senare.',502);}
    if(result.status===429||result.status===503){
      const retry=retryAfterSeconds(result.headers.get('retry-after'),6*3600);
      if(result.status===429||retry.retryKnown){
        // A stalled or malformed error body must not erase a known cooldown.
        // Cancellation can itself wait indefinitely, so it is never awaited.
        try{result.body?.cancel().catch(()=>{});}catch{}
        throw bankError(result.status===429?'rate_limited':'bank_unavailable',result.status===429?'Bankens anropsgräns är nådd. Vänta innan du försöker igen.':'Banktjänsten är tillfälligt otillgänglig. Vänta till nästa tillåtna försök.',result.status,{providerStatus:result.status,...retry});
      }
    }
    const data=result.status===204?{}:await result.json().catch(()=>null);
    // Fetch can finish its headers while the response body is still waiting.
    // A body abort must keep its timeout identity and must never start recovery.
    if(requestSignal.aborted||Date.now()>=deadline)throw timedOut();
    if(!result.ok){
      const providerStatus=result.status,extra={providerStatus};
      if(providerStatus===429||data?.error==='ASPSP_RATE_LIMIT_EXCEEDED')throw bankError('rate_limited','Bankens anropsgräns är nådd. Vänta innan du försöker igen.',429,{...extra,...retryAfterSeconds(result.headers.get('retry-after'),data?.error==='ASPSP_RATE_LIMIT_EXCEEDED'?6*3600:60)});
      if(['CLOSED_SESSION','EXPIRED_SESSION','REVOKED_SESSION','SESSION_DOES_NOT_EXIST'].includes(data?.error))throw bankError('renewal_required','Bankmedgivandet har upphört. Förnya anslutningen.',409,extra);
      if(['ASPSP_ACCOUNT_NOT_ACCESSIBLE','ACCOUNT_DOES_NOT_EXIST'].includes(data?.error))throw bankError('account_unavailable','Det valda bankkontot kan inte längre läsas. Kontrollera bankanslutningen och kontots behörighet.',409,extra);
      if(data?.error==='ASPSP_PSU_ACTION_REQUIRED')throw bankError('action_required','Banken kräver en åtgärd från kontoinnehavaren innan hämtningen kan fortsätta.',409,extra);
      if(['PSU_HEADER_NOT_PROVIDED','PSU_HEADER_INVALID','PSUHEADERNOT_PROVIDED'].includes(data?.error))throw bankError('background_access_denied','Bankens behörighet för hämtning i bakgrunden behöver verifieras innan nya försök görs.',409,extra);
      if(data?.error==='REDIRECT_URI_NOT_ALLOWED')throw bankError('redirect_not_registered','Bankens returadress måste registreras av systemadministratören.',409,extra);
      if(providerStatus===401||providerStatus===403)throw bankError('application_access_denied','Banktjänsten behöver aktiveras av systemadministratören. Kontrollera nyckel, produktionsgodkännande och AIS-behörighet.',409,extra);
      if(['EXPIRED_AUTHORIZATION_CODE','WRONG_AUTHORIZATION_CODE','ALREADY_AUTHORIZED'].includes(data?.error))throw bankError('authorization_failed','Bankgodkännandet kunde inte slutföras. Starta en ny anslutning.',409,extra);
      if(data?.error==='WRONG_DATE_INTERVAL')throw bankError('invalid_date_range','Banken avvisade datumordningen. Kontrollera från- och tilldatum.',400,extra);
      if(data?.error==='WRONG_TRANSACTIONS_PERIOD')throw bankError('transaction_period_unavailable','Banken kunde inte lämna hela det begärda datumintervallet. Välj en kortare period eller komplettera med bankfil. Inga händelser från hämtningen har importerats.',409,extra);
      throw bankError('bank_error','Banktjänsten kunde inte genomföra förfrågan. Kontrollera anslutningen och försök igen.',502,extra);
    }
    if(!data||typeof data!=='object'||Array.isArray(data))throw bankError('invalid_response','Banktjänsten returnerade ett ogiltigt svar.',502);
    return data;
  }finally{clearTimeout(timeout);}
}
/** Kontrollerar att applikationens miljö, behörighet, aktivering och callback är lämpliga innan riktig bankanslutning startar. */
export async function assertApplicationReady(origin){
  const {applicationId,environment}=configuration(),callback=`${validatedOrigin(origin,environment)}/api/bank/callback`;
  const app=await bankingRequest('/application');
  if(app.kid!==applicationId)throw bankError('application_mismatch','Banktjänstens applikationsidentitet kunde inte bekräftas.',502);
  if(app.environment!==environment)throw bankError('environment_mismatch','Bankapplikationens registrerade miljö stämmer inte med serverns inställning.');
  if(app.active!==true)throw bankError('application_inactive','Banktjänsten behöver aktiveras av systemadministratören. Applikationen väntar på Enable Bankings godkännande.');
  if(!app.services?.includes('AIS')||!app.countries?.includes('SE'))throw bankError('ais_not_enabled','Bankapplikationen saknar läsåtkomst för svenska konton. Kontakta systemadministratören.');
  if(!app.redirect_urls?.includes(callback))throw bankError('redirect_not_registered','Bankens exakta returadress måste registreras hos Enable Banking av systemadministratören.');
  return {environment,active:true,checked_at:new Date().toISOString()};
}
/** Hämtar banker i Sverige och identifierar Swedbank; använder inte ett påhittat institutions-ID. */
export async function findSwedbank(){
  const result=await bankingRequest('/aspsps?country=SE');
  if(!Array.isArray(result.aspsps))throw bankError('invalid_response','Banktjänsten returnerade en ogiltig banklista.',502);
  return result.aspsps.filter(x=>x&&/^Swedbank(?:\b|\s)/i.test(x.name)&&x.country==='SE'&&Array.isArray(x.psu_types)&&x.psu_types.includes('business'))
    .sort((a,b)=>Number(b.name==='Swedbank')-Number(a.name==='Swedbank'));
}
/** Bygger begäran om bankmedgivande för läsåtkomst och anger vart banken ska returnera användaren. */
export function startConsentBody(aspsp,state,origin){
  if(typeof state!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(state))throw bankError('invalid_state','Ogiltig bankstatus.',400);
  if(!aspsp||aspsp.country!=='SE'||!/^Swedbank(?:\b|\s)/i.test(aspsp.name)||!aspsp.psu_types?.includes('business'))throw bankError('business_bank_unavailable','Swedbanks företagsanslutning är inte tillgänglig.');
  const environment=alias('ENABLE_BANKING_ENVIRONMENT','ENABLEBANKING_ENVIRONMENT').toUpperCase();
  if(!['SANDBOX','PRODUCTION'].includes(environment))throw bankError('environment_required','Banktjänstens miljö måste väljas av systemadministratören.');
  const max=aspsp.maximum_consent_validity;
  if(!Number.isSafeInteger(max)||max<=60)throw bankError('invalid_consent_validity','Banken saknar en giltig medgivandetid.',502);
  const duration=Math.min(max,90*86400),valid_until=new Date(Date.now()+duration*1000-30000).toISOString();
  return {access:{valid_until,transactions:true,balances:false},aspsp:{name:aspsp.name,country:'SE'},state,redirect_url:`${validatedOrigin(origin,environment)}/api/bank/callback`,psu_type:'business',language:'sv'};
}
function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
/** Hämtar hela det inkluderande UTC-intervallet innan några händelser lämnas till lagring. */
export async function fetchBookedTransactions(accountId,{dateFrom,dateTo,authorize=()=>{},deadline=Date.now()+240000,request=bankingRequest}){
  if(typeof accountId!=='string'||!accountId||accountId.length>200)throw bankError('invalid_account','Välj ett godkänt konto.',400);
  if(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo)throw bankError('invalid_date_range','Välj ett giltigt från- och tilldatum.',400);
  const day=86400000,out=[],end=Date.parse(dateTo);
  let start=Date.parse(dateFrom),width=90,adjustments=0,requests=0,received=0;
  // 90 dates is a local request-size policy, not a claim about bank retention.
  // Global budgets include rejected attempts; a partial history never escapes.
  while(start<=end){
    const until=Math.min(end,start+(width-1)*day),from=new Date(start).toISOString().slice(0,10),to=new Date(until).toISOString().slice(0,10);
    const window=[],seen=new Set();let cursor='';
    try{
      while(true){
        authorize();
        if(requests>=15)throw bankError('page_limit','För många bankanrop – välj ett kortare datumintervall. Inga händelser från hämtningen har importerats.',409);
        const search=new URLSearchParams({date_from:from,date_to:to,transaction_status:'BOOK'});
        if(cursor)search.set('continuation_key',cursor);
        requests++;
        const data=await request(`/accounts/${encodeURIComponent(accountId)}/transactions?${search}`,{deadline});
        authorize();
        if(!Array.isArray(data.transactions))throw bankError('invalid_response','Banktjänsten returnerade en ogiltig transaktionslista.',502);
        received+=data.transactions.length;
        if(received>5000)throw bankError('transaction_limit','För många händelser – välj ett kortare datumintervall.',409);
        // Do not trust a provider that ignores the BOOK query filter.
        for(const item of data.transactions){
          if(!item||typeof item!=='object'||typeof item.status!=='string')throw bankError('invalid_response','Banktjänsten returnerade en transaktion utan bekräftad bokföringsstatus.',502);
          if(item.status==='BOOK')window.push(item);
        }
        if(data.continuation_key===undefined||data.continuation_key===null||data.continuation_key==='')break;
        if(typeof data.continuation_key!=='string'||data.continuation_key.length>8000)throw bankError('invalid_response','Banktjänsten returnerade en ogiltig sidmarkör.',502);
        if(seen.has(data.continuation_key))throw bankError('repeated_cursor','Banktjänsten upprepade samma sidmarkör. Inga händelser har importerats.',502);
        cursor=data.continuation_key;seen.add(cursor);
      }
    }catch(error){
      authorize();
      if(error.code!=='transaction_period_unavailable'||until===start||adjustments>=6)throw error;
      // Discard this window's pages, retry its exact start, and keep the narrower
      // width for the remainder. Never trim unavailable dates or use longest.
      width=Math.max(1,Math.floor(((until-start)/day+1)/2));adjustments++;
      continue;
    }
    out.push(...window);start=until+day;
  }
  return out;
}
