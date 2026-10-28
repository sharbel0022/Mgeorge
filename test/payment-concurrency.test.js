import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,listInvoices,listTransactions,storeTransactions} from '../src/db.js';
import {runReconciliation} from '../src/reconciliation.js';
import {parseCSV} from '../src/importers.js';
import {approveSyntheticBankAccount} from './bank-fixtures.js';

const account='SE4280000890119146168423';
const source=`Datum;Belopp;Betalare;Betalningsreferens;Bankreferens;IBAN;Valuta\n2026-10-26;100;Syntetisk Kund AB;000018;CONCURRENT-BANK-1;${account};SEK\n`;
const childSource=`
import {openDatabase,storeTransactions} from ${JSON.stringify(new URL('../src/db.js',import.meta.url).href)};
import {runReconciliation} from ${JSON.stringify(new URL('../src/reconciliation.js',import.meta.url).href)};
import {parseCSV} from ${JSON.stringify(new URL('../src/importers.js',import.meta.url).href)};
const db=openDatabase(process.argv[1]);
process.on('message',message=>{
  if(message!=='go')return;
  try{
    const source=${JSON.stringify(source)},content=Buffer.from(source);
    const imported=storeTransactions(db,parseCSV(source,${JSON.stringify(account)}),'file:concurrent.csv',{content,mime_type:'text/csv'});
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
  approveSyntheticBankAccount(setup,account);
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
    storeTransactions(db,parseCSV(source,account),'file:restart.csv',{content:Buffer.from(source),mime_type:'text/csv'});runReconciliation(db);
    assert.equal(listInvoices(db)[0].paid_cents,10000);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
  }finally{db.close();}
});

test('abrupt process exit during bank insertion rolls back the entire import and retries once',{timeout:15000},async t=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-payment-crash-')),path=join(folder,'db.sqlite');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const setup=openDatabase(path),priorOriginal=Buffer.from('Preserved synthetic original');
  setup.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-invoice','customer','001','Syntetisk Kund AB',10000,'000018','2026-10-01');
  approveSyntheticBankAccount(setup,account);
  storeTransactions(setup,[],'file:preserved.csv',{content:priorOriginal,mime_type:'text/csv'});
  const before={imports:setup.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,audits:setup.prepare('SELECT COUNT(*) n FROM audit_events').get().n};
  setup.close();
  // Test-only wrapper exits after SQLite has accepted the first INSERT while
  // storeTransactions still owns its open transaction. There is intentionally
  // no close(), rollback(), exception handler or production crash hook.
  const crashSource=`
    import {openDatabase,storeTransactions} from ${JSON.stringify(new URL('../src/db.js',import.meta.url).href)};
    import {parseCSV} from ${JSON.stringify(new URL('../src/importers.js',import.meta.url).href)};
    const real=openDatabase(process.argv[1]);
    const db={exec:sql=>real.exec(sql),prepare(sql){const statement=real.prepare(sql);if(!/^INSERT OR IGNORE INTO bank_transactions\\(/.test(sql))return statement;return{run(...args){const result=statement.run(...args);if(result.changes){if(real.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n!==1)process.exit(74);process.exit(73);}return result;}};}};
    const source=${JSON.stringify(source)};
    storeTransactions(db,parseCSV(source,${JSON.stringify(account)}),'file:crashed.csv',{content:Buffer.from(source),mime_type:'text/csv'});
    process.exit(75);
  `;
  const child=spawn(process.execPath,['--input-type=module','--eval',crashSource,path],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,73,stderr);
  const db=openDatabase(path);
  try{
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(listTransactions(db).length,0);assert.equal(listInvoices(db)[0].paid_cents,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,before.imports);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,before.audits);
    assert.deepEqual(Buffer.from(db.prepare("SELECT content FROM import_jobs WHERE name='preserved.csv'").get().content),priorOriginal);
    const retried=storeTransactions(db,parseCSV(source,account),'file:retry.csv',{content:Buffer.from(source),mime_type:'text/csv'});runReconciliation(db);
    assert.equal(retried.imported,1);assert.equal(listTransactions(db).length,1);assert.equal(listInvoices(db)[0].paid_cents,10000);
    const replay=storeTransactions(db,parseCSV(source,account),'file:replay.csv',{content:Buffer.from(source),mime_type:'text/csv'});runReconciliation(db);
    assert.equal(replay.imported,0);assert.equal(replay.duplicate,1);assert.equal(listInvoices(db)[0].paid_cents,10000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='automatic_verified_match'").get().n,1);
  }finally{db.close();}
});
