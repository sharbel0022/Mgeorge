import {randomUUID} from 'node:crypto';
import {createImportJobStatus} from '../sites/lib/import-job-status.js';

const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
const interrupted='Körningen avbröts eller väntar på svar. Kontrollera anslutningen om felet kvarstår.';
const genericFailure='Hämtningen misslyckades. Kontrollera anslutningen och försök igen.';
const knownMessages=new Set([
  interrupted,genericFailure,'Gmail-hämtningen behöver kontrolleras','Gmail-anslutningen behöver förnyas',
  'Bankanslutningen behöver förnyas – koppla igen','Bankens anropsgräns är nådd. Försök igen senare.',
  'Det gick inte att hämta bankhändelser. Kontrollera anslutningen och försök igen.'
]);
const knownCodes=new Set([
  'integration_failed','integration_interrupted','integration_blocked','rate_limited','provider_error','connection_error',
  'renewal_required','access_denied','missing_scope','invalid_client','account_mismatch','invalid_tokens',
  'invalid_date_range','transaction_period_unavailable','page_limit','transaction_limit','bank_timeout',
  'incomplete_bank_response','bank_sync_window_limit','application_access_denied','bank_unavailable','retry_after_unknown'
]);
const safeMessage=value=>typeof value==='string'&&knownMessages.has(value)?value:genericFailure;
const safeCode=value=>typeof value==='string'&&knownCodes.has(value)?value:'integration_failed';
const maxTimestamp=253402300799999;
const iso=value=>Number.isSafeInteger(value)&&value>0&&value<=maxTimestamp?new Date(value).toISOString():null;
const jobType=name=>name==='gmail'?'gmail_sync':name.startsWith('bank:')?'bank_sync':name==='backup'?'backup':name.startsWith('bankgiro')?'bankgiro_import':'document_ocr';

