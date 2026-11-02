import {identity,db,readWorkspace,readBankOriginalBytes,response} from '../server';
import {hasBankApiOrigin,bankApiOriginalIssue,paymentOriginalIssue,paymentEvidenceConflict,canonicalBankAccount,type State} from '../domain';
import {accountEvidenceTarget,type AccountEvidenceTarget} from '../account-evidence-presentation';
import {connection,application,accounts,providerConfig,sessionId,metadata,withBankLock,type BankLease,type BankConnectionRow,type BankApplicationRow} from './store';
import {getSession,getAccountDetails,providerResponseDiagnostic,providerRetryDiagnostic,providerCooldownDiagnostic,providerErrorCode,type ProviderAccount} from './enable-banking';
import {stableAccountKey} from './transactions';
import {parseSpecificationBytes} from '../bankgiro-parser.js';
import {projectBankAccountEvidence} from './account-evidence-contract';
import {accountReadCooldown,mergeAccountReadCooldown} from './account-read-cooldown';
import {guardedBankRead} from './account-read-guard';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,ID=/^[a-zA-Z0-9_-]{1,100}$/,MAX_RESOURCES=5,MAX_ROWS=50;
const providerErrorCodes=new Set(['INVALID_REQUEST','INVALID_PROVIDER_RESPONSE','INVALID_CONFIGURATION','INVALID_PRIVATE_KEY','RESPONSE_TOO_LARGE','BANK_RECONNECT_REQUIRED','BANK_AUTHORIZATION_EXPIRED','NO_LINKED_ACCOUNTS','CALLBACK_NOT_REGISTERED','BANK_PERIOD_UNAVAILABLE','BANK_ACCOUNT_UNAVAILABLE','BANK_ACTION_REQUIRED','BANK_RATE_LIMIT','BANK_TIMEOUT','BANK_USER_CONTEXT_REQUIRED','PROVIDER_AUTHORIZATION_FAILED','PROVIDER_ACCESS_DENIED','BANK_UNAVAILABLE','BANK_SYNC_RESTART_REQUIRED','BANK_RESOURCE_UNAVAILABLE','BANK_SERVICE_ERROR','PROVIDER_REDIRECT_DENIED','BANK_NETWORK_ERROR']);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function args(value:unknown){
 if(!object(value)||Object.keys(value).some(k=>!['transactionId','documentId','sha256'].includes(k))||typeof value.transactionId!=='string'||!ID.test(value.transactionId)||(value.documentId!==undefined)===(value.sha256!==undefined)||value.documentId!==undefined&&(typeof value.documentId!=='string'||!ID.test(value.documentId))||value.sha256!==undefined&&(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)))throw Error('Välj en ägd AIS-bankhändelse och exakt ett ägt original-ID eller SHA256. Ägare och bankkonton kan inte väljas.');
 return value as {transactionId:string;documentId?:string;sha256?:string};
}
function active(owner:string,app:BankApplicationRow|null,conn:BankConnectionRow|null){
 if(!app||!conn||app.owner!==owner||conn.owner!==owner||conn.status!=='connected'||conn.environment!=='PRODUCTION'||app.generation!==conn.app_generation||!(Date.parse(conn.valid_until)>Date.now()))throw Error('Ett aktivt ägarbundet produktionsmedgivande krävs för kontokontrollen.');
 const info=metadata(app);
 if(info.kid!==app.application_id||info.environment!=='PRODUCTION'||info.active!==true||!info.services?.includes('AIS')||!info.countries?.includes('SE')||conn.country!=='SE')throw Error('Bankapplikationens befintliga svenska AIS-åtkomst behöver verifieras.');
 return {app,conn};
}
const consentFields=['id','owner','status','environment','app_generation','valid_until','selected_accounts','encrypted_accounts','encrypted_session','bank_name','country','retry_after','account_evidence_retry'] as const;
const consentSnapshot=(conn:BankConnectionRow)=>JSON.stringify(consentFields.map(k=>conn[k]));
const appSnapshot=(app:BankApplicationRow)=>JSON.stringify([app.owner,app.application_id,app.generation,app.metadata]);
/** Formatting only. Never change digits, clearing length, leading zeros or IBAN. */
const formatted=(v:string)=>v.replace(/[\s-]/g,'').toUpperCase();
function aliases(account:ProviderAccount){
 const out:{value:string;scheme:string;sourcePath:string}[]=[];
 if(account.account_id?.iban)out.push({value:account.account_id.iban,scheme:'IBAN',sourcePath:'account_id.iban'});
 if(account.account_id?.other)out.push({value:account.account_id.other.identification,scheme:account.account_id.other.scheme_name,sourcePath:'account_id.other.identification'});
 for(const [index,id]of (account.all_account_ids||[]).entries())out.push({value:id.identification,scheme:id.scheme_name,sourcePath:`all_account_ids[${index}].identification`});
 return out.filter(id=>['IBAN','BBAN','CPAN'].includes(id.scheme)&&/^[A-Z0-9]{1,80}$/.test(formatted(id.value)));
}

