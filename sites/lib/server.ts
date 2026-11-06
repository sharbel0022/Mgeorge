import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { emptyState, type State } from "./domain";
import {AsyncLocalStorage} from 'node:async_hooks';
import {createCompanyDatabase,resolveCompanyScope,assertScopeCurrent,boundaryForScope,companyDirectory,selectCompany,provisionCompany,changeCompanyMembership,resolveWorkerScope,resolveWorkerCredential,resolveCompanyMailbox,type CompanyScope} from './company-storage.js';
import type {CompanyAction,CompanyContext} from './company-contract.js';

type User=NonNullable<Awaited<ReturnType<typeof getChatGPTUser>>>;
type RequestCompany={request:Request;scope?:CompanyScope;pending?:Promise<CompanyScope>;user?:User;catalogue?:boolean};
const requests=new AsyncLocalStorage<RequestCompany>();
const denied=(code:string,status=403)=>Object.assign(Error(code),{code,status});
const bodyFailures:Record<string,{status:number;message:string}>={
 REQUEST_BODY_TOO_LARGE:{status:413,message:'Förfrågan är för stor. Dela upp underlaget och försök igen.'},
 REQUEST_BODY_TIMEOUT:{status:408,message:'Överföringen tog för lång tid. Försök igen.'},
 REQUEST_BODY_INVALID:{status:400,message:'Förfrågans storlek är ogiltig.'},
 REQUEST_BODY_UNREADABLE:{status:400,message:'Förfrågan kunde inte läsas. Försök igen.'},
};
const boundedRequests=new WeakSet<Request>();
/** Bound the original stream before authorization or framework code can clone
 * it. Pull lazily: an anonymous upload rejected by identity must not be read. */
