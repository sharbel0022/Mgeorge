import {env} from 'cloudflare:workers';
import {db,readWorkspace,readBankOriginalBytes} from './server';
import {applyCommand,emptyState,now,uid,specificationPreview,BankImportEvidenceError,bankImportEvidenceError,prepareBankImportFailure,type State} from './domain';
import {readBankgiroOriginal} from './bankgiro-service';
import {parseSpecificationBytes} from './bankgiro-parser.js';
import {assertPaymentOriginal,writePaymentState} from './reconciliation-evidence';
import {createBankgiroIngest} from './bankgiro-ingest.js';
import {createBankgiroIngestStore} from './bankgiro-ingest-store.js';
import {publicBankgiroStatus} from './bankgiro-source.js';
import {resolveBankgiroSource} from './bankgiro-source-registry.js';

type Lease={owner:string;token:string;until:number;assert():Promise<void>;fence():D1PreparedStatement;write(statements:D1PreparedStatement[]):Promise<unknown>};
type Report={reportId:string;filename:string;sha256:string};
type Job=Report&{registrationBinding?:string;id:string;owner:string;sourceId:string;scopeId:string;documentId:string;authorizationGeneration:string};
type Authorization={registrationBinding?:string;configurationRevision?:number;status:string;owner:string;sourceId:string;scopeId:string;generation:string;validUntil:string;evidenceId:string};
type ImportInput={owner:string;job:Job;documentId:string;authorization:Authorization;lease:Lease};
type Outcome={status:'IMPORTED'|'REVIEW'|'DUPLICATE';importId?:string;paymentCount:number};
const error=(code:string,message:string)=>Object.assign(Error(message),{code});
const originalError=()=>error('INVALID_ORIGINAL','Bankoriginalet behöver kontrolleras innan rapporten kan importeras.');
const mimeTypes:Record<string,string>={xml:'application/xml',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const mime=(filename:string)=>mimeTypes[filename.split('.').pop()?.toLowerCase()||''];
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),byte=>byte.toString(16).padStart(2,'0')).join('');
async function legacySourceFence(owner:string,database:D1Database|undefined=env.DB){
 if(!database||!await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_bank_sync_scopes'").first())return null;
 if(await database.prepare('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first())throw error('AUTHORIZATION_BLOCKED','Företagets Bankgirokälla måste använda företagets aktuella behörighet och importkontroller.');
 return database.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_bank_sync_scopes WHERE owner=?) THEN 1 ELSE json('AUTHORIZATION_BLOCKED') END").bind(owner);
}
function originalFailure(failure:unknown):never{
 // The shared reader reports these fixed validation messages. Storage/network
 // exceptions keep their retry semantics rather than becoming permanent holds.
 if(failure instanceof Error&&/^(?:Bankoriginal|Välj ett sparat bankoriginal)/.test(failure.message))throw originalError();
 throw failure;
}
async function checkedOriginal(owner:string,id:string){try{return await readBankOriginalBytes(owner,id);}catch(failure){return originalFailure(failure);}}
function validateReport<T>(operation:()=>T):T{
 try{return operation();}catch(failure){
  // Only synchronous domain validation runs here. Evidence holds retain their
  // recovery path; I/O, consent and commit failures are handled outside it.
  if(failure instanceof BankImportEvidenceError)throw failure;
  if(failure instanceof Error&&failure.constructor===Error)throw originalError();
  throw failure;
 }
}
function ownerLease(owner:string,lease:Lease){
 if(typeof owner!=='string'||!owner||owner!==lease?.owner)throw error('AUTHORIZATION_BLOCKED','Rapportkörningen tillhör inte det inloggade kontot.');
}
function checkAuthorization({owner,job,documentId,authorization,lease}:ImportInput){
 ownerLease(owner,lease);
 if(authorization.registrationBinding&&job.registrationBinding!==authorization.registrationBinding)throw error('AUTHORIZATION_CHANGED','Rapportkällans registrering har ändrats.');
 if(job.owner!==owner||job.documentId!==documentId||authorization.status!=='VERIFIED'||authorization.owner!==owner||authorization.sourceId!==job.sourceId||authorization.scopeId!==job.scopeId||authorization.generation!==job.authorizationGeneration||!authorization.evidenceId||!(Date.parse(authorization.validUntil)>Date.now()))throw error('AUTHORIZATION_CHANGED','Rapportkällans behörighet eller identitet har ändrats. Kontrollera källan igen.');
 if(!/^[a-f0-9]{64}$/.test(job.sha256))throw originalError();
}
/** Only the existing original/parser/domain pipeline may interpret report bytes.
 * The source worker never reconciles invoices or creates an allocation. */
export function createSitesBankgiroSink(){
 const database=db(),bucket=env.BUCKET;
 const ownedDocument=(owner:string,id:string)=>database.prepare('SELECT id FROM documents WHERE owner=? AND id=?').bind(owner,id).first();
 const knownDocument=(owner:string,sha256:string)=>database.prepare('SELECT id FROM documents WHERE owner=? AND sha256=? LIMIT 1').bind(owner,sha256).first<{id:string}>();
 async function cleanUnreferenced(owner:string,id:string){
  // A failed D1 response may follow a successful commit. Keep bytes unless an
  // owned read proves that this object is not referenced by any document.
  try{if(!await ownedDocument(owner,id))await bucket?.delete(`${owner}/${id}`);}catch{/* Unknown outcome: preserve the original for recovery. */}
 }
 async function retained(owner:string,id:string,sha256:string,contentType:string){
  const original=await checkedOriginal(owner,id);
  if(original.sha256!==sha256||original.mime!==contentType)throw error('HASH_MISMATCH','Originalfilens identitet stämmer inte med rapportleveransen.');
  return{documentId:id};
 }
 async function retain({owner,report,bytes,sha256,lease}:{owner:string;report:Report;bytes:Uint8Array;sha256:string;lease:Lease}){
  ownerLease(owner,lease);await lease.assert();
  const companyFence=await legacySourceFence(owner,database);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>15000000||typeof report.filename!=='string'||report.filename.length>200||/[\u0000-\u001f]/.test(report.filename)||!mime(report.filename))throw originalError();
  if(!/^[a-f0-9]{64}$/.test(sha256)||report.sha256!==sha256||await hash(bytes)!==sha256)throw error('HASH_MISMATCH','Rapportens kontrollsumma stämmer inte med originalfilen.');
  const contentType=mime(report.filename),known=await knownDocument(owner,sha256);
  if(known){const result=await retained(owner,known.id,sha256,contentType);await lease.assert();return result;}
  if(!bucket)throw Error('R2_UNAVAILABLE');
  const id=uid();await lease.assert();
  await bucket.put(`${owner}/${id}`,Uint8Array.from(bytes),{httpMetadata:{contentType}});
  try{
   await lease.assert();
   await lease.write([...(companyFence?[companyFence]:[]),database.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM documents WHERE owner=? AND sha256=?)').bind(id,owner,report.filename,contentType,bytes.byteLength,sha256,now(),owner,sha256)]);
  }catch(failure){await cleanUnreferenced(owner,id);throw failure;}
  // No cleanup on an uncertain outcome read: this upload may be the winner.
  const saved=await knownDocument(owner,sha256);if(!saved)throw Error('D1_ERROR: report original outcome unavailable');
  if(saved.id!==id)await cleanUnreferenced(owner,id);
  const result=await retained(owner,saved.id,sha256,contentType);await lease.assert();return result;
 }
 function jobStatement(input:ImportInput){
  const {owner,job,documentId}=input;
  return database.prepare("SELECT id FROM bankgiro_ingest_jobs WHERE id=? AND owner=? AND source_id=? AND scope_id=? AND report_id=? AND sha256=? AND filename=? AND document_id=? AND authorization_generation=? AND registration_binding=? AND status IN ('PENDING','RETRY')").bind(job.id,owner,job.sourceId,job.scopeId,job.reportId,job.sha256,job.filename,documentId,job.authorizationGeneration,job.registrationBinding??'');
 }
 async function assertCurrentAuthorization(input:ImportInput){
  const {owner,job,authorization}=input;
  const current=await database.prepare("SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id=? AND authorization_generation=? AND authorization_status='VERIFIED'").bind(owner,job.sourceId,job.scopeId,authorization.generation).first();
  if(!current)throw error('AUTHORIZATION_CHANGED','Rapportkällans aktuella behörighet har ändrats. Kontrollera källan igen.');
 }
 function sourceEvidence(input:ImportInput){const {job,authorization}=input;return{jobId:job.id,sourceId:job.sourceId,scopeId:job.scopeId,reportId:job.reportId,authorizationGeneration:authorization.generation,authorizationEvidenceId:authorization.evidenceId};}
 async function commit(input:ImportInput,original:Awaited<ReturnType<typeof readBankOriginalBytes>>,old:Awaited<ReturnType<typeof readWorkspace>>,state:State,payload:string,action:string,detail:Record<string,unknown>,auditId=uid()){
  checkAuthorization(input);await input.lease.assert();
  const {owner,job,documentId,authorization,lease}=input,at=now();
  const companyFence=await legacySourceFence(owner,database);
  const originalFence=database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM documents WHERE owner=? AND id=? AND sha256=? AND filename=? AND mime=? AND size=?) AND EXISTS(SELECT 1 FROM bankgiro_ingest_jobs WHERE id=? AND owner=? AND source_id=? AND scope_id=? AND report_id=? AND sha256=? AND filename=? AND document_id=? AND authorization_generation=? AND registration_binding=? AND status IN ('PENDING','RETRY')) AND EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id=? AND authorization_generation=? AND authorization_status='VERIFIED') AND julianday(?)>julianday('now') THEN 1 ELSE json('BANKGIRO_ORIGINAL_CHANGED') END").bind(owner,documentId,job.sha256,original.filename,original.mime,original.size,job.id,owner,job.sourceId,job.scopeId,job.reportId,job.sha256,job.filename,documentId,job.authorizationGeneration,job.registrationBinding??'',owner,job.sourceId,job.scopeId,authorization.generation,authorization.validUntil);
  const statements=[...(companyFence?[companyFence]:[]),lease.fence(),originalFence,
   database.prepare('INSERT OR IGNORE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,0,?,?)').bind(owner,JSON.stringify(emptyState()),at),
   database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(auditId,owner,old.revision+1,action,JSON.stringify(detail),at,owner,old.revision),
   database.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(payload,at,owner,old.revision),lease.fence()
  ];
  const saved=await writePaymentState(owner,old.revision,old.state,state,database,statements);
  if(saved[(companyFence?1:0)+4].meta.changes!==1)throw error('WORKSPACE_CHANGED','Registret ändrades under importen. Rapporten finns kvar och kan bearbetas igen.');
 }
 async function importReport(input:ImportInput):Promise<Outcome>{
  checkAuthorization(input);const {owner,job,documentId,lease}=input;await lease.assert();
  await legacySourceFence(owner,database);
  if(!await jobStatement(input).first())throw error('IDENTITY_CONFLICT','Rapportjobbet stämmer inte med den sparade leveransidentiteten.');
  const original=await checkedOriginal(owner,documentId);
  if(original.sha256!==job.sha256||original.mime!==mime(job.filename))throw error('HASH_MISMATCH','Det sparade originalet motsvarar inte rapportleveransen.');
  let command:Awaited<ReturnType<typeof readBankgiroOriginal>>;
  try{command=await readBankgiroOriginal(owner,{type:'bankgiro.import',documentId});}
  catch(failure){
   // Classify malformed bytes with the same parser, only on the error path.
   // A transient second R2 read must not permanently block a valid report.
   try{parseSpecificationBytes(original.bytes,original.filename);}catch{throw originalError();}
   return originalFailure(failure);
  }
  if(command.hash!==job.sha256||command.name!==original.filename)throw error('HASH_MISMATCH','Originalets identitet ändrades under kontrollen.');
  await lease.assert();checkAuthorization(input);
  const old=await readWorkspace(owner),previous=old.state.imports.filter(record=>record.hash===job.sha256||record.documentId===documentId),paymentCount=command.rows.filter((row:{kind:string})=>row.kind!=='batch').length;
  await assertCurrentAuthorization(input);
  if(previous.length){
   if(previous.some(record=>record.hash!==job.sha256||!record.documentId))throw error('IDENTITY_CONFLICT','Originalet har en motstridig tidigare importidentitet.');
   // Intake completion and later evidence review are separate operations.
   // This receipt also recovers a commit whose response the worker never saw.
   return{status:'DUPLICATE',importId:previous[0].id,paymentCount};
  }
  const preview=validateReport(()=>specificationPreview(old.state,command.rows));let current=old.state;
  for(const id of new Set(preview.plans.flatMap(plan=>plan.parentId?[plan.parentId]:[])))current=await assertPaymentOriginal(owner,current,id);
  const auditCommand={type:command.type,documentId,hash:command.hash,name:command.name};
  let result:ReturnType<typeof applyCommand>,payload:string;
  try{
   result=validateReport(()=>applyCommand(current,command));payload=JSON.stringify(result.state);
   if(JSON.stringify(result.state.allocations)!==JSON.stringify(old.state.allocations))throw error('INVALID_SINK_RESULT','Rapportimporten får inte ändra fakturornas betalningskopplingar.');
   if(new TextEncoder().encode(payload).length>1800000)throw bankImportEvidenceError(old.state,result.state,'Rapportimporten överskrider registrets storleksgräns.')||originalError();
  }catch(failure){
   if(!(failure instanceof BankImportEvidenceError))throw failure;
   const eventId=uid(),prepared=await prepareBankImportFailure(old.state,failure.state,eventId);
   if(!prepared.replayed)await commit(input,original,old,prepared.state,prepared.payload,'bank.import_rejected',{message:'Rapportimporten avvisades. Motstridiga original behöver granskas.',command:auditCommand,source:sourceEvidence(input),retained_conflicts:prepared.conflicts,compact_hold:prepared.compact,allocationsCreated:0},eventId);
   throw error('INVALID_ORIGINAL','Rapportimporten avvisades. Originalet och konfliktunderlaget är bevarade för granskning.');
  }
  await commit(input,original,old,result.state,payload,'bankgiro.import',{message:result.message,command:auditCommand,source:sourceEvidence(input),allocationsCreated:0});
  const record=result.state.imports.find(record=>!old.state.imports.some(previous=>previous.id===record.id));
  return{status:preview.review||paymentCount===0?'REVIEW':record?.count===0?'DUPLICATE':'IMPORTED',importId:record?.id,paymentCount};
 }
 return{retain,importReport};
}

