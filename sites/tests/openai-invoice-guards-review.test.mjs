import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentOcrFixture} from './helpers/document-ocr-fixture.mjs';
import {positionedInvoicePdf} from '../../test/helpers/pdf-layout-ocr.mjs';
import {openDatabase,storeDocument} from '../../src/db.js';
import {interpretInvoice} from '../../src/invoice-extraction.js';
import {enrichNodeInvoice} from '../../src/openai-invoice-integration.js';
import {createBackup,restoreBackup} from '../../src/backup.js';
import {extractOpenAiInvoice} from '../lib/openai-invoices/adapter.js';
import {invoiceAiPolicy} from '../lib/openai-invoices/integration.js';
import {INVOICE_AI_FIELD_NAMES} from '../lib/openai-invoices/schema.js';

// Real SQLite, migrations, retained originals and processing code. Only provider
// responses and the precisely located lost-continuation fault are synthetic.
const endpoint='https://api.openai.com/v1/responses';
const environment=owner=>({
  OPENAI_INVOICES_ENABLED:'true',
  OPENAI_INVOICES_PRIVACY_APPROVED:'true',
  OPENAI_INVOICES_SECURITY_APPROVED:'true',
  OPENAI_INVOICES_COST_APPROVED:'true',
  OPENAI_INVOICES_APPROVAL_ID:'synthetic-guard-review',
  OPENAI_INVOICES_ALLOWED_OWNERS:JSON.stringify([owner]),
  OPENAI_INVOICES_COMPANY_ORGANIZATIONS:JSON.stringify({[owner]:'5560160680'}),
  OPENAI_INVOICES_PROFILE:'luna-v1',
  OPENAI_API_KEY:'synthetic-key-not-a-credential',
});
const counted=()=>Response.json({object:'response.input_tokens',input_tokens:1500});
const quota=()=>Response.json({error:{code:'insufficient_quota'}},{status:429});
const reserved=db=>db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='invoice.ai.reserved'").get().n;
function adapterInput(){
  const bytes=positionedInvoicePdf(),owner='synthetic-guard-owner',env=environment(owner);
  return {bytes,mime:'application/pdf',pageCount:1,inputValidated:true,
    sha256:createHash('sha256').update(bytes).digest('hex'),owner,documentId:'synthetic-document',
    policy:invoiceAiPolicy(env,owner),companyRole:'recipient',apiKey:env.OPENAI_API_KEY};
}
function completed(details){
  const output={documentType:'invoice',suspiciousInstructions:false,lineItems:null,conflicts:[],
    ...Object.fromEntries(INVOICE_AI_FIELD_NAMES.map(name=>[name,{value:null,evidence:null}]))};
  return Response.json({object:'response',id:'resp_synthetic',status:'completed',model:'gpt-6-luna',
    error:null,incomplete_details:null,
    usage:{input_tokens:1500,output_tokens:500,total_tokens:2000,input_tokens_details:details},
    output:[{type:'message',role:'assistant',status:'completed',
      content:[{type:'output_text',text:JSON.stringify(output),annotations:[]}]}]});
}
function nodeFixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-ai-guard-review-')),path=join(folder,'source.sqlite');
  const database=openDatabase(path),databases=[database];
  t.after(()=>{for(const db of databases)db.close();rmSync(folder,{recursive:true,force:true});});
  const bytes=positionedInvoicePdf(),stored=storeDocument(database,{name:'synthetic.pdf',mime_type:'application/pdf',bytes});
  const row=database.prepare('SELECT * FROM documents WHERE id=?').get(stored.id);
  const baseline=interpretInvoice('',{direction:'supplier'});
  baseline.documentRead={validated:true,sha256:row.fingerprint,mime:'application/pdf',pageCount:1};
  return {folder,path,database,databases,row,baseline};
}