function boundedRequest(req:Request):Request{
 const path=new URL(req.url).pathname;
 if(boundedRequests.has(req)||['GET','HEAD'].includes(req.method)||!path.startsWith('/api/')&&path!=='/mcp')return req;
 // OCR's route already caps transport bytes at 600k; its smaller JSON/text
 // character limits remain in the worker validator and must allow UTF-8 input.
 const max=path==='/api/files'?16_000_000:path==='/api/state'?1_500_000:path==='/api/ocr-worker/complete'?600_000:65_536;
 const length=req.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length)))){
  throw denied('REQUEST_BODY_INVALID',400);
 }
 if(length!==null&&Number(length)>max)throw denied('REQUEST_BODY_TOO_LARGE',413);
 if(!req.body)return req;
 const reader=req.body.getReader();let total=0,finished=false,timer:ReturnType<typeof setTimeout>|undefined;
 let controller:ReadableStreamDefaultController<Uint8Array>;
 const timeout=max>65_536?120_000:30_000;
 const cleanup=()=>{if(timer!==undefined)clearTimeout(timer);req.signal.removeEventListener('abort',abort);};
 const cancelReader=()=>{void reader.cancel().catch(()=>{}).finally(()=>reader.releaseLock());};
 const stop=(code:string)=>{if(finished)return;finished=true;cleanup();controller.error(denied(code,bodyFailures[code].status));cancelReader();};
 const abort=()=>stop('REQUEST_BODY_UNREADABLE');
 const body=new ReadableStream<Uint8Array>({
  start(value){controller=value;req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort();},
  async pull(){
   if(finished)return;
   timer??=setTimeout(()=>stop('REQUEST_BODY_TIMEOUT'),timeout);
   try{
    const next=await reader.read();if(finished)return;
    if(next.done){finished=true;cleanup();reader.releaseLock();controller.close();return;}
    total+=next.value.byteLength;
    if(total>max){stop('REQUEST_BODY_TOO_LARGE');return;}
    controller.enqueue(next.value);
   }catch{stop('REQUEST_BODY_UNREADABLE');}
  },
  cancel(){
   if(finished)return;finished=true;cleanup();
   // Before the first pull, the platform still owns the unread incoming body.
   // Do not start/cancel an upstream multipart encoder as a side effect of an
   // authorization denial. Once reading starts, explicitly stop its remainder.
   if(timer===undefined)reader.releaseLock();else cancelReader();
  },
 },{highWaterMark:0});
 const result=new Request(req,{body,duplex:'half'} as RequestInit);boundedRequests.add(result);return result;
}
async function authorizationBody(req:Request){
 try{return await req.clone().json();}catch(error){
  // A size/timeout error is an admission failure, never an unclassified command.
  if(error instanceof Error&&Object.hasOwn(bodyFailures,error.message))throw error;
  return null;
 }
}
function rawDatabase(){if(!env.DB)throw new Error("Databasen är inte tillgänglig. Försök igen om en stund.");return env.DB;}
function sameOrigin(req:Request){if(req.method!=='GET'&&req.method!=='HEAD'){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new Error('ORIGIN_DENIED');}}
function companyHeaders():Record<string,string>{const c=currentCompanyContext();return c?{'X-Company-Id':c.companyId,'X-Company-Context-Version':String(c.contextVersion)}:{};}
export const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",...companyHeaders()}});
export function currentCompanyContext():Readonly<CompanyContext>|null{return requests.getStore()?.scope?.context??null;}
function selectors(req?:Request){
 if(!req)return{};const p=new URL(req.url).searchParams;
 if(p.getAll('companyId').length>1||p.getAll('companyContextVersion').length>1)throw denied('COMPANY_CONTEXT_INVALID',400);
 const hId=req.headers.get('x-company-id'),qId=p.get('companyId'),hVersion=req.headers.get('x-company-context-version'),qVersion=p.get('companyContextVersion');
 if(hId&&qId&&hId!==qId||hVersion&&qVersion&&hVersion!==qVersion)throw denied('COMPANY_CONTEXT_STALE',409);
 const companyId=hId??qId??undefined,version=hVersion??qVersion??undefined;
 if(version!==undefined&&!/^[1-9]\d*$/.test(version)||companyId===undefined&&version!==undefined||companyId!==undefined&&version===undefined)throw denied('COMPANY_CONTEXT_INVALID',400);
 return{companyId,contextVersion:version===undefined?undefined:Number(version)};
}
async function actionFor(req?:Request):Promise<CompanyAction>{
 if(!req)return'read';const path=new URL(req.url).pathname;
 if(/\/api\/bank\/(?:config|connect|callback|disconnect|accounts|automatic|auto-sync|sync|details|account-evidence|revalidate)$/.test(path)||/\/api\/gmail\/(?:connect|callback|disconnect|automation|trust|sync)$/.test(path)||/\/api\/bankgiro\/(?:source\/run|invoice-search)$/.test(path)||req.method==='POST'&&/^\/api\/payment-control\/(?:run|advance)$/.test(path))return'manage_integrations';
 if(path==='/api/state'&&req.method==='POST'){
  const body=await authorizationBody(req) as {command?:{type?:string}}|null;if(body?.command?.type==='settings.save')return Object.hasOwn(body.command,'invoiceReferencePolicies')?'manage_reference_policy':'manage_company';
 }
 if(path==='/mcp'){
  const body=await authorizationBody(req) as {method?:string;params?:{name?:string}}|null,name=body?.params?.name||'';
  if(body?.method==='tools/call'&&['bank_auto_sync','bank_account_evidence','bank_revalidate_consent','bankgiro_auto_ingest','gmail_auto_sync'].includes(name))return'manage_integrations';
  return body?.method==='tools/call'&&!['payment_evidence','retained_report_evidence','backup_status','bankgiro_source_status','gmail_sync_status','bank_auto_sync_status'].includes(name)?'write':'read';
 }
 return req.method==='GET'||req.method==='HEAD'?'read':'write';
}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
async function oauthDigest(value:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function resolveRequestScope(holder?:RequestCompany):Promise<CompanyScope>{
 const req=holder?.request,path=req?new URL(req.url).pathname:'';
 if(req&&path.startsWith('/api/ocr-worker/')){
  const cfg=env as unknown as Record<string,string>,runner=req.headers.get('x-mg-ocr-runner')||'local';
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'',secret=(runner==='cloud'?cfg.DOCUMENT_CLOUD_WORKER_TOKEN:cfg.DOCUMENT_WORKER_TOKEN)||'';
  if(!['cloud','local'].includes(runner)||!/^[A-Za-z0-9_-]{43}$/.test(token))throw denied('WORKER_AUTH',401);
  if(req.headers.has('x-company-id')||req.headers.has('x-company-context-version')||new URL(req.url).searchParams.has('companyId')||new URL(req.url).searchParams.has('companyContextVersion'))throw denied('COMPANY_WORKER_FORBIDDEN');
  const registered=await resolveWorkerCredential(rawDatabase(),runner,await digest(token));if(registered)return registered;
  if(!/^[A-Za-z0-9_-]{43}$/.test(secret)||token.length!==secret.length||await digest(token)!==await digest(secret))throw denied('WORKER_AUTH',401);
  if(runner==='cloud'&&(cfg.DOCUMENT_CLOUD_OCR_ENABLED!=='true'||secret===cfg.DOCUMENT_WORKER_TOKEN))throw denied('WORKER_AUTH',401);
  const owners=await rawDatabase().prepare('SELECT owner FROM document_automation WHERE lower(email)=lower(?) AND enabled=1 LIMIT 2').bind(cfg.DOCUMENT_OWNER_EMAIL||'').all<{owner:string}>();
  if(owners.results.length!==1)throw denied('WORKER_AUTH',401);
  return resolveWorkerScope(rawDatabase(),owners.results[0].owner,runner,await digest(secret));
 }
 const user=await getChatGPTUser();if(!user)throw Error('AUTH_REQUIRED');if(holder)holder.user=user;
 let selection=selectors(req),flowMembershipVersion:number|null=null;
 // Provider redirects cannot attach browser headers. Their retained one-use
 // flow carries the initiating actor and context version; switching invalidates it.
 if(req&&/\/api\/(?:bank\/callback|gmail\/callback)$/.test(path)){
  const state=new URL(req.url).searchParams.get('state');
  if(state){const table=path.includes('/bank/')?'bank_auth_flows':'gmail_flows';
   const flow=await rawDatabase().prepare(`SELECT company_id,company_actor_id,company_context_version,company_membership_version FROM ${table} WHERE state_hash=?`).bind(await oauthDigest(state)).first<{company_id:string|null;company_actor_id:string|null;company_context_version:number|null;company_membership_version:number|null}>();
   if(flow?.company_id){
    if(flow.company_actor_id!==user.userId)throw denied('COMPANY_FORBIDDEN');
    if(!Number.isSafeInteger(flow.company_membership_version)||!flow.company_membership_version)throw denied('COMPANY_CONTEXT_STALE',409);
    if(selection.companyId!==undefined&&(selection.companyId!==flow.company_id||selection.contextVersion!==flow.company_context_version))throw denied('COMPANY_CONTEXT_STALE',409);
    selection={companyId:flow.company_id,contextVersion:flow.company_context_version??undefined};flowMembershipVersion=flow.company_membership_version;
   }else if(selection.companyId!==undefined)throw denied('COMPANY_CONTEXT_STALE',409);
  }
 }
 const scope=await resolveCompanyScope(rawDatabase(),user.userId,{...selection,action:await actionFor(req)});
 if(flowMembershipVersion!==null&&flowMembershipVersion!==scope.context?.membershipVersion)throw denied('COMPANY_CONTEXT_STALE',409);
 return scope;
}
async function requestScope(holder=requests.getStore()){
 if(!holder)return resolveRequestScope();
 holder.pending??=resolveRequestScope(holder).then(scope=>(holder.scope=scope));return holder.pending;
}
/** Install before dispatch. Resolution happens inside Next's trusted-header
 * context, and the same holder follows every awaited operation and response. */
export function withCompanyRequest<Args extends unknown[]>(handler:(req:Request,...args:Args)=>Promise<Response>){
 return async(req:Request,...args:Args):Promise<Response>=>{
  try{req=boundedRequest(req);}catch(error){return failure(error);}
  return requests.run({request:(new URL(req.url).pathname==='/mcp'?req.clone():req) as Request},async()=>{
  const holder=requests.getStore()!;
  try{const result=await handler(req,...args);if(holder.pending){const scope=await holder.pending;await assertScopeCurrent(rawDatabase(),scope);for(const [key,value]of Object.entries(companyHeaders()))result.headers.set(key,value);}return result;}
  catch(error){return failure(error);}
  finally{if(!req.bodyUsed)void req.body?.cancel().catch(()=>{});if(holder.request!==req&&!holder.request.bodyUsed)void holder.request.body?.cancel().catch(()=>{});}
 });
 };
}
export async function identity(req?:Request){
 if(req)sameOrigin(req);const holder=requests.getStore(),scope=await requestScope(holder);await assertScopeCurrent(rawDatabase(),scope);
 const user=holder?.user??await getChatGPTUser();if(!user)throw Error('AUTH_REQUIRED');
 return {...user,userId:scope.owner,actorId:scope.actorId,companyId:scope.context?.companyId};
}
export function db(){const holder=requests.getStore();return createCompanyDatabase(rawDatabase(),()=>{if(holder&&requests.getStore()!==holder)throw denied('COMPANY_BOUNDARY_MISMATCH');return requestScope(holder);});}
export async function companyBoundaryForOwner(owner:string){return boundaryForScope(rawDatabase(),await requestScope(),owner);}
export async function companyGmailAccount(owner:string,{required=true}={}){
 const scope=await requestScope();await boundaryForScope(rawDatabase(),scope,owner);
 const company=scope.context?await rawDatabase().prepare('SELECT legacy_owner FROM companies WHERE id=? AND storage_owner=?').bind(scope.context.companyId,owner).first<{legacy_owner:string|null}>():null;
 const config=env as unknown as Record<string,string>;
 return resolveCompanyMailbox(config.COMPANY_GMAIL_ACCOUNTS,{context:scope.context,legacyOwner:company?.legacy_owner,legacyAccount:config.GMAIL_ACCOUNT||'mg.vitvaror@gmail.com',required})??'';
}
export async function companyWorkerIdentity(req:Request){
 if(!requests.getStore())return null; // Standalone legacy helpers retain their existing credential check.
 const scope=await requestScope();await assertScopeCurrent(rawDatabase(),scope,'write');
 if(!['worker','legacy-worker'].includes(scope.kind)||!new URL(req.url).pathname.startsWith('/api/ocr-worker/'))throw denied('WORKER_AUTH',401);
 return{owner:scope.owner,mode:req.headers.get('x-mg-ocr-runner')||'local'};
}
export async function companyWorkerConfigured(owner:string,runner='cloud'){
 const scope=await requestScope();await boundaryForScope(rawDatabase(),scope,owner);if(!scope.context)return null;
 const row=await rawDatabase().prepare("SELECT g.id FROM company_worker_grants g JOIN company_memberships m ON m.company_id=g.company_id AND m.actor_id=g.actor_id JOIN companies c ON c.id=g.company_id WHERE g.company_id=? AND g.runner=? AND g.status='active' AND m.status='active' AND m.role IN ('owner','admin') AND m.membership_version=g.membership_version AND c.company_version=g.company_version AND c.status='active' LIMIT 1").bind(scope.context.companyId,runner).first();
 return !!row;
}
/** Internal continuations can retain their owner, never adopt a new one. */
export async function withCompanyOwner<T>(owner:string,action:CompanyAction,fn:()=>Promise<T>){const scope=await requestScope();if(scope.owner!==owner)throw denied('COMPANY_BOUNDARY_MISMATCH');await assertScopeCurrent(rawDatabase(),scope,action);return fn();}
export async function companyCatalogueAction(req:Request,action:'list'|'active'|'create'|'membership'){
 const user=await getChatGPTUser();if(!user)throw Error('AUTH_REQUIRED');sameOrigin(req);const holder=requests.getStore();if(holder)holder.catalogue=true;
 if(action==='list')return response(await companyDirectory(rawDatabase(),user.userId));
 const raw=await req.text();if(raw.length>10000)throw denied('COMPANY_REQUEST_TOO_LARGE',413);const body=JSON.parse(raw);
 if(action==='active'){if(Object.keys(body).some(k=>!['companyId','contextVersion'].includes(k)))throw denied('COMPANY_CONTEXT_INVALID',400);return response({context:await selectCompany(rawDatabase(),user.userId,body.companyId,body.contextVersion)});}
 if(action==='create'){
  if(body.confirmEmptyCompany!==true||Object.keys(body).some(k=>!['name','confirmEmptyCompany'].includes(k)))throw denied('COMPANY_PROVISIONING_INVALID',400);
  const created=await provisionCompany(rawDatabase(),{id:crypto.randomUUID(),name:body.name,actorId:user.userId,verifiedBy:user.userId,verificationEvidence:'Authenticated creation of a separate empty company. No legacy data was adopted.'});return response(created,201);
 }
 const scope=await requestScope();return response(await changeCompanyMembership(rawDatabase(),scope,body));
}
export async function readWorkspace(owner:string){const boundary=await companyBoundaryForOwner(owner);const row=await db().prepare('SELECT revision, payload FROM workspaces WHERE owner = ?').bind(owner).first<{revision:number,payload:string}>();if(!row&&currentCompanyContext())throw denied('COMPANY_WORKSPACE_MISSING',409);const result=row?{revision:row.revision,state:JSON.parse(row.payload) as State}:{revision:0,state:emptyState()};
 // Compatibility projection for the evidence engine. A stored business profile
 // is never tenant authority: overwrite it from the current catalog on every read.
 delete result.state.company.id;
 if(boundary)result.state.company.id=boundary.companyId;
 return result;}
/** Ownership, size and exact-byte integrity are shared by invoice and bank originals. */
async function readOriginalBytes(owner:string,documentId:string,maxBytes:number,bank:boolean){
 const doc=await db().prepare('SELECT filename,mime,sha256,size FROM documents WHERE id=? AND owner=?').bind(documentId,owner).first<{filename:string;mime:string;sha256:string;size:number}>();
 if(!doc)throw Error(bank?'Välj ett sparat bankoriginal i XLSX-, CSV- eller camt XML-format.':'Originalet saknas för den aktuella ägaren.');
 if(bank&&!(doc.mime==='text/csv'&&/\.csv$/i.test(doc.filename)||doc.mime==='application/xml'&&/\.xml$/i.test(doc.filename)||doc.mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'&&/\.xlsx$/i.test(doc.filename)||doc.mime==='application/vnd.mgeorge.openpayments-bankgiro+json'&&/\.opbg\.json$/i.test(doc.filename)))throw Error('Välj ett sparat bankoriginal i XLSX-, CSV- eller camt XML-format.');
 if(!Number.isSafeInteger(doc.size)||doc.size<1||doc.size>15_000_000||!/^[a-f0-9]{64}$/.test(doc.sha256))throw Error(bank?'Bankoriginalets storlek är ogiltig.':'Originalets storlek eller kontrollsumma är ogiltig.');
 if(doc.size>maxBytes)throw Error(bank?'Bankoriginalen överskrider kontrollens säkerhetsgräns. Granska underlagen i mindre omgångar.':'Originalen överskrider kontrollens säkerhetsgräns. Granska underlagen i mindre omgångar.');
 const object=await env.BUCKET?.get(`${owner}/${documentId}`);if(!object||object.size!==doc.size)throw Error(bank?'Bankoriginalet saknas eller har ändrad storlek.':'Originalet saknas eller har ändrad storlek.');
 const bytes=await object.arrayBuffer();if(bytes.byteLength!==doc.size)throw Error(bank?'Bankoriginalets storlek stämmer inte.':'Originalets storlek stämmer inte.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==doc.sha256)throw Error(bank?'Bankoriginalets kontrollsumma stämmer inte. Ingen import har gjorts.':'Originalets kontrollsumma stämmer inte. Ingen import har gjorts.');
 return {...doc,bytes,objectVersion:typeof object.version==='string'?object.version:null,objectEtag:typeof object.etag==='string'?object.etag:null};
}
/** The same owned, byte-checked bank original is required at import and allocation. */
export async function readBankOriginalBytes(owner:string,documentId:string,maxBytes=15_000_000){return readOriginalBytes(owner,documentId,maxBytes,true);}
/** A reviewed register entry never certifies availability of its invoice original. */
export async function readInvoiceOriginalBytes(owner:string,documentId:string,maxBytes=15_000_000){return readOriginalBytes(owner,documentId,maxBytes,false);}
/** Bank facts come from retained bytes. An owned document ID alone is not evidence. */
export async function readBankFileOriginal(owner:string,command:Record<string,any>){
 const doc=await readBankOriginalBytes(owner,command.documentId),bytes=doc.bytes;
 if(/\.opbg\.json$/i.test(doc.filename))throw Error('API-underlaget ska läsas via den företagsbundna Bankgiroimporten.');
 if(/\.xlsx$/i.test(doc.filename))throw Error('Importera Excelrapporten via Importera Bankgirofil så att rapportens kontroller och granskningsspärrar används.');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
 const {parseCSV,guessMapping,mapCSV,parseCAMT}=await import('./imports');
 let rows,mapping=undefined;
 if(doc.mime==='application/xml')rows=parseCAMT(text,doc.filename);
 else{const parsed=parseCSV(text);mapping=command.mapping??guessMapping(parsed.headers);rows=mapCSV(parsed,mapping,doc.filename);}
 return {...command,rows:rows.map(row=>({...row,verified:false})),hash:doc.sha256,name:doc.filename,mapping,trustedBankImport:false,trustedBankFileImport:true};
}
export function failure(error:unknown){const message=error instanceof Error?error.message:'Åtgärden misslyckades.';if(Object.hasOwn(bodyFailures,message)){const safe=bodyFailures[message];return response({error:safe.message,code:message},safe.status);}if(message==='AUTH_REQUIRED')return response({error:'Logga in med ChatGPT för att öppna dina sparade uppgifter.',signIn:'/signin-with-chatgpt?return_to=%2F'},401);if(message==='ORIGIN_DENIED')return response({error:'Åtgärden måste göras från systemets egen sida.'},403);if(message.startsWith('COMPANY_')){const e=error as Error&{status?:number};const stale=['COMPANY_CONTEXT_STALE','COMPANY_CONTEXT_REQUIRED'].includes(message);const result=response({error:stale?'Företagskontexten har ändrats. Välj företag igen.':'Du saknar behörighet för den här företagsåtgärden.',code:message},e.status??(stale?409:403));if(stale)result.headers.set('X-Company-Context-Stale','1');return result;}if(message==='WORKER_AUTH')return response({error:'Åtkomst nekad.'},401);if(/SQLITE|D1_|R2_|constraint|syntax error|no such table/i.test(message))return response({error:'Uppgifterna kunde inte sparas. Försök igen, eller kontakta administratören.'},500);return response({error:message},400);}
