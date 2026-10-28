import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,allocate,listInvoices} from '../src/db.js';
import {runReconciliation} from '../src/reconciliation.js';
import {prepareMessages,listMessages,verifyContact,editMessage,rejectMessage,reviewMessage,approveAndSend,validRecipient} from '../src/customer-messages.js';

function fixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-messages-')),db=openDatabase(join(folder,'db.sqlite'));t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents,vat_cents,net_cents,reference,due_at) VALUES('i','customer','0597','Kund AB',312500,62500,250000,'0597','2000-01-01')").run();
  verifyContact(db,{invoice_id:'i',email:'kund@example.com',evidence:'Bekräftat i kundavtal'},'admin');
  return db;
}
function payment(db,amount=250000,reference='B1'){
  storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:amount,currency:'SEK',payer:'Kund AB',reference:'0597',bank_reference:reference}],'enablebanking');runReconciliation(db);prepareMessages(db);
}
function draft(db){prepareMessages(db);return listMessages(db).find(m=>m.status==='draft');}
function review(db,m){return reviewMessage(db,m.id,m.version,'admin','session');}
const opts=send=>({authorize:()=>{},prepare:async()=>send});
function send(db,m,r,options){return approveAndSend(db,m.id,{version:m.version,review_id:r.review_id,approve:true},'admin','session',options);}

test('VAT message uses verified cents, states uncertainty and does not accuse the customer',t=>{
  const db=fixture(t);payment(db);const m=draft(db);assert.equal(m.kind,'possible_vat');assert.match(m.body,/Kan betalningen ha avsett/);assert.equal(m.invoice.remaining_cents,62500);assert.equal(m.payments.length,1);assert.doesNotMatch(m.body,/glömt/);
});