for(const scenario of ['enabled after acceptance','profile changed after acceptance']){
  test('accepted document run sends no AI request when '+scenario,async t=>{
    const f=await documentOcrFixture(t,positionedInvoicePdf());
    f.env.DOCUMENT_WORKER_TOKEN='a'.repeat(43);
    await f.api.enqueueDocuments(f.owner);
    f.sql.prepare("UPDATE document_jobs SET state='processing',engine='local',lease_runner='local',lease='synthetic-lease',lease_until=? WHERE owner=? AND document_id=?")
      .run(new Date(Date.now()+180000).toISOString(),f.owner,f.id);
    if(scenario.startsWith('profile'))Object.assign(f.env,environment(f.owner));
    let requests=0;
    t.mock.method(globalThis,'fetch',async url=>{
      requests++;
      if(url===endpoint+'/input_tokens')return counted();
      assert.equal(url,endpoint);
      return quota();
    });
    const request=()=>new Request('https://synthetic.test/api/ocr-worker/complete',{
      method:'POST',headers:{authorization:'Bearer '+f.env.DOCUMENT_WORKER_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({id:f.id,lease:'synthetic-lease',sha256:f.sha,text:'',method:'ocr',confidence:90}),
    });
    const prepare=f.db.prepare.bind(f.db);let interrupt=true;
    const fault=t.mock.method(f.db,'prepare',query=>{
      const statement=prepare(query);
      if(query==='SELECT * FROM document_automation WHERE owner=?'&&interrupt){
        statement.first=async()=>{interrupt=false;throw Error('synthetic lost continuation');};
      }
      return statement;
    });
    await assert.rejects(()=>f.api.workerAction(request(),'complete'),/synthetic lost continuation/);
    fault.mock.restore();
    const accepted=f.sql.prepare('SELECT state,lease,extraction FROM document_jobs WHERE owner=? AND document_id=?').get(f.owner,f.id);
    assert.equal(accepted.state,'processing');
    assert.equal(accepted.lease,'synthetic-lease');
    assert.match(JSON.parse(accepted.extraction).processing.run_id,/^[a-f0-9]{64}$/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
    const beforeReservations=reserved(f.sql);
    Object.assign(f.env,environment(f.owner));
    if(scenario.startsWith('profile'))f.env.OPENAI_INVOICES_PROFILE='sol-v1';
    requests=0;
    const replay=await f.api.workerAction(request(),'complete');
    assert.equal((await replay.json()).ignored,true);
    assert.equal(requests,0,'an accepted receipt must stop transmission before policy/profile admission');
    assert.equal(reserved(f.sql),beforeReservations,'an accepted receipt must not reserve another budget cap');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
    assert.equal(f.sql.prepare('SELECT extraction FROM document_jobs WHERE owner=? AND document_id=?').get(f.owner,f.id).extraction,accepted.extraction);
    assert.equal(f.invoices().length,0);
  });
}

for(const revokedAt of ['input count','rate-limit response']){
  test('Node host authorization is checked before sending after '+revokedAt,async t=>{
    const f=nodeFixture(t);let generations=0;
    const revoke=()=>f.database.prepare("UPDATE documents SET status='dismissed' WHERE id=?").run(f.row.id);
    const adapter=args=>extractOpenAiInvoice(args,{retryDelayMs:0,fetchImpl:async url=>{
      if(url===endpoint+'/input_tokens'){
        if(revokedAt==='input count')revoke();
        return counted();
      }
      assert.equal(url,endpoint);generations++;
      if(revokedAt==='rate-limit response'&&generations===1){
        revoke();return Response.json({error:{code:'rate_limit_exceeded'}},{status:429});
      }
      return quota();
    }});
    await assert.rejects(()=>enrichNodeInvoice(f.database,f.row,f.baseline,{
      environment:environment('node:legacy'),adapter,
    }),/AI_DOCUMENT_CHANGED/);
    assert.equal(generations,revokedAt==='input count'?0:1,'no external request may follow revoked host authorization');
    assert.equal(reserved(f.database),1,'the original reservation is retained conservatively');
  });
}

test('adapter checks the host immediately before its first external request',async()=>{
  let requests=0;
  const result=await extractOpenAiInvoice({...adapterInput(),authorize:async()=>{throw Error('synthetic revoked host');}},
    {fetchImpl:async()=>{requests++;return counted();}});
  assert.equal(requests,0);
  assert.equal(result.status,'fallback');
  assert.equal(result.costUnknown,false);
});

for(const status of [500,502,503,504]){
  test('ambiguous generation HTTP '+status+' is retained without a retry',async()=>{
    let generations=0;
    const result=await extractOpenAiInvoice(adapterInput(),{retryDelayMs:0,fetchImpl:async url=>{
      if(url===endpoint+'/input_tokens')return counted();
      assert.equal(url,endpoint);generations++;
      return Response.json({error:{code:'synthetic_provider_error'}},{status});
    }});
    assert.equal(generations,1);
    assert.equal(result.status,'fallback');
    assert.equal(result.costUnknown,true);
    assert.equal(result.costMicroUsd,null);
    assert.equal(result.reservationMicroUsd,250000);
  });
}

test('generation disables implicit cache writes without adding unsupported count options',async()=>{
  const sent=[];
  await extractOpenAiInvoice(adapterInput(),{fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);sent.push({url,body});
    if(url===endpoint+'/input_tokens')return counted();
    assert.equal(url,endpoint);return quota();
  }});
  assert.equal(sent.length,2);
  assert.equal(Object.hasOwn(sent[0].body,'prompt_cache_options'),false);
  assert.deepEqual(sent[1].body.prompt_cache_options,{mode:'explicit'});
  assert.equal(JSON.stringify(sent[1].body.input).includes('prompt_cache_breakpoint'),false);
});

