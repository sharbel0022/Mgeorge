/** Application capture container, NOT an Open Payments response schema.
 * Each body is the exact UTF-8 response text. Receipts describe acquisition;
 * a SHA-256 is an integrity check and never substitutes for bank authority. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {normalizeOpenPaymentsBankgiro} from './bankgiro-openpayments.js';

export const OPENPAYMENTS_CAPTURE_VERSION='openpayments-bankgiro-capture-v1';
export const OPENPAYMENTS_PROFILE='openpayments-bankgiro-v1';
const encoder=new TextEncoder(),MAX_BYTES=15_000_000;
const error=code=>Object.assign(new Error(code),{code});
const text=(value,max=200)=>typeof value==='string'&&!!value&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const instant=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const digest=bytes=>bytesToHex(sha256(bytes));
const bytesOf=value=>value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):typeof value==='string'?encoder.encode(value):null;
function utf8(value){
 const bytes=bytesOf(value);if(!bytes?.length||bytes.length>MAX_BYTES)throw error('INVALID_ORIGINAL');
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw error('INVALID_ORIGINAL');}
}
/** JSON.parse alone silently accepts duplicate identity fields. Scan the already
 * syntax-checked text to reject duplicate keys (including escaped aliases). */
function strictJSON(input){
 let result;try{result=JSON.parse(input);}catch{throw error('INVALID_ORIGINAL');}
 let i=0,nodes=0;
 const ws=()=>{while(/\s/.test(input[i]||'')&&i<input.length)i++;};
 const string=()=>{const start=i++;while(i<input.length){if(input[i]==='\\'){i+=2;continue;}if(input[i++]==='"')return JSON.parse(input.slice(start,i));}throw error('INVALID_ORIGINAL');};
 function scan(depth=0){
  if(depth>32||++nodes>100000)throw error('INVALID_ORIGINAL');ws();
  if(input[i]==='"'){string();return;}
  if(input[i]==='{'){
   i++;ws();const keys=new Set();if(input[i]==='}'){i++;return;}
   while(i<input.length){ws();const key=string();if(keys.has(key))throw error('INVALID_ORIGINAL');keys.add(key);ws();i++;scan(depth+1);ws();if(input[i++]==='}')return;}
  }else if(input[i]==='['){
   i++;ws();if(input[i]===']'){i++;return;}while(i<input.length){scan(depth+1);ws();if(input[i++]===']')return;}
  }else{while(i<input.length&&!/[\s,}\]]/.test(input[i]))i++;}
 }
 scan();return result;
}
function checkedContext(raw){
 const keys=['owner','companyId','sourceId','scopeId','accountId','iban'];
 if(!raw||keys.some(key=>!text(raw[key]))||! /^[A-Za-z0-9_-]{1,128}$/.test(raw.accountId)||! /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(raw.iban)||raw.bankgiro!==undefined&&!/^\d{4,10}$/.test(raw.bankgiro))throw error('AUTHORIZATION_BLOCKED');
 return Object.fromEntries([...keys,...(raw.bankgiro!==undefined?['bankgiro']:[])].map(key=>[key,raw[key]]));
}
function requestPath(value,context,allowAbsolute=false){
 // The provider validates the environment before following a link. A retained
 // capture can also inspect either documented origin, without making a request.
 if(allowAbsolute&&typeof value==='string'&&value.startsWith('https://')){
  let link;try{link=new URL(value);}catch{throw error('ACCOUNT_MISMATCH');}
  if(!['https://api.openbankingplatform.com','https://api.sandbox.openbankingplatform.com'].includes(link.origin)||link.username||link.password||link.hash||/[\\\r\n]/.test(value))throw error('ACCOUNT_MISMATCH');
  value=link.pathname+link.search;
 }
 const base='/psd2/accountinformation/v1/accounts/'+encodeURIComponent(context.accountId)+'/transactions';
 if(!text(value,2000)||!value.startsWith(base+'?')||/[\\#]/.test(value))throw error('ACCOUNT_MISMATCH');
 let url;try{url=new URL(value,'https://api.openbankingplatform.com');}catch{throw error('ACCOUNT_MISMATCH');}
 if(url.origin!=='https://api.openbankingplatform.com'||url.pathname!==base)throw error('ACCOUNT_MISMATCH');
 const allowed=['bookingStatus','dateFrom','dateTo','entryReferenceFrom','continuationKey'],seen=new Set();
 for(const [key,val] of url.searchParams){if(seen.has(key)||!allowed.includes(key)||!text(val,1000))throw error('ACCOUNT_MISMATCH');seen.add(key);}
 if(url.searchParams.get('bookingStatus')!=='booked')throw error('ACCOUNT_MISMATCH');
 for(const key of ['dateFrom','dateTo'])if(url.searchParams.has(key)){
  const d=url.searchParams.get(key);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T12:00:00Z'))||new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d)throw error('ACCOUNT_MISMATCH');
 }
 if(url.searchParams.has('dateFrom')&&url.searchParams.has('dateTo')&&url.searchParams.get('dateFrom')>url.searchParams.get('dateTo'))throw error('ACCOUNT_MISMATCH');
 url.searchParams.sort();return url.pathname+url.search;
}
function readContainer(container){
 if(container?.version!==OPENPAYMENTS_CAPTURE_VERSION||!text(container.captureId)||!Array.isArray(container.pages)||!container.pages.length||container.pages.length>50)throw error('INVALID_ORIGINAL');
 const context=checkedContext(container.context),pages=[],bodies=[],paths=new Set();let previousNext;
 for(const page of container.pages){
  if(!page||typeof page.body!=='string'||!text(page.requestId)||!instant(page.receivedAt)||! /^[a-f0-9]{64}$/.test(page.sha256))throw error('INVALID_ORIGINAL');
  const rawBytes=encoder.encode(page.body);if(digest(rawBytes)!==page.sha256)throw error('HASH_MISMATCH');
  const path=requestPath(page.requestPath,context);if(paths.has(path)||pages.length&&path!==previousNext)throw error('INVALID_ORIGINAL');paths.add(path);
  const body=strictJSON(page.body);if(!body||typeof body!=='object'||Array.isArray(body))throw error('INVALID_ORIGINAL');
  const next=body.transactions?._links?.next?.href;
  previousNext=next==null?undefined:requestPath(next,context,true);
  if(previousNext&&paths.has(previousNext))throw error('INVALID_ORIGINAL');
  pages.push({body:page.body,sha256:page.sha256,requestPath:page.requestPath,requestId:page.requestId,receivedAt:page.receivedAt});bodies.push(body);
 }
 const reportId='opbg-'+digest(encoder.encode(JSON.stringify([context.owner,context.companyId,context.sourceId,context.scopeId,context.accountId,container.captureId])));
 const normalization=normalizeOpenPaymentsBankgiro(bodies,{...context,reportId});
 return {version:OPENPAYMENTS_CAPTURE_VERSION,captureId:container.captureId,context,pages,reportId,normalization};
}
export function createOpenPaymentsBankgiroCapture({context,captureId,pages}){
 if(!Array.isArray(pages)||pages.length>50)throw error('INVALID_ORIGINAL');
 const container={version:OPENPAYMENTS_CAPTURE_VERSION,captureId,context:checkedContext(context),pages:pages.map(page=>{
  const body=utf8(page?.body);return {body,sha256:digest(encoder.encode(body)),requestPath:page.requestPath,requestId:page.requestId,receivedAt:page.receivedAt};
 })};
 const result=readContainer(container),bytes=encoder.encode(JSON.stringify(container));if(bytes.length>MAX_BYTES)throw error('INVALID_ORIGINAL');
 return {...result,bytes,sha256:digest(bytes),filename:result.reportId+'.opbg.json'};
}
export function readOpenPaymentsBankgiroCapture(bytes){return readContainer(strictJSON(utf8(bytes)));}

/** Authorization is supplied by the trusted server adapter, never read out of
 * the JSON original or browser input. The selected workspace supplies companyId. */
export function assertOpenPaymentsBankgiroAuthority(capture,authorization,{owner,companyId,sourceId,scopeId,now=Date.now()}){
 const context=capture?.context,auth=authorization;
 if(!text(owner)||!text(companyId)||!text(sourceId)||!text(scopeId)||!Number.isFinite(now)||!context||['owner','companyId','sourceId','scopeId'].some(key=>context[key]!==({owner,companyId,sourceId,scopeId})[key]||auth?.[key]!==context[key])||auth.status!=='VERIFIED'||auth.origin!=='provider_authorization'||auth.profileId!==OPENPAYMENTS_PROFILE||!text(auth.generation)||!text(auth.evidenceId)||!instant(auth.checkedAt)||!instant(auth.validUntil)||Date.parse(auth.checkedAt)>now||now-Date.parse(auth.checkedAt)>300000||Date.parse(auth.validUntil)<=now||!Array.isArray(auth.capabilities)||!['bankgiro_reports:read','accountinformation','bankgiroinformation','corporate'].every(scope=>auth.capabilities.includes(scope))||!/^\d{4,10}$/.test(auth.bankgiro)||auth.bankgiro!==context.bankgiro)throw error('AUTHORIZATION_BLOCKED');
 if(auth.accountId!==context.accountId||auth.iban!==context.iban||capture.pages.some(page=>Date.parse(page.receivedAt)>now))throw error('AUTHORIZATION_BLOCKED');
 return Object.fromEntries(['status','origin','owner','companyId','sourceId','scopeId','generation','accountId','iban','bankgiro','profileId','evidenceId','checkedAt','validUntil','capabilities'].filter(key=>auth[key]!==undefined).map(key=>[key,structuredClone(auth[key])]));
}
/** Selection only: never starts a fetch, changes consent or activates SFTP. */
export function bankgiroEnrichmentFallback({companyId,coverage,sftp,now=Date.now()}){
 if(coverage?.status==='available')return {source:'api',message:'Individuell betalningsinformation finns i det sparade API-underlaget.'};
 const available=text(companyId)&&sftp?.companyId===companyId&&sftp.status==='VERIFIED'&&sftp.origin==='provider_authorization'&&text(sftp.agreementId)&&instant(sftp.validUntil)&&Date.parse(sftp.validUntil)>now;
 const source=available?'camt054c_sftp':'manual_file';
 const message=coverage?.status==='partial'?'Individuell betalningsinformation är ofullständig och behöver granskas.':'Individuell betalningsinformation är inte tillgänglig i API-underlaget.';
 return {source,message:message+(available?' Använd företagets godkända CAMT054C/SFTP-källa.':' Använd en bankfil för manuell import; SFTP kräver ett godkänt företagsavtal.')};
}

/** Join the server-only provider receipts to the existing report source contract.
 * This does not grant authority, persist a report or fetch any remote resource. */
export function createOpenPaymentsBankgiroCaptureFromProvider({context,captureId,originals,binding}){
 const scoped=checkedContext(context);
 if(!binding||binding.provider!=='open_payments'||binding.owner!==scoped.owner||binding.companyId!==scoped.companyId||!text(binding.connectionId)||!text(binding.generation)||!['SANDBOX','PRODUCTION'].includes(binding.environment)||!Array.isArray(originals)||!originals.length)throw error('AUTHORIZATION_BLOCKED');
 const pages=originals.map(original=>{
  if(original?.provider!=='open_payments'||original.operation!=='transactions'||['owner','companyId','connectionId','provider','environment','generation'].some(key=>original.binding?.[key]!==binding[key]))throw error('AUTHORIZATION_BLOCKED');
  const receipt=original.rawResponse;
  if(!receipt||typeof receipt.body!=='string'||receipt.sha256!==digest(encoder.encode(receipt.body))||original.requestId!==receipt.requestId||original.receivedAt!==receipt.receivedAt)throw error('HASH_MISMATCH');
  return receipt;
 });
 return createOpenPaymentsBankgiroCapture({context:scoped,captureId,pages});
}
