/** Original-preserving adapter for the shared source queue. No reconciliation is run here. */
import {randomUUID} from 'node:crypto';
import {digest} from './security.js';
import {parseBankFile} from './importers.js';
import {recordImport,storeTransactions} from './db.js';

const mimeFor=name=>/\.xlsx$/i.test(name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.xml$/i.test(name)?'application/xml':'text/csv';
const blocked=(code='INVALID_ORIGINAL')=>Object.assign(new Error('Bankgiro-originalet eller behörigheten måste kontrolleras.'),{code,status:409});
const parseOriginal=(name,encoded,account)=>{try{return parseBankFile(name,encoded,account);}catch{throw blocked('INVALID_ORIGINAL');}};

/** D1's batch is atomic; keep that property when using synchronous SQLite. */
export function nodeIngestDatabase(db){
 const prepare=(sql,params=[])=>({
  bind(...values){return prepare(sql,values);},
  async first(){return db.prepare(sql).get(...params)||null;},
  async all(){return {results:db.prepare(sql).all(...params)};},
  async run(){return this.execute();},
  execute(){const result=db.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}};}
 });
 return {prepare,async exec(sql){db.exec(sql);},async batch(statements){
  db.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}
 }};
}

export function createNodeBankgiroSink(db,{now=Date.now}={}){
 function guard(owner,lease,authorization){
  if(!owner||lease?.owner!==owner)throw blocked('AUTHORIZATION_BLOCKED');
  const lock=db.prepare('SELECT token,expires_at FROM bankgiro_ingest_leases WHERE owner=?').get(owner);
  if(!lock||lock.token!==lease.token||lock.expires_at<=now()||lease.until<=now())throw blocked('LEASE_LOST');
  if(authorization&&(authorization.owner!==owner||authorization.status!=='VERIFIED'||Date.parse(authorization.validUntil)<=now()||!Number.isFinite(Date.parse(authorization.validUntil))))throw blocked('AUTHORIZATION_BLOCKED');
 }
 function write(owner,lease,operation,authorization,assertOriginal=()=>{}){
  db.exec('BEGIN IMMEDIATE');try{guard(owner,lease,authorization);assertOriginal();const result=operation();guard(owner,lease,authorization);assertOriginal();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {
  async retain({owner,report,bytes,sha256,lease}){
   if(digest(bytes)!==sha256||report.sha256!==sha256)throw blocked('HASH_MISMATCH');
   return write(owner,lease,()=>{
    const old=db.prepare("SELECT id,metadata,content FROM documents WHERE fingerprint=? AND source='bankgiro_source'").all(sha256).find(row=>JSON.parse(row.metadata).owner===owner);
    if(old){if(digest(old.content)!==sha256)throw blocked('HASH_MISMATCH');return {documentId:old.id};}
    const id=randomUUID();
    db.prepare('INSERT INTO documents(id,name,mime_type,content,fingerprint,source,metadata,status) VALUES(?,?,?,?,?,?,?,?)').run(id,report.filename,mimeFor(report.filename),Buffer.from(bytes),sha256,'bankgiro_source',JSON.stringify({owner,reportId:report.reportId,sha256}),'bank_report');
    return {documentId:id};
   });
  },
  async importReport({owner,job,documentId,authorization,lease}){
   const assertOriginal=()=>{
   guard(owner,lease,authorization);
   if(job.owner!==owner||job.documentId!==documentId||authorization.sourceId!==job.sourceId||authorization.scopeId!==job.scopeId||authorization.generation!==job.authorizationGeneration||!authorization.evidenceId)throw blocked('AUTHORIZATION_CHANGED');
   if(!db.prepare("SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id=? AND authorization_generation=? AND authorization_status='VERIFIED'").get(owner,job.sourceId,job.scopeId,job.authorizationGeneration))throw blocked('AUTHORIZATION_CHANGED');
   const persisted=db.prepare("SELECT id FROM bankgiro_ingest_jobs WHERE id=? AND owner=? AND source_id=? AND scope_id=? AND report_id=? AND sha256=? AND filename=? AND document_id=? AND authorization_generation=? AND status IN ('PENDING','RETRY')").get(job.id,owner,job.sourceId,job.scopeId,job.reportId,job.sha256,job.filename,documentId,job.authorizationGeneration);
   if(!persisted)throw blocked('IDENTITY_CONFLICT');
   const document=db.prepare("SELECT * FROM documents WHERE id=? AND source='bankgiro_source'").get(documentId);
   // Delivery names can change on replay. The owned bytes identify the original;
   // keep each queue filename but parse the canonical retained name and format.
   if(!document||JSON.parse(document.metadata).owner!==owner||mimeFor(document.name)!==mimeFor(job.filename)||document.mime_type!==mimeFor(document.name))throw blocked('IDENTITY_CONFLICT');
   if(document.fingerprint!==job.sha256||digest(document.content)!==job.sha256)throw blocked('HASH_MISMATCH');
   return document;
   };
   const document=assertOriginal();
   // Manual imports belong to this standalone application's single administrator.
   // Never adopt an explicitly owned import from a different administrator.
   const prior=db.prepare("SELECT * FROM import_jobs WHERE source='bank_file' AND content_sha256=? AND (owner=? OR owner='') ORDER BY rowid LIMIT 1").get(job.sha256,owner);
   if(prior){
    if(!prior.content||digest(prior.content)!==job.sha256||!['completed','needs_review'].includes(prior.status))throw blocked();
    return write(owner,lease,()=>{db.prepare("UPDATE import_jobs SET owner=? WHERE id=? AND owner=''").run(owner,prior.id);return {status:prior.status==='needs_review'||db.prepare('SELECT 1 FROM bank_transactions WHERE import_id=? AND is_aggregate=1').get(prior.id)?'REVIEW':'DUPLICATE',importId:prior.id,paymentCount:db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE import_id=? AND is_aggregate=0').get(prior.id).n};},authorization,assertOriginal);
   }
   const encoded=Buffer.from(document.content).toString('base64');
   let rows=parseOriginal(document.name,encoded,'');
   const accounts=new Set(rows.map(row=>row.account_evidence?.reported_account).filter(Boolean));
   const account=accounts.size===1?[...accounts][0]:'';
   // Only an actual complete IBAN in every original row can identify an automatic account.
   const review=rows.some(row=>row.review_only||!row.account_evidence?.explicit_currency)||!rows.length||!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(account)||rows.some(row=>row.account_evidence?.reported_account!==account);
   if(review)return write(owner,lease,()=>{
    const importId=recordImport(db,{source:'bank_file',name:document.name,found:rows.length,review:rows.length,status:'needs_review',content:document.content,mime_type:document.mime_type,error:rows[0]?.review_reason||'Originalets mottagarkonto eller valuta kräver granskning.'});
    db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run(owner,importId);
    return {status:'REVIEW',importId,paymentCount:0};
   },authorization,assertOriginal);
   rows=parseOriginal(document.name,encoded,account);
   let result;try{result=storeTransactions(db,rows,'file:'+document.name,{content:document.content,mime_type:document.mime_type,owner},assertOriginal);}catch(error){if(['conflicting_bank_record','conflicting_payment_specification','allocated_aggregate','bank_review_only'].includes(error.code))throw blocked('INVALID_ORIGINAL');throw error;}
   return {status:rows.some(row=>row.is_aggregate)?'REVIEW':result.imported?'IMPORTED':'DUPLICATE',importId:result.import_id,paymentCount:db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE import_id=? AND is_aggregate=0').get(result.import_id).n};
  }
 };
}

export async function createNodeBankgiroIngest(db,{source=null,now=Date.now,allowSynthetic=false}={}){
 const [{createBankgiroIngest},{createBankgiroIngestStore}]=await Promise.all([import('../sites/lib/bankgiro-ingest.js'),import('../sites/lib/bankgiro-ingest-store.js')]);
 const store=createBankgiroIngestStore(nodeIngestDatabase(db),{now});
 return createBankgiroIngest({source,store,sink:createNodeBankgiroSink(db,{now}),now,allowSynthetic});
}
