import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState,applyCommand} from '../lib/domain.ts';
import {extractPaymentReferences} from '../lib/payment-references.js';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [name,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(value));
 return data(code);
}
const domain=url('../lib/domain.ts');
const parsers=compiled('../lib/imports.ts',{'./domain':domain,'./local-ocr':data('export async function imageText(){};export async function pdfInvoiceText(){}'),'./payment-references.js':url('../lib/payment-references.js'),'./bankgiro-parser.js':url('../lib/bankgiro-parser.js')});
const parser=await import(parsers);
const env=data('export const env=new Proxy({}, {get:(_,key)=>globalThis.bankFileProvenance.env[key]});');
const server=compiled('../lib/server.ts',{'cloudflare:workers':env,'@/app/chatgpt-auth':data('export async function getChatGPTUser(){return globalThis.bankFileProvenance.user;}'),'./domain':domain,'./imports':parsers});
const presentation=await import(compiled('../lib/payment-presentation.ts',{'./domain':domain,'./payment-references.js':url('../lib/payment-references.js'),'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')}));
const reconciliation=await import(compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')}));
const route=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/bankgiro-service':data('export async function readBankgiroOriginal(){throw Error("Unused");}'),'@/lib/reconciliation':data('export const reconcileState=state=>({state,decisions:[]});'),'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){}')}));
const csv='Datum;Belopp;Betalare;OCR;Referens;Valuta\n2026-10-26;625,00;Verklig kund AB;000018;BANK-ID;SEK';
const forgedRow={date:'2026-10-25',amount:1,currency:'SEK',party:'Påhittad kund AB',payerReference:'999998',referenceEvidence:extractPaymentReferences({ocr:'999998'}),bankReference:'FORGED',kind:'payment',verified:true};
async function fixture(t,filename='Bank.csv',body=csv,mime='text/csv'){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('CREATE TABLE workspaces(owner TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT,created_at TEXT);CREATE TABLE audit_events(id TEXT,owner TEXT,revision INTEGER,action TEXT,detail TEXT,created_at TEXT);');
 const DB={prepare(statement){return{bind(...args){return{async first(){return sql.prepare(statement).get(...args)||null;},async all(){return{results:sql.prepare(statement).all(...args)};},async run(){return{meta:{changes:sql.prepare(statement).run(...args).changes}};}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const bytes=new TextEncoder().encode(body),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),objects=new Map([['owner/original',bytes]]);
 sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('original','owner',filename,mime,bytes.length,hash,'at');
 sql.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('owner',1,JSON.stringify(emptyState()),'at');
 const f={sql,objects,user:{userId:'owner'},env:{DB,BUCKET:{async get(key){const value=objects.get(key);return value?{size:value.length,arrayBuffer:async()=>value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)}:null;}}}};globalThis.bankFileProvenance=f;return f;
}
const request=(command,revision=1)=>new Request('https://mg.test/api/state',{method:'POST',headers:{Origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({revision,requestId:crypto.randomUUID(),command})});
const command=extra=>({type:'transactions.import',documentId:'original',hash:'forged-hash',name:'forged-name.csv',account:'Swedbank',rows:[forgedRow],mapping:parser.guessMapping(parser.parseCSV(csv).headers),...extra});

test('generic CSV confirmation reparses original instead of trusting browser payer, OCR, amount or provenance',async t=>{
 const f=await fixture(t),response=await route.POST(request(command({trustedBankImport:true,trustedBankFileImport:true}))),result=await response.json();
 assert.equal(response.status,200);const tx=result.state.transactions[0];assert.equal(tx.party,'Verklig kund AB');assert.equal(tx.payerReference,'000018');assert.equal(tx.amount,62500);assert.equal(tx.bankReference,'BANK-ID');assert.equal(tx.evidence,'bank_file');
 assert.equal(presentation.bankPaymentView(result.state,tx).payer,'Verklig kund AB');assert.equal(presentation.bankPaymentView(result.state,tx).reference.ocr,'000018');assert.equal(tx.verified,false);assert.equal(result.state.imports[0].name,'Bank.csv');assert.notEqual(result.state.imports[0].hash,'forged-hash');
 assert.doesNotMatch(JSON.stringify(tx),/Påhittad|999998|FORGED/);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,1);
});

test('an owned invoice PDF cannot turn arbitrary browser fields into bank-file facts',async t=>{
 const f=await fixture(t,'Invoice.pdf','%PDF-1.7 synthetic','application/pdf'),response=await route.POST(request(command()));
 assert.equal(response.status,400);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,0);
});

test('attaching a document ID alone grants no bank-file evidence inside the domain',()=>{
 const s=applyCommand(emptyState(),command()).state,tx=s.transactions[0];assert.notEqual(tx.evidence,'bank_file');assert.equal(presentation.bankPaymentView(s,tx).payer,'Betalare okänd');assert.equal(presentation.bankPaymentView(s,tx).reference.ocr,'');
});

test('generic CSV does not accept malformed quotes, ambiguous headers, widths or reused columns',()=>{
 for(const text of [csv.replace('Verklig kund AB','Verklig "kund" AB'),csv+';extra',csv.replace(';OCR;',';OCR;OCR;').replace(';000018;',';000018;999998;')])assert.throws(()=>{const parsed=parser.parseCSV(text);parser.mapCSV(parsed,parser.guessMapping(parsed.headers),'Bank.csv');});
 const parsed=parser.parseCSV(csv),mapping=parser.guessMapping(parsed.headers);assert.throws(()=>parser.mapCSV(parsed,{...mapping,party:mapping.payerReference},'Bank.csv'));
});

test('changed original bytes, missing original and foreign owner fail without changing finances',async t=>{
 for(const mode of ['tampered','missing','foreign']){
  const f=await fixture(t);if(mode==='tampered')f.objects.set('owner/original',new TextEncoder().encode(csv.replace('000018','999998')));if(mode==='missing')f.objects.clear();if(mode==='foreign')f.user={userId:'other'};
  const response=await route.POST(request(command(),mode==='foreign'?0:1));assert.equal(response.status,400);assert.equal(f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get('owner').revision,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,0);
 }
});

test('generic camt imports preserve original bank account and facts despite forged browser fields',async t=>{
 const xml='<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>SE4280000890119146168423</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>ORIGINAL-ID</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Bankens kund AB</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Faktura 0599</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>';
 await fixture(t,'Original.xml',xml,'application/xml');const response=await route.POST(request(command({account:'wrong-account',mapping:undefined}))),result=await response.json();assert.equal(response.status,200);const tx=result.state.transactions[0];assert.equal(tx.account,'iban:SE4280000890119146168423');assert.equal(tx.party,'Bankens kund AB');assert.equal(tx.amount,62500);assert.equal(tx.bankReference,'ORIGINAL-ID');assert.equal(tx.evidence,'bank_file');assert.equal(tx.verified,false);
});

test('manual rows remain manual and cannot supply either internal trust flag',async t=>{
 await fixture(t);const bankFileProof={version:'bank-file-original-v1',documentId:'original',sha256:'a'.repeat(64)},response=await route.POST(request(command({documentId:'',trustedBankImport:true,trustedBankFileImport:true,bankFileProof,rows:[{...forgedRow,bankFileProof}]}))),result=await response.json();assert.equal(response.status,200);const tx=result.state.transactions[0];assert.equal(tx.party,forgedRow.party);assert.equal(tx.verified,false);assert.equal(tx.evidence,undefined);assert.equal(tx.bankFileProof,undefined);assert.equal(presentation.bankPaymentView(result.state,tx).payer,'Betalare okänd');assert.equal(presentation.bankPaymentView(result.state,tx).reference.ocr,'');
});

test('mapping cannot relabel an unrelated original column as bank payer or OCR',async t=>{
 const f=await fixture(t);for(const key of ['party','payerReference']){const mapping=parser.guessMapping(parser.parseCSV(csv).headers);mapping[key]=mapping.bankReference;mapping.bankReference=-1;const response=await route.POST(request(command({mapping})));assert.equal(response.status,400);}assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);
});

test('missing original currency is never silently supplied as SEK',()=>{
 const parsed=parser.parseCSV(csv.replace(';Valuta','').replace(';SEK',''));assert.throws(()=>parser.mapCSV(parsed,parser.guessMapping(parsed.headers),'Bank.csv'),/valuta/);
});

test('legacy bank-file labels alone prove neither payer nor OCR and cannot authorize automation',()=>{
 let s=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Verklig kund AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-11-01',reviewed:true}}).state;
 s=applyCommand(s,{type:'transactions.import',documentId:'legacy-document',rows:[{...forgedRow,date:'2026-10-26',amount:62500,party:'Verklig kund AB',payerReference:'000018',referenceEvidence:extractPaymentReferences({ocr:'000018'}),kind:'payment',verified:true}]}).state;
 const tx=s.transactions[0];tx.evidence='bank_file';tx.referenceEvidence=extractPaymentReferences({ocr:'000018'});tx.verified=true;
 const before=structuredClone(s),view=presentation.bankPaymentView(s,tx);assert.equal(view.payer,'Betalare okänd');assert.equal(view.reference.ocr,'');assert.match(view.status,/original|verifier/i);assert.ok(reconciliation.analyze(s).every(f=>!f.safe));assert.deepEqual(s,before);
 assert.throws(()=>applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:tx.id,amount:62500,note:'Försök utan återläst original'}),/original/i);
 assert.throws(()=>applyCommand(s,{type:'transaction.verify',id:tx.id,note:'Försök utan återläst original'}),/original/i);
});

