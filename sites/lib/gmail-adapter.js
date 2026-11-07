import {isInlineDecoration} from './document-triage.js';
import {env} from 'cloudflare:workers';
import {Buffer} from 'node:buffer';
// Read-only Gmail adapter. Mail bodies and files are untrusted data, never instructions.
// OAuth state is generated, bound to the user's session and consumed by the HTTP layer.
const scope='https://www.googleapis.com/auth/gmail.readonly';
const apiBase='https://gmail.googleapis.com/gmail/v1/users/me';
const maxFileBytes=15_000_000;
const maxBatchBytes=50_000_000;
const maxAttachmentAttempts=150;
const defaultQuery='has:attachment -in:spam -in:trash -in:drafts';

function fail(message,code='gmail_error',status=409){return Object.assign(new Error(message),{code,status});}
function retryDelay(response){
  const value=(response.headers.get('retry-after')||'').trim(),max=365*86400;
  let seconds=/^\d{1,10}$/.test(value)?Number(value):value.length<=64&&/GMT$/i.test(value)?Math.ceil((Date.parse(value)-Date.now())/1000):NaN;
  const retryBlocked=/^\d{11,}$/.test(value)||Number.isFinite(seconds)&&seconds>max;
  if(!Number.isFinite(seconds)||seconds<0)seconds=900;
  return {retryAfter:Math.max(1,Math.min(max,seconds)),retryBlocked};
}
function rateLimitFailure(response){
  const wait=retryDelay(response);
  return Object.assign(fail(wait.retryBlocked?'Gmail angav en väntetid som kräver manuell kontroll. Automatisk hämtning har stoppats.':'Gmail har begränsat hämtningen. Vänta till nästa tillåtna försök.','rate_limited',429),wait);
}
export function gmailAccount(expectedAccount){
 const account=expectedAccount===undefined?(env.GMAIL_ACCOUNT||'mg.vitvaror@gmail.com'):expectedAccount;
 if(typeof account!=='string'||account.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(account)||/[\r\n\0]/.test(account))throw fail('Företagets Gmail-konto behöver verifieras.','account_mismatch');
 return account.trim().toLowerCase();
}
export function isGmailConfigured(){return !!(env.GOOGLE_CLIENT_ID?.trim()&&env.GOOGLE_CLIENT_SECRET?.trim());}
function requireConfig(){if(!isGmailConfigured())throw fail('En administratör behöver aktivera Gmail-kopplingen först.','not_configured');}
function callback(origin){
  const url=new URL(origin);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw fail('Ogiltig returadress för Gmail.','invalid_origin',400);
  return `${url.origin}/api/gmail/callback`;
}
/** @param {string} state @param {string} origin @param {{send?:boolean,account?:string}} options */
export function gmailAuthorizationUrl(state,origin,{send=false,account=undefined}={}){
  requireConfig();
  if(!/^[A-Za-z0-9_-]{32,200}$/.test(state||''))throw fail('Ogiltig OAuth-status.','invalid_state',400);
  const search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callback(origin),response_type:'code',scope:send?scope+' https://www.googleapis.com/auth/gmail.send':scope,access_type:'offline',prompt:'consent select_account',login_hint:gmailAccount(account),state});
  return `https://accounts.google.com/o/oauth2/v2/auth?${search}`;
}
async function requestJson(url,options={}){
  let response;
  // Workers rejects redirect:'error' before sending the request. Manual mode
  // plus an explicit 3xx rejection keeps credentials on the original endpoint.
  try{response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(20_000)});}
  catch{throw fail('Det gick inte att nå Gmail. Försök igen.','connection_error',502);}
  if(response.status>=300&&response.status<400)throw fail('Google returnerade en oväntad omdirigering. Inga uppgifter skickades vidare.','unexpected_redirect',502);
  // Status remains authoritative even when an outage or expired session returns HTML.
  if(response.status===429){await response.body?.cancel().catch(()=>{});throw rateLimitFailure(response);}
  if(response.status>=500){await response.body?.cancel().catch(()=>{});throw Object.assign(fail('Gmail kunde inte slutföra begäran. Försök igen.','provider_error',502),retryDelay(response));}
  // A bounded read prevents a malformed response or huge attachment from exhausting memory.
  let bytes=0;const chunks=[];
  try{
    if(response.body){for await(const chunk of response.body){bytes+=chunk.length;if(bytes>22_000_000){await response.body.cancel?.().catch(()=>{});throw fail('Svaret från Gmail var för stort.','response_too_large',413);}chunks.push(chunk);}}
  }catch(error){
    if(error?.code==='response_too_large')throw error;
    throw fail('Det gick inte att läsa svaret från Gmail. Försök igen.','connection_error',502);
  }
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{if(response.status===401)throw fail('Gmail-anslutningen behöver förnyas. Koppla Gmail igen.','renewal_required');if(response.status===403)throw fail('Gmail gav inte läsåtkomst. Kontrollera behörigheten och Gmail API i Google Cloud.','access_denied');throw fail('Gmail returnerade ett ogiltigt svar.','invalid_response',502);}
  if(!response.ok){
    if(body?.error==='invalid_client'||body?.error==='unauthorized_client')throw fail('Google avvisade webbklienten. Kontrollera klient-id och klienthemlighet i Sites.','invalid_client');
    if(response.status===401||body?.error==='invalid_grant')throw fail('Gmail-anslutningen behöver förnyas. Koppla Gmail igen.','renewal_required');
    if(response.status===403){
      const reasons=Array.isArray(body?.error?.errors)?body.error.errors:[];
      if(reasons.some(error=>['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded'].includes(error?.reason)))throw rateLimitFailure(response);
      throw fail('Gmail gav inte läsåtkomst. Kontrollera behörigheten och Gmail API i Google Cloud.','access_denied');
    }
    // Do not reflect provider responses: these may include secrets or mailbox content.
    throw fail('Gmail kunde inte slutföra begäran. Försök igen.','provider_error',502);
  }
  return body;
}
function normalizedTokens(body,previous={}){
  if(typeof body.access_token!=='string'||!body.access_token||body.access_token.length>8192||!(Number(body.expires_in)>0)||Number(body.expires_in)>86400)throw fail('Google returnerade ofullständiga åtkomstuppgifter.','invalid_tokens',502);
  const granted=String(body.scope||previous.scope||'').split(/\s+/);
  if(!granted.includes(scope))throw fail('Godkänn läsåtkomst till Gmail för att fortsätta.','missing_scope');
  if(body.token_type&&body.token_type.toLowerCase()!=='bearer')throw fail('Google returnerade en okänd tokentyp.','invalid_tokens',502);
  return {access_token:body.access_token,refresh_token:body.refresh_token||previous.refresh_token||'',expires_at:Date.now()+Number(body.expires_in)*1000,scope:granted.join(' ')};
}
async function tokenRequest(params,previous){
  requireConfig();
  const body=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...params});
  return normalizedTokens(await requestJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}),previous);
}
export async function exchangeGmailCode(code,origin){
  if(typeof code!=='string'||!code||code.length>4096)throw fail('Saknar Googles engångskod.','invalid_code',400);
  return tokenRequest({grant_type:'authorization_code',code,redirect_uri:callback(origin)});
}
export async function refreshGmailTokens(tokens){
  if(!tokens?.refresh_token)throw fail('Gmail-anslutningen behöver förnyas. Koppla Gmail igen.','renewal_required');
  return tokenRequest({grant_type:'refresh_token',refresh_token:tokens.refresh_token},tokens);
}
async function apiRequest(path,tokens){
  if(typeof tokens?.access_token!=='string'||!tokens.access_token)throw fail('Gmail-anslutningen behöver förnyas.','renewal_required');
  if(!path.startsWith('/')||path.startsWith('//')||/[\r\n]/.test(path))throw fail('Ogiltig Gmail-sökväg.','invalid_path',400);
  const request=()=>requestJson(apiBase+path,{headers:{Authorization:`Bearer ${tokens.access_token}`,Accept:'application/json'}});
  try{return await request();}catch(e){
    if(e.code!=='renewal_required'||!tokens.refresh_token)throw e;
    Object.assign(tokens,await refreshGmailTokens(tokens));
    return request();
  }
}
export async function gmailProfile(tokens,account){
  const expected=gmailAccount(account);
  const profile=await apiRequest('/profile',tokens);
  if(typeof profile.emailAddress!=='string'||profile.emailAddress.toLowerCase()!==expected)throw fail(`Välj företagets Gmail-konto: ${expected}.`,'account_mismatch');
  return profile;
}
export function hasGmailSendScope(tokens){return String(tokens?.scope||'').split(/\s+/).includes('https://www.googleapis.com/auth/gmail.send');}
// Preflight may refresh/read. The returned sender performs exactly ONE POST, no retry.
/** @param {any} tokens @param {{account?:string}} options */
export async function prepareGmailSend(tokens,{account=undefined}={}){
  const expected=gmailAccount(account);
  if(!tokens?.access_token||!tokens.expires_at||tokens.expires_at<Date.now()+60000)Object.assign(tokens,await refreshGmailTokens(tokens));
  if(!hasGmailSendScope(tokens))throw fail('Koppla Gmail igen och godkänn utskicksbehörigheten gmail.send.','missing_send_scope');
  await gmailProfile(tokens,expected);
  if(!hasGmailSendScope(tokens))throw fail('Utskicksbehörigheten behöver förnyas.','missing_send_scope');
  return message=>{
    if(typeof message.recipient!=='string'||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(message.recipient)||message.recipient.length>240||/[\r\n\0]/.test(message.recipient)||typeof message.subject!=='string'||/[\r\n\0]/.test(message.subject)||!/^<[a-f0-9-]+@mg-fakturakoll\.local>$/.test(message.rfc_message_id))throw fail('Ogiltiga mejluppgifter.','invalid_message',400);
    const words=[];let part='';
    for(const char of message.subject){if(Buffer.byteLength(part+char)>42){words.push(part);part='';}part+=char;}if(part)words.push(part);
    const subject=words.map(word=>'=?UTF-8?B?'+Buffer.from(word).toString('base64')+'?=').join('\r\n ');
    const body=Buffer.from(message.body,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
    const raw=Buffer.from(`From: ${expected}\r\nTo: ${message.recipient}\r\nSubject: ${subject}\r\nMessage-ID: ${message.rfc_message_id}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`).toString('base64url');
    return requestJson(apiBase+'/messages/send',{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  };
}
export async function revokeGmailTokens(tokens){
  const credential=tokens?.refresh_token||tokens?.access_token;
  if(!credential)return;
  let response;
  try{response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:credential}),signal:AbortSignal.timeout(20_000)});}
  catch{throw fail('Det gick inte att återkalla åtkomsten hos Google. Försök igen.','revoke_failed',502);}
  if(!response.ok&&response.status!==400)throw fail('Google kunde inte återkalla åtkomsten. Försök igen.','revoke_failed',502);
}
function mimeText(value){
  return String(value||'').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(whole,charset,encoding,text)=>{
    try{const bytes=encoding.toLowerCase()==='b'?Buffer.from(text,'base64'):Buffer.from(text.replace(/_/g,' ').replace(/=([a-f0-9]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))),'latin1');return new TextDecoder(charset).decode(bytes);}catch{return whole;}
  }).replace(/[\r\n\0]/g,' ').trim();
}
function mailbox(value){
  const decoded=mimeText(value);const email=decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]||'';
  const party=(decoded.includes('<')?decoded.slice(0,decoded.indexOf('<')):email||decoded).replace(/^\s*["']|["']\s*$/g,'').trim();
  return {email:email.slice(0,240),party:party.slice(0,240)};
}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function parsedHeaders(value){
  const headers=Object.create(null),entries=[];let valid=value===undefined||Array.isArray(value);
  for(const header of Array.isArray(value)?value:[]){
    if(!isObject(header)||typeof header.name!=='string'||!/^[-A-Za-z0-9]+$/.test(header.name)||typeof header.value!=='string'){valid=false;continue;}
    const name=header.name.toLowerCase(),text=mimeText(header.value);
    // Transport trace headers are legitimately repeated. Conflicts only matter
    // for the single-valued metadata used for identity and MIME decisions.
    if(Object.hasOwn(headers,name)&&headers[name]!==text&&['from','to','subject','content-disposition','content-id','content-type'].includes(name))valid=false;
    else headers[name]=text;
    entries.push({name,value:text});
  }
  return {headers,entries,valid};
}
function receivedAt(value){
  const milliseconds=typeof value==='number'?value:typeof value==='string'&&/^\d{1,16}$/.test(value)?Number(value):NaN;
  if(!Number.isSafeInteger(milliseconds)||milliseconds<0)return '';
  const date=new Date(milliseconds);
  return Number.isNaN(date.getTime())?'':date.toISOString();
}
function attachmentBodyIssue(body){
  if(!isObject(body)||body.size!==undefined&&(typeof body.size!=='number'||!Number.isSafeInteger(body.size)||body.size<0)||body.attachmentId!==undefined&&typeof body.attachmentId!=='string')return 'attachment_unreadable';
  return body.size>maxFileBytes?'attachment_too_large':'';
}
function partsOf(payload,path='0',out=[],state={invalid:false}){
  if(!isObject(payload)){state.invalid=true;return out;}
  if(out.length>=500)throw fail('Ett mejl har för många bilagor eller delar.','message_too_complex');
  if(path.split('.').length>20)throw fail('Ett mejl har för många nästlade delar.','message_too_complex');
  const headers=parsedHeaders(payload.headers);
  if(!headers.valid||payload.parts!==undefined&&!Array.isArray(payload.parts))state.invalid=true;
  out.push({...payload,headers:headers.entries,_headers_valid:headers.valid,_part:typeof payload.partId==='string'&&payload.partId?payload.partId:path});
  for(const [i,part]of(Array.isArray(payload.parts)?payload.parts:[]).entries())partsOf(part,path+'.'+i,out,state);
  return out;
}
function detectedMime(buffer){
  if(buffer.subarray(0,5).toString('ascii')==='%PDF-')return 'application/pdf';
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return '';
}
function attachmentMime(part){
  const mime=String(part.mimeType||'').toLowerCase();
  if(['application/pdf','image/png','image/jpeg','image/webp'].includes(mime))return mime;
  if(/\.pdf$/i.test(part.filename||''))return 'application/pdf';
  return '';
}
// This collects potential originals for human review, never records a debt or a payment.
// It deliberately does not claim OCR: scans and PDF fields must be reviewed in the UI.
/** @param {any} tokens @param {{query?:string,after?:string,maxMessages?:number,knownIds?:string[],rejectedIds?:string[],lookupSources?:(sourceIds:string[])=>Promise<{knownIds:string[],rejectedIds:string[]}>|{knownIds:string[],rejectedIds:string[]},pageToken?:string,account?:string}} options */
export async function fetchGmailInvoiceDocuments(tokens,{query='',after='',maxMessages=50,knownIds=[],rejectedIds=[],lookupSources=undefined,pageToken='',account=undefined}={}){
  const expected=gmailAccount(account);
  requireConfig();
  if(!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>100)throw fail('Välj mellan 1 och 100 mejl per hämtning.','invalid_limit',400);
  if(typeof query!=='string'||query.length>1000)throw fail('Gmail-sökningen är för lång.','invalid_query',400);
  if(typeof pageToken!=='string'||pageToken.length>4096)throw fail('Ogiltig sidmarkör för Gmail.','invalid_pagination',400);
  if(!Array.isArray(knownIds)||!Array.isArray(rejectedIds)||lookupSources!==undefined&&typeof lookupSources!=='function')throw fail('Ogiltiga importreferenser.','invalid_sources',400);
  let afterTime;
  if(after){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(after))throw fail('Ogiltigt startdatum för Gmail.','invalid_date',400);
    afterTime=Date.parse(`${after}T00:00:00Z`);
    if(!Number.isFinite(afterTime)||new Date(afterTime).toISOString().slice(0,10)!==after)throw fail('Ogiltigt startdatum för Gmail.','invalid_date',400);
  }
  let current=tokens;
  const deadline=Date.now()+120000;
  if(!tokens?.access_token||!tokens.expires_at||tokens.expires_at<Date.now()+60_000)Object.assign(current,await refreshGmailTokens(tokens));
  await gmailProfile(current,expected);
  let search=query.trim()||defaultQuery;
  // Gmail date-only search boundaries use PST. UTC seconds plus overlap prevent gaps
  // around midnight, delayed mail indexing and interrupted syncs; source IDs deduplicate.
  if(after)search+=` after:${Math.floor(afterTime/1000)-86400}`;
  const known=new Set(knownIds),rejected=new Set(rejectedIds),seenMessages=new Set(),seenPages=new Set(),documents=[],warnings=[];
  let cursor=pageToken,next_page_token='',received=0,skipped=0,duplicate=0,totalBytes=0,attachmentAttempts=0,truncated=false;
  for(let page=0;page<10;page++){
    const params=new URLSearchParams({q:search,maxResults:String(Math.min(50,maxMessages-received)),includeSpamTrash:'false'});
    if(cursor)params.set('pageToken',cursor);
    const listing=await apiRequest(`/messages?${params}`,current);
    for(const item of listing.messages||[]){
      if(Date.now()>deadline){truncated=true;next_page_token=cursor;break;}
      if(received>=maxMessages){truncated=true;break;}
      if(!item.id||seenMessages.has(item.id))continue;
      seenMessages.add(item.id);received++;
      const message=await apiRequest(`/messages/${encodeURIComponent(item.id)}?format=full`,current);
      // A missing envelope must not advance the checkpoint past possible originals.
      if(!isObject(message)||!isObject(message.payload)||!isObject(message.payload.body)&&!Array.isArray(message.payload.parts))throw fail('Gmail returnerade ett ofullständigt mejl. Försök igen.','invalid_response',502);
      const labelsValid=Array.isArray(message.labelIds)&&message.labelIds.every(label=>typeof label==='string');
      const labels=Array.isArray(message.labelIds)?message.labelIds.filter(label=>typeof label==='string'):[];
      if(labels.some(l=>['SPAM','TRASH','DRAFT'].includes(l))){skipped++;continue;}
      const parsed=parsedHeaders(message.payload.headers),headers=parsed.headers;
      const subject=(headers.subject||'').slice(0,500);
      // Subjects cannot establish the contents of an attachment. Retain
      // uncertain originals; document interpretation decides what needs review.
      const direction=labels.includes('SENT')&&!labels.includes('INBOX')?'customer':'supplier';
      const contact=mailbox(direction==='customer'?headers.to:headers.from);
      const partsState={invalid:false},parts=partsOf(message.payload,'0',[],partsState);
      const supported=parts.filter(p=>attachmentMime(p)&&(typeof p.filename==='string'&&p.filename.trim()||String(p.mimeType||'').toLowerCase()==='application/pdf'));
      if(partsState.invalid&&!supported.length)throw fail('Gmail returnerade ett ofullständigt mejl. Försök igen.','invalid_response',502);
      const received_at=receivedAt(message.internalDate),missingMetadata=[];
      if(!parsed.valid)missingMetadata.push('headers');
      if(!labelsValid)missingMetadata.push('label_ids');
      if(partsState.invalid)missingMetadata.push('parts');
      if(!mailbox(headers.from).email)missingMetadata.push('from');
      if(!mailbox(headers.to).email)missingMetadata.push('to');
      if(!subject)missingMetadata.push('subject');
      if(!received_at)missingMetadata.push('received_at');
      let metadataWarned=false;
      const warnMetadata=()=>{if(!metadataWarned){warnings.push({source_id:null,message_id:item.id,code:'message_metadata_invalid',message:'Mejlets metadata är ofullständiga. Originalet kräver granskning.'});metadataWarned=true;}};
      if(missingMetadata.length)warnMetadata();
      let found=false,lookupEnd=0;
      for(const [partIndex,part] of supported.entries()){
        if(Date.now()>deadline){truncated=true;next_page_token=cursor;break;}
        if(part._headers_valid&&isInlineDecoration(part)){skipped++;continue;}
        const original_filename=typeof part.filename==='string'?mimeText(part.filename).slice(0,240):'';
        let name=original_filename.replace(/[\\/]/g,'_');
        const missing_fields=[...missingMetadata];
        if(!original_filename){missing_fields.push('original_filename');warnMetadata();}
        found=true;
        const source_id=`gmail:${expected}:${item.id}:${part._part}`;
        // Read only encountered references. A message has at most 500 parts;
        // each lookup uses at most 50 IDs and retains the existing resume cursor.
        if(lookupSources&&partIndex>=lookupEnd){
          lookupEnd=Math.min(partIndex+50,supported.length);
          const ids=[...new Set(supported.slice(partIndex,lookupEnd)
            .filter(candidate=>!(candidate._headers_valid&&isInlineDecoration(candidate)))
            .map(candidate=>`gmail:${expected}:${item.id}:${candidate._part}`)
            .filter(id=>!known.has(id)&&!rejected.has(id)))];
          if(ids.length){
            const matches=await lookupSources(ids),requested=new Set(ids);
            if(!matches||!Array.isArray(matches.knownIds)||!Array.isArray(matches.rejectedIds)||
              matches.knownIds.length>ids.length||matches.rejectedIds.length>ids.length||
              [...matches.knownIds,...matches.rejectedIds].some(id=>typeof id!=='string'||!requested.has(id)))
              throw fail('Importreferenserna kunde inte kontrolleras. Försök igen.','invalid_sources',502);
            for(const id of matches.knownIds)known.add(id);
            for(const id of matches.rejectedIds)rejected.add(id);
          }
          if(Date.now()>deadline){truncated=true;next_page_token=cursor;break;}
        }
        if(known.has(source_id)){duplicate++;continue;}
        if(rejected.has(source_id)){skipped++;continue;}
        // Invalid parts count toward the same work budget as valid files. Persisting
        // immutable rejected source IDs lets the next batch pass them and make progress.
        if(attachmentAttempts>=maxAttachmentAttempts){truncated=true;next_page_token=cursor;break;}
        attachmentAttempts++;
        const rejectPart=code=>{warnings.push({source_id,message_id:item.id,code,message:code==='attachment_too_large'?'Bilagan är större än 15 MB.':code==='attachment_format_invalid'?'Bilagans filformat kunde inte bekräftas.':'Bilagan kunde inte läsas.'});skipped++;};
        const partIssue=attachmentBodyIssue(part.body);
        if(partIssue){rejectPart(partIssue);continue;}
        let body=part.body;
        if(body.attachmentId){
          try{body=await apiRequest(`/messages/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(body.attachmentId)}`,current);}
          catch(error){if(error.code!=='response_too_large')throw error;rejectPart('attachment_too_large');continue;}
        }
        const bodyIssue=attachmentBodyIssue(body);
        if(bodyIssue){rejectPart(bodyIssue);continue;}
        const encoded=body.data;
        if(typeof encoded==='string'&&encoded.length>Math.ceil(maxFileBytes*4/3)+4){rejectPart('attachment_too_large');continue;}
        if(typeof encoded!=='string'||!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)){rejectPart('attachment_unreadable');continue;}
        const content=Buffer.from(encoded,'base64url');const mime_type=detectedMime(content);
        if(content.length>maxFileBytes){rejectPart('attachment_too_large');continue;}
        if(!content.length||mime_type!==attachmentMime(part)){rejectPart('attachment_format_invalid');continue;}
        // MIME attachments may have no extension, or a misleading one. Keep an inert,
        // correctly typed download name so the server's same-format validation accepts it.
        const extension={'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[mime_type];
        const matchingExtension=mime_type==='image/jpeg'?/\.jpe?g$/i.test(name):name.toLowerCase().endsWith(extension);
        if(!matchingExtension)name=`${(name||'gmail-attachment').slice(0,240-extension.length)}${extension}`;
        if(totalBytes+content.length>maxBatchBytes||documents.length>=100){truncated=true;next_page_token=cursor;break;}
        totalBytes+=content.length;known.add(source_id);
        documents.push({source_id,name,mime_type,content_base64:content.toString('base64'),direction,...contact,subject,received_at,needs_review:true,metadata:{message_id:item.id,attachment_id:part.body?.attachmentId||null,part_id:part._part,inline_decoration:false,from:headers.from||'',to:headers.to||'',original_filename,missing_fields,forwarded:/^(?:fw|fwd|vb):/i.test(subject),direction_confident:!missing_fields.length&&!(labels.includes('SENT')&&labels.includes('INBOX'))&&!/^(?:fw|fwd|vb):/i.test(subject),note:'Kontrollera originalet och de tolkade uppgifterna. Ingen betalningsstatus har antagits.'}});
      }
      if(!found)skipped++;
      if(truncated)break;
    }
    if(truncated)break;
    if(!listing.nextPageToken)break;
    if(received>=maxMessages){truncated=true;next_page_token=listing.nextPageToken;break;}
    if(seenPages.has(listing.nextPageToken))throw fail('Gmail upprepade en sidmarkör. Försök ett kortare datumintervall.','invalid_pagination',502);
    cursor=listing.nextPageToken;seenPages.add(cursor);
    if(page===9){truncated=true;next_page_token=cursor;}
  }
  return {tokens:current,documents,received,skipped,duplicate,truncated,next_page_token,warnings,rejected_source_ids:warnings.filter(w=>w.source_id).map(w=>w.source_id)};
}
