import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,listInvoices,listTransactions,storeTransactions} from '../src/db.js';
import {runReconciliation} from '../src/reconciliation.js';
import {parseCSV} from '../src/importers.js';

const source='Datum;Belopp;Betalare;Betalningsreferens;Bankreferens\n2026-10-26;100;Syntetisk Kund AB;000018;CONCURRENT-BANK-1\n';
const childSource=`
import {openDatabase,storeTransactions} from ${JSON.stringify(new URL('../src/db.js',import.meta.url).href)};
import {runReconciliation} from ${JSON.stringify(new URL('../src/reconciliation.js',import.meta.url).href)};
import {parseCSV} from ${JSON.stringify(new URL('../src/importers.js',import.meta.url).href)};
const db=openDatabase(process.argv[1]);
process.on('message',message=>{
  if(message!=='go')return;
  try{
    const source=${JSON.stringify(source)},content=Buffer.from(source);
    const imported=storeTransactions(db,parseCSV(source,'MG'),'file:concurrent.csv',{content,mime_type:'text/csv'});
    runReconciliation(db);db.close();process.send({done:true,imported:imported.imported,duplicate:imported.duplicate});process.disconnect();
  }catch(error){db.close();process.send({error:error.message});process.disconnect();process.exitCode=1;}
});
process.send({ready:true});
`;

function worker(path,t){
  const child=spawn(process.execPath,['--input-type=module','--eval',childSource,path],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const ready=new Promise((resolve,reject)=>{child.on('message',m=>{if(m.ready)resolve();});child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('Synthetic concurrency worker failed before ready'));});});
  const done=new Promise((resolve,reject)=>{child.on('message',m=>{if(m.done)resolve(m);if(m.error)reject(new Error(m.error));});child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('Synthetic concurrency worker failed'));});});
  return {child,ready,done};
}

test('two real processes import and reconcile one bank payment once, then replay safely after restart',{timeout:15000},async t=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-payment-concurrency-')),path=join(folder,'db.sqlite');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const setup=openDatabase(path);
  setup.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-invoice','customer','001','Syntetisk Kund AB',10000,'000018','2026-10-01');
  setup.close();
  const workers=[worker(path,t),worker(path,t)];
  await Promise.all(workers.map(w=>w.ready));
  for(const w of workers)w.child.send('go');
  const results=await Promise.all(workers.map(w=>w.done));
  assert.equal(results.reduce((sum,r)=>sum+r.imported,0),1);
  assert.equal(results.reduce((sum,r)=>sum+r.duplicate,0),1);
  const db=openDatabase(path);
  try{
    assert.equal(listTransactions(db).length,1);assert.equal(listInvoices(db)[0].paid_cents,10000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='automatic_verified_match'").get().n,1);
    storeTransactions(db,parseCSV(source,'MG'),'file:restart.csv',{content:Buffer.from(source),mime_type:'text/csv'});runReconciliation(db);
    assert.equal(listInvoices(db)[0].paid_cents,10000);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
  }finally{db.close();}
});
