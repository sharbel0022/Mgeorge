import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {emptyState,applyCommand,activeBankgiroLink} from '../lib/domain.ts';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {makeBankgiroXLSX} from './helpers/bankgiro-xlsx-fixture.mjs';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {syntheticConnection,retainSyntheticConsent} from './helpers/bank-account-fixture.mjs';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'),url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));return data(code);}
const domain=url('../lib/domain.ts'),auth=data('export async function getChatGPTUser(){return globalThis.linkingFixture.user;}'),environment=data('export const env=new Proxy({}, {get:(_,key)=>globalThis.linkingFixture.env[key]});');
const server=compiled('../lib/server.ts',{'cloudflare:workers':environment,'@/app/chatgpt-auth':auth,'./domain':domain});
const store=data('export async function connection(owner){globalThis.linkingFixture.connectionOwners.push(owner);return globalThis.linkingFixture.syncConsent();} export async function application(){return globalThis.linkingFixture.application;} export async function accounts(){return globalThis.linkingFixture.accounts;}');
const service=compiled('../lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':data('export function stableAccountKey(account){return "iban:"+account.account_id.iban;}')});
const evidence=data('export async function assertPaymentOriginal(owner,state){return state;} export async function reconcileWithOriginals(owner,state){globalThis.linkingFixture.reconciliations++;return {state,decisions:[],findings:[]};} export async function writePaymentState(owner,revision,before,after,database,statements){if(JSON.stringify(before.allocations)!==JSON.stringify(after.allocations))throw Error("Metadata fixture cannot allocate");return database.batch(statements);}');
const route=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/bankgiro-service':service,'@/lib/reconciliation-evidence':evidence,'@/lib/customer-messages':data('export async function reconcileAndPrepare(){globalThis.linkingFixture.preparations++;}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){throw Error("Must not search");}')}));
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')});
const actualEvidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js'),'./bankgiro-service':service});
const actualRoute=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/bankgiro-service':service,'@/lib/reconciliation-evidence':actualEvidence,'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){}')}));
const account='SE4280000890119146168423',sha=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
function fixture(t,options={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('CREATE TABLE workspaces(owner TEXT PRIMARY KEY,revision INTEGER,payload TEXT NOT NULL,updated_at TEXT);CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT,created_at TEXT);CREATE TABLE audit_events(id TEXT,owner TEXT,revision INTEGER,action TEXT,detail TEXT,created_at TEXT);');
 const objects=new Map(),DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const BUCKET={async get(key){const bytes=objects.get(key);return bytes?{size:bytes.byteLength,arrayBuffer:async()=>bytes}:null;}};
 const filename=options.csv?'synthetic.csv':'synthetic.xlsx',bytes=options.csv?new TextEncoder().encode('Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto;Bankreferens\n2026-10-26;Syntetiskt café AB;0599;987-6543;625,00;SEK;'+account+';SYNTHETIC-ENTRY'):makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...options.report}),documentId=crypto.randomUUID(),hash=sha(bytes);
 objects.set('owner/'+documentId,bytes.buffer);sqlite.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(documentId,'owner',filename,options.csv?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes.byteLength,hash,'2026-10-26');
 let seed=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+account,date:'2026-10-26',amount:62500,party:'',payerReference:'',description:'Bankgiro inbetalning'})]}).state;
 if(!options.noImport)seed=applyCommand(seed,{type:'bankgiro.import',documentId,hash,name:filename,rows:parseSpecificationBytes(bytes,filename)}).state;
 if(options.pending)for(const row of seed.transactions.filter(row=>row.specification)){row.specificationStatus='review';row.parentId='';row.verified=false;}
 sqlite.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('owner',1,JSON.stringify(seed),'2026-10-26');
 const f={user:{userId:'owner',displayName:'Syntetisk ägare'},env:{DB,BUCKET},sqlite,objects,seed,documentId,reconciliations:0,preparations:0,connectionOwners:[],connection:{id:'connection',owner:'owner',status:'connected',environment:'PRODUCTION',valid_until:'2099-01-01T00:00:00Z',app_generation:'generation',selected_accounts:'["selected"]',bank_name:'Swedbank',country:'SE'},application:{owner:'owner',generation:'generation'},accounts:[{uid:'selected',currency:'SEK',account_id:{iban:account}}]};f.connection={...syntheticConnection('owner',account),...f.connection,encrypted_accounts:JSON.stringify(f.accounts)};f.syncConsent=()=>{f.connection.encrypted_accounts=JSON.stringify(f.accounts);retainSyntheticConsent(f.sqlite,f.connection);return f.connection;};f.syncConsent();globalThis.linkingFixture=f;
 f.command={type:'bankgiro.link',transactionId:seed.transactions[0].id,specificationId:seed.transactions[1]?.id||'',note:'Båda originalen och kontot har kontrollerats.',confirmOriginals:true,confirmAccount:true};return f;
}
const stored=f=>JSON.parse(f.sqlite.prepare('SELECT payload FROM workspaces WHERE owner=?').get('owner').payload);
const audit=f=>f.sqlite.prepare('SELECT * FROM audit_events ORDER BY revision').all();
function request(command,revision=1,requestId=crypto.randomUUID()){return new Request('https://mg.test/api/state',{method:'POST',headers:{origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({revision,requestId,command})});}
const finances=s=>({transactions:s.transactions,invoices:s.invoices,allocations:s.allocations,imports:s.imports,credits:s.credits});

test('owner link and revoke commit only relation metadata and audit without reconciliation or draft preparation',async t=>{
 const f=fixture(t),response=await route.POST(request(f.command)),out=await response.json();assert.equal(response.status,200,out.error);assert.ok(activeBankgiroLink(out.state,f.command.transactionId));assert.deepEqual(finances(out.state),finances(f.seed));assert.equal(f.reconciliations,0);assert.equal(f.preparations,0);assert.equal(audit(f).length,1);assert.equal(audit(f)[0].owner,'owner');assert.equal(audit(f)[0].action,'bankgiro.link');
 const revoked=await route.POST(request({type:'bankgiro.unlink',id:out.state.bankgiroLinks[0].id,note:'Felaktigt samband, granskas på nytt.'},2)),revoke=await revoked.json();assert.equal(revoked.status,200,revoke.error);assert.equal(activeBankgiroLink(revoke.state,f.command.transactionId),undefined);assert.deepEqual(finances(revoke.state),finances(f.seed));assert.equal(f.reconciliations,0);assert.equal(f.preparations,0);assert.equal(audit(f).length,2);
});
test('client supplied rows proof hash document and relation fields are discarded at link boundary',async t=>{
 const f=fixture(t),response=await route.POST(request({...f.command,rows:[],documentId:'forged',hash:'forged',bankFileProof:{sha256:'forged'},bankgiroLinks:[{id:'forged'}],transactionSnapshot:'forged',specificationIds:['forged'],method:'bank_verified'})),out=await response.json();assert.equal(response.status,200,out.error);assert.equal(out.state.bankgiroLinks[0].documentId,f.documentId);assert.equal(out.state.bankgiroLinks[0].method,'manual_review');const command=JSON.parse(audit(f)[0].detail).command;assert.equal(command.documentId,undefined);assert.equal(command.method,undefined);assert.equal(command.rows,undefined);
});
test('disconnected expired wrong-generation and unselected account cannot confirm link',async t=>{
 const f=fixture(t);for(const mutate of [()=>{f.connection.status='disconnected';},()=>{f.connection.status='connected';f.connection.valid_until='2000-01-01';},()=>{f.connection.valid_until='2099-01-01';f.connection.app_generation='other';},()=>{f.connection.app_generation='generation';f.connection.selected_accounts='[]';}]){mutate();const response=await route.POST(request(f.command));assert.equal(response.status,400);assert.deepEqual(stored(f),f.seed);assert.equal(audit(f).length,0);}
});
test('changed retained XLSX bytes reject link before metadata or audit commits',async t=>{
 const f=fixture(t),bytes=new Uint8Array(f.objects.get('owner/'+f.documentId)).slice();bytes[bytes.length-1]^=1;f.objects.set('owner/'+f.documentId,bytes.buffer);const response=await route.POST(request(f.command));assert.equal(response.status,400);assert.match((await response.json()).error,/kontrollsumma/);assert.deepEqual(stored(f),f.seed);assert.equal(audit(f).length,0);
});
test('changed report observation is rejected by retained original reparse',async t=>{
 const f=fixture(t),changed=structuredClone(f.seed);changed.transactions[1].party='Klientskriven annan betalare';f.sqlite.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(changed));const response=await route.POST(request(f.command));assert.equal(response.status,400);assert.match((await response.json()).error,/original|uppgifter|stämmer/i);assert.deepEqual(stored(f),changed);assert.equal(audit(f).length,0);
});
test('only changing nested original or details cannot forge linked report identity',async t=>{
 const f=fixture(t);for(const field of ['original','bankDetails']){const changed=structuredClone(f.seed);if(field==='original')changed.transactions[1].original.party='Förfalskad originalavsändare';else changed.transactions[1].bankDetails={status:'identified',party:'Förfalskat detaljnamn',payerReference:'9999'};f.sqlite.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(changed));const response=await route.POST(request(f.command));assert.equal(response.status,400);assert.deepEqual(stored(f),changed);assert.equal(audit(f).length,0);}
});
test('missing or contradictory AIS receipt blocks manual relation without fetching provider',async t=>{
 const f=fixture(t),changed=structuredClone(f.seed);delete changed.transactions[0].bankDataSha256;f.sqlite.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(changed));const response=await route.POST(request(f.command));assert.equal(response.status,400);assert.match((await response.json()).error,/original|kvitto/);assert.deepEqual(stored(f),changed);assert.equal(audit(f).length,0);
});
test('owner isolation and Origin authentication guard every relation command',async t=>{
 const f=fixture(t);f.user=null;assert.equal((await route.POST(request(f.command))).status,401);f.user={userId:'other'};assert.equal((await route.POST(request(f.command,0))).status,400);f.user={userId:'owner'};const req=request(f.command);req.headers.set('origin','https://attacker.test');assert.equal((await route.POST(req)).status,403);assert.deepEqual(stored(f),f.seed);assert.equal(audit(f).length,0);
});
test('simultaneous link confirmations commit once and stale revision cannot overwrite metadata',async t=>{
 const f=fixture(t),responses=await Promise.all([route.POST(request(f.command)),route.POST(request(f.command))]);assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);assert.equal(stored(f).bankgiroLinks.length,1);assert.equal(audit(f).length,1);assert.equal((await route.POST(request(f.command))).status,409);assert.equal(f.reconciliations,0);assert.equal(f.preparations,0);
});
test('a lost response replay uses receipt without a second relation or audit',async t=>{
 const f=fixture(t),requestId=crypto.randomUUID();assert.equal((await route.POST(request(f.command,1,requestId))).status,200);assert.equal((await route.POST(request(f.command,1,requestId))).status,200);assert.equal(stored(f).bankgiroLinks.length,1);assert.equal(audit(f).length,1);
});
test('owner API refuses to reuse the same semantic report from a second retained XLSX original',async t=>{
 const f=fixture(t),bytes=makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',shiftRows:1,payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),documentId=crypto.randomUUID(),hash=sha(bytes);
 assert.notEqual(hash,f.seed.transactions[1].bankFileProof.sha256);f.objects.set('owner/'+documentId,bytes.buffer);f.sqlite.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(documentId,'owner','layout-variant.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes.byteLength,hash,'2026-10-26');
 let seed=applyCommand(f.seed,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+account,date:'2026-10-26',amount:62500,party:'',payerReference:'',description:'Bankgiro inbetalning',bankReference:'SECOND-INDEPENDENT-AIS'})]}).state;
 seed=applyCommand(seed,{type:'bankgiro.import',documentId,hash,name:'layout-variant.xlsx',rows:parseSpecificationBytes(bytes,'layout-variant.xlsx')}).state;f.sqlite.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(seed));
 const secondBank=seed.transactions.find(row=>!row.specification&&row.id!==f.command.transactionId),secondSpec=seed.transactions.find(row=>row.bankFileProof?.documentId===documentId),first=await route.POST(request(f.command));assert.equal(first.status,200);
 const response=await route.POST(request({...f.command,transactionId:secondBank.id,specificationId:secondSpec.id},2)),out=await response.json();assert.equal(response.status,400);assert.match(out.error,/rapport|specifikation.*redan|redan.*koppl/i);assert.equal(stored(f).bankgiroLinks.length,1);assert.equal(audit(f).length,1);assert.deepEqual(finances(stored(f)),finances(seed));assert.equal(f.reconciliations,0);assert.equal(f.preparations,0);
});
test('stable CSV identity with active owned selected account keeps the automatic whole-report link',async t=>{
 const f=fixture(t,{csv:true,noImport:true}),response=await actualRoute.POST(request({type:'bankgiro.import',documentId:f.documentId})),out=await response.json();assert.equal(response.status,200,out.error);assert.equal(out.state.transactions.find(row=>row.specification).specificationStatus,'linked');assert.equal(out.state.transactions.find(row=>row.specification).parentId,f.seed.transactions[0].id);
});
test('stable bank references cannot auto-link a new report after consent was lost or expired',async t=>{
 const f=fixture(t,{csv:true,noImport:true});f.connection.valid_until='2000-01-01T00:00:00Z';const response=await actualRoute.POST(request({type:'bankgiro.import',documentId:f.documentId})),out=await response.json();assert.equal(response.status,200,out.error);const report=out.state.transactions.find(row=>row.specification);assert.equal(report.specificationStatus,'review');assert.equal(report.parentId,'');assert.match(report.bankgiroAccountIssue,/bank|konto|medgivande/i);assert.equal(out.state.allocations.length,0);
});
test('legacy pending reports need current consent before later automatic promotion',async t=>{
 const f=fixture(t,{csv:true,pending:true});f.connection.status='disconnected';const response=await actualRoute.POST(request({type:'settings.save',name:'Syntetiskt bolag',email:'test@example.test'})),out=await response.json();assert.equal(response.status,200,out.error);assert.equal(out.state.transactions[1].specificationStatus,'review');assert.equal(out.state.transactions[1].parentId,'');assert.equal(out.state.allocations.length,0);
 f.connection.status='connected';const next=await actualRoute.POST(request({type:'settings.save',name:'Syntetiskt bolag',email:'test@example.test'},2)),fresh=await next.json();assert.equal(next.status,200,fresh.error);assert.equal(fresh.state.transactions[1].specificationStatus,'linked');assert.equal(fresh.state.transactions[1].parentId,f.seed.transactions[0].id);
});


