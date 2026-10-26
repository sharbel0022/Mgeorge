import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {request} from 'node:http';
const folder=mkdtempSync(join(tmpdir(),'mgeorge-api-'));
process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:3000';process.env.DB_PATH=join(folder,'db.sqlite');
delete process.env.MG_ADMIN_PASSWORD;
process.env.SESSION_SECRET='1'.repeat(64);process.env.BANK_DATA_KEY='2'.repeat(64);
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
let cookie='';
async function call(path,method='GET',body,origin='http://localhost:3000'){
  const res=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json','Origin':origin}:{}),...(cookie?{'Cookie':cookie}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});
  const json=await res.json().catch(()=>({}));return {res,json};
}
test('local app and business APIs open directly without a password',async()=>{
  assert.equal((await call('/api/health')).res.status,200);
  for(const path of ['/api/invoices','/api/documents','/api/export','/api/dashboard'])assert.equal((await call(path)).res.status,200);
  const result=await call('/api/me');assert.equal(result.json.login_required,false);assert.equal(result.json.authenticated,true);
  cookie=result.res.headers.get('set-cookie').split(';')[0];assert.match(cookie,/mg_session=/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admins').get().n,0);
});
test('password-free local use preserves origin and OAuth browser-session protection',async()=>{
  assert.equal((await call('/api/login','POST',{password:'unused'})).res.status,404);
  assert.equal((await call('/api/invoices','POST',{invoice_number:'1'},'https://attacker.example')).res.status,403);
  const rebound=await new Promise((resolve,reject)=>{const req=request(base+'/api/invoices',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(rebound,403);
  const saved=cookie;cookie='mg_session=expired-browser';
  const renewed=await call('/api/me');assert.equal(renewed.res.status,200);assert.equal(renewed.json.login_required,false);assert.match(renewed.res.headers.get('set-cookie'),/mg_session=/);cookie=saved;
});
test('new invoice, payment and matching via API',async()=>{
  const inv=await call('/api/invoices','POST',{direction:'customer',invoice_number:'0604',party:'Kund AB',total_cents:187500,issued_at:'2026-10-20',due_at:'2026-11-02',reference:'0604'});
  assert.equal(inv.res.status,201);const invoiceId=inv.json.id;
  const tx=await call('/api/bank-transactions','POST',{account:'Swedbank',booked_at:'2026-10-26',amount_cents:187500,payer:'Kund AB',reference:'0604'});
  assert.equal(tx.json.imported,1);
  const id=(await call('/api/bank-transactions')).json.items[0].id;
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoiceId,transaction_id:id,amount_cents:187500,confirm:false})).res.status,400);
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoiceId,transaction_id:id,amount_cents:187500,confirm:true})).res.status,201);
  assert.equal((await call('/api/invoices')).json.items[0].status,'paid');
  assert.equal((await call('/api/dashboard')).json.customer_paid_cents,187500);
});
test('preview and import are separate and deduplicate repeated bank files',async()=>{
  const csv='Datum;Belopp;Betalare;OCR\n2026-10-26;100,00;Other AB;7777';
  const body={name:'bank.csv',account:'Swedbank',content_base64:Buffer.from(csv).toString('base64')};
  assert.equal((await call('/api/import/preview','POST',body)).json.count,1);
  assert.equal((await call('/api/import/commit','POST',{...body,confirm:true})).json.imported,1);
  assert.equal((await call('/api/import/commit','POST',{...body,confirm:true})).json.duplicate,1);
});
test('bank status exposes no secrets, connection requires server-side keys',async()=>{
  const status=await call('/api/bank/status');assert.equal(status.json.configured,false);
  assert.equal((await call('/api/bank/connect','POST',{})).res.status,409);
});
test('invoice registration rejects duplicates and impossible dates, detail preserves originals and matches',async()=>{
  const invoice=(await call('/api/invoices')).json.items[0];
  assert.equal((await call('/api/invoices','POST',{direction:'customer',invoice_number:invoice.invoice_number,party:invoice.party,total_cents:10000})).res.status,409);
  assert.equal((await call('/api/invoices','POST',{direction:'customer',invoice_number:'INVALID-DATE',party:'Datum AB',total_cents:10000,due_at:'2026-02-31'})).res.status,400);
  const detail=await call('/api/invoices/'+invoice.id);assert.equal(detail.json.invoice.id,invoice.id);assert.equal(detail.json.allocations.length,1);assert.equal(detail.json.allocations[0].transaction.reference,'0604');
  const other=await call('/api/invoices','POST',{direction:'customer',invoice_number:invoice.invoice_number,party:'Annan kund AB',total_cents:10000});assert.equal(other.res.status,201);
  assert.equal((await call('/api/invoices','PATCH',{id:other.json.id,party:invoice.party})).res.status,409);
});
test('uploaded originals require a real file signature and cannot create or pay invoices automatically',async()=>{
  const before=(await call('/api/invoices')).json.items.length;
  assert.equal((await call('/api/documents','POST',{name:'fake.pdf',content_base64:Buffer.from('<html>not pdf</html>').toString('base64')})).res.status,400);
  const content=Buffer.from('%PDF-1.4\nprivate original fixture');
  const doc=await call('/api/documents','POST',{name:'original.pdf',content_base64:content.toString('base64')});assert.equal(doc.res.status,201);assert.equal(doc.json.content,undefined);
  const original=await fetch(base+'/api/documents/'+doc.json.id,{headers:{Cookie:cookie}});assert.equal(original.status,200);assert.match(original.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await original.arrayBuffer()),content);
  const direct=await fetch(base+'/api/documents/'+doc.json.id);assert.equal(direct.status,200);
  assert.equal((await call('/api/invoices')).json.items.length,before);
  const invoice=await call('/api/invoices','POST',{direction:'supplier',invoice_number:'ORIGINAL-1',party:'Original AB',total_cents:10000,due_at:'2099-01-01',document_id:doc.json.id});assert.equal(invoice.res.status,201);
  const detail=(await call('/api/invoices/'+invoice.json.id)).json;assert.equal(detail.documents[0].id,doc.json.id);assert.equal(detail.invoice.status,'unreconciled');
  assert.equal((await call('/api/invoices','POST',{direction:'supplier',invoice_number:'ORIGINAL-2',party:'Original AB',total_cents:10000,document_id:doc.json.id})).res.status,409);
});
test('marking an invoice checked requires explicit evidence, never silently marks it paid',async()=>{
  const invoice=(await call('/api/invoices')).json.items.find(i=>i.invoice_number==='ORIGINAL-1');
  assert.equal((await call('/api/invoices','PATCH',{id:invoice.id,reconciled:true})).res.status,400);
  assert.equal((await call('/api/invoices','PATCH',{id:invoice.id,reconciled:true,confirm:true,reconciliation_note:'Kontoutdrag kontrollerat 2026-10-26'})).res.status,200);
  const detail=(await call('/api/invoices/'+invoice.id)).json;assert.equal(detail.invoice.status,'unpaid');assert.equal(detail.invoice.paid_cents,0);
});
test('excluded events require a reason, preserve bank evidence and are restored explicitly',async()=>{
  const tx=(await call('/api/bank-transactions')).json.items.find(t=>t.reference==='7777');
  assert.equal((await call('/api/bank-transactions','PATCH',{id:tx.id,excluded:true})).res.status,400);
  assert.equal((await call('/api/bank-transactions','PATCH',{id:tx.id,payer:'Changed'})).res.status,409);
  assert.equal((await call('/api/bank-transactions','PATCH',{id:tx.id,excluded:true,reason:'Inte fakturarelaterad'})).res.status,200);
  assert.equal((await call('/api/bank-transactions')).json.items.find(t=>t.id===tx.id).status,'excluded');
  assert.equal((await call('/api/bank-transactions','PATCH',{id:tx.id,excluded:false})).res.status,200);
});
test('bank source files can be downloaded privately and import history excludes their bytes',async()=>{
  const jobs=(await call('/api/imports')).json.items;const job=jobs.find(j=>j.name==='bank.csv');assert.equal(job.has_original,1);assert.equal(job.content,undefined);
  const response=await fetch(base+'/api/imports/'+job.id+'/original',{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.match(await response.text(),/Other AB/);
  assert.equal((await fetch(base+'/api/imports/'+job.id+'/original')).status,200);
});
test('company settings and export exclude secrets and refuse unsupported automatic mail sending',async()=>{
  assert.equal((await call('/api/settings','PATCH',{company_name:'Testföretaget AB',sync_interval_minutes:15,notifications_due:false})).res.status,200);
  const settings=(await call('/api/settings')).json;assert.equal(settings.company_name,'Testföretaget AB');assert.equal(settings.scheduler_available,true);
  assert.equal((await call('/api/me')).json.company,'Testföretaget AB');
  assert.equal((await call('/api/settings','PATCH',{sync_interval_minutes:1})).res.status,400);
  assert.equal((await call('/api/settings','PATCH',{reminders_enabled:true})).res.status,409);
  const output=(await call('/api/export')).json;assert.equal(output.settings.company_name,'Testföretaget AB');assert.equal(output.sessions,undefined);assert.equal(output.bank_connections,undefined);assert.equal(output.documents[0].content,undefined);
});
test('Gmail OAuth state is session-bound, imports private originals and deduplicates without creating debts',async()=>{
  const previousFetch=globalThis.fetch,originalClient=process.env.GOOGLE_CLIENT_ID,originalSecret=process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';
  const scope='https://www.googleapis.com/auth/gmail.readonly',pdf=Buffer.from('%PDF-1.4\ngmail-original');let revoked=false;
  globalThis.fetch=async(url,options)=>{
    const target=String(url);if(target.startsWith(base))return previousFetch(url,options);
    if(target==='https://oauth2.googleapis.com/token')return Response.json({access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600,scope});
    if(target==='https://oauth2.googleapis.com/revoke'){revoked=true;return new Response('',{status:200});}
    const parsed=new URL(target);
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:'mg.vitvaror@gmail.com'});
    if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:'message-1'}]});
    if(parsed.pathname.includes('/messages/message-1'))return Response.json({id:'message-1',labelIds:['INBOX'],internalDate:String(Date.now()),payload:{headers:[{name:'Subject',value:'Faktura från leverantör'},{name:'From',value:'Leverantör AB <leverantor@example.com>'}],parts:[{partId:'1',mimeType:'application/pdf',filename:'gmail-faktura.pdf',body:{size:pdf.length,data:pdf.toString('base64url')}}]}});
    throw Error('Unexpected provider URL');
  };
  try{
    const invalid=(await call('/api/gmail/connect','POST',{})).json;const state1=new URL(invalid.url).searchParams.get('state');
    db.prepare("UPDATE gmail_states SET session_hash='other-session'").run();assert.equal((await call('/api/gmail/callback?state='+state1+'&code=one-use')).res.status,403);
    const connect=(await call('/api/gmail/connect','POST',{})).json,state2=new URL(connect.url).searchParams.get('state');
    assert.equal((await call('/api/gmail/callback?state='+state2+'&code=one-use')).res.status,302);
    assert.equal((await call('/api/gmail/callback?state='+state2+'&code=one-use')).res.status,403);
    const status=(await call('/api/gmail/status')).json;assert.equal(status.status,'connected');assert.equal(status.connection.encrypted_tokens,undefined);
    const encrypted=db.prepare('SELECT encrypted_tokens FROM gmail_connections').get().encrypted_tokens;assert.ok(!encrypted.includes('private-access-token'));
    const count=(await call('/api/invoices')).json.items.length;
    const synced=await call('/api/gmail/sync','POST',{});assert.equal(synced.res.status,200);assert.equal(synced.json.imported,1);assert.equal(synced.json.review,1);
    const again=await call('/api/gmail/sync','POST',{});assert.equal(again.res.status,200);assert.equal(again.json.imported,0);assert.equal(again.json.duplicate,1);
    assert.equal((await call('/api/invoices')).json.items.length,count);
    const doc=(await call('/api/documents')).json.items.find(d=>d.source==='gmail');assert.equal(doc.party,'Leverantör AB');assert.equal(doc.direction,'supplier');assert.equal(doc.status,'needs_review');
    assert.equal((await call('/api/gmail/connection','DELETE',{})).res.status,200);assert.equal(revoked,true);assert.equal((await call('/api/gmail/status')).json.status,'not_connected');
    assert.ok((await call('/api/documents')).json.items.some(d=>d.id===doc.id));
  }finally{
    globalThis.fetch=previousFetch;
    if(originalClient===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=originalClient;
    if(originalSecret===undefined)delete process.env.GOOGLE_CLIENT_SECRET;else process.env.GOOGLE_CLIENT_SECRET=originalSecret;
  }
});
test('bounded Gmail batches persist rejected originals and resume past poison attachments',async()=>{
  const previousFetch=globalThis.fetch,originalClient=process.env.GOOGLE_CLIENT_ID,originalSecret=process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';
  const scope='https://www.googleapis.com/auth/gmail.readonly',pdf=Buffer.from('%PDF-1.4\nlegitimate after invalid attachments');
  const parts=Array.from({length:151},(_,i)=>({partId:'bad-'+i,mimeType:'application/pdf',filename:'faktura-'+i+'.pdf',body:{size:20,data:Buffer.from('<html>invalid</html>').toString('base64url')}}));
  parts.push({partId:'valid',mimeType:'application/pdf',filename:'faktura-valid.pdf',body:{size:pdf.length,data:pdf.toString('base64url')}});
  globalThis.fetch=async(url,options)=>{
    const target=String(url);if(target.startsWith(base))return previousFetch(url,options);
    if(target==='https://oauth2.googleapis.com/token')return Response.json({access_token:'bounded-test-access',refresh_token:'bounded-test-refresh',expires_in:3600,scope});
    if(target==='https://oauth2.googleapis.com/revoke')return new Response('',{status:200});
    const parsed=new URL(target);
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:'mg.vitvaror@gmail.com'});
    if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:'poison'}]});
    if(parsed.pathname.endsWith('/messages/poison'))return Response.json({id:'poison',labelIds:['INBOX'],internalDate:String(Date.now()),payload:{headers:[{name:'Subject',value:'Faktura med bilagor'},{name:'From',value:'Test AB <test@example.com>'}],parts}});
    throw Error('Unexpected provider URL');
  };
  try{
    const authorization=(await call('/api/gmail/connect','POST',{})).json,stateToken=new URL(authorization.url).searchParams.get('state');
    assert.equal((await call('/api/gmail/callback?state='+stateToken+'&code=bounded-test-code')).res.status,302);
    const first=await call('/api/gmail/sync','POST',{});assert.equal(first.res.status,200);assert.equal(first.json.imported,0);assert.equal(first.json.truncated,true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_rejected_sources').get().n,150);
    const partialConnection=db.prepare('SELECT last_synced,sync_started_at FROM gmail_connections').get();assert.equal(partialConnection.last_synced,'');assert.ok(partialConnection.sync_started_at);
    const second=await call('/api/gmail/sync','POST',{});assert.equal(second.res.status,200);assert.equal(second.json.imported,1);assert.equal(second.json.truncated,false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gmail_rejected_sources').get().n,151);
    const terminalConnection=db.prepare('SELECT last_synced,sync_started_at FROM gmail_connections').get();assert.equal(terminalConnection.last_synced,partialConnection.sync_started_at);assert.equal(terminalConnection.sync_started_at,'');
    const third=await call('/api/gmail/sync','POST',{});assert.equal(third.res.status,200);assert.equal(third.json.imported,0);assert.equal(third.json.duplicate,1);assert.equal(third.json.skipped,151);assert.equal(third.json.truncated,false);
    assert.equal((await call('/api/gmail/connection','DELETE',{})).res.status,200);
  }finally{
    globalThis.fetch=previousFetch;
    if(originalClient===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=originalClient;
    if(originalSecret===undefined)delete process.env.GOOGLE_CLIENT_SECRET;else process.env.GOOGLE_CLIENT_SECRET=originalSecret;
  }
});
test('public legal URLs return the actual Swedish drafts without a login or app shell',async()=>{
  for(const slug of ['integritetspolicy','anvandarvillkor'])for(const suffix of ['','/','.html']){
    const result=await fetch(base+'/'+slug+suffix);
    assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/text\/html/);
    const html=await result.text();assert.match(html,/<html lang="sv">/);assert.match(html,/Utkast/);assert.match(html,/M.George Vitvaror AB/);assert.ok(!html.includes('id="app"'));
  }
  assert.equal((await fetch(base+'/saknad-informationssida')).status,404);
});
test('cleanup',async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});
