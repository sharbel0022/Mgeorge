/**
 * MG FAKTURAKOLL – GMAIL / GOOGLE OAUTH
 * ANSVAR: Bygger Googles medgivandelänk, växlar och förnyar token och hämtar fakturaliknande mejlbilagor. Bilagor är underlag för granskning, inte automatiskt bokförda fakturor.
 * FLÖDE: server.js → gmail.js → Gmail API → dokument lagras genom db.js.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

// Import and explicitly approved send adapter. Mail/file contents are untrusted data.
// OAuth state is generated, bound to the user's session and consumed by the HTTP layer.
const scope='https://www.googleapis.com/auth/gmail.readonly';
const apiBase='https://gmail.googleapis.com/gmail/v1/users/me';
const maxFileBytes=15_000_000;
const maxBatchBytes=50_000_000;
const maxAttachmentAttempts=150;
const defaultQuery='has:attachment -in:spam -in:trash -in:drafts';

function fail(message,code='gmail_error',status=409){return Object.assign(new Error(message),{code,status});}
export function gmailAccount(){return (process.env.GMAIL_ACCOUNT||'mg.vitvaror@gmail.com').trim().toLowerCase();}
export function isGmailConfigured(){return !!(process.env.GOOGLE_CLIENT_ID?.trim()&&process.env.GOOGLE_CLIENT_SECRET?.trim());}
function requireConfig(){if(!isGmailConfigured())throw fail('En administratör behöver aktivera Gmail-kopplingen först.','not_configured');}
function callback(origin){
  const url=new URL(origin);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw fail('Ogiltig returadress för Gmail.','invalid_origin',400);
  return `${url.origin}/api/gmail/callback`;
}
/** Bygger Googles OAuth-länk med läsbehörigheten gmail.readonly och säker state för att identifiera rätt medgivandeflöde. */
export function gmailAuthorizationUrl(state,origin,{send=false}={}){
  requireConfig();
  if(!/^[A-Za-z0-9_-]{32,200}$/.test(state||''))throw fail('Ogiltig OAuth-status.','invalid_state',400);
  const search=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:callback(origin),response_type:'code',scope:send?scope+' https://www.googleapis.com/auth/gmail.send':scope,access_type:'offline',prompt:'consent select_account',login_hint:gmailAccount(),state});
  return `https://accounts.google.com/o/oauth2/v2/auth?${search}`;
}
async function requestJson(url,options={}){
  let response;
  try{response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20_000)});}
  catch{throw fail('Det gick inte att nå Gmail. Försök igen.','connection_error',502);}
  // A bounded read prevents a malformed response or huge attachment from exhausting memory.
  let bytes=0;const chunks=[];
  if(response.body){for await(const chunk of response.body){bytes+=chunk.length;if(bytes>22_000_000){await response.body.cancel?.().catch(()=>{});throw fail('Svaret från Gmail var för stort.','response_too_large',413);}chunks.push(chunk);}}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('Gmail returnerade ett ogiltigt svar.','invalid_response',502);}
  if(!response.ok){
    if(response.status===401||body.error==='invalid_grant')throw fail('Gmail-anslutningen behöver förnyas. Koppla Gmail igen.','renewal_required');
    if(response.status===403)throw fail('Gmail gav inte läsåtkomst. Kontrollera behörigheten och Gmail API i Google Cloud.','access_denied');
    if(response.status===429)throw fail('Gmail har begränsat hämtningen. Försök igen senare.','rate_limited',429);
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
  const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,...params});
  return normalizedTokens(await requestJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}),previous);
}
/** Växlar Googles kortlivade auktoriseringskod mot token på servern. */
export async function exchangeGmailCode(code,origin){
  if(typeof code!=='string'||!code||code.length>4096)throw fail('Saknar Googles engångskod.','invalid_code',400);
  return tokenRequest({grant_type:'authorization_code',code,redirect_uri:callback(origin)});
}
/** Begär en ny access token med lagrad refresh token när den tidigare har gått ut. */
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
/** Bekräftar att användaren verkligen godkänt företagets konfigurerade Gmail-konto. */
export async function gmailProfile(tokens){
  const profile=await apiRequest('/profile',tokens);
  if(typeof profile.emailAddress!=='string'||profile.emailAddress.toLowerCase()!==gmailAccount())throw fail(`Välj företagets Gmail-konto: ${gmailAccount()}.`,'account_mismatch');
  return profile;
}
export function hasGmailSendScope(tokens){return String(tokens?.scope||'').split(/\s+/).includes('https://www.googleapis.com/auth/gmail.send');}
// Preflight may refresh/read. The returned sender performs exactly ONE POST, no retry.
export async function prepareGmailSend(tokens){
  if(!tokens?.access_token||!tokens.expires_at||tokens.expires_at<Date.now()+60000)Object.assign(tokens,await refreshGmailTokens(tokens));
  if(!hasGmailSendScope(tokens))throw fail('Koppla Gmail igen och godkänn utskicksbehörigheten gmail.send.','missing_send_scope');
  await gmailProfile(tokens);
  if(!hasGmailSendScope(tokens))throw fail('Utskicksbehörigheten behöver förnyas.','missing_send_scope');
  return message=>{
    if(typeof message.recipient!=='string'||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(message.recipient)||message.recipient.length>240||/[\r\n\0]/.test(message.recipient)||typeof message.subject!=='string'||/[\r\n\0]/.test(message.subject)||!/^<[a-f0-9-]+@mg-fakturakoll\.local>$/.test(message.rfc_message_id))throw fail('Ogiltiga mejluppgifter.','invalid_message',400);
    const words=[];let part='';
    for(const char of message.subject){if(Buffer.byteLength(part+char)>42){words.push(part);part='';}part+=char;}if(part)words.push(part);
    const subject=words.map(word=>'=?UTF-8?B?'+Buffer.from(word).toString('base64')+'?=').join('\r\n ');
    const body=Buffer.from(message.body,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
    const raw=Buffer.from(`From: ${gmailAccount()}\r\nTo: ${message.recipient}\r\nSubject: ${subject}\r\nMessage-ID: ${message.rfc_message_id}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`).toString('base64url');
    return requestJson(apiBase+'/messages/send',{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  };
}
export async function revokeGmailTokens(tokens){
  const credential=tokens?.refresh_token||tokens?.access_token;
  if(!credential)return;
  let response;
  try{response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:credential}),signal:AbortSignal.timeout(20_000)});}
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
function partsOf(payload,path='0',out=[]){
  if(out.length>500)throw fail('Ett mejl har för många bilagor eller delar.','message_too_complex');
  out.push({...payload,_part:payload.partId||path});
  if(path.split('.').length>20)throw fail('Ett mejl har för många nästlade delar.','message_too_complex');
  for(const [i,part]of(payload.parts||[]).entries())partsOf(part,`${path}.${i}`,out);
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
/**
 * Hämtar bilagor som originalunderlag för efterföljande tolkning och granskning.
 * @param {any} tokens
 * @param {{query?:string,after?:string,maxMessages?:number,knownIds?:string[],rejectedIds?:string[],pageToken?:string}} options
 */
export async function fetchGmailInvoiceDocuments(tokens,{query='',after='',maxMessages=50,knownIds=[],rejectedIds=[],pageToken=''}={}){
  requireConfig();
  if(!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>100)throw fail('Välj mellan 1 och 100 mejl per hämtning.','invalid_limit',400);
  if(typeof query!=='string'||query.length>1000)throw fail('Gmail-sökningen är för lång.','invalid_query',400);
  if(typeof pageToken!=='string'||pageToken.length>4096)throw fail('Ogiltig sidmarkör för Gmail.','invalid_pagination',400);
  if(!Array.isArray(knownIds)||!Array.isArray(rejectedIds))throw fail('Ogiltiga importreferenser.','invalid_sources',400);
  let afterTime;
  if(after){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(after))throw fail('Ogiltigt startdatum för Gmail.','invalid_date',400);
    afterTime=Date.parse(`${after}T00:00:00Z`);
    if(!Number.isFinite(afterTime)||new Date(afterTime).toISOString().slice(0,10)!==after)throw fail('Ogiltigt startdatum för Gmail.','invalid_date',400);
  }
  let current=tokens;
  const deadline=Date.now()+120000;
  if(!tokens?.access_token||!tokens.expires_at||tokens.expires_at<Date.now()+60_000)Object.assign(current,await refreshGmailTokens(tokens));
  await gmailProfile(current);
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
      const labels=message.labelIds||[];
      if(labels.some(l=>['SPAM','TRASH','DRAFT'].includes(l))){skipped++;continue;}
      const headers=Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),mimeText(h.value)]));
      const subject=(headers.subject||'').slice(0,500);
      if(/påminnelse|payment\s+reminder|orderbekräftelse|order\s+confirmation|beställningsbekräftelse|betalningsbekräftelse|payment\s+confirmation|\breceipt\b|\bkvitto\b/i.test(subject)){skipped++;continue;}
      const direction=labels.includes('SENT')&&!labels.includes('INBOX')?'customer':'supplier';
      const contact=mailbox(direction==='customer'?headers.to:headers.from);
      const parts=partsOf(message.payload||{});
      const supported=parts.filter(p=>p.filename&&attachmentMime(p));
      let found=false;
      for(const part of supported){
        if(Date.now()>deadline){truncated=true;next_page_token=cursor;break;}
        const original_filename=mimeText(part.filename).slice(0,240);
        let name=original_filename.replace(/[\\/]/g,'_');
        if(/påminnelse|reminder|orderbekräftelse|confirmation/i.test(name)){continue;}
        found=true;
        const source_id=`gmail:${gmailAccount()}:${item.id}:${part._part}`;
        if(known.has(source_id)){duplicate++;continue;}
        if(rejected.has(source_id)){skipped++;continue;}
        // Invalid parts count toward the same work budget as valid files. Persisting
        // immutable rejected source IDs lets the next batch pass them and make progress.
        if(attachmentAttempts>=maxAttachmentAttempts){truncated=true;next_page_token=cursor;break;}
        attachmentAttempts++;
        if(Number(part.body?.size)>maxFileBytes){warnings.push({source_id,message:`${name}: filen är större än 15 MB.`});skipped++;continue;}
        let body=part.body||{};
        if(body.attachmentId)body=await apiRequest(`/messages/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(body.attachmentId)}`,current);
        const encoded=body.data;
        if(typeof encoded!=='string'||encoded.length>Math.ceil(maxFileBytes*4/3)+4||!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)){warnings.push({source_id,message:`${name}: bilagan kunde inte läsas.`});skipped++;continue;}
        const content=Buffer.from(encoded,'base64url');const mime_type=detectedMime(content);
        if(!content.length||content.length>maxFileBytes||mime_type!==attachmentMime(part)){warnings.push({source_id,message:`${name}: filformatet kunde inte bekräftas.`});skipped++;continue;}
        // MIME attachments may have no extension, or a misleading one. Keep an inert,
        // correctly typed download name so the server's same-format validation accepts it.
        const extension={'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[mime_type];
        const matchingExtension=mime_type==='image/jpeg'?/\.jpe?g$/i.test(name):name.toLowerCase().endsWith(extension);
        if(!matchingExtension)name=`${(name||'faktura').slice(0,240-extension.length)}${extension}`;
        if(totalBytes+content.length>maxBatchBytes||documents.length>=100){truncated=true;next_page_token=cursor;break;}
        totalBytes+=content.length;known.add(source_id);
        const receivedDate=new Date(Number(message.internalDate));
        const received_at=Number.isNaN(receivedDate.getTime())?'':receivedDate.toISOString();
        documents.push({source_id,name,mime_type,content_base64:content.toString('base64'),direction,...contact,subject,received_at,needs_review:true,metadata:{message_id:item.id,attachment_id:part.body?.attachmentId||null,part_id:part._part,from:headers.from||'',to:headers.to||'',original_filename,forwarded:/^(?:fw|fwd|vb):/i.test(subject),direction_confident:!(labels.includes('SENT')&&labels.includes('INBOX'))&&!/^(?:fw|fwd|vb):/i.test(subject),note:'Kontrollera originalet och de tolkade uppgifterna. Ingen betalningsstatus har antagits.'}});
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
  return {tokens:current,documents,received,skipped,duplicate,truncated,next_page_token,warnings,rejected_source_ids:warnings.map(w=>w.source_id)};
}