async function sourceWorker(owner:string){
 const source=await resolveBankgiroSource(owner,{configuration:(env as unknown as Record<string,unknown>).BANKGIRO_SOURCE_CONFIG,secrets:env as unknown as Record<string,unknown>}) as {id:string;mode:string;[key:string]:any}|null;
 // An absent or synthetic source must not require D1/R2 or create a lease.
 if(!source||source.mode==='synthetic')return createBankgiroIngest({source,store:null,sink:null});
 try{await legacySourceFence(owner);}catch(failure){
  if((failure as {code?:string})?.code!=='AUTHORIZATION_BLOCKED')throw failure;
  // Status and an attempted legacy run both report the existing sanitized
  // blocked projection. They cannot acquire a lease, call transport or mutate
  // intake state. The sink still rejects any direct company-bound writes.
  return createBankgiroIngest({source:{id:source.id,mode:source.mode,configurationValid:false},store:null,sink:null});
 }
 const guarded={...source};
 for(const method of ['authorize','listReports','fetchReport'])if(typeof source[method]==='function')guarded[method]=async(...args:unknown[])=>{await legacySourceFence(owner);return source[method](...args);};
 return createBankgiroIngest({source:guarded,store:createBankgiroIngestStore(db()),sink:createSitesBankgiroSink()});
}
export async function bankgiroSourceStatus(owner:string){return publicBankgiroStatus(await(await sourceWorker(owner)).status(owner));}
export async function runBankgiroSource(owner:string){return publicBankgiroStatus(await(await sourceWorker(owner)).run(owner));}
