import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {parseBankFile} from '../src/importers.js';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
import {digest} from '../src/security.js';
import {storeTransactions} from '../src/db.js';

const directory=mkdtempSync(join(tmpdir(),'mgeorge-xlsx-'));
for(const key of Object.keys(process.env))if(/^(GOOGLE_|ENABLE_BANKING_|ENABLEBANKING_|MG_ADMIN_PASSWORD|ENCRYPTION_KEY)/.test(key))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://mg.example.test',DB_PATH:join(directory,'synthetic.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'3'.repeat(64),MG_ADMIN_PASSWORD:'Synthetic test password 123!'});
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
let cookie='';
async function call(path,method='GET',body,{session=cookie}={}){
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const req=request(base+path,{method,headers:{Host:'mg.example.test',...(session?{Cookie:session}:{}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),Origin:process.env.APP_ORIGIN}:{})}},res=>{
      const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>{const bytes=Buffer.concat(chunks);let json={};try{json=JSON.parse(bytes.toString());}catch{}resolve({status:res.statusCode,headers:res.headers,bytes,json});});
    });req.on('error',reject);req.end(payload);
  });
}
test.after(()=>new Promise(resolve=>server.close(()=>{db.close();rmSync(directory,{recursive:true,force:true});resolve();})));
const content=makeBankgiroXLSX(),payload={name:'synthetic-bankgiro.xlsx',account:'Separat syntetiskt konto',content_base64:Buffer.from(content).toString('base64')};
const financialCounts=()=>Object.fromEntries(['bank_transactions','allocations','invoices'].map(table=>[table,db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));

test('the bank store refuses review-only observations even when a caller bypasses the upload route',()=>{
  const before=financialCounts(),imports=db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n;
  assert.throws(()=>storeTransactions(db,[{account:'SYNTHETIC',booked_at:'2026-10-20',amount_cents:12345,currency:'SEK',payer:'Testbageriet AB',reference:'0017',review_only:true}],'file:synthetic.xlsx'),/granskning/);
  assert.deepEqual(financialCounts(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,imports);
});

test('XLSX adapter preserves observed payer, reference, integer öre and report cells without asserting account identity',()=>{
  const [row]=parseBankFile(payload.name,payload.content_base64,'SE4280000890119146168423');
  assert.equal(row.payer,'Testbageriet AB');assert.equal(row.reference,'0017');assert.equal(row.amount_cents,12345);assert.equal(row.booked_at,'2026-10-20');
  assert.equal(row.bankgiro,'1234-5678');assert.equal(row.payer_bankgiro,'987-6543');assert.equal(row.bank_reference,'');
  assert.equal(row.account_evidence.exact_match,false);assert.equal(row.account_evidence.reported_account,'');assert.equal(row.review_only,true);
  assert.ok(row.account_evidence.report);assert.ok(row.account_evidence.cells);assert.notEqual(row.reference_evidence.selected.kind,'ocr');assert.equal(row.reference_evidence.selected.value,'0017');
});

test('XLSX routes require authentication and preview never writes originals or financial rows',async()=>{
  const before=financialCounts();
  assert.equal((await call('/api/import/preview','POST',payload,{session:''})).status,401);
  assert.equal((await call('/api/import/commit','POST',{...payload,confirm:true},{session:''})).status,401);
  const login=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD},{session:''});assert.equal(login.status,200);cookie=login.headers['set-cookie'][0].split(';')[0];
  const preview=await call('/api/import/preview','POST',payload);
  assert.equal(preview.status,200,JSON.stringify(preview.json));assert.equal(preview.json.count,1);assert.equal(preview.json.review_only,true);assert.equal(preview.json.review,1);
  assert.equal(preview.json.items[0].payer,'Testbageriet AB');assert.equal(preview.json.items[0].reference,'0017');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,0);assert.deepEqual(financialCounts(),before);
});

test('confirmed XLSX retains exact private bytes and SHA once, without financial mutations even with concurrent retries',async()=>{
  const before=financialCounts();
  assert.equal((await call('/api/import/commit','POST',payload)).status,400);
  const replies=await Promise.all([call('/api/import/commit','POST',{...payload,confirm:true}),call('/api/import/commit','POST',{...payload,confirm:true})]);
  for(const response of replies){assert.equal(response.status,200,JSON.stringify(response.json));assert.equal(response.json.imported,0);assert.equal(response.json.review_only,true);}
  assert.deepEqual(replies.map(r=>r.json.duplicate).sort(),[0,1]);assert.equal(replies[0].json.import_id,replies[1].json.import_id);
  const retained=db.prepare('SELECT * FROM import_jobs').all();assert.equal(retained.length,1);assert.equal(retained[0].status,'needs_review');
  assert.equal(retained[0].content_sha256,digest(content));assert.deepEqual(Buffer.from(retained[0].content),Buffer.from(content));assert.equal(retained[0].mime_type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const renamed=await call('/api/import/commit','POST',{...payload,name:'renamed.xlsx',confirm:true});assert.equal(renamed.json.duplicate,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,1);
  assert.deepEqual(financialCounts(),before);
  const download=await call(`/api/imports/${retained[0].id}/original`);assert.equal(download.status,200);assert.deepEqual(download.bytes,Buffer.from(content));assert.match(download.headers['content-disposition'],/\.xlsx/);
  assert.equal((await call(`/api/imports/${retained[0].id}/original`,'GET',undefined,{session:''})).status,401);
});

test('damaged, oversized and unsupported Excel files cannot create import or financial records',async()=>{
  const before=financialCounts(),imports=db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n;
  for(const changed of [{content_base64:Buffer.from('corrupt spreadsheet').toString('base64')},{name:'synthetic.xlsm'}]){
    const response=await call('/api/import/commit','POST',{...payload,...changed,confirm:true});assert.equal(response.status,400);
  }
  assert.throws(()=>parseBankFile('large.xlsx',Buffer.alloc(15_000_001).toString('base64')),/stor|MB/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM import_jobs').get().n,imports);assert.deepEqual(financialCounts(),before);
});
