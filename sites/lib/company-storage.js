import {assertCompanyContext,assertCompanyPermission,companyDataBoundary,COMPANY_ROLES} from './company-contract.js';
import {openPaymentsTokenFenceStatement} from './banking/openpayments/token-coordinator-fence.js';

// Every financial/automation table with an owner column. A migration regression
// compares this manifest with the actual SQLite schema and its write triggers.
export const ownerTables=Object.freeze(["audit_events","backup_runs","bank_applications","bank_auth_flows","bank_connections","bank_locks","bank_sync_runs","bankgiro_ingest_jobs","bankgiro_ingest_leases","bankgiro_ingest_sources","company_bank_sync_jobs","company_bank_sync_receipts","company_bank_sync_requests","company_bank_sync_scopes","customer_contacts","customer_deliveries","customer_messages","customer_reviews","document_automation","document_extractions","document_jobs","document_registrations","documents","gmail_connections","gmail_flows","gmail_locks","gmail_runs","gmail_sources","invoice_counterparties","payment_control_requests","payment_control_runs","reconciliation_findings","saas_bank_state","workspaces"]);
const statements=new WeakMap();
const applicationFenceDatabases=new WeakMap();
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:@._-]{0,199}$/.test(value)&&value!=='.'&&value!=='..';
const fail=(code,status=403)=>{throw Object.assign(Error(code),{code,status});};
const validActor=actor=>{if(!id(actor))fail('AUTH_REQUIRED',401);return actor;};
const at=()=>new Date().toISOString();
const first=(database,sql,...args)=>database.prepare(sql).bind(...args).first();
const all=async(database,sql,...args)=>(await database.prepare(sql).bind(...args).all()).results;
const companyQuery=`SELECT c.*,m.actor_id,m.role,m.status AS membership_status,m.membership_version
 FROM companies c JOIN company_memberships m ON m.company_id=c.id WHERE c.id=? AND m.actor_id=?`;
const active=row=>row&&row.status==='active'&&row.membership_status==='active'&&!!row.ownership_verified_at;
const context=(row,actor,version)=>assertCompanyContext({version:'company-context-v1',companyId:row.id,storageOwner:row.storage_owner,actorId:actor,role:row.role,membershipVersion:row.membership_version,companyVersion:row.company_version,contextVersion:version});
const selectorVersion=value=>Number.isSafeInteger(value)&&value>0;

/** Shape is never permission: the catalogue and live membership resolve it. */
export async function resolveCompanyScope(database,actorId,options={}){
 validActor(actorId);const {companyId,contextVersion,action='read'}=options;
 const selection=await first(database,'SELECT * FROM company_user_contexts WHERE actor_id=?',actorId);
 const history=await first(database,'SELECT company_id FROM company_memberships WHERE actor_id=? LIMIT 1',actorId);
 const boundOwner=await first(database,'SELECT id FROM companies WHERE storage_owner=?',actorId);
 if(!history&&!boundOwner&&!selection?.active_company_id){
  if(companyId!==undefined||contextVersion!==undefined)fail('COMPANY_FORBIDDEN');
  return Object.freeze({kind:'legacy',owner:actorId,actorId,action,context:null});
 }
 if(!id(companyId)||!selectorVersion(contextVersion))fail('COMPANY_CONTEXT_REQUIRED',409);
 const row=await first(database,companyQuery,companyId,actorId);
 if(!active(row))fail('COMPANY_FORBIDDEN');
 if(!selection||selection.active_company_id!==companyId||selection.context_version!==contextVersion)fail('COMPANY_CONTEXT_STALE',409);
 const c=context(row,actorId,contextVersion);assertCompanyPermission(c.role,action);
 return Object.freeze({kind:'company',owner:c.storageOwner,actorId,action,context:c});
}

