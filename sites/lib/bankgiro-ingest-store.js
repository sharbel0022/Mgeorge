import {ingestError} from './bankgiro-source.js';
export const registrationBinding=r=>JSON.stringify([r.id,r.owner,r.companyId,r.bankgiro,r.scopeId,r.generation,r.profileId,r.allowedFormats??null,r.entitlement??null,r.transportBinding??null]);
// Authority tombstones are bounded and never pruned. Exhaustion fails closed.
const retiredGenerations=(row,retire=false)=>{
 let list;try{list=JSON.parse(row?.revokedGenerations??'[]');}catch{throw ingestError('AUTHORIZATION_CHANGED');}
 const valid=value=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\u0000-\u001f]/.test(value);
 if(!Array.isArray(list)||list.length>64||!list.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(valid))||new Set(list.map(pair=>JSON.stringify(pair))).size!==list.length)throw ingestError('AUTHORIZATION_CHANGED');
 if(retire&&row?.scopeId&&row?.authorizationGeneration&&!list.some(([scope,generation])=>scope===row.scopeId&&generation===row.authorizationGeneration))list.push([row.scopeId,row.authorizationGeneration]);
 if(list.length>64||JSON.stringify(list).length>65536)throw ingestError('AUTHORIZATION_CHANGED');
 return list;
};
/** Pure owner-scoped authority admission; never contacts a source or writes. */
export function bankgiroRegistrationPlan(owner,source,sources){
 const r=source?.registration;
 if(source?.configurationValid!==true||!r||r.owner!==owner||r.id!==source.id||!Number.isSafeInteger(r.configurationRevision)||r.configurationRevision<1||r.enabled!==true||!Array.isArray(sources)||sources.some(row=>row.owner!==owner))throw ingestError('AUTHORIZATION_BLOCKED');
   const revision=r.configurationRevision,binding=registrationBinding(r),previous=sources.find(row=>row.sourceId===source.id),latest=Math.max(0,...sources.map(row=>row.registrationRevision));
   const retired=retiredGenerations(previous,Number(previous?.registrationRevision)>0&&previous.registrationBinding!==binding);
   const otherRetirements=sources.filter(row=>row.sourceId!==source.id).map(row=>({row,retired:retiredGenerations(row,true)}));
   // A source alias cannot reuse any owner-scoped retirement, including one
   // this registration would create while replacing another active source.
   if([retired,...otherRetirements.map(entry=>entry.retired)].some(history=>history.some(([scope,generation])=>scope===r.scopeId&&generation===r.generation)))throw ingestError('AUTHORIZATION_CHANGED');
   // Reserve the current generation's future retirement before admitting it.
   retiredGenerations({scopeId:r.scopeId,authorizationGeneration:r.generation,revokedGenerations:JSON.stringify(retired)},true);
   if(revision<latest||revision===latest&&(!previous||previous.registrationBinding!==binding||previous.authorizationStatus==='BLOCKED'))throw ingestError('AUTHORIZATION_CHANGED');
 return {revision,binding,previous,latest,retired,otherRetirements};
}
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
  /** Trusted server lifecycle only. Revision is an owner-wide monotonic fence. */
  async register(owner,source,lease){
   const r=source.registration;
   if(source.configurationValid!==true||!r||r.owner!==owner||r.id!==source.id||!Number.isSafeInteger(r.configurationRevision)||r.configurationRevision<1||r.enabled!==true)throw ingestError('AUTHORIZATION_BLOCKED');
   // One SQL snapshot supplies both the retirement history and its revision CAS.
   const sources=await rows('SELECT * FROM bankgiro_ingest_sources WHERE owner=?',owner);
   const {revision,binding,previous,latest,retired,otherRetirements}=bankgiroRegistrationPlan(owner,source,sources);
   const retireOthers=otherRetirements.map(({row,retired:history})=>statement("UPDATE bankgiro_ingest_sources SET authorization_status='BLOCKED',registration_revision=?,revoked_generations=?,updated_at=? WHERE owner=? AND source_id=?",revision,JSON.stringify(history),now(),owner,row.sourceId));
   if(revision===latest){this.fenceRegistration(lease,source);return;}
   await lease.write([
    statement("SELECT CASE WHEN coalesce((SELECT max(registration_revision) FROM bankgiro_ingest_sources WHERE owner=?),0)=? THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",owner,latest),
    ...retireOthers,
    statement("UPDATE bankgiro_ingest_jobs SET status='BLOCKED',last_error='AUTHORIZATION_CHANGED',next_attempt_at=NULL,updated_at=? WHERE owner=? AND status IN ('PENDING','RETRY') AND (source_id<>? OR registration_binding<>?)",now(),owner,source.id,binding),
    statement("INSERT INTO bankgiro_ingest_sources(owner,source_id,scope_id,authorization_generation,authorization_status,registration_revision,registration_binding,revoked_generations,updated_at) VALUES(?,?,?,?,'REVIEW',?,?,?,?) ON CONFLICT(owner,source_id) DO UPDATE SET scope_id=excluded.scope_id,authorization_generation=excluded.authorization_generation,authorization_status=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding THEN bankgiro_ingest_sources.authorization_status ELSE 'REVIEW' END,registration_revision=excluded.registration_revision,revoked_generations=excluded.revoked_generations,cursor=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding THEN bankgiro_ingest_sources.cursor ELSE NULL END,missing_report_ids=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding THEN bankgiro_ingest_sources.missing_report_ids ELSE '[]' END,next_poll_at=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding OR bankgiro_ingest_sources.last_error='RATE_LIMITED' THEN bankgiro_ingest_sources.next_poll_at ELSE NULL END,attempts=0,last_error=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding OR bankgiro_ingest_sources.last_error='RATE_LIMITED' THEN bankgiro_ingest_sources.last_error ELSE NULL END,authorization_verified_at=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding THEN bankgiro_ingest_sources.authorization_verified_at ELSE NULL END,authorization_valid_until=CASE WHEN bankgiro_ingest_sources.registration_binding=excluded.registration_binding THEN bankgiro_ingest_sources.authorization_valid_until ELSE NULL END,registration_binding=excluded.registration_binding,updated_at=excluded.updated_at",owner,source.id,r.scopeId,r.generation,revision,binding,JSON.stringify(retired),now())
   ]);
   this.fenceRegistration(lease,source);
  },
  fenceRegistration(lease,source){
   const r=source.registration,binding=registrationBinding(r);
   lease.fence=()=>statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_leases WHERE owner=? AND token=? AND expires_at>${clock}) AND EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND registration_revision=? AND registration_binding=?) THEN 1 ELSE json('AUTHORIZATION_CHANGED') END`,lease.owner,lease.token,now(),lease.owner,source.id,r.configurationRevision,binding);
   lease.registrationFence=lease.fence;
  },
  async revokeOwner(owner,revision){
   if(!Number.isSafeInteger(revision)||revision<1)throw ingestError('AUTHORIZATION_CHANGED');
   const sources=await rows('SELECT * FROM bankgiro_ingest_sources WHERE owner=?',owner);
   const latest=Math.max(0,...sources.map(row=>row.registrationRevision));
   if(latest>revision)throw ingestError('AUTHORIZATION_CHANGED');
   if(latest===revision&&sources.every(row=>row.authorizationStatus==='BLOCKED'))return;
   if(revision<=latest)throw ingestError('AUTHORIZATION_CHANGED');
   try{await database.batch([
    statement("SELECT CASE WHEN coalesce((SELECT max(registration_revision) FROM bankgiro_ingest_sources WHERE owner=?),0)=? THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",owner,latest),
    ...sources.map(row=>statement("UPDATE bankgiro_ingest_sources SET authorization_status='BLOCKED',registration_revision=?,revoked_generations=?,updated_at=? WHERE owner=? AND source_id=?",revision,JSON.stringify(retiredGenerations(row,true)),now(),owner,row.sourceId)),
    statement("UPDATE bankgiro_ingest_jobs SET status='BLOCKED',last_error='AUTHORIZATION_CHANGED',next_attempt_at=NULL,updated_at=? WHERE owner=? AND status IN ('PENDING','RETRY')",now(),owner),
    statement("INSERT OR IGNORE INTO bankgiro_ingest_sources(owner,source_id,authorization_status,registration_revision,updated_at) VALUES(?,'bankgiro-registration-revoked','BLOCKED',?,?)",owner,revision,now())
   ]);}catch{throw ingestError('AUTHORIZATION_CHANGED');}
  },
  async revokeRegistration(owner,id,revision){
   if(!Number.isSafeInteger(revision)||revision<1)throw ingestError('AUTHORIZATION_CHANGED');
   const sources=await rows('SELECT * FROM bankgiro_ingest_sources WHERE owner=?',owner);
   const latest=Math.max(0,...sources.map(row=>row.registrationRevision));
   if(revision<=latest)throw ingestError('AUTHORIZATION_CHANGED');
   const retired=retiredGenerations(sources.find(row=>row.sourceId===id),true);
   try{await database.batch([
    statement("SELECT CASE WHEN coalesce((SELECT max(registration_revision) FROM bankgiro_ingest_sources WHERE owner=?),0)=? THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",owner,latest),
    statement("INSERT INTO bankgiro_ingest_sources(owner,source_id,authorization_status,registration_revision,revoked_generations,updated_at) VALUES(?,?,'BLOCKED',?,?,?) ON CONFLICT(owner,source_id) DO UPDATE SET authorization_status='BLOCKED',registration_revision=excluded.registration_revision,revoked_generations=excluded.revoked_generations,updated_at=excluded.updated_at",owner,id,revision,JSON.stringify(retired),now())
   ]);}catch{throw ingestError('AUTHORIZATION_CHANGED');}
  },
  async bindAuthorization(lease,source,authorization){
   const r=source.registration,binding=registrationBinding(r),until=Date.parse(authorization.validUntil),verified=Date.parse(authorization.checkedAt);
   if(!Number.isFinite(until)||until<=now()||!Number.isFinite(verified)||verified>now()||now()-verified>300000)throw ingestError('AUTHORIZATION_BLOCKED');
   const authorityFence=()=>statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND registration_revision=? AND registration_binding=? AND authorization_status IN ('REVIEW','VERIFIED')) AND ?>${clock} THEN 1 ELSE json('AUTHORIZATION_CHANGED') END`,lease.owner,source.id,r.configurationRevision,binding,until,now());
   // Refreshes may extend the receipt, never alter the immutable authority binding.
   await lease.write([authorityFence(),statement("UPDATE bankgiro_ingest_sources SET authorization_status='VERIFIED',authorization_verified_at=?,authorization_valid_until=?,updated_at=? WHERE owner=? AND source_id=?",verified,until,now(),lease.owner,source.id)]);
   lease.fence=()=>statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_leases WHERE owner=? AND token=? AND expires_at>${clock}) AND EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND registration_revision=? AND registration_binding=? AND authorization_status='VERIFIED' AND authorization_valid_until>${clock}) AND ?>${clock} THEN 1 ELSE json('AUTHORIZATION_CHANGED') END`,lease.owner,lease.token,now(),lease.owner,source.id,r.configurationRevision,binding,now(),until,now());
   authorization.registrationBinding=binding;authorization.configurationRevision=r.configurationRevision;
  },
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
  async snapshot(owner,id,binding){return {authorities:binding?await rows('SELECT * FROM bankgiro_ingest_sources WHERE owner=?',owner):null,currentCounts:binding?await rows('SELECT status,count(*) AS count FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND registration_binding=? GROUP BY status',owner,id,binding):null,source:await this.source(owner,id),jobs:await rows('SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? ORDER BY created_at DESC,id DESC LIMIT 200',owner,id),counts:await rows('SELECT status,count(*) AS count FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? GROUP BY status',owner,id),lease:camel(await statement('SELECT * FROM bankgiro_ingest_leases WHERE owner=? AND expires_at>?',owner,now()).first()),nextAttemptAt:(await statement("SELECT min(coalesce(next_attempt_at,0)) AS due FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND status IN ('PENDING','RETRY')",owner,id).first())?.due??null};},
  async recordSource(owner,id,patch,lease){
   // Queue diagnostics never replay a previously read authority row. Promotion is
   // exclusively a trusted configuration lifecycle operation, not an error handler.
   if(patch.authorizationStatus!==undefined&&patch.authorizationStatus!=='BLOCKED')throw ingestError('AUTHORIZATION_CHANGED');
   const columns={nextPollAt:'next_poll_at',attempts:'attempts',lastError:'last_error',lastFailureAt:'last_failure_at',lastFailureCode:'last_failure_code'};
   const fields=Object.entries(columns).filter(([key])=>Object.hasOwn(patch,key));
   const commands=[];
   if(patch.authorizationStatus==='BLOCKED'){
    const expected=await this.source(owner,id);commands.push(sourceFence(owner,id,expected));
   }
   commands.push(statement("INSERT OR IGNORE INTO bankgiro_ingest_sources(owner,source_id,authorization_status,updated_at) VALUES(?,?,'REVIEW',?)",owner,id,now()));
   commands.push(statement(`UPDATE bankgiro_ingest_sources SET ${fields.map(([,column])=>column+'=?').concat(patch.authorizationStatus==='BLOCKED'?["authorization_status='BLOCKED'"]:[]).concat('updated_at=?').join(',')} WHERE owner=? AND source_id=?`,...fields.map(([key])=>patch[key]??null),now(),owner,id));
   if(lease.registrationFence){await lease.assert();await database.batch([lease.registrationFence(),...commands,lease.registrationFence()]);}else await lease.write(commands);
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
   commands.push(statement('UPDATE bankgiro_ingest_sources SET missing_report_ids=?,next_poll_at=?,attempts=0,last_error=NULL,updated_at=? WHERE owner=? AND source_id=?',JSON.stringify(gaps),page.discoveryNextPollAt??null,now(),owner,id));
   commands.push(...page.reports.map(r=>statement('INSERT OR IGNORE INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,available_at,authorization_generation,registration_binding,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),owner,id,authorization.scopeId,r.reportId,r.sha256,r.filename,r.availableAt??null,authorization.generation,authorization.registrationBinding??'','PENDING',now(),now())));
   try{await lease.write(commands);}catch(error){await assertAuthorization({owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation});throw error;}
  },
  async acknowledge(owner,id,authorization,page,lease){
   const binding={owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation};
   await assertAuthorization(binding);
   const guards=[];
   for(const report of page.reports){
    const row=await statement("SELECT id FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND scope_id=? AND report_id=? AND sha256=? AND authorization_generation=? AND registration_binding=? AND document_id IS NOT NULL AND status IN ('IMPORTED','REVIEW','DUPLICATE')",owner,id,authorization.scopeId,report.reportId,report.sha256,authorization.generation,authorization.registrationBinding??'').first();
    if(!row)return false;
    guards.push(statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_jobs WHERE id=? AND owner=? AND document_id IS NOT NULL AND status IN ('IMPORTED','REVIEW','DUPLICATE')) THEN 1 ELSE json('INCOMPLETE_PAGE') END",row.id,owner));
   }
   guards.push(this.authorizationFence({owner,sourceId:id,scopeId:authorization.scopeId,authorizationGeneration:authorization.generation}));
   // An accepted page can advance its cursor while an older queued report is
   // rate-limited. Its polling hint cannot replace a still-active source embargo.
   guards.push(statement(`UPDATE bankgiro_ingest_sources SET cursor=?,last_success_at=?,next_poll_at=CASE WHEN last_error IS NOT NULL AND next_poll_at>${clock} THEN next_poll_at ELSE ? END,updated_at=? WHERE owner=? AND source_id=?`,page.nextCursor,now(),now(),page.nextPollAt?Date.parse(page.nextPollAt):null,now(),owner,id));
   try{await lease.write(guards);}catch(error){await assertAuthorization(binding);throw error;}return true;
  },
  authorizationFence(job){return statement("SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_sources WHERE owner=? AND source_id=? AND scope_id=? AND authorization_generation=? AND authorization_status='VERIFIED') THEN 1 ELSE json('AUTHORIZATION_CHANGED') END",job.owner,job.sourceId,job.scopeId,job.authorizationGeneration);},
  async due(owner,id,limit){return rows("SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND source_id=? AND status IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT ?",owner,id,now(),limit);},
  async conflict(job){return camel(await statement('SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND scope_id=? AND report_id=? AND sha256<>? LIMIT 1',job.owner,job.scopeId,job.reportId,job.sha256).first());},
  async duplicate(job){return camel(await statement("SELECT * FROM bankgiro_ingest_jobs WHERE owner=? AND sha256=? AND id<>? AND status IN ('IMPORTED','REVIEW','DUPLICATE') AND document_id IS NOT NULL LIMIT 1",job.owner,job.sha256,job.id).first());},
  async update(job,patch,lease){const data={...job,...patch},terminal=['IMPORTED','REVIEW','DUPLICATE'].includes(data.status);if(terminal)await assertAuthorization(job);try{await lease.write([...(['IMPORTED','REVIEW','DUPLICATE'].includes(data.status)?[this.authorizationFence(job)]:[]),statement('UPDATE bankgiro_ingest_jobs SET document_id=?,status=?,attempts=?,next_attempt_at=?,last_error=?,import_id=?,payment_count=?,updated_at=? WHERE id=? AND owner=?',data.documentId??null,data.status,data.attempts,data.nextAttemptAt??null,data.lastError??null,data.importId??null,data.paymentCount??0,now(),job.id,job.owner)]);}catch(error){if(terminal)await assertAuthorization(job);throw error;}Object.assign(job,patch);}
 };
}