for(const location of ['account_id.other','all_account_ids'])for(const scheme of ['IBAN','BBAN'])for(const currency of ['SEK','EUR'])test('direct-primary report cannot be manually linked when '+location+' duplicates its '+scheme+' identifier on an unselected '+currency+' resource',async t=>{
 const f=fixture(t),before=structuredClone(stored(f)),bytes=new Uint8Array(f.objects.get('owner/'+f.documentId)).slice();
 const other={uid:'unselected',currency,account_id:{iban:'SE4550000000058398257466'}};
 const identifier={scheme_name:scheme,identification:account};
 if(location==='account_id.other')other.account_id.other=identifier;else other.all_account_ids=[identifier];
 f.accounts.push(other);
 const response=await actualRoute.POST(request(f.command)),out=await response.json();
 assert.equal(response.status,400,JSON.stringify(out));assert.match(out.error,/mottagarkonto|kontoalias|medgivande/i);
 assert.deepEqual(stored(f),before);assert.equal(audit(f).length,0);assert.equal(f.sqlite.prepare('SELECT revision FROM workspaces WHERE owner=?').get('owner').revision,1);
 assert.deepEqual(new Uint8Array(f.objects.get('owner/'+f.documentId)),bytes);
 const row=stored(f).transactions.find(row=>row.specification);assert.equal(row.payerReference,'0599');assert.equal(row.party,'Syntetiskt café AB');assert.equal(row.recipientAccount,account);
 f.accounts=f.accounts.filter(resource=>resource.uid==='selected');
 const restored=await actualRoute.POST(request(f.command)),accepted=await restored.json();assert.equal(restored.status,200,JSON.stringify(accepted));
 assert.equal(accepted.state.bankgiroLinks.length,1);assert.equal(accepted.state.allocations.length,0);assert.deepEqual(finances(accepted.state),finances(before));assert.equal(audit(f).length,1);
});