/** Explicit current provider read. Financial state/originals are read-only;
 * owner lease and provider cooldowns are operational state. No account numbers
 * or raw provider resources leave the bounded evidence response. */
type TrustedAccountEvidenceSelection={owner:string;revision:number;target:AccountEvidenceTarget};
export async function readBankAccountEvidence(input:unknown,trustedSelection?:TrustedAccountEvidenceSelection){
 const select=args(input),user=await identity(),attempt={providerContacted:false,operationalStateChanged:false};
 try{return await withBankLock(user.userId,lease=>readLocked(select,user,lease,attempt,trustedSelection));}
 catch(error){
  if(error instanceof Error&&['BANK_BUSY','BANK_LEASE_LOST'].includes(error.message))return evidenceResponse({changed:false,...attempt,checkedAt:new Date().toISOString(),transactionId:select.transactionId,documentId:select.documentId,status:'blocked',reason:'En bankåtgärd pågår eller kontokontrollens lås har löpt ut. Läs status igen innan ett nytt försök.',accountMatch:false,complete:false,ambiguous:false,rows:[]},409);
  throw error;
 }
}
const evidenceResponse=(result:Record<string,unknown>,status=200)=>response({...result,bankAccountEvidence:projectBankAccountEvidence(result)},status);
async function readLocked(select:ReturnType<typeof args>,user:Awaited<ReturnType<typeof identity>>,lease:BankLease,attempt:{providerContacted:boolean;operationalStateChanged:boolean},trustedSelection?:TrustedAccountEvidenceSelection){
 const owner=user.userId,{state,revision}=await readWorkspace(owner),target=state.transactions.find(t=>t.id===select.transactionId);
 // This context is constructed by the same-origin UI route, never parsed from
 // MCP/public selectors. Independent owned-report MCP inspection stays available.
 const selectionCurrent=(currentState:State,currentRevision:number)=>{
  if(!trustedSelection)return true;
  const current=accountEvidenceTarget(currentState,select.transactionId);
  return trustedSelection.owner===owner&&trustedSelection.revision===currentRevision&&trustedSelection.target.transactionId===select.transactionId&&trustedSelection.target.documentId===select.documentId&&current?.transactionId===trustedSelection.target.transactionId&&current.documentId===trustedSelection.target.documentId;
 };
 if(!selectionCurrent(state,revision))return evidenceResponse({changed:false,providerContacted:false,checkedAt:new Date().toISOString(),transactionId:select.transactionId,documentId:select.documentId,revision,status:'stale',reason:'Arbetsytan eller rapportvalet ändrades före bankläsningen. Läs betalningskontrollen på nytt.',snapshotCurrent:false,accountMatch:false,complete:false,ambiguous:false,resourcesRead:0,rows:[]},409);
 if(!target||target.parentId||!hasBankApiOrigin(target)||bankApiOriginalIssue(target)||paymentOriginalIssue(state,target)||paymentEvidenceConflict(state,target))throw Error('Välj en ägd AIS-bankhändelse med intakt original och ankomstkvitto.');
 const {app,conn}=active(owner,await application(owner),await connection(owner));
 const cooldown=accountReadCooldown(conn.account_evidence_retry),genericWait=conn.retry_after!==''&&(!Number.isFinite(Date.parse(conn.retry_after))||Date.parse(conn.retry_after)>Date.now());
 if(cooldown.blocked||genericWait)return evidenceResponse({changed:false,operationalStateChanged:false,providerContacted:false,checkedAt:new Date().toISOString(),revision,transactionId:select.transactionId,documentId:select.documentId,status:'blocked',sourceScope:'current_owned_ais_consent',reason:'Bankens väntetid är aktiv eller inte fastställd. Ingen ny kontokontroll görs innan spärren är utredd.',retryAdvice:cooldown.retryAdvice,accountMatch:false,complete:false,ambiguous:false,resourcesRead:0,rows:[]});
 const available=await accounts(conn),selected=JSON.parse(conn.selected_accounts) as unknown;
 if(!Array.isArray(available)||!available.length||available.length>100||available.some(a=>!object(a)||typeof a.uid!=='string'||!UUID.test(a.uid))||new Set(available.map(a=>a.uid)).size!==available.length||!Array.isArray(selected)||!selected.length||selected.some(id=>typeof id!=='string'||!UUID.test(id)||!available.some(a=>a.uid===id))||new Set(selected).size!==selected.length)throw Error('Bankmedgivandets befintliga kontoresurser eller kontoval är ogiltiga.');
 const bank={name:conn.bank_name,country:conn.country},targetKey=canonicalBankAccount(target.account),matches=available.filter(a=>stableAccountKey(a,bank)===targetKey);
 if(matches.length!==1||matches[0].currency!=='SEK'||!selected.includes(matches[0].uid))throw Error('AIS-bankhändelsens primära konto ingår inte entydigt i det valda SEK-kontot.');
 const account=matches[0],docs=select.documentId?await db().prepare('SELECT id FROM documents WHERE owner=? AND id=? LIMIT 2').bind(owner,select.documentId).all<{id:string}>():await db().prepare('SELECT id FROM documents WHERE owner=? AND sha256=? ORDER BY id LIMIT 2').bind(owner,select.sha256).all<{id:string}>();
 if(docs.results.length!==1)throw Error('Originalet saknas för ditt konto eller kontrollsumman avser flera original. Välj ett ägt original-ID.');
 const original=await readBankOriginalBytes(owner,docs.results[0].id),report=parseSpecificationBytes(original.bytes,original.filename);
 if(!report.length||report.some(row=>typeof row.account!=='string'||!/^[A-Z0-9]{1,80}$/.test(formatted(row.account))))throw Error('Rapportoriginalet saknar ett uttryckligt kontonummer som kan jämföras utan gissning.');
 const config=await providerConfig(app),remoteId=await sessionId(conn),beforeConsent=consentSnapshot(conn),beforeApp=appSnapshot(app),resources=[account,...available.filter(a=>a.uid!==account.uid)].slice(0,MAX_RESOURCES);
 if(!UUID.test(remoteId))throw Error('Det sparade bankmedgivandets sessionsresurs är ogiltig.');
 const base={changed:false,operationalStateChanged:false,providerContacted:false,checkedAt:new Date().toISOString(),revision,scope:{kind:'authenticated_owner',email:user.email},sourceScope:'current_owned_ais_consent',sourcePath:'GET /accounts/{consent-account}/details',documentId:docs.results[0].id,transactionId:target.id,resourcesTotal:available.length,resourceReadLimit:MAX_RESOURCES,reportRowCount:report.length,reportRowLimit:MAX_ROWS,originalIntegrity:'passed',reportSourceScope:'owned_retained_original',originalAuthenticityProved:false,relationshipProved:false};
 const guarded=<T>(read:()=>Promise<T>)=>guardedBankRead(owner,conn,lease,()=>{base.providerContacted=attempt.providerContacted=true;return read();},changed=>{base.operationalStateChanged=attempt.operationalStateChanged=changed;});
 let resourcesRead=0,resourcesAttempted=0,stage:'session'|'account_details'='session';
 const snapshotCurrent=async()=>{
  try{
   await lease.assert();
   const current=active(owner,await application(owner),await connection(owner)),workspace=await db().prepare('SELECT revision FROM workspaces WHERE owner=?').bind(owner).first<{revision:number}>();
   const currentWorkspace=trustedSelection?await readWorkspace(owner):null;
   return workspace?.revision===revision&&consentSnapshot(current.conn)===beforeConsent&&appSnapshot(current.app)===beforeApp&&(!currentWorkspace||selectionCurrent(currentWorkspace.state,currentWorkspace.revision));
  }catch{return false;}
 };
 const stale=()=>evidenceResponse({...base,checkedAt:new Date().toISOString(),status:'stale',reason:'Arbetsytan eller bankmedgivandet ändrades under läsningen. Ingen positiv kontoverifiering lämnas.',snapshotCurrent:false,accountMatch:false,complete:false,ambiguous:false,resourcesRead,rows:[]});
 try{
  if(!await snapshotCurrent())return stale();
  const live=await guarded(()=>getSession(config,remoteId));
  if(live.status!=='AUTHORIZED'||!(Date.parse(live.access.valid_until)>Date.now())||live.psu_type!=='business'||live.aspsp?.name!==conn.bank_name||live.aspsp?.country!==conn.country||resources.some(a=>!live.accounts.includes(a.uid)))return evidenceResponse({...base,status:'blocked',reason:'Bankens aktuella medgivande motsvarar inte de ägda kontoresurserna.',accountMatch:false,complete:false,ambiguous:false,resourcesRead,rows:[]});
  // Unread live accounts could share the same domestic alias. Never expand the
  // read set to newly observed UIDs or claim uniqueness from a strict subset.
  if(live.accounts.length!==available.length||new Set(live.accounts).size!==live.accounts.length||available.some(a=>!live.accounts.includes(a.uid)))return evidenceResponse({...base,status:'incomplete',reason:'Bankens aktuella kontolista skiljer sig från det sparade medgivandet. Inga ytterligare konton har hämtats.',sourcePath:'GET /sessions/{owned-session}',consentMembershipCurrent:false,accountMatch:false,complete:false,ambiguous:false,resourcesRead,rows:[]});
  if(!await snapshotCurrent())return stale();
  const refreshed:{uid:string;details:ProviderAccount}[]=[];
  for(const prior of resources){
   stage='account_details';resourcesAttempted++;
   const details=await guarded(()=>getAccountDetails(config,prior.uid));resourcesRead++;
   const priorKey=stableAccountKey(prior,bank),freshKey=stableAccountKey(details,bank);
   // A bank may omit account_id while returning a real typed alias. Exact
   // singular hash continuity may bind that alias; fuzzy hashes never may.
   const exactPrimaryHash=priorKey?.startsWith('enable-account:')&&typeof prior.identification_hash==='string'&&prior.identification_hash===details.identification_hash;
   if(!priorKey||(!exactPrimaryHash&&freshKey!==priorKey)||details.currency!==prior.currency||prior.uid===account.uid&&details.currency!=='SEK')return evidenceResponse({...base,status:'mismatch',reason:'Bankens aktuella primära konto eller valuta avviker från medgivandets sparade resurs.',accountMatch:false,complete:false,ambiguous:false,resourcesRead,rows:[]});
   refreshed.push({uid:prior.uid,details});
   if(!await snapshotCurrent()||!(Date.parse(live.access.valid_until)>Date.now()))return stale();
  }
  const resourcesComplete=resourcesRead===available.length,rows=report.slice(0,MAX_ROWS).map((row,index)=>{
   const expected=formatted(row.account),holders=refreshed.map(resource=>({uid:resource.uid,matches:aliases(resource.details).filter(id=>formatted(id.value)===expected)})).filter(resource=>resource.matches.length);
   const ambiguous=holders.length>1,own=holders.length===1&&holders[0].uid===account.uid,match=own?holders[0].matches[0]:undefined;
   return {rowIndex:index,status:ambiguous?'ambiguous':!resourcesComplete?'incomplete':own?'matched':'missing',matched:resourcesComplete&&own&&!ambiguous,ambiguous,scheme:match?.scheme||null,sourcePath:match?.sourcePath||null,sourceScope:'current_owned_ais_consent',reportSourcePath:`rows[${index}].account`};
  });
  const complete=resourcesComplete&&report.length<=MAX_ROWS,ambiguous=rows.some(row=>row.ambiguous),accountMatch=complete&&!ambiguous&&rows.every(row=>row.matched);
  return evidenceResponse({...base,checkedAt:new Date().toISOString(),status:ambiguous?'ambiguous':!complete?'incomplete':accountMatch?'matched':'missing',snapshotCurrent:true,resourcesRead,resourcesComplete,accountMatch,complete,ambiguous,rows});
 }catch(error){
  const providerCode=providerErrorCode(error);
  const advice=providerCooldownDiagnostic(error);
  if(advice){
   await lease.assert();
   const current=await connection(owner);
   if(current&&current.id===conn.id&&current.app_generation===conn.app_generation&&current.encrypted_session===conn.encrypted_session){
    const guard=mergeAccountReadCooldown(current.account_evidence_retry,advice),wait=advice.status==='known'?Date.parse(advice.notBefore):advice.status==='manual_block'?Date.parse('9999-12-31T23:59:59.999Z'):Date.now()+6*3600_000;
    const retry=current.retry_after&&!Number.isFinite(Date.parse(current.retry_after))?current.retry_after:new Date(Math.max(Date.parse(current.retry_after)||0,wait)).toISOString();
    const saved=await lease.run(db().prepare('UPDATE bank_connections SET account_evidence_retry=?,retry_after=? WHERE owner=? AND id=? AND app_generation=? AND encrypted_session=?').bind(guard,retry,owner,conn.id,conn.app_generation,conn.encrypted_session));
    base.operationalStateChanged=attempt.operationalStateChanged=saved.meta.changes===1||base.operationalStateChanged;
   }
  }
  if(providerCode!==undefined&&['INVALID_REQUEST','INVALID_CONFIGURATION','INVALID_PRIVATE_KEY'].includes(providerCode))base.providerContacted=false;
  return evidenceResponse({...base,checkedAt:new Date().toISOString(),status:'error',reason:'Bankens aktuella kontouppgifter kunde inte verifieras. Ingen kontoöversättning har gjorts.',errorCode:providerCode!==undefined&&providerErrorCodes.has(providerCode)?providerCode:'ACCOUNT_EVIDENCE_UNAVAILABLE',stage,validationIssue:providerResponseDiagnostic(error),retryAdvice:advice||providerRetryDiagnostic(error),resourcesAttempted,resourcesRead,accountMatch:false,complete:false,ambiguous:false,rows:[]});
 }
}
