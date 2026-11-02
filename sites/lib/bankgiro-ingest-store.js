import {ingestError} from './bankgiro-source.js';
const camel=row=>row&&Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));
/** Database has D1's async prepare().bind().first/all/run and atomic batch(). */
export function createBankgiroIngestStore(database,{now=Date.now,leaseMs=120000}={}){
 // A custom clock is a trusted test seam; production guards use SQLite's execution clock.
 const clock=now===Date.now?"max(?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))":'?';
 const statement=(sql,...values)=>database.prepare(sql).bind(...values);
 const rows=async(sql,...values)=>(await statement(sql,...values).all()).results.map(camel);
 const sourceFence=(owner,id,expected)=>expected
  ?statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id IS ? AND authorization_generation IS ? AND authorization_status=?) THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",owner,id,expected.scopeId,expected.authorizationGeneration,expected.authorizationStatus)
  :statement("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=?) THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",owner,id);

 const assertAuthorization=async job=>{
  const row=await statement("SELECT owner FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id=? AND authorization_generation=? AND authorization_status='VERIFIED'",job.owner,job.sourceId,job.scopeId,job.authorizationGeneration).first();
  if(!row)throw ingestError('AUTHORIZATION_CHANGED');
 };

 return {
  async acquire(owner){
   const token=crypto.randomUUID(),until=now()+leaseMs;
   const result=await statement('INSERT INTO bankgiro_ingest_leases(owner,token,expires_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE bankgiro_ingest_leases.expires_at<=?',owner,token,until,now()).run();
   if(!result.meta?.changes)return null;
   const lease={owner,token,until,
    fence(){return statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_leases WHERE owner=? AND token=? AND expires_at>${clock}) THEN 1 ELSE json('LEASE_LOST') END AS lease_valid`,owner,token,now());},
    async assert(){const row=await statement('SELECT token FROM bankgiro_ingest_leases WHERE owner=? AND token=? AND expires_at>?',owner,token,now()).first();if(!row)throw ingestError('LEASE_LOST');},
    async write(statements){await lease.assert();return database.batch([lease.fence(),...statements,lease.fence()]);}
   };return lease;
  },
  async release(lease){await statement('DELETE FROM bankgiro_ingest_leases WHERE owner=? AND token=?',lease.owner,lease.token).run();},
  async source(owner,id){return camel(await statement('SELECT * FROM bankgiro_ingest_sources WHERE owner=? AND source_id=?',owner,id).first());},
  async snapshot(owner,id){return {source:await this.source(owner,id),jobs:await rows('SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? ORDER BY created_at DESC,id DESC LIMIT 200',owner,id),counts:await rows('SELECT status,count(*) AS count FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? GROUP BY status',owner,id),lease:camel(await statement('SELECT * FROM bankgiro_ingest_leases WHERE owner=? AND expires_at>?',owner,now()).first()),nextAttemptAt:(await statement("SELECT min(coalesce(next_attempt_at,0)) AS due FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND status IN ('PENDING','RETRY')",owner,id).first())?.due??null};},
  async recordSource(owner,id,patch,lease){
   // Queue diagnostics never replay a previously read authority row. Promotion is
   // exclusively a trusted configuration lifecycle operation, not an error handler.
   if(patch.authorizationStatus!==undefined&&patch.authorizationStatus!=='BLOCKED')throw ingestError('AUTHORIZATION_CHANGED');
   const columns={nextPollAt:'next_poll_at',attempts:'attempts',lastError:'last_error'};
   const fields=Object.entries(columns).filter(([key])=>Object.hasOwn(patch,key));
   const commands=[];
   if(patch.authorizationStatus==='BLOCKED'){
    const expected=await this.source(owner,id);commands.push(sourceFence(owner,id,expected));
   }
   commands.push(statement("INSERT OR IGNORE INTO bankgiro_ingest_sources(owner,source_id,authorization_status,updated_at) VALUES(?,?,'REVIEW',?)",owner,id,now()));
   commands.push(statement(`UPDATE bankgiro_ingest_sources SET ${fields.map(([,column])=>column+'=?').concat(patch.authorizationStatus==='BLOCKED'?["authorization_status='BLOCKED'"]:[]).concat('updated_at=?').join(',')} WHERE owner=? AND source_id=?`,...fields.map(([key])=>patch[key]??null),now(),owner,id));
   await lease.write(commands);
  },
  async discover(owner,id,authorization,page,lease){
   const previous=await this.source(owner,id);
   // An unbound REVIEW row only stores diagnostics from an earlier bootstrap
   // failure. Once bound, authorization can never be promoted by discovery.
   const bootstrap=!previous||previous.scopeId===null&&previous.authorizationGeneration===null&&previous.authorizationStatus==='REVIEW';
   if(!bootstrap&&(previous.scopeId!==authorization.scopeId||previous.authorizationGeneration!==authorization.generation||previous.authorizationStatus!=='VERIFIED'))throw ingestError('AUTHORIZATION_CHANGED');
   let gaps=JSON.parse(previous?.missingReportIds||'[]');
   if(page.missingReportIds!==undefined)gaps=[...new Set([...gaps,...page.missingReportIds])];
   gaps=gaps.filter(g=>!page.reports.some(r=>r.reportId===g));
   const commands=[sourceFence(owner,id,previous)];
   if(!previous)commands.push(statement("INSERT INTO bankgiro_ingest_sources(owner,source_id,scope_id,authorization_generation,authorization_status,updated_at) VALUES(?,?,?,?,'VERIFIED',?)",owner,id,authorization.scopeId,authorization.generation,now()));
   else if(bootstrap)commands.push(statement("UPDATE bankgiro_ingest_sources SET scope_id=?,authorization_generation=?,authorization_status='VERIFIED' WHERE owner=? AND source_id=?",authorization.scopeId,authorization.generation,owner,id));
   commands.push(this.authorizationFence({owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation}));
   commands.push(statement('UPDATE bankgiro_ingest_sources SET missing_report_ids=?,next_poll_at=NULL,attempts=0,last_error=NULL,updated_at=? WHERE owner=? AND source_id=?',JSON.stringify(gaps),now(),owner,id));
   commands.push(...page.reports.map(r=>statement('INSERT OR IGNORE INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,available_at,authorization_generation,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),owner,id,authorization.scopeId,r.reportId,r.sha256,r.filename,r.availableAt??null,authorization.generation,'PENDING',now(),now())));
   try{await lease.write(commands);}catch(error){await assertAuthorization({owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation});throw error;}
  },
  async acknowledge(owner,id,authorization,page,lease){
   const binding={owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation};
   await assertAuthorization(binding);
   const guards=[];
   for(const report of page.reports){
    const row=await statement("SELECT id FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND scope_id=? AND report_id=? AND sha256=? AND document_id IS NOT NULL AND status IN ('IMPORTED','REVIEW','DUPLICATE')",owner,id,authorization.scopeId,report.reportId,report.sha256).first();
    if(!row)return false;
    guards.push(statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_jobs WHERE id=? AND owner=? AND document_id IS NOT NULL AND status IN ('IMPORTED','REVIEW','DUPLICATE')) THEN 1 ELSE json('INCOMPLETE_PAGE') END",row.id,owner));
   }
   guards.push(this.authorizationFence({owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation}));
   // An accepted page can advance its cursor while an older queued report is
   // rate-limited. Its polling hint cannot replace a still-active source embargo.
   guards.push(statement(`UPDATE bankgiro_ingest_sources SET cursor=?,next_poll_at=CASE WHEN last_error IS NOT NULL AND next_poll_at>${clock} THEN next_poll_at ELSE ? END,updated_at=? WHERE owner=? AND source_id=?`,page.nextCursor,now(),page.nextPollAt?Date.parse(page.nextPollAt):null,now(),owner,id));
   try{await lease.write(guards);}catch(error){await assertAuthorization(binding);throw error;}return true;
  },
  authorizationFence(job){return statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id=? AND authorization_generation=? AND authorization_status='VERIFIED') THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",job.owner,job.sourceId,job.scopeId,job.authorizationGeneration);},
  async due(owner,id,limit){return rows("SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT ?",owner,id,now(),limit);},
  async conflict(job){return camel(await statement('SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND scope_id=? AND report_id=? AND sha256<>? LIMIT 1',job.owner,job.scopeId,job.reportId,job.sha256).first());},
  async duplicate(job){return camel(await statement("SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND sha256=? AND id<>? AND status IN ('IMPORTED','REVIEW','DUPLICATE') AND document_id IS NOT NULL LIMIT 1",job.owner,job.sha256,job.id).first());},
  async update(job,patch,lease){const data={...job,...patch},terminal=['IMPORTED','REVIEW','DUPLICATE'].includes(data.status);if(terminal)await assertAuthorization(job);try{await lease.write([...(['IMPORTED','REVIEW','DUPLICATE'].includes(data.status)?[this.authorizationFence(job)]:[]),statement('UPDATE bankgiro_ingest_jobs SET document_id=?,status=?,attempts=?,next_attempt_at=?,last_error=?,import_id=?,payment_count=?,updated_at=? WHERE id=? AND owner=?',data.documentId??null,data.status,data.attempts,data.nextAttemptAt??null,data.lastError??null,data.importId??null,data.paymentCount??0,now(),job.id,job.owner)]);}catch(error){if(terminal)await assertAuthorization(job);throw error;}Object.assign(job,patch);}
 };
}