test('same original hash can revalidate an exact legacy row without duplicating money',async t=>{
 const f=await fixture(t),first=await (await route.POST(request(command()))).json();const legacy=first.state;delete legacy.transactions[0].bankFileProof;
 f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(legacy),'owner');
 const response=await route.POST(request(command(),2)),result=await response.json();assert.equal(response.status,200);assert.equal(result.state.transactions.length,1);assert.equal(result.state.imports.length,1);assert.equal(result.state.allocations.length,0);
 const tx=result.state.transactions[0];assert.equal(tx.bankFileProof.version,'bank-file-original-v1');assert.equal(tx.bankFileProof.documentId,'original');assert.match(tx.bankFileProof.sha256,/^[a-f0-9]{64}$/);assert.equal(presentation.bankPaymentView(result.state,tx).payer,'Verklig kund AB');
});

test('conflicting legacy rows remain preserved and unknown when original revalidation disagrees',async t=>{
 const f=await fixture(t),first=await (await route.POST(request(command()))).json();const legacy=first.state;delete legacy.transactions[0].bankFileProof;legacy.transactions[0].party='Legacy påhittat';legacy.transactions[0].original.party='Legacy påhittat';
 f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(legacy),'owner');const response=await route.POST(request(command(),2));assert.equal(response.status,400);
 const stored=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get('owner').payload);assert.deepEqual(stored,legacy);assert.equal(stored.transactions.length,1);assert.equal(presentation.bankPaymentView(stored,stored.transactions[0]).payer,'Betalare okänd');
});

