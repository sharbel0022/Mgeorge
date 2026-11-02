import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compiled,fixture,files,sync} from './helpers/file-upload-concurrency-fixture.mjs';
import {dataModule,invoiceParserUrl,libUrl} from './helpers/invoice-module-loader.mjs';
import {positionedInvoicePdf} from '../../test/helpers/pdf-layout-ocr.mjs';
import {randomToken,seal} from '../lib/banking/security.ts';

// Reuse the genuine migration-backed SQLite and storage-race fixture. Only the
// external Gmail HTTP replies and the host identity/environment are substituted:
// the file route, adapter, crypto, PDF extraction, queue and after-check are real.
const environment=dataModule('export const env=new Proxy({}, {get:(_,key)=>globalThis.uploadRaceFixture.env[key]});');
const auth=dataModule('export async function getChatGPTUser(){const f=globalThis.uploadRaceFixture;return f.users?.length?f.users.shift():f.user;}');
const domain=libUrl('domain.ts'),security=libUrl('banking/security.ts');
const server=compiled('lib/server.ts',{'cloudflare:workers':environment,'@/app/chatgpt-auth':auth,'./domain':domain});
const store=dataModule(`import {seal,unseal} from ${JSON.stringify(security)};export const storageReady=()=>true;export const encrypt=(owner,purpose,value)=>seal(globalThis.uploadRaceFixture.key,owner,purpose,value);export const decrypt=(owner,purpose,value)=>unseal(globalThis.uploadRaceFixture.key,owner,purpose,value);`);
const adapter=compiled('lib/gmail-adapter.js',{'cloudflare:workers':environment});
const reconciliation=compiled('lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':libUrl('reconciliation-engine.js')});
const evidence=compiled('lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':libUrl('reconciliation-engine.js')});
const customer=compiled('lib/customer-messages.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-evidence':evidence,'./customer-message-text.js':libUrl('customer-message-text.js'),'./banking/security':security,'./banking/store':store,'./gmail-adapter.js':adapter});
const processingUrl=compiled('lib/document-processing.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./banking/security':security,'./invoice-fields.js':invoiceParserUrl(),'./server-pdf':libUrl('server-pdf.ts'),'./customer-messages':customer});
const gmail=await import(compiled('lib/gmail-service.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./banking/security':security,'./banking/store':store,'./gmail-adapter.js':adapter,'./invoice-fields.js':invoiceParserUrl(),'./document-processing':processingUrl,'./customer-messages':customer}));

function uploadPdf(bytes){
  const form=new FormData();form.set('file',new File([bytes],'synthetic-invoice.pdf',{type:'application/pdf'}));
  return new Request('https://mg.test/api/files',{method:'POST',headers:{origin:'https://mg.test'},body:form});
}