for(const alteration of ['none','sequence address','sequence label','payer source'])test('legacy separate-sequence provenance '+alteration+' is checked against the unchanged original',async t=>{
 const f=fixture(t,{report:{mutate:wb=>{const sheet=wb.Sheets['Insättningsuppgift'];sheet.E11={t:'s',v:'Löpnummer'};sheet.E12={t:'s',v:'00041'};}}}),legacy=structuredClone(f.seed),row=legacy.transactions.find(item=>item.specification),cells=JSON.parse(row.reportEvidence.sourceCells);
 cells.sequence=cells.sequenceLabel;delete cells.sequenceLabel;
 if(alteration==='sequence address')cells.sequence.address='E10';
 if(alteration==='sequence label')cells.sequence.rawValue='Annan rubrik';
 if(alteration==='payer source')cells.party.address='A20';
 row.reportEvidence.sourceCells=JSON.stringify(cells);
 f.sqlite.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(legacy));
 const response=await actualRoute.POST(request(f.command)),out=await response.json();
 if(alteration==='none'){
  assert.equal(response.status,200,out.error);assert.ok(activeBankgiroLink(out.state,f.command.transactionId));assert.deepEqual(finances(out.state),finances(legacy));assert.equal(audit(f).length,1);
  const retained=out.state.transactions.find(item=>item.id===row.id);assert.equal(retained.payerReference,'0599');assert.equal(retained.reportEvidence.sequence,'00041');assert.equal(retained.reportEvidence.sourceCells,row.reportEvidence.sourceCells);
 }else{assert.equal(response.status,400,JSON.stringify(out));assert.match(out.error,/original|uppgifter/i);assert.deepEqual(stored(f),legacy);assert.equal(audit(f).length,0);}
});