/** Durable coordination only: no credentials or provider payloads enter this table. */
export function createIntegrationJobs(db,{now=Date.now,leaseMs=5*60_000,maxRunMs=15*60_000}={}){
  if(!Number.isSafeInteger(leaseMs)||leaseMs<=0||!Number.isSafeInteger(maxRunMs)||maxRunMs<leaseMs)throw TypeError('Invalid integration lease duration');
  // Serialize an additive upgrade across independently starting Node processes.
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS integration_jobs(
      name TEXT PRIMARY KEY,lease TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '')`);
    const columns=new Set(db.prepare('PRAGMA table_info(integration_jobs)').all().map(column=>column.name));
    const upgrading=!columns.has('job_state');
    const additions={
      job_state:"TEXT NOT NULL DEFAULT 'queued'",last_success:'INTEGER NOT NULL DEFAULT 0',attempt_count:'INTEGER DEFAULT 0',
      fence_version:'INTEGER NOT NULL DEFAULT 0',error_code:"TEXT NOT NULL DEFAULT ''",retry_after:'INTEGER NOT NULL DEFAULT 0',
      retry_blocked:'INTEGER NOT NULL DEFAULT 0',lease_deadline:'INTEGER NOT NULL DEFAULT 0',
      record_attempt:'INTEGER NOT NULL DEFAULT 1',last_scheduled_attempt:'INTEGER NOT NULL DEFAULT 0'
    };
    for(const [name,type] of Object.entries(additions))if(!columns.has(name))db.exec(`ALTER TABLE integration_jobs ADD COLUMN ${name} ${type}`);
    if(upgrading){
      const update=db.prepare('UPDATE integration_jobs SET job_state=?,attempt_count=NULL,error_code=?,last_error=?,retry_after=?,lease_deadline=lease_until,last_scheduled_attempt=last_attempt WHERE name=?');
      for(const row of db.prepare('SELECT * FROM integration_jobs').all()){
        const state=row.lease?'running':row.failures>=3?'blocked':row.last_error?'retry_wait':'queued';
        update.run(state,row.last_error?'integration_failed':'',row.last_error?safeMessage(row.last_error):'',row.last_error?row.next_attempt:0,row.name);
      }
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}

  const state=name=>db.prepare('SELECT * FROM integration_jobs WHERE name=?').get(name);
  function recoverExpired(){
    // Legacy or malformed provider deadlines must not become an immediate retry
    // or crash status serialization. Preserve an explicit block with unknown ETA.
    db.prepare(`UPDATE integration_jobs SET job_state='blocked',retry_blocked=1,failures=MAX(failures,3),
      error_code='retry_after_unknown',last_error=?,next_attempt=0,retry_after=0,lease='',lease_until=0,lease_deadline=0
      WHERE next_attempt<0 OR next_attempt>? OR retry_after<0 OR retry_after>? OR lease_until>? OR lease_deadline>?`).run(genericFailure,maxTimestamp,maxTimestamp,maxTimestamp,maxTimestamp);
    db.prepare(`UPDATE integration_jobs SET
      job_state=CASE WHEN record_attempt=1 AND job_state='running' THEN CASE WHEN failures>=3 THEN 'blocked' ELSE 'retry_wait' END ELSE job_state END,
      last_error=CASE WHEN record_attempt=1 AND job_state='running' THEN ? ELSE last_error END,
      error_code=CASE WHEN record_attempt=1 AND job_state='running' THEN 'integration_interrupted' ELSE error_code END,
      lease='',lease_until=0,lease_deadline=0
      WHERE lease<>'' AND lease_until<=?`).run(interrupted,now());
  }
  recoverExpired();
  const running=name=>{const row=state(name);return !!row?.lease&&row.lease_until>now();};
  function due(name,last,interval){
    recoverExpired();const row=state(name),at=now();
    return interval>0&&!running(name)&&(!row||row.failures<3&&!row.retry_blocked&&row.job_state!=='paused'&&at>=Math.max(row.next_attempt,row.retry_after)&&at-(row.failures?row.last_attempt:row.last_scheduled_attempt)>=interval)&&at-last>=interval;
  }
  function claim(name,{scheduled=false,interval=0,recordAttempt=true}={}){
    recoverExpired();
    const at=now(),id=randomUUID(),tracked=Number(recordAttempt),automatic=Number(scheduled&&recordAttempt);
    db.prepare('INSERT OR IGNORE INTO integration_jobs(name) VALUES(?)').run(name);
    const row=db.prepare(`UPDATE integration_jobs SET lease=?,lease_until=?,lease_deadline=?,record_attempt=?,fence_version=fence_version+1,
      job_state=CASE WHEN ? THEN 'running' ELSE job_state END,
      last_attempt=CASE WHEN ? THEN ? ELSE last_attempt END,
      last_scheduled_attempt=CASE WHEN ? THEN ? ELSE last_scheduled_attempt END,
      attempt_count=CASE WHEN ? THEN COALESCE(attempt_count,0)+1 ELSE attempt_count END,
      next_attempt=CASE WHEN ? THEN MAX(retry_after,?+MAX(?,60000*(1 << MIN(failures,8)))) ELSE next_attempt END,
      failures=failures+?,last_error=CASE WHEN ? THEN '' ELSE last_error END,error_code=CASE WHEN ? THEN '' ELSE error_code END
      WHERE name=? AND (lease='' OR lease_until<=?)
      AND (?=0 OR (retry_blocked=0 AND retry_after<=?))
      AND (?=0 OR (failures<3 AND job_state<>'paused' AND next_attempt<=? AND CASE WHEN failures>0 THEN last_attempt ELSE last_scheduled_attempt END<=?-?))
      RETURNING *`).get(id,at+leaseMs,at+maxRunMs,tracked,tracked,tracked,at,automatic,at,tracked,tracked,at,interval,tracked,tracked,tracked,name,at,tracked,at,automatic,at,at,interval);
    if(!row){
      const current=state(name);
      if(current.lease&&current.lease_until>at)throw failure(409,'integration_busy','En integrationsåtgärd pågår redan.');
      if(recordAttempt&&(current.retry_blocked||current.failures>=3&&scheduled))throw failure(409,'integration_blocked','Automatisk hämtning stoppades efter tre avbrutna eller misslyckade försök. Kontrollera anslutningen och gör en manuell hämtning.');
      throw Object.assign(failure(429,'integration_wait','Hämtningen väntar på nästa tillåtna försök.'),{retryAfter:Math.max(1,Math.ceil((Math.max(current.next_attempt,current.retry_after)-at)/1000))});
    }
    const version=row.fence_version;let completed='';
    const lost=()=>failure(409,'integration_lease_lost','Körningens lås har löpt ut. Inga uppgifter från det försenade svaret sparades.');
    function assertOwned(allowComplete=false){
      const current=state(name);
      if(!current||current.lease!==id||current.fence_version!==version||current.lease_until<=now()||current.lease_deadline<=now()||!allowComplete&&(completed||recordAttempt&&current.job_state!=='running'))throw lost();
      return current;
    }
    function changed(result){if(!result.changes)throw lost();}
    return {
      assert(){assertOwned();},
      renew(){
        assertOwned();const current=now();
        changed(db.prepare('UPDATE integration_jobs SET lease_until=MIN(?,lease_deadline) WHERE name=? AND lease=? AND fence_version=? AND lease_until>? AND lease_deadline>?').run(current+leaseMs,name,id,version,current,current));
      },
      write(fn){
        db.exec('BEGIN IMMEDIATE');const previous=completed;
        try{
          assertOwned();const result=fn();
          if(result&&typeof result.then==='function')throw TypeError('Integration lease writes must be synchronous');
          assertOwned(true);db.exec('COMMIT');return result;
        }catch(error){completed=previous;db.exec('ROLLBACK');throw error;}
      },
      success(){
        assertOwned(completed==='success');if(completed==='success')return;
        if(recordAttempt)changed(db.prepare("UPDATE integration_jobs SET job_state='succeeded',last_success=?,failures=0,last_error='',error_code='',next_attempt=0,retry_after=0,retry_blocked=0 WHERE name=? AND lease=? AND fence_version=? AND lease_until>? AND job_state='running'").run(now(),name,id,version,now()));
        completed='success';
      },
      fail(message,retryAfter=0,blocked=false,errorCode='integration_failed'){
        assertOwned();
        const current=now(),retry=Number.isFinite(retryAfter)&&retryAfter>0?Math.ceil(retryAfter):0;
        const invalidRetry=!Number.isFinite(retryAfter)||retryAfter<0||retry>maxTimestamp-current,stop=Number(blocked||invalidRetry);
        if(recordAttempt)changed(db.prepare(`UPDATE integration_jobs SET
          failures=CASE WHEN ? THEN 3 ELSE MAX(1,failures) END,
          job_state=CASE WHEN ? OR failures>=3 THEN 'blocked' ELSE 'retry_wait' END,
          last_error=?,error_code=?,next_attempt=CASE WHEN ? THEN 0 ELSE MAX(next_attempt,?) END,
          retry_after=CASE WHEN ? THEN 0 ELSE MAX(retry_after,?) END,retry_blocked=?
          WHERE name=? AND lease=? AND fence_version=? AND lease_until>? AND job_state='running'`).run(stop,stop,safeMessage(message),safeCode(invalidRetry?'retry_after_unknown':errorCode),Number(invalidRetry),current+Math.max(60_000,invalidRetry?0:retry),Number(invalidRetry),retry&&!invalidRetry?current+retry:0,stop,name,id,version,current));
        completed='failure';
      },
      release(){
        db.prepare(`UPDATE integration_jobs SET
          job_state=CASE WHEN record_attempt=1 AND job_state='running' THEN CASE WHEN failures>=3 THEN 'blocked' ELSE 'retry_wait' END ELSE job_state END,
          last_error=CASE WHEN record_attempt=1 AND job_state='running' THEN ? ELSE last_error END,
          error_code=CASE WHEN record_attempt=1 AND job_state='running' THEN 'integration_interrupted' ELSE error_code END,
          lease='',lease_until=0,lease_deadline=0 WHERE name=? AND lease=? AND fence_version=?`).run(interrupted,name,id,version);
      }
    };
  }
  function summary(){
    recoverExpired();const at=now();
    return db.prepare('SELECT * FROM integration_jobs ORDER BY name').all().map(row=>{
      const active=!!row.lease&&row.lease_until>at,blocked=row.failures>=3||!!row.retry_blocked;
      const currentState=active&&row.record_attempt&&row.job_state==='running'?'running':blocked?'blocked':row.job_state;
      return {
        name:row.name,lease_until:row.lease_until,failures:row.failures,last_attempt:row.last_attempt,next_attempt:row.next_attempt,
        last_error:row.last_error?safeMessage(row.last_error):'',running:active,blocked,
        jobStatus:createImportJobStatus({jobType:jobType(row.name),state:currentState,lastAttemptAt:iso(row.last_attempt),lastSuccessAt:iso(row.last_success),
          nextAttemptAt:blocked||currentState==='succeeded'?null:iso(Math.max(row.next_attempt,row.retry_after)),
          attemptCount:row.attempt_count,fenceVersion:row.fence_version,leaseExpiresAt:active&&row.record_attempt?iso(row.lease_until):null,
          errorCode:row.error_code?safeCode(row.error_code):row.last_error?'integration_failed':null},{now:at})
      };
    });
  }
  return {state,running,due,claim,summary};
}