for(const winner of ['manual','gmail'])test(`real Gmail PDF flow retains the ${winner} race winner and one exact unknown-counterparty proposal`,{timeout:30000},async t=>{
  // The permuted stream draws 000018 before 0606; their visible labels establish
  // the independent expected invoice and OCR identities (the PR19 regression).
  const bytes=positionedInvoicePdf({order:[0,3,2,1]}),sha=createHash('sha256').update(bytes).digest('hex');
  const f=fixture(t,{parallel:true,order:winner}),owner=f.user.userId;
  f.key=randomToken();
  Object.assign(f.env,{GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GMAIL_ACCOUNT:f.user.email});
  const tokens={access_token:'synthetic-access',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly'};
  f.sqlite.prepare('UPDATE gmail_connections SET tokens=? WHERE owner=?').run(await seal(f.key,owner,'gmail-tokens',tokens),owner);
  const at=new Date().toISOString();
  f.sqlite.prepare('INSERT INTO document_automation(owner,email,enabled,auto_register,updated_at) VALUES(?,?,1,1,?)').run(owner,f.user.email,at);
  let attachmentReads=0;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://gmail.googleapis.com');assert.equal(options.method||'GET','GET');
    assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer synthetic-access');
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:f.user.email});
    if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:'synthetic-pdf-message'}]});
    if(parsed.pathname.endsWith('/attachments/synthetic-part')){
      attachmentReads++;return Response.json({size:bytes.length,data:bytes.toString('base64url')});
    }
    assert.equal(parsed.pathname,'/gmail/v1/users/me/messages/synthetic-pdf-message');
    return Response.json({id:'synthetic-pdf-message',labelIds:['INBOX'],internalDate:String(Date.now()),payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'Testbolaget AB <supplier@example.test>'},{name:'To',value:f.user.email},{name:'Subject',value:'Syntetiskt underlag'}],parts:[{partId:'1',filename:'synthetic-invoice.pdf',mimeType:'application/pdf',body:{attachmentId:'synthetic-part',size:bytes.length}}]}});
  });

  // Pause the real worker after its durable claim, before it reads the original.
  let releaseOriginal,originalReached;
  const hold=new Promise(resolve=>{releaseOriginal=resolve;}),reached=new Promise(resolve=>{originalReached=resolve;});
  t.after(()=>releaseOriginal());
  const get=f.env.BUCKET.get.bind(f.env.BUCKET);let held=false;
  f.env.BUCKET.get=async key=>{const object=await get(key);if(!held&&object){held=true;originalReached();await hold;}return object;};
  const manual=files.POST(uploadPdf(bytes)),fetched=gmail.gmailSync(sync());
  await Promise.race([reached,fetched.then(()=>{throw Error('Gmail completed before claiming its retained PDF');})]);
  const uploaded=await manual;assert.equal(uploaded.status,200);const upload=await uploaded.json();
  const documents=f.sqlite.prepare('SELECT id,sha256,size FROM documents').all();assert.equal(documents.length,1);
  const id=documents[0].id;assert.equal(upload.id,id);assert.equal(upload.duplicate===true,winner==='gmail');
  assert.equal(documents[0].sha256,sha);assert.equal(documents[0].size,bytes.length);assert.equal(f.objects.size,1);
  const source=f.sqlite.prepare('SELECT source_id,document_id,status,metadata FROM gmail_sources').get(),metadata=JSON.parse(source.metadata);
  assert.equal(source.source_id,'gmail:owner@example.test:synthetic-pdf-message:1');assert.equal(source.document_id,id);assert.equal(source.status,'needs_review');
  assert.equal(metadata.from,'Testbolaget AB <supplier@example.test>');assert.equal(metadata.direction,'supplier');assert.equal(metadata.direction_confident,true);
  assert.deepEqual({...f.sqlite.prepare('SELECT document_id,state,attempts FROM document_jobs').get()},{document_id:id,state:'processing',attempts:1});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  const restarted=await import(processingUrl+'#fresh-worker-'+winner),blocked=await restarted.processDocuments(owner);
  assert.equal(blocked.processed,0);assert.equal(f.sqlite.prepare('SELECT attempts FROM document_jobs').get().attempts,1);

  releaseOriginal();const response=await fetched;assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.imported,winner==='gmail'?1:0);assert.equal(result.duplicates,winner==='manual'?1:0);
  assert.equal(result.warning,undefined);assert.equal(result.processing.processed,1);assert.equal(result.processing.counts.needs_review,1);
  const job=f.sqlite.prepare('SELECT document_id,state,attempts,automatic,invoice_id,extraction FROM document_jobs').get(),extraction=JSON.parse(job.extraction);
  assert.equal(job.document_id,id);assert.equal(job.state,'needs_review');assert.equal(job.attempts,1);assert.equal(job.automatic,0);assert.equal(job.invoice_id,'');
  assert.equal(extraction.method,'pdf');assert.equal(extraction.processing.sha256,sha);
  const values=Object.fromEntries(Object.entries(extraction.fields).map(([name,field])=>[name,field.value]));
  assert.deepEqual({number:values.invoice_number,reference:values.reference,party:values.party,organization:values.organization_number,direction:values.direction,total:values.total_cents,net:values.net_cents,vat:values.vat_cents,currency:values.currency,issued:values.issued_at,due:values.due_at},
    {number:'0606',reference:'000018',party:'Testbolaget AB',organization:'5560160680',direction:'supplier',total:375000,net:300000,vat:75000,currency:'SEK',issued:'2026-10-24',due:'2026-11-07'});
  assert.notEqual(extraction.level,'green');assert.ok(extraction.issues.includes('Motparten behöver verifieras för automatisk registrering.'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM customer_messages').get().n,0);

  const status=await(await gmail.gmailStatus()).json();assert.equal(status.candidates.length,1);
  assert.equal(status.candidates[0].document_id,id);assert.equal(status.candidates[0].processing_state,'needs_review');
  assert.equal(JSON.parse(status.candidates[0].processing_extraction).fields.reference.value,'000018');
  const preview=await files.GET(new Request('https://mg.test/api/files?id='+id));assert.equal(preview.status,200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
  // A repeat fetch uses the immutable message/part identity, then fresh manual
  // and worker instances retain the same original/proposal without new debt.
  const repeat=await(await gmail.gmailSync(sync())).json(),duplicate=await(await files.POST(uploadPdf(bytes))).json();
  assert.equal(repeat.imported,0);assert.equal(repeat.duplicates,1);assert.equal(attachmentReads,1);
  assert.equal(duplicate.id,id);assert.equal(duplicate.duplicate,true);assert.equal(f.objects.size,1);
  assert.equal((await restarted.processDocuments(owner)).processed,0);
  assert.equal(f.sqlite.prepare('SELECT extraction FROM document_jobs').get().extraction,job.extraction);
  assert.deepEqual(Buffer.from(f.objects.get(owner+'/'+id)),bytes);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM gmail_sources').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_jobs').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});
