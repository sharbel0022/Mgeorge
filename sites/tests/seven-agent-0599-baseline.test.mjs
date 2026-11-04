import {isReadOnlySql} from './helpers/company-compat-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCommand,balance,economicTransactions,emptyState} from '../lib/domain.ts';
import {randomToken} from '../lib/banking/security.ts';

// Current runtime baseline 73662187: this joins existing services, not the
// proposed CompanyReferencePolicy or BankgiroReportSource (neither exists yet).
// Only Worker bindings/auth and the network boundary are substituted. Parser,
// encrypted account store, financial rules/commit fence, candidate API and UI
// are real. No live provider, Gmail, scheduler or new-source coverage is claimed.
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{
  fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}
 }).outputText;
 for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
const domain=local('../lib/domain.ts'),engine=local('../lib/reconciliation-engine.js');
const environment=data('export const env=new Proxy({}, {get:(_,key)=>globalThis.sevenAgentBaselineFixture.env[key]});');
const auth=data('export async function getChatGPTUser(){return globalThis.sevenAgentBaselineFixture.user;}');
const server=compiled('../lib/server.ts',{'./company-storage.js':new URL('../lib/company-storage.js',import.meta.url).href,'cloudflare:workers':environment,'@/app/chatgpt-auth':auth,'./domain':domain});
const normalizer=compiled('../lib/banking/transactions.ts',{
 '../domain':domain,'../payment-references.js':local('../lib/payment-references.js'),'../payer-evidence.js':local('../lib/payer-evidence.js')
});
const storeUrl=compiled('../lib/banking/store.ts',{
 'cloudflare:workers':environment,'@/lib/server':server,'./security':local('../lib/banking/security.ts'),'./runtime-config':local('../lib/banking/runtime-config.ts')
});
const bankgiroUrl=compiled('../lib/bankgiro-service.ts',{
 './server':server,'./domain':domain,'./bankgiro-parser.js':local('../lib/bankgiro-parser.js'),'./banking/store':storeUrl,'./banking/transactions':normalizer
});
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const evidenceUrl=compiled('../lib/reconciliation-evidence.ts',{
 './server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':bankgiroUrl
});
const presentationUrl=compiled('../lib/payment-presentation.ts',{
 './domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':local('../lib/payment-references.js')
});
const candidatesUrl=compiled('../lib/banking/invoice-candidates.ts',{
 '../domain':domain,'../reconciliation-engine.js':engine,'../payment-presentation':presentationUrl
});
const reactImports={'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')};
const pagination=compiled('../components/list-pagination.tsx',reactImports);
const {default:BankPayments}=await import(compiled('../components/bank-payments.tsx',{
 ...reactImports,'@/lib/domain':domain,'@/lib/payment-presentation':presentationUrl,'./list-pagination':pagination,'./bankgiro-availability':compiled('../components/bankgiro-availability.tsx',reactImports)
}));
const {normalizeTransactions,stableAccountKey}=await import(normalizer);
const store=await import(storeUrl),bankgiro=await import(bankgiroUrl),evidence=await import(evidenceUrl);
const {bankPaymentView,bankVisibleTransactions}=await import(presentationUrl);
const files=await import(compiled('../app/api/files/route.ts',{'cloudflare:workers':environment,'@/lib/server':server,'@/lib/domain':domain}));
const candidateApi=await import(compiled('../app/api/bank/invoice-candidates/route.ts',{'@/lib/server':server,'@/lib/banking/invoice-candidates':candidatesUrl}));

