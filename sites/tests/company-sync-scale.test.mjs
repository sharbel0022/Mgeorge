import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {assertScopeCurrent} from '../lib/company-storage.js';
import {createCompanyBankSyncStore} from '../lib/company-bank-sync-store.js';
import {createCompanyBankSyncRunner,runCompanyBankSyncBatch} from '../lib/company-bank-sync.js';


// The first cohort cannot finish until all configured slots have entered the
// provider stub. A serialized scheduler therefore fails, rather than reporting
// its requested concurrency as a measured result.
function requestOverlap(target) {
 let active=0,peak=0,arrivals=0,release,reject,timer;
 const ready=new Promise((resolve,rejected)=>{release=resolve;reject=rejected;});
 return {
  get peak(){return peak;},
  close(){clearTimeout(timer);},
  async request(){
   active++;peak=Math.max(peak,active);
   try{
    if(arrivals<target){
     arrivals++;
     if(arrivals===1)timer=setTimeout(()=>reject(Error('synthetic concurrent cohort did not arrive')),3000);
     if(arrivals===target){clearTimeout(timer);release();}
     await ready;
    }
    await new Promise(resolve=>setImmediate(resolve));
    return{synthetic:true};
   }finally{active--;}
  },
 };
}

for(const count of [1,10,100])test(`real tenant database and durable runner scale: ${count} synthetic companies`,async t=>{
 const f=companyFixture(t),started=performance.now(),jobs=[];
 let overlap=requestOverlap(Math.min(5,count));t.after(()=>overlap.close());
 for(let n=0;n<count;n++){
  const companyId='scale-company-'+n,actor='scale-actor-'+n;await f.create(companyId,actor);
  const scope=await f.scope(actor,companyId),database=f.database(scope),owner=scope.owner,store=createCompanyBankSyncStore(database);
  await store.bindScope({companyId,owner,evidenceId:'synthetic-scale-registration'});
  const context={companyId,owner,connectionId:'same-connection',provider:'open_payments',accountKey:'same-account-key',accountUid:'same-provider-account',consentId:'same-synthetic-consent',generation:'synthetic-v1',revision:1,validUntil:new Date(Date.now()+3600000).toISOString(),authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-scale-budget',maxRequests:10,windowMs:60000},bankgiroEnabled:false};
  const runner=createCompanyBankSyncRunner({store,resolveContext:async()=>{await assertScopeCurrent(f.raw,scope,'manage_integrations');return context;},currentGuard:()=>({assert:()=>assertScopeCurrent(f.raw,scope,'manage_integrations'),fence:()=>database.prepare('SELECT 1')}),sync:async stage=>{
   await stage.request(()=>overlap.request());
   const key='same-receipt',sha256='a'.repeat(64),result=await stage.lease.commit({key,sha256,statements:[database.prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,0,'synthetic.scale',?,?)").bind('scale-audit-'+n,owner,JSON.stringify({companyId,invoiceReference:'0599'}),new Date().toISOString())],result:{imported:1}});
   return{complete:true,receiptKey:key,imported:result.duplicate?0:1,duplicate:result.duplicate?1:0};
  }});
  jobs.push({context,database,run:()=>runner.run({companyId,connectionId:context.connectionId,accountKey:context.accountKey})});
 }
 const provisionMs=performance.now()-started,runStart=performance.now();
 const result=await runCompanyBankSyncBatch({jobs,maxConcurrent:5,maxJobs:100,run:job=>job.run()});
 const firstRunMs=performance.now()-runStart;assert.equal(result.results.length,count);assert.ok(result.results.every(row=>row.status==='success'&&row.imported===1),JSON.stringify(result));
 const observedPeakConcurrency=overlap.peak;assert.equal(observedPeakConcurrency,Math.min(5,count),'first run must actually overlap without exceeding the configured limit');
 overlap.close();overlap=requestOverlap(Math.min(5,count));
 const replayStart=performance.now(),replay=await runCompanyBankSyncBatch({jobs,maxConcurrent:5,maxJobs:100,run:job=>job.run()});
 const replayMs=performance.now()-replayStart,replayObservedPeakConcurrency=overlap.peak;assert.equal(replayObservedPeakConcurrency,Math.min(5,count),'replay must retain independent concurrent tenant leases');assert.ok(replay.results.every(row=>row.status==='success'&&row.imported===0&&row.duplicate===1));
 for(const job of jobs){const rows=await job.database.prepare("SELECT owner,detail FROM audit_events WHERE action='synthetic.scale'").all();assert.equal(rows.results.length,1);assert.equal(rows.results[0].owner,job.context.owner);assert.equal(JSON.parse(rows.results[0].detail).companyId,job.context.companyId);}
 assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_jobs').get().n,count);assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,count);assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,count*2);
 t.diagnostic(JSON.stringify({kind:'synthetic_tenant_database_and_scheduler',companies:count,concurrency:5,observedPeakConcurrency,replayObservedPeakConcurrency,provisionMs:+provisionMs.toFixed(2),firstRunMs:+firstRunMs.toFixed(2),replayMs:+replayMs.toFixed(2),receipts:count,providerNetwork:false,financialWrites:0}));
});
