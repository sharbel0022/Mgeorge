import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openDatabase,allocate,listInvoices,storeTransactions} from '../src/db.js';
process.env.MG_ADMIN_PASSWORD='TEST-DO-NOT-USE-THIS-AS-A-REAL-PASSWORD';
const fixture=()=>{
  const folder=mkdtempSync(join(tmpdir(),'mgeorge-'));const db=openDatabase(join(folder,'db.sqlite'));
  return {db,cleanup:()=>{db.close();rmSync(folder,{recursive:true,force:true});}};
};
test('matching respects direction, balances and prevents double-match',()=>{
  const {db,cleanup}=fixture();
  try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i1','customer','0604','Kund AB',187500);
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i2','supplier','123','Leverantör AB',25000);
    const x={account:'MG',booked_at:'2026-10-26',amount_cents:187500,currency:'SEK',payer:'Kund AB',reference:'0604',bank_reference:'BANK123',description:''};
    assert.equal(storeTransactions(db,[x,x],'test').imported,1);
    const t=db.prepare('SELECT id FROM bank_transactions').get().id;
    assert.throws(()=>allocate(db,'i2',t,25000),/riktning/);
    allocate(db,'i1',t,125000);assert.equal(listInvoices(db)[0].paid_cents,125000);
    assert.throws(()=>allocate(db,'i1',t,70000),/saldo|UNIQUE/);
    assert.equal(listInvoices(db)[0].status,'partial');
  }finally{cleanup();}
});
test('matching refuses transactions missing payer and reference',()=>{
  const {db,cleanup}=fixture();
  try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('i1','customer','0604','Kund AB',10000);
    storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer:'',reference:'',bank_reference:'SWED123',description:''}],'test');
    const t=db.prepare('SELECT id FROM bank_transactions').get().id;
    assert.throws(()=>allocate(db,'i1',t,10000),/Komplettera/);
  }finally{cleanup();}
});