const owner='synthetic-seven-agent-owner',connectionId='synthetic-seven-agent-connection';
const iban='SE4280000890119146168423',accountAlias='8000000123456789';
const depositId='SYNTHETIC-0599-DEPOSIT',paymentId='SYNTHETIC-0599-PAYMENT';
const payer='Synthetic bank payer AB',invoiceParty='Synthetic invoice customer AB';
const bank={name:'Synthetic bank',country:'SE'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rawDeposit={
 entry_reference:depositId,transaction_id:'synthetic-provider-lookup-1',status:'BOOK',booking_date:'2026-10-26',
 transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',
 bank_transaction_code:{description:'Bankgiro inbetalning'},remittance_information:['Bankgiro inbetalning']
};
const accountResource=withAlias=>({uid:'selected',currency:'SEK',account_id:{iban},
 ...(withAlias?{all_account_ids:[{scheme_name:'BBAN',identification:accountAlias}]}:{})});
function reportBytes({reference='0599',entryReference=depositId}={}){
 return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn>
 <Ntfctn><Id>SYNTHETIC-REPORT-0599</Id><Acct><Id><Othr><Id>${accountAlias}</Id></Othr></Id><Ccy>SEK</Ccy></Acct>
  <Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt>
   ${entryReference?`<AcctSvcrRef>${entryReference}</AcctSvcrRef>`:''}
   <NtryDtls><Btch><NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt><CdtDbtInd>CRDT</CdtDbtInd></Btch>
    <TxDtls><Refs><TxId>${paymentId}</TxId></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">625.00</Amt></TxAmt></AmtDtls>
     <RltdPties><Dbtr><Nm>${payer}</Nm></Dbtr></RltdPties>
     <RmtInf><Strd><RfrdDocInf><Nb>${reference}</Nb></RfrdDocInf></Strd></RmtInf>
    </TxDtls>
   </NtryDtls>
  </Ntry>
 </Ntfctn>
</BkToCstmrDbtCdtNtfctn></Document>`);
}

async function fixture(t,{withAlias=true}={}){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const objects=new Map(),f={sqlite,objects,beforeBatch:null,user:{userId:owner},effects:{d1Writes:0,r2Writes:0,fetchCalls:0}};
 // The current candidate path uses plain SELECTs. Count other SQL as a write
 // attempt, even when it changes no rows or its failure is caught by the route.
 const statement=sql=>{if(!isReadOnlySql(sqlite,sql))f.effects.d1Writes++;return sqlite.prepare(sql);};
 const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
  async first(){return statement(sql).get(...this.args)||null;},
  async all(){return {results:statement(sql).all(...this.args)};},
  async run(){return this.execute();},execute(){return {success:true,meta:{changes:Number(statement(sql).run(...this.args).changes)}};}
 };},async batch(statements){
  if(f.beforeBatch)await f.beforeBatch();
  sqlite.exec('BEGIN');try{const result=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return result;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
 const BUCKET={async put(key,bytes){f.effects.r2Writes++;objects.set(key,new Uint8Array(bytes).slice());},
  async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,body:bytes.slice(),arrayBuffer:async()=>bytes.slice().buffer}:null;},
  async delete(key){f.effects.r2Writes++;objects.delete(key);}
 };
 f.env={DB,BUCKET,BANK_DATA_ENCRYPTION_KEY:randomToken(),ENABLE_BANKING_APPLICATION_ID:'11111111-1111-4111-8111-111111111111',
  ENABLE_BANKING_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nU1lOVEhFVElDLU5PVC1BLVJFQUwtS0VZ\n-----END PRIVATE KEY-----',
  ENABLE_BANKING_ENVIRONMENT:'PRODUCTION',ENABLE_BANKING_KEY_ROTATED:'true'};
 globalThis.sevenAgentBaselineFixture=f;
 t.after(()=>{delete globalThis.sevenAgentBaselineFixture;sqlite.close();});
 t.mock.method(globalThis,'fetch',async()=>{f.effects.fetchCalls++;throw Error('Network access is forbidden in the synthetic baseline test');});
 const app=await store.application(owner),at='2026-10-26T12:00:00Z';
 const encryptedSession=await store.encrypt(owner,'session:'+connectionId,'synthetic-session');
 const encryptedAccounts=await store.encrypt(owner,'accounts:'+connectionId,[accountResource(withAlias)]);
 sqlite.prepare('INSERT INTO bank_connections (id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(connectionId,owner,app.generation,'PRODUCTION',bank.name,bank.country,encryptedSession,encryptedAccounts,'["selected"]','2099-01-01T00:00:00Z','2026-10-01','connected',at,at);
 f.normalize=raw=>normalizeTransactions([raw],{accountKey:stableAccountKey(accountResource(true),bank),accountLabel:'Synthetic selected account',bankName:bank.name,dateFrom:'2026-10-01',dateTo:'2026-10-31'});
 const normalized=await f.normalize(rawDeposit);
 assert.deepEqual(normalized.skipped,{pending:0,nonSek:0,invalid:0,unstableId:0});
 let state=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;
 // Both equal-amount invoices are deliberate controls. Exact identifiers may
 // propose one; a different bank payer cannot establish a customer relation.
 for(const number of ['0599','599'])state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',number,ocr:'',party:invoiceParty,total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 sqlite.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,1,JSON.stringify(state),at);
 f.seed=structuredClone(state);
 f.read=()=>{const row=sqlite.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(owner);return {revision:row.revision,state:JSON.parse(row.payload)};};
 f.audit=()=>sqlite.prepare('SELECT * FROM audit_events ORDER BY revision').all();
 f.upload=async(bytes,name='synthetic-0599.xml')=>{
  const form=new FormData();form.set('file',new File([bytes],name));
  const response=await files.POST(new Request('https://mg.test/api/files',{method:'POST',headers:{Origin:'https://mg.test'},body:form}));
  const result=await response.json();assert.equal(response.status,200,result.error);return result;
 };
 // Compose the actual import/reconciliation and financial writer without
 // loading state POST's optional Gmail-search/customer-message orchestration.
 // Only its caller-owned workspace CAS/audit SQL is supplied by this fixture.
 f.commit=async(command)=>{
  const before=f.read(),imported=applyCommand(before.state,command),checked=await evidence.reconcileWithOriginals(owner,imported.state);
  const result=await evidence.writePaymentState(owner,before.revision,before.state,checked.state,DB,[
   DB.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND revision=?)')
    .bind(crypto.randomUUID(),owner,before.revision+1,command.type,JSON.stringify({message:imported.message}),at,owner,before.revision),
   DB.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?')
    .bind(JSON.stringify(checked.state),at,owner,before.revision)
  ]);
  assert.equal(result[1].meta.changes,1);return f.read().state;
 };
 f.importReport=async(documentId,extra={})=>f.commit(await bankgiro.readBankgiroOriginal(owner,{type:'bankgiro.import',documentId,...extra}));
 return f;
}
function conserved(state){
 assert.equal(economicTransactions(state).length,1);
 assert.equal(economicTransactions(state).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.deepEqual(state.allocations,[]);
 assert.deepEqual(state.invoices.map(invoice=>[invoice.number,balance(state,invoice)]),[['0599',62500],['599',62500]]);
}
async function candidatesWithoutWrites(f,payment){
 const before=f.read(),audit=f.audit(),snapshot=structuredClone(before.state),effects={...f.effects};
 const response=await candidateApi.GET(),body=await response.json();assert.equal(response.status,200,body.error);
 const candidates=body.candidates[payment.id]||[],view=bankPaymentView(before.state,payment,candidates);
 const html=renderToStaticMarkup(React.createElement(BankPayments,{state:before.state,transactions:bankVisibleTransactions(before.state),candidates:body.candidates,open(){throw Error('A read cannot open a mutation');}}));
 assert.deepEqual(before.state,snapshot);assert.deepEqual(f.read(),before);assert.deepEqual(f.audit(),audit);conserved(f.read().state);
 assert.deepEqual(f.effects,effects,'candidate lookup and UI must not attempt D1/R2 writes or network access');
 return {candidates,view,html};
}

// Catches broken original parsing/provenance, a guessed alias/deposit relation,
// lossy reference matching, false OCR/paid labels, and duplicate economic money.
test('current baseline 0599: AIS deposit, retained report, exact candidate and payment UI conserve money on replay',async t=>{
 const f=await fixture(t),bytes=reportBytes(),before=f.read(),ais=f.seed.transactions[0];
 assert.equal(ais.kind,'batch');assert.equal(ais.payerReference,'Bankgiro inbetalning');assert.equal(ais.bankReference,depositId);
 assert.equal(bankPaymentView(f.seed,ais).reference.value,'');
 assert.equal(ais.account,'iban:'+iban);assert.equal(ais.bankDataSha256,hash(JSON.stringify(rawDeposit)));assert.deepEqual(ais.bankData,rawDeposit);
 const saved=await f.upload(bytes),download=await files.GET(new Request('https://mg.test/api/files?id='+saved.id));
 assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),bytes);assert.equal(saved.sha256,hash(bytes));
 assert.deepEqual(f.read(),before);assert.equal(f.audit().length,0);
 const state=await f.importReport(saved.id,{hash:'client-hash',name:'client-name.csv',rows:[{amount:1,payerReference:'599'}]}),payment=state.transactions.find(row=>row.specification);
 assert.equal(state.transactions.length,2);assert.equal(payment.specificationStatus,'linked');assert.equal(payment.parentId,ais.id);
 assert.equal(payment.account,'iban:'+iban);assert.equal(payment.recipientAccount,accountAlias);assert.equal(payment.bankgiroAccountIssue,'');
 assert.equal(payment.parentBankReference,depositId);assert.equal(payment.bankReference,paymentId);assert.equal(payment.specificationCount,1);assert.equal(payment.specificationTotal,62500);
 assert.equal(payment.payerReference,'0599');assert.equal(payment.party,payer);assert.equal(payment.amount,62500);assert.equal(payment.verified,true);
 assert.equal(payment.bankFileProof.documentId,saved.id);assert.equal(payment.bankFileProof.sha256,hash(bytes));assert.equal(state.imports.at(-1).name,'synthetic-0599.xml');
 assert.equal(payment.referenceEvidence.selected.kind,'invoice');assert.equal(payment.referenceEvidence.selected.validity,'unchecked');
 assert.equal(payment.referenceEvidence.candidates.some(candidate=>candidate.kind==='ocr'),false);
 assert.deepEqual(state.transactions.find(row=>row.id===ais.id),ais);assert.deepEqual(bankVisibleTransactions(state).map(row=>row.id),[payment.id]);conserved(state);
 const {candidates,view,html}=await candidatesWithoutWrites(f,payment);
 assert.deepEqual(candidates.map(candidate=>[candidate.number,candidate.source]),[['0599','invoice']]);
 assert.equal(candidates[0].invoiceId,state.invoices.find(invoice=>invoice.number==='0599').id);
 assert.equal(view.payer,payer);assert.equal(view.reference.value,'0599');assert.equal(view.reference.kind,'invoice');assert.equal(view.reference.ocr,'');
 assert.equal(view.referenceLabel,'Fakturareferens');assert.deepEqual(view.possible,['0599']);assert.equal(view.invoiceVerified,false);assert.equal(view.verified,false);
 assert.match(html,/<div class="bank-desktop-list">/);assert.match(html,/<div class="bank-mobile-list"/);
 const layouts=html.split('<div class="bank-mobile-list"');assert.equal(layouts.length,2);
 for(const layout of layouts){
  assert.match(layout,/Synthetic bank payer AB/);assert.match(layout,/<strong class="mono">0599<\/strong>/);assert.match(layout,/Fakturareferens/);
  assert.match(layout,/Bank-OCR saknas\./);assert.match(layout,/Möjlig: 0599/);assert.doesNotMatch(layout,/is-verified|Synthetic invoice customer AB/);
 }
 const uploadedAgain=await f.upload(bytes,'renamed-report.xml');assert.equal(uploadedAgain.id,saved.id);assert.equal(uploadedAgain.duplicate,true);
 const repeated=await f.importReport(saved.id);assert.deepEqual(repeated.transactions,state.transactions);assert.deepEqual(repeated.imports,state.imports);assert.equal(f.objects.size,1);conserved(repeated);
 const normalizedAgain=await f.normalize({...rawDeposit,transaction_id:'synthetic-provider-lookup-2'});
 assert.equal(normalizedAgain.rows[0].externalId,ais.externalId);
 const refreshed=await f.commit({type:'transactions.import',trustedBankImport:true,rows:normalizedAgain.rows});
 assert.deepEqual(refreshed.transactions,state.transactions);assert.equal(refreshed.imports.at(-1).count,0);conserved(refreshed);
 assert.deepEqual(f.objects.get(owner+'/'+saved.id),bytes);
});

// Catches numeric coercion or padding that silently reconstructs a lost zero.
test('current baseline 0599: observed 599 does not select or display invoice 0599',async t=>{
 const f=await fixture(t),saved=await f.upload(reportBytes({reference:'599'})),state=await f.importReport(saved.id),payment=state.transactions.find(row=>row.specification);
 assert.equal(payment.specificationStatus,'linked');assert.equal(payment.payerReference,'599');assert.equal(payment.original.payerReference,'599');
 const {candidates,view,html}=await candidatesWithoutWrites(f,payment);
 assert.deepEqual(candidates.map(candidate=>candidate.number),['599']);assert.deepEqual(view.possible,['599']);assert.equal(view.reference.value,'599');
 assert.equal(view.reference.ocr,'');assert.equal(view.invoiceVerified,false);assert.doesNotMatch(html,/Möjlig: 0599|<strong class="mono">0599<\/strong>/);conserved(state);
});

// Equal date/amount/name and a report ID must not substitute for either proof.
for(const [name,options,report] of [
 ['missing current account alias',{withAlias:false},{}],
 ['missing common deposit identifier',{}, {entryReference:''}]
])test('current baseline 0599: '+name+' keeps the report outside economic money',async t=>{
 const f=await fixture(t,options),bytes=reportBytes(report),saved=await f.upload(bytes),state=await f.importReport(saved.id),payment=state.transactions.find(row=>row.specification);
 assert.equal(payment.specificationStatus,'review');assert.equal(payment.parentId,'');assert.equal(payment.verified,false);
 assert.equal(payment.payerReference,'0599');assert.equal(payment.party,payer);assert.equal(payment.recipientAccount,accountAlias);assert.equal(payment.bankFileProof.sha256,hash(bytes));
 if(options.withAlias===false)assert.match(payment.bankgiroAccountIssue,/konto|medgivande/i);
 else{assert.equal(payment.bankgiroAccountIssue,'');assert.equal(payment.parentBankReference,'');assert.equal(payment.reportEvidence.reportId,'SYNTHETIC-REPORT-0599');}
 assert.deepEqual(state.transactions.find(row=>row.id===f.seed.transactions[0].id),f.seed.transactions[0]);
 assert.deepEqual(economicTransactions(state).map(row=>row.id),[f.seed.transactions[0].id]);conserved(state);
 assert.equal(bankPaymentView(state,payment).verified,false);
 const repeated=await f.importReport(saved.id);assert.deepEqual(repeated.transactions,state.transactions);assert.deepEqual(repeated.imports,state.imports);conserved(repeated);
 assert.deepEqual(f.objects.get(owner+'/'+saved.id),bytes);
});

// Catches moving the consent check outside the atomic financial write fence.
test('current baseline 0599: consent revoked before commit rolls back promotion and audit',async t=>{
 const f=await fixture(t),saved=await f.upload(reportBytes()),before=f.read(),audit=f.audit();
 f.beforeBatch=()=>f.sqlite.prepare("UPDATE bank_connections SET selected_accounts='[]' WHERE owner=?").run(owner);
 await assert.rejects(f.importReport(saved.id),error=>error.code==='BANK_CONSENT_CHANGED');
 assert.deepEqual(f.read(),before);assert.deepEqual(f.audit(),audit);conserved(f.read().state);assert.equal(f.objects.size,1);
 f.beforeBatch=null;f.sqlite.prepare('UPDATE bank_connections SET selected_accounts=? WHERE owner=?').run('["selected"]',owner);
 const restored=await f.importReport(saved.id);assert.equal(restored.transactions.find(row=>row.specification).specificationStatus,'linked');conserved(restored);
});

// Catches trusting D1 metadata/client fields without verifying retained bytes.
test('current baseline 0599: changed retained report bytes fail before any financial write',async t=>{
 const f=await fixture(t),saved=await f.upload(reportBytes()),before=f.read(),audit=f.audit(),key=owner+'/'+saved.id;
 const changed=f.objects.get(key).slice();changed[changed.length-1]^=1;f.objects.set(key,changed);
 await assert.rejects(f.importReport(saved.id),/kontrollsumma/i);
 assert.deepEqual(f.read(),before);assert.deepEqual(f.audit(),audit);conserved(f.read().state);
});