export async function companyDirectory(database,actorId){
 validActor(actorId);
 const rows=await all(database,`SELECT c.id,c.name,c.company_version,m.role,m.membership_version FROM companies c JOIN company_memberships m ON m.company_id=c.id WHERE m.actor_id=? AND m.status='active' AND c.status='active' AND c.ownership_verified_at<>'' ORDER BY c.name,c.id`,actorId);
 const selection=await first(database,'SELECT * FROM company_user_contexts WHERE actor_id=?',actorId);
 const ever=await first(database,'SELECT company_id FROM company_memberships WHERE actor_id=? LIMIT 1',actorId);
 const bound=await first(database,'SELECT id FROM companies WHERE storage_owner=?',actorId);
 const chosen=rows.find(row=>row.id===selection?.active_company_id);
 const result={version:'company-context-v1',companies:rows.map(r=>({id:r.id,name:r.name,role:r.role,membershipVersion:r.membership_version,companyVersion:r.company_version})),activeCompanyId:chosen?.id??null,contextVersion:selection?.context_version??1};
 if(!ever&&!bound)result.legacy=true;
 else if(!rows.length)fail('COMPANY_FORBIDDEN');
 else if(!chosen){result.selectionRequired=true;result.actorId=actorId;}
 if(chosen)result.context=context(await first(database,companyQuery,chosen.id,actorId),actorId,result.contextVersion);
 return result;
}

export async function selectCompany(database,actorId,companyId,expectedVersion){
 validActor(actorId);if(!id(companyId)||!selectorVersion(expectedVersion))fail('COMPANY_CONTEXT_INVALID',400);
 const row=await first(database,companyQuery,companyId,actorId);if(!active(row))fail('COMPANY_FORBIDDEN');
 const current=await first(database,'SELECT * FROM company_user_contexts WHERE actor_id=?',actorId);
 if((current?.context_version??1)!==expectedVersion)fail('COMPANY_CONTEXT_STALE',409);
 // Two simultaneous switches cannot both claim the same context version.
 const saved=await database.batch([
  database.prepare('INSERT OR IGNORE INTO company_user_contexts(actor_id,context_version,updated_at) VALUES(?,1,?)').bind(actorId,at()),
  database.prepare(`UPDATE company_user_contexts SET active_company_id=?,context_version=context_version+1,updated_at=? WHERE actor_id=? AND context_version=? AND EXISTS(SELECT 1 FROM companies c JOIN company_memberships m ON m.company_id=c.id WHERE c.id=? AND c.status='active' AND c.company_version=? AND m.actor_id=? AND m.status='active' AND m.membership_version=?)`).bind(companyId,at(),actorId,expectedVersion,companyId,row.company_version,actorId,row.membership_version),
 ]);
 if(saved[1].meta.changes!==1)fail('COMPANY_CONTEXT_STALE',409);
 return (await resolveCompanyScope(database,actorId,{companyId,contextVersion:expectedVersion+1})).context;
}

