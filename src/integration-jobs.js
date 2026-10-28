import {randomUUID} from 'node:crypto';

const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
/** Durable coordination only: no credentials or provider payloads enter this table. */
export function createIntegrationJobs(db,{now=Date.now,leaseMs=5*60_000}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS integration_jobs(
    name TEXT PRIMARY KEY,lease TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,
    next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '')`);
  const state=name=>db.prepare('SELECT * FROM integration_jobs WHERE name=?').get(name);
  const running=name=>{const row=state(name);return !!row?.lease&&row.lease_until>now();};
  function due(name,last,interval){const row=state(name);return interval>0&&!running(name)&&(!row||row.failures<3&&now()>=row.next_attempt&&now()-row.last_attempt>=interval)&&now()-last>=interval;}
  function claim(name,{scheduled=false,interval=0}={}){
    const at=now(),id=randomUUID();
    db.prepare('INSERT OR IGNORE INTO integration_jobs(name) VALUES(?)').run(name);
    const updated=db.prepare(`UPDATE integration_jobs SET lease=?,lease_until=?,
      last_attempt=CASE WHEN ? THEN ? ELSE last_attempt END,
      next_attempt=CASE WHEN ? THEN ?+MAX(?,60000*(1 << failures)) ELSE next_attempt END,
      failures=failures+?,last_error=CASE WHEN ? THEN 'Körningen avbröts eller väntar på svar. Kontrollera anslutningen om felet kvarstår.' ELSE last_error END
      WHERE name=? AND (lease='' OR lease_until<=?)
      AND (?=0 OR (failures<3 AND next_attempt<=? AND last_attempt<=?-?))`).run(id,at+leaseMs,Number(scheduled),at,Number(scheduled),at,interval,Number(scheduled),Number(scheduled),name,at,Number(scheduled),at,at,interval);
    if(!updated.changes){
      const row=state(name);
      if(row.failures>=3&&scheduled)throw failure(409,'integration_blocked','Automatisk hämtning stoppades efter tre avbrutna eller misslyckade försök. Kontrollera anslutningen och gör en manuell hämtning.');
      if(row.lease&&row.lease_until>at)throw failure(409,'integration_busy','En integrationsåtgärd pågår redan.');
      throw failure(429,'integration_wait','Hämtningen väntar på nästa tillåtna försök.');
    }
    function assert(){const row=state(name);if(!row||row.lease!==id||row.lease_until<=now())throw failure(409,'integration_lease_lost','Körningens lås har löpt ut. Inga uppgifter från det försenade svaret sparades.');}
    function changed(result){if(!result.changes)throw failure(409,'integration_lease_lost','Körningens lås har löpt ut. Inga uppgifter från det försenade svaret sparades.');}
    return {
      assert,
      write(fn){db.exec('BEGIN IMMEDIATE');try{assert();const result=fn();if(result&&typeof result.then==='function')throw TypeError('Integration lease writes must be synchronous');db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},
      success(){changed(db.prepare("UPDATE integration_jobs SET failures=0,last_error='',next_attempt=0 WHERE name=? AND lease=? AND lease_until>?").run(name,id,now()));},
      fail(message,retryAfter=0,blocked=false){const safe=String(message).slice(0,300);changed(db.prepare('UPDATE integration_jobs SET failures=CASE WHEN ? THEN 3 ELSE MAX(1,failures) END,last_error=?,next_attempt=MAX(next_attempt,?) WHERE name=? AND lease=? AND lease_until>?').run(Number(blocked),safe,now()+Math.max(60_000,retryAfter),name,id,now()));},
      release(){db.prepare("UPDATE integration_jobs SET lease='',lease_until=0 WHERE name=? AND lease=?").run(name,id);}
    };
  }
  function summary(){return db.prepare('SELECT name,lease,lease_until,failures,last_attempt,next_attempt,last_error FROM integration_jobs ORDER BY name').all().map(({lease,...row})=>({...row,running:!!lease&&row.lease_until>now(),blocked:row.failures>=3}));}
  return {state,running,due,claim,summary};
}
