/**
 * MG FAKTURAKOLL – SWEDBANK / ENABLE BANKING
 * ANSVAR: Bygger signerade API-anrop för läsning av konton och bokförda bankhändelser. Skapar medgivandeuppgifter och hanterar paginerade banksvar.
 * FLÖDE: server.js initierar → bank.js anropar Enable Banking → server.js validerar och lagrar via db.js. Inga betalningar startas.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { createPrivateKey, createSign } from 'node:crypto';
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
  const allowed=(method==='GET'&&(/^\/(application|aspsps)$/.test(pathname)||/^\/sessions\/[^/]+$/.test(pathname)||/^\/accounts\/[^/]+(?:\/transactions)?$/.test(pathname)))||
    (method==='POST'&&['/auth','/sessions'].includes(pathname))||
    (method==='DELETE'&&/^\/sessions\/[^/]+$/.test(pathname));
  if(!allowed||(method!=='GET'&&url.search))throw bankError('read_only','Bankintegrationen tillåter endast läsåtkomst och hantering av medgivanden.',400);
  return url.href;
}
function retryAfterSeconds(value){
  const seconds=/^\d+$/.test(value||'')?Number(value):Math.ceil((Date.parse(value)-Date.now())/1000);
  return Number.isFinite(seconds)?Math.min(86400,Math.max(1,seconds)):60;
}
/** Skickar tidsbegränsade anrop till Enable Bankings fasta API-domän med signerad token; leverantörsfel hanteras centralt. */
export async function bankingRequest(path,{method='GET',body}={}){
  const url=requestUrl(path,method),authorization=`Bearer ${jwt()}`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
  try{
    let result;
    try{result=await fetch(url,{method,redirect:'error',signal:controller.signal,headers:{Authorization:authorization,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
    catch{throw bankError(controller.signal.aborted?'bank_timeout':'bank_unavailable',controller.signal.aborted?'Bankförfrågan tog för lång tid. Försök igen.':'Banktjänsten kunde inte nås. Försök igen senare.',502);}
    const data=result.status===204?{}:await result.json().catch(()=>null);
    if(!result.ok){
      const providerStatus=result.status,extra={providerStatus};
      if(providerStatus===429||data?.error==='ASPSP_RATE_LIMIT_EXCEEDED')throw bankError('rate_limited','Bankens anropsgräns är nådd. Vänta innan du försöker igen.',429,{...extra,retryAfter:retryAfterSeconds(result.headers.get('retry-after'))});
      if(['CLOSED_SESSION','EXPIRED_SESSION','REVOKED_SESSION','SESSION_DOES_NOT_EXIST'].includes(data?.error))throw bankError('renewal_required','Bankmedgivandet har upphört. Förnya anslutningen.',409,extra);
      if(data?.error==='REDIRECT_URI_NOT_ALLOWED')throw bankError('redirect_not_registered','Bankens returadress måste registreras av systemadministratören.',409,extra);
      if(providerStatus===401||providerStatus===403)throw bankError('application_access_denied','Banktjänsten behöver aktiveras av systemadministratören. Kontrollera nyckel, produktionsgodkännande och AIS-behörighet.',409,extra);
      if(['EXPIRED_AUTHORIZATION_CODE','WRONG_AUTHORIZATION_CODE','ALREADY_AUTHORIZED'].includes(data?.error))throw bankError('authorization_failed','Bankgodkännandet kunde inte slutföras. Starta en ny anslutning.',409,extra);
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
/** Hämtar bokförda transaktioner över flera API-sidor och förhindrar oändliga upprepningar av sidmarkörer. */
export async function fetchBookedTransactions(accountId,{dateFrom,dateTo}){
  if(typeof accountId!=='string'||!accountId||accountId.length>200)throw bankError('invalid_account','Välj ett godkänt konto.',400);
  if(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo||Date.parse(dateTo)-Date.parse(dateFrom)>91*86400000)throw bankError('invalid_date_range','Välj ett giltigt datumintervall på högst 91 dagar.',400);
  const out=[];let cursor='';const seen=new Set();let received=0;
  for(let page=0;page<15;page++){
    const search=new URLSearchParams({date_from:dateFrom,date_to:dateTo,transaction_status:'BOOK'});
    if(cursor)search.set('continuation_key',cursor);
    const data=await bankingRequest(`/accounts/${encodeURIComponent(accountId)}/transactions?${search}`);
    if(!Array.isArray(data.transactions))throw bankError('invalid_response','Banktjänsten returnerade en ogiltig transaktionslista.',502);
    received+=data.transactions.length;
    if(received>5000)throw bankError('transaction_limit','För många händelser – välj ett kortare datumintervall.',409);
    // Do not trust a provider that ignores the BOOK query filter.
    for(const item of data.transactions){
      if(!item||typeof item!=='object'||typeof item.status!=='string')throw bankError('invalid_response','Banktjänsten returnerade en transaktion utan bekräftad bokföringsstatus.',502);
      if(item.status==='BOOK')out.push(item);
    }
    if(data.continuation_key===undefined||data.continuation_key===null||data.continuation_key==='')return out;
    if(typeof data.continuation_key!=='string'||data.continuation_key.length>8000)throw bankError('invalid_response','Banktjänsten returnerade en ogiltig sidmarkör.',502);
    if(seen.has(data.continuation_key))throw bankError('repeated_cursor','Banktjänsten upprepade samma sidmarkör. Inga händelser har importerats.',502);
    cursor=data.continuation_key;seen.add(cursor);
  }
  throw bankError('page_limit','För många banksidor – välj ett kortare datumintervall.',409);
}