for(const [name,details] of [
  ['cache write',{cached_tokens:0,cache_write_tokens:1500,cache_write_tokens_details:{ttl_30m_tokens:1500,ttl_12h_tokens:0}}],
  ['unreported cache-write total',{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:1500}}],
  ['cache read',{cached_tokens:1500}],
]){
  test('unexpected '+name+' never becomes a known low-cost receipt',async()=>{
    const result=await extractOpenAiInvoice(adapterInput(),{fetchImpl:async url=>{
      if(url===endpoint+'/input_tokens')return counted();
      assert.equal(url,endpoint);return completed(details);
    }});
    assert.equal(result.status,'fallback');
    assert.equal(result.costUnknown,true);
    assert.equal(result.costMicroUsd,null);
    assert.equal(result.knownCostMicroUsd,0);
    assert.equal(result.reservationMicroUsd,250000);
  });
}

test('an older restored Node snapshot cannot reissue an AI request under recovery quarantine',async t=>{
  const f=nodeFixture(t),archive=join(f.folder,'before-ai.mgbak'),target=join(f.folder,'restored.sqlite');
  const encryptionKey='ab'.repeat(32);
  createBackup(f.path,archive,encryptionKey);
  let requests=0;
  const adapter=args=>extractOpenAiInvoice(args,{fetchImpl:async url=>{
    requests++;
    if(url===endpoint+'/input_tokens')return counted();
    assert.equal(url,endpoint);return quota();
  }});
  await enrichNodeInvoice(f.database,f.row,f.baseline,{environment:environment('node:legacy'),adapter});
  assert.equal(requests,2);assert.equal(reserved(f.database),1);
  const restored=restoreBackup(archive,target,encryptionKey);
  assert.equal(restored.applicationTokenRecoveryRequired,true);
  const database=openDatabase(target);f.databases.push(database);
  assert.equal(reserved(database),0,'the older snapshot predates the retained live reservation');
  assert.equal(database.prepare('SELECT recovery_required FROM company_application_token_control WHERE id=1').get().recovery_required,1);
  requests=0;
  const row=database.prepare('SELECT * FROM documents WHERE id=?').get(f.row.id);
  const result=await enrichNodeInvoice(database,row,f.baseline,{environment:environment('node:legacy'),adapter});
  assert.equal(requests,0,'restore quarantine must fence AI disclosure and spending');
  assert.equal(reserved(database),0);
  assert.equal(result.ai.status,'blocked');
  assert.equal(result.ai.code,'AI_RECOVERY_REQUIRED');
  assert.equal(database.prepare('SELECT recovery_required FROM company_application_token_control WHERE id=1').get().recovery_required,1);
});