test('inconsistent VAT figures never produce a VAT claim and missing reference has its own draft',t=>{
  const db=fixture(t);payment(db);db.prepare('UPDATE invoices SET net_cents=240000').run();
  prepareMessages(db);assert.equal(draft(db).kind,'partial');
  db.prepare("INSERT INTO reconciliation_findings(id,invoice_id,transaction_id,kind,details) VALUES('missing','i','test','missing_reference','{}')").run();
  prepareMessages(db);const missing=listMessages(db).find(m=>m.status==='draft'&&m.kind==='missing_reference');
  assert.ok(missing);assert.match(missing.body,/saknar fakturareferens/);assert.match(missing.body,/ännu inte säkert kopplad/);
  assert.equal(db.prepare('SELECT count(*) n FROM message_deliveries').get().n,0);
});
test('unverified absence asks for confirmation; verified absence may produce overdue draft',t=>{
  const db=fixture(t);assert.equal(draft(db).kind,'confirmation');
  db.prepare("UPDATE invoices SET reconciled_at='2026-10-27',reconciliation_note='Bankutdrag kontrollerat'").run();prepareMessages(db);assert.equal(draft(db).kind,'overdue');
});
test('payment after drafting invalidates the old version and review',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);payment(db);let calls=0;
  await assert.rejects(send(db,m,r,opts(async()=>{calls++;return {id:'gmail'};})),/ändrats/);assert.equal(calls,0);assert.equal(listMessages(db).find(x=>x.id===m.id).status,'stale');
});
test('edited draft cannot use its previous review; current edit must be reviewed',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);editMessage(db,m.id,{version:m.version,subject:'Nytt ämne',body:'Ny text'},'admin');
  await assert.rejects(send(db,m,r,opts(async()=>({id:'gmail'}))),/ändrats/);
  const updated=draft(db);await assert.rejects(send(db,updated,r,opts(async()=>({id:'gmail'}))),/aktuell mejlversion/);
  const fresh=review(db,updated);assert.equal((await send(db,updated,fresh,opts(async()=>({id:'gmail'})))).status,'sent');
});
test('no approval, forged review, different browser and expired review cannot send',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);let calls=0;const options=opts(async()=>{calls++;return {id:'gmail'};});
  await assert.rejects(approveAndSend(db,m.id,{version:m.version,review_id:r.review_id,approve:false},'admin','session',options),/godkännande/);
  await assert.rejects(approveAndSend(db,m.id,{version:m.version,review_id:r.review_id,approve:true},'admin','other',options),/aktuell mejlversion/);
  await assert.rejects(send(db,m,{review_id:'forged'},options),/aktuell mejlversion/);
  db.prepare('UPDATE message_reviews SET expires_at=0').run();await assert.rejects(send(db,m,r,options),/aktuell mejlversion/);assert.equal(calls,0);
});
test('double click creates one consumed approval and one Gmail send',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);let calls=0;
  const results=await Promise.allSettled([send(db,m,r,opts(async()=>{calls++;return {id:'gmail-1'};})),send(db,m,r,opts(async()=>{calls++;return {id:'gmail-2'};}))]);
  assert.equal(calls,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM message_approvals').get().n,1);
  const delivery=db.prepare('SELECT * FROM message_deliveries').get();assert.ok(delivery.sent_at);assert.equal(delivery.gmail_message_id,'gmail-1');assert.equal(db.prepare('SELECT consumed FROM message_reviews').get().consumed,1);
});
test('Gmail timeout is unknown and cannot be resent or regenerated after new bank data',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);let calls=0;const options=opts(async()=>{calls++;throw Error('timeout');});
  await assert.rejects(send(db,m,r,options),/oklar/);await assert.rejects(send(db,m,r,options),/ändrats/);assert.equal(calls,1);
  payment(db,10000);prepareMessages(db);assert.equal(listMessages(db).filter(x=>x.kind===m.kind).length,1);assert.equal(db.prepare('SELECT status FROM message_deliveries').get().status,'unknown');
});
test('preflight changes payment data or revoked admin session stop the send',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);let calls=0;
  await assert.rejects(send(db,m,r,{authorize:()=>{},prepare:async()=>{payment(db);return async()=>{calls++;return {id:'gmail'};};}}),/ändrats/);assert.equal(calls,0);
  const updated=draft(db),fresh=review(db,updated);await assert.rejects(send(db,updated,fresh,{authorize:()=>{throw Error('Session revoked');},prepare:async()=>async()=>{calls++;return {id:'gmail'};}}),/Session revoked/);assert.equal(calls,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM message_deliveries').get().n,0);
});
test('recipient verification is explicit, rejects header injection and changes invalidate review',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);assert.equal(validRecipient('a@example.com\r\nBcc: x@example.com'),false);
  verifyContact(db,{invoice_id:'i',email:'new@example.com',evidence:'Nytt avtal'},'admin');await assert.rejects(send(db,m,r,opts(async()=>({id:'gmail'}))),/ändrats/);
});
test('rejection persists for the same evidence and the scheduler only prepares drafts',t=>{
  const db=fixture(t),m=draft(db);rejectMessage(db,m.id,m.version,'admin');runReconciliation(db);prepareMessages(db);assert.equal(listMessages(db).length,1);assert.equal(listMessages(db)[0].status,'rejected');assert.equal(db.prepare('SELECT COUNT(*) n FROM message_deliveries').get().n,0);
});
test('overpayment draft retains actual bank amount and unallocated excess',t=>{
  const db=fixture(t);payment(db,350000);const m=draft(db);assert.equal(m.kind,'overpayment');assert.equal(m.payments[0].amount_cents,350000);assert.equal(m.invoice.remaining_cents,0);assert.equal(listInvoices(db)[0].paid_cents,312500);
});
test('restart retains sending lock and cannot consume a second approval',async t=>{
  const db=fixture(t),m=draft(db),r=review(db,m);db.prepare("UPDATE customer_messages SET status='sending' WHERE id=?").run(m.id);
  await assert.rejects(send(db,m,r,opts(async()=>({id:'gmail'}))),/ändrats/);prepareMessages(db);assert.equal(listMessages(db).length,1);
});
test('correcting an OCR allocation preserves the bank original and prepares a factual reference draft',t=>{
  const db=fixture(t);storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:312500,currency:'SEK',payer:'Kund AB',reference:'0577',bank_reference:'OCR'}],'enablebanking');
  const tx=db.prepare('SELECT * FROM bank_transactions').get();allocate(db,'i',tx.id,312500);runReconciliation(db);prepareMessages(db);
  const m=draft(db);assert.equal(m.kind,'wrong_reference');assert.match(m.body,/0577/);assert.match(m.body,/0597/);assert.equal(db.prepare('SELECT reference FROM bank_transactions').get().reference,'0577');
});
test('unresolved matching duplicates prepare a cautious duplicate-payment draft',t=>{
  const db=fixture(t);
  for(const bank_reference of ['B1','B2'])storeTransactions(db,[{account:'MG',booked_at:'2026-10-26',amount_cents:312500,currency:'SEK',payer:'Kund AB',reference:'0597',bank_reference}],'enablebanking');
  runReconciliation(db);prepareMessages(db);const duplicate=listMessages(db).find(m=>m.kind==='possible_duplicate');assert.ok(duplicate);assert.match(duplicate.body,/kan avse/);assert.equal(duplicate.invoice.paid_cents,0);
});
test('changing invoice customer identity requires a fresh recipient verification',t=>{
  const db=fixture(t);draft(db);db.prepare("UPDATE invoices SET party='Annan kund'").run();prepareMessages(db);assert.equal(draft(db).recipient,'');
});