/** Trusted provisioning only. No HTTP endpoint can adopt an existing namespace. */
export async function provisionCompany(database,input){
 const {id:companyId,name,actorId,legacyOwner,verifiedBy,verificationEvidence,verifiedLegacyOwner}=input??{};
 if(!id(companyId)||!id(actorId)||!id(verifiedBy)||typeof name!=='string'||!name.trim()||name.length>200||typeof verificationEvidence!=='string'||verificationEvidence.trim().length<10||verificationEvidence.length>2000)fail('COMPANY_PROVISIONING_INVALID',400);
 if(legacyOwner!==undefined&&(!id(legacyOwner)||verifiedLegacyOwner!==legacyOwner||actorId!==legacyOwner))fail('COMPANY_OWNERSHIP_PROOF_REQUIRED');
 const owner=legacyOwner??'company:'+crypto.randomUUID(),timestamp=at();
 if(await first(database,'SELECT id FROM companies WHERE id=? OR storage_owner=?',companyId,owner))fail('COMPANY_ALREADY_BOUND',409);
 // Originals, consent, jobs and audit history may predate the first saved
 // workspace. Check the complete retained namespace, both now and atomically
 // with admission so an in-flight legacy save cannot be hidden by creation.
 const retained=ownerTables.map(table=>`EXISTS(SELECT 1 FROM ${table} WHERE owner=?)`).join(' OR ');
 const condition=legacyOwner?`(${retained})`:`EXISTS(SELECT 1 FROM companies WHERE storage_owner=?) OR NOT (${retained})`;
 const conditionArgs=[...(legacyOwner?[]:[actorId]),...ownerTables.map(()=>legacyOwner??actorId)];
 const rejected=()=>fail(legacyOwner?'COMPANY_LEGACY_OWNER_NOT_FOUND':'COMPANY_LEGACY_BINDING_REQUIRED',legacyOwner?404:409);
 if((await first(database,'SELECT CASE WHEN '+condition+' THEN 1 ELSE 0 END AS allowed',...conditionArgs))?.allowed!==1)rejected();
 const ops=[database.prepare(`INSERT INTO company_operation_guard(slot,storage_owner,company_id,actor_id,action,authorized) SELECT 1,?,NULL,?,'manage_company',CASE WHEN ${condition} THEN 1 ELSE 0 END`).bind(owner,actorId,...conditionArgs)];
 // Verified adoption of originals-only storage supplies an absent workspace;
 // INSERT OR IGNORE preserves every existing payload/revision byte unchanged.
 const state={schemaVersion:1,company:{name:name.trim(),email:'',invoiceReferencePolicies:[]},invoices:[],transactions:[],allocations:[],credits:[],imports:[],receipts:[]};
 ops.push(database.prepare('INSERT OR IGNORE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,0,?,?)').bind(owner,JSON.stringify(state),timestamp));
 if(!legacyOwner){
  // Neutral state is written before the new binding, in the same transaction.
  // Nothing is copied from a legacy owner, company profile or reference policy.
  ops.push(database.prepare('INSERT INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,0,?)').bind(owner,'',timestamp));
 }
 ops.push(database.prepare('INSERT INTO companies(id,name,storage_owner,legacy_owner,ownership_verified_by,ownership_evidence,ownership_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(companyId,name.trim(),owner,legacyOwner??null,verifiedBy,verificationEvidence,timestamp,timestamp,timestamp));
 ops.push(database.prepare("INSERT INTO company_memberships(company_id,actor_id,role,created_at,updated_at) VALUES(?,?,'owner',?,?)").bind(companyId,actorId,timestamp,timestamp));
 ops.push(database.prepare('INSERT OR IGNORE INTO company_user_contexts(actor_id,active_company_id,context_version,updated_at) VALUES(?,?,1,?)').bind(actorId,companyId,timestamp));
 ops.push(unfence(database));
 try{await database.batch(ops);}catch(error){if(/CHECK constraint failed: authorized|company_guard_authorized/.test(String(error?.message)))rejected();throw error;}
 return {companyId,storageOwner:owner};
}

function authorization(scope){
 if(scope.kind==='legacy')return{sql:`NOT EXISTS(SELECT 1 FROM companies WHERE storage_owner=?) AND NOT EXISTS(SELECT 1 FROM company_memberships WHERE actor_id=?) AND NOT EXISTS(SELECT 1 FROM company_user_contexts WHERE actor_id=? AND active_company_id IS NOT NULL)`,args:[scope.owner,scope.actorId,scope.actorId]};
 if(scope.kind==='legacy-worker')return{sql:'NOT EXISTS(SELECT 1 FROM companies WHERE storage_owner=?) AND NOT EXISTS(SELECT 1 FROM company_worker_grants WHERE credential_sha256=?)',args:[scope.owner,scope.legacyCredential.credentialHash]};
 const c=assertCompanyContext(scope.context);
 let sql=`EXISTS(SELECT 1 FROM companies c JOIN company_memberships m ON m.company_id=c.id WHERE c.id=? AND c.storage_owner=? AND c.company_version=? AND c.status='active' AND c.ownership_verified_at<>'' AND m.actor_id=? AND m.membership_version=? AND m.role=? AND m.status='active'`;
 const args=[c.companyId,c.storageOwner,c.companyVersion,c.actorId,c.membershipVersion,c.role];
 if(scope.kind==='worker'){
  sql+=` AND EXISTS(SELECT 1 FROM company_worker_grants g WHERE g.id=? AND g.company_id=c.id AND g.actor_id=m.actor_id AND g.membership_version=m.membership_version AND g.company_version=c.company_version AND g.grant_version=? AND g.status='active' AND g.runner=? AND g.credential_sha256=?)`;
  sql+=' AND EXISTS(SELECT 1 FROM document_automation a WHERE a.owner=c.storage_owner AND a.enabled=1)';
  args.push(scope.grant.id,scope.grant.version,scope.grant.runner,scope.grant.credentialHash);
 }else{
  sql+=' AND EXISTS(SELECT 1 FROM company_user_contexts u WHERE u.actor_id=m.actor_id AND u.active_company_id=c.id AND u.context_version=?)';args.push(c.contextVersion);
 }
 return{sql:sql+')',args};
}
export async function assertScopeCurrent(database,scope,action=scope.action){
 if(scope.context)assertCompanyPermission(scope.context.role,action);
 const check=authorization(scope),row=await first(database,'SELECT CASE WHEN '+check.sql+' THEN 1 ELSE 0 END AS allowed',...check.args);
 if(row?.allowed!==1){
  if(scope.kind==='company'){
   const selection=await first(database,'SELECT active_company_id,context_version FROM company_user_contexts WHERE actor_id=?',scope.actorId);
   if(selection?.active_company_id!==scope.context.companyId||selection?.context_version!==scope.context.contextVersion)fail('COMPANY_CONTEXT_STALE',409);
  }
  fail(scope.kind==='legacy'?'COMPANY_CONTEXT_STALE':scope.kind==='worker'?'COMPANY_WORKER_FORBIDDEN':'COMPANY_FORBIDDEN',scope.kind==='legacy'?409:403);
 }
}
function fence(database,scope,action){
 const check=authorization(scope);
 return database.prepare(`INSERT INTO company_operation_guard(slot,storage_owner,company_id,actor_id,context_version,membership_version,action,authorized) SELECT 1,?,?,?,?,?,?,CASE WHEN ${check.sql} THEN 1 ELSE 0 END`).bind(scope.owner,scope.context?.companyId??null,scope.actorId,scope.context?.contextVersion??null,scope.context?.membershipVersion??null,action,...check.args);
}
const unfence=database=>database.prepare('DELETE FROM company_operation_guard WHERE slot=1');
async function authorizedBatch(database,scope,action,ops){
 await assertScopeCurrent(database,scope,action);
 try{return(await database.batch([fence(database,scope,action),...ops,unfence(database)])).slice(1,-1);}
 catch(error){if(/company_operation_guard|company_guard_authorized|CHECK constraint failed: authorized|COMPANY_BOUNDARY/.test(String(error?.message)))fail(/COMPANY_BOUNDARY/.test(String(error?.message))?'COMPANY_BOUNDARY_VIOLATION':'COMPANY_FORBIDDEN');throw error;}
}
export async function changeCompanyMembership(database,scope,{actorId,role,status}){
 if(!scope.context)fail('COMPANY_FORBIDDEN');assertCompanyPermission(scope.context.role,'manage_members');
 if(!id(actorId)||!COMPANY_ROLES.includes(role)||!['active','revoked'].includes(status))fail('COMPANY_MEMBERSHIP_INVALID',400);
 const c=scope.context,timestamp=at();
 // A company always retains an owner; revocations are tombstones, never deletes.
 const last=await first(database,"SELECT COUNT(*) AS n FROM company_memberships WHERE company_id=? AND status='active' AND role='owner'",c.companyId);
 const old=await first(database,'SELECT role,status FROM company_memberships WHERE company_id=? AND actor_id=?',c.companyId,actorId);
 if(old?.role==='owner'&&old.status==='active'&&(role!=='owner'||status!=='active')&&last.n<=1)fail('COMPANY_LAST_OWNER',409);
 await authorizedBatch(database,scope,'manage_members',[
  database.prepare(`INSERT INTO company_memberships(company_id,actor_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,actor_id) DO UPDATE SET role=excluded.role,status=excluded.status,membership_version=company_memberships.membership_version+1,updated_at=excluded.updated_at`).bind(c.companyId,actorId,role,status,timestamp,timestamp),
  ...(status==='active'?[database.prepare('INSERT OR IGNORE INTO company_user_contexts(actor_id,active_company_id,context_version,updated_at) VALUES(?,?,1,?)').bind(actorId,c.companyId,timestamp)]:[]),
 ]);
 return first(database,'SELECT company_id AS companyId,actor_id AS actorId,role,status,membership_version AS membershipVersion FROM company_memberships WHERE company_id=? AND actor_id=?',c.companyId,actorId);
}

/** Workers receive an explicit credential-bound grant; UI selection is irrelevant. */
export async function createWorkerGrant(database,scope,{runner,credentialHash}){
 if(!scope.context)fail('COMPANY_FORBIDDEN');assertCompanyPermission(scope.context.role,'manage_integrations');
 if(!['cloud','local'].includes(runner)||!/^[a-f0-9]{64}$/.test(credentialHash))fail('COMPANY_WORKER_INVALID',400);
 const c=scope.context,timestamp=at();
 await assertScopeCurrent(database,scope,'manage_integrations');
 const existing=await first(database,"SELECT * FROM company_worker_grants WHERE company_id=? AND runner=? AND status='active'",c.companyId,runner);
 if(existing?.credential_sha256===credentialHash&&existing.actor_id===c.actorId&&existing.membership_version===c.membershipVersion&&existing.company_version===c.companyVersion)return;
 // Retain revoked credential bindings. An old worker credential can never be
 // registered for another company, including after rotation or revocation.
 await authorizedBatch(database,scope,'manage_integrations',[
  database.prepare("UPDATE company_worker_grants SET status='revoked',grant_version=grant_version+1,updated_at=? WHERE company_id=? AND runner=? AND status='active'").bind(timestamp,c.companyId,runner),
  database.prepare('INSERT INTO company_worker_grants(id,company_id,actor_id,membership_version,company_version,runner,credential_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),c.companyId,c.actorId,c.membershipVersion,c.companyVersion,runner,credentialHash,timestamp,timestamp),
 ]);
}
export async function resolveWorkerCredential(database,runner,credentialHash){
 const matches=await all(database,"SELECT c.storage_owner FROM company_worker_grants g JOIN companies c ON c.id=g.company_id WHERE g.runner=? AND g.credential_sha256=? AND g.status='active' LIMIT 2",runner,credentialHash);
 if(matches.length>1)fail('COMPANY_WORKER_FORBIDDEN');
 if(!matches.length&&await first(database,'SELECT id FROM company_worker_grants WHERE credential_sha256=? LIMIT 1',credentialHash))fail('COMPANY_WORKER_FORBIDDEN');
 return matches.length?resolveWorkerScope(database,matches[0].storage_owner,runner,credentialHash):null;
}
export async function resolveWorkerScope(database,owner,runner,credentialHash){
 if(!id(owner)||!['cloud','local'].includes(runner)||!/^[a-f0-9]{64}$/.test(credentialHash))fail('COMPANY_WORKER_FORBIDDEN');
 const bound=await first(database,'SELECT id FROM companies WHERE storage_owner=?',owner);
 if(!bound){
  if(await first(database,'SELECT id FROM company_worker_grants WHERE credential_sha256=? LIMIT 1',credentialHash))fail('COMPANY_WORKER_FORBIDDEN');
  return Object.freeze({kind:'legacy-worker',owner,actorId:owner,action:'write',context:null,legacyCredential:Object.freeze({runner,credentialHash})});
 }
 const g=await first(database,`SELECT g.* FROM company_worker_grants g WHERE g.company_id=? AND g.runner=? AND g.credential_sha256=? AND g.status='active'`,bound.id,runner,credentialHash);
 if(!g)fail('COMPANY_WORKER_FORBIDDEN');const row=await first(database,companyQuery,g.company_id,g.actor_id);
 if(!active(row)||row.membership_version!==g.membership_version||row.company_version!==g.company_version)fail('COMPANY_WORKER_FORBIDDEN');
 const c=context(row,g.actor_id,1);assertCompanyPermission(c.role,'manage_integrations');
 return Object.freeze({kind:'worker',owner,actorId:g.actor_id,action:'write',context:c,grant:Object.freeze({id:g.id,version:g.grant_version,runner,credentialHash})});
}
export async function boundaryForScope(database,scope,owner){
 if(scope.owner!==owner)fail('COMPANY_BOUNDARY_MISMATCH');await assertScopeCurrent(database,scope);
 return scope.context?companyDataBoundary(scope.context):null;
}

/** Protected runtime registration, never a browser-provided mailbox. Existing
 * verified legacy namespaces may retain their original configured mailbox. */
export function resolveCompanyMailbox(configuration,{context,legacyOwner,legacyAccount,required=true}){
 const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&!/[\r\n\0]/.test(value)?value.trim().toLowerCase():null;
 const absent=()=>{if(required)fail('COMPANY_MAILBOX_UNVERIFIED',409);return null;};
 if(!context)return email(legacyAccount)??absent();
 const c=assertCompanyContext(context);let registration;
 if(configuration!==undefined&&configuration!==null&&configuration!==''){
  try{
   if(typeof configuration==='string'&&configuration.length>65536)throw Error();
   const config=typeof configuration==='string'?JSON.parse(configuration):configuration;
   if(!config||config.version!==1||!Array.isArray(config.accounts)||config.accounts.length>100||new Set(config.accounts.map(r=>r?.companyId)).size!==config.accounts.length||config.accounts.some(r=>!r||!id(r.companyId)||!id(r.storageOwner)||!email(r.email)||!id(r.verifiedBy)||typeof r.evidence!=='string'||r.evidence.trim().length<10||r.evidence.length>2000||/[\u0000-\u001f\u007f]/.test(r.evidence)))throw Error();
   registration=config.accounts.find(r=>r.companyId===c.companyId);
  }catch{return absent();}
 }
 if(registration)return registration.storageOwner===c.storageOwner?email(registration.email):absent();
 if(legacyOwner===c.storageOwner)return email(legacyAccount)??absent();
 return absent();
}

function sqlShape(query){
 if(typeof query!=='string')fail('COMPANY_SQL_DENIED');
 // Business SQL is internal and parameterized. Block escapes to raw tables or
// catalogue/guard state; quoted string contents are not SQL identifiers.
 const uncommented=query.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g,' ');
 if(/\b(?:FROM|JOIN|UPDATE|INTO)\s*'/i.test(uncommented))fail('COMPANY_SQL_DENIED');
 for(const literal of uncommented.matchAll(/'((?:''|[^'])*)'/g)){
  // A fixed uppercase JSON error is a transaction fence, not a quoted table.
  // Quoted identifiers (including parenthesized FROM spellings) remain denied.
  const fenceError=/^COMPANY_[A-Z_]+$/.test(literal[1])&&/\bjson\s*\(\s*$/i.test(uncommented.slice(0,literal.index));
  if(!fenceError&&(ownerTables.includes(literal[1].toLowerCase())||/^(?:main|temp|companies|company_[a-z_]+|sqlite_[a-z_]+)$/i.test(literal[1])))fail('COMPANY_SQL_DENIED');
 }
 const shape=uncommented.replace(/'(?:''|[^'])*'/g,"''").replace(/[`"\[\]]/g,'');
 // REPLACE implicitly deletes conflicting rows without normal DELETE triggers.
 // Only explicit INSERT/UPSERT is supported, including for legacy namespaces.
 if(!/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(shape)||/;\s*\S|\b(?:PRAGMA|ATTACH|DETACH|CREATE|DROP|ALTER|REPLACE|VACUUM|sqlite_master|sqlite_schema|companies)\b|\b(?:main|temp)\s*\./i.test(shape))fail('COMPANY_SQL_DENIED');
 const companyColumns=['company_id','company_actor_id','company_context_version','company_membership_version','company_version'];
 for(const identifier of shape.matchAll(/\bcompany_[a-z_]+\b/gi))if(!ownerTables.includes(identifier[0].toLowerCase())&&!companyColumns.includes(identifier[0].toLowerCase()))fail('COMPANY_SQL_DENIED');
 return shape;
}
function scopedStatement(database,entry,scope){
 if(entry.applicationTokenFence)return openPaymentsTokenFenceStatement(entry.applicationTokenFence,database);
 const shape=sqlShape(entry.query);
 const used=ownerTables.filter(table=>new RegExp('\\b'+table+'\\b','i').test(shape));
 let query=entry.query,args=entry.args;
 // A leading comment must not conceal an existing WITH from the CTE prefix.
 while(/^\s*(?:--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/.test(query))query=query.replace(/^\s*(?:--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/,'');
 if(used.length){
  const projection=/\browid\b/i.test(shape)?'rowid AS rowid,*':'*';
  const prefix=used.map(table=>`${table} AS (SELECT ${projection} FROM main.${table} WHERE owner=?)`).join(', ');
  query=/^\s*WITH\b/i.test(query)?query.replace(/^(\s*WITH\s+(?:RECURSIVE\s+)?)/i,'$1'+prefix+', '):'WITH '+prefix+' '+query;
  args=[...used.map(()=>scope.owner),...args];
 }
 return database.prepare(query).bind(...args);
}
const writes=query=>/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sqlShape(query));
const scopeKey=s=>JSON.stringify([s.kind,s.owner,s.actorId,s.context,s.grant,s.legacyCredential]);

/** Per-request adapter. Reads are owner-filtered even when a predicate is missed;
 * mutations run with live authorization and row ownership triggers in one batch.
 * Prepared statements retain the scope that created them across later awaits. */
export function createCompanyDatabase(database,getScope){
 let pinnedScope;const scope=async()=>{const current=await getScope();if(pinnedScope&&scopeKey(current)!==scopeKey(pinnedScope))fail('COMPANY_BOUNDARY_MISMATCH');pinnedScope??=current;return pinnedScope;};
 async function perform(entry,method,column){
  const pinned=await entry.scope();await assertScopeCurrent(database,pinned);
  const statement=scopedStatement(database,entry,pinned);
  if(writes(entry.query)){
   const [result]=await authorizedBatch(database,pinned,'write',[statement]);
   if(method==='first')return column?result.results?.[0]?.[column]??null:result.results?.[0]??null;
   if(method==='raw')return(result.results??[]).map(row=>Object.values(row));
   return result;
  }
  const result=await statement[method](...(column===undefined?[]:[column]));
  await assertScopeCurrent(database,pinned);return result;
 }
 function prepare(query,args=[]){
  sqlShape(query);const entry={query,args,scope};
  const statement={bind(...values){return prepare(query,values);},first(column){return perform(entry,'first',column);},all(){return perform(entry,'all');},run(){return perform(entry,'run');},raw(options){return perform(entry,'raw',options);}};
  statements.set(statement,entry);return statement;
 }
 const result=Object.freeze({prepare,async batch(items){
  const pinned=await scope();await assertScopeCurrent(database,pinned);
  const entries=[];
  for(const item of items){const entry=statements.get(item);if(!entry||scopeKey(await entry.scope())!==scopeKey(pinned))fail('COMPANY_BOUNDARY_MISMATCH');entries.push(entry);}
  const mutation=entries.some(e=>!e.applicationTokenFence&&writes(e.query));
  if(mutation)return authorizedBatch(database,pinned,'write',entries.map(e=>scopedStatement(database,e,pinned)));
  const result=await database.batch(entries.map(e=>scopedStatement(database,e,pinned)));await assertScopeCurrent(database,pinned);return result;
 },async exec(){fail('COMPANY_SQL_DENIED');},async dump(){fail('COMPANY_SQL_DENIED');}});
 applicationFenceDatabases.set(result,capability=>{
  // This proves raw-DB identity and private branding without executing SQL.
  // Ordinary prepare() remains unable to name either global control table.
  openPaymentsTokenFenceStatement(capability,database);
  const statement=Object.freeze({});statements.set(statement,{applicationTokenFence:capability,scope});return statement;
 });
 return result;
}

/** Server-only fixed assertion. The opaque statement is usable only by the
 * current company's authorized batch, and never exposes application rows. */
export function companyApplicationTokenFence(database,capability){
 const create=applicationFenceDatabases.get(database);if(!create)fail('COMPANY_SQL_DENIED');return create(capability);
}