test('generic file identity never verifies the account without a fresh manual original review',async t=>{
 await fixture(t);const first=await (await route.POST(request(command()))).json();let s=applyCommand(first.state,{type:'invoice.save',invoice:{direction:'receivable',party:'Verklig kund AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-11-01',reviewed:true}}).state;
 s.transactions[0].verified=true;s.transactions[0].kind='payment';assert.ok(reconciliation.analyze(s).every(f=>!f.safe));assert.throws(()=>applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:s.transactions[0].id,amount:62500,note:'Utan kontokontroll'}),/konto|bankoriginal/i);
 s=applyCommand(s,{type:'transaction.verify',id:s.transactions[0].id,note:'Bankoriginalets mottagarkonto, datum, valuta, riktning, betalare och referens kontrollerade'}).state;
 assert.ok(s.transactions[0].bankFileProof.reviewedAt);assert.equal(reconciliation.reconcileState(s).state.allocations.length,1);
});

test('CSV account from the original is retained ahead of a browser account alias',async t=>{
 await fixture(t,'Bank.csv',csv.replace(';Valuta',';Valuta;Konto').replace(';SEK',';SEK;SE4280000890119146168423'));
 const result=await (await route.POST(request(command({account:'client-chosen-alias'})))).json();assert.equal(result.state.transactions[0].account,'iban:SE4280000890119146168423');assert.equal(result.state.transactions[0].verified,false);assert.equal(result.state.transactions[0].bankFileProof.reviewedAt,undefined);
});
