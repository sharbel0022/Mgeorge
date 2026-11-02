import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {applyCommand,balance,emptyState} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

const local=path=>new URL(path,import.meta.url).href,data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [name,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(value));return data(code);}
const domain=local('../lib/domain.ts'),engine=local('../lib/reconciliation-engine.js');
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const {reconcileState}=await import(reconciliation);
const original=Buffer.from('%PDF-Synthetic reviewed invoice 0599, total 625.00 SEK'),hash=createHash('sha256').update(original).digest('hex');
async function fixture(t,{amount=62500,mode='intact',generic=false}={}){
 const owner='synthetic-auto-owner',key='__auto_payment_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT);');
 const DB={prepare(statement){return{bind(...values){return{async first(){return sql.prepare(statement).get(...values)||null;}};}};}};
 const objects=new Map([[owner+'/invoice-original',original]]);
 if(mode==='missing')objects.clear();if(mode==='tampered')objects.set(owner+'/invoice-original',Buffer.from('%PDF-Synthetic reviewed invoice 0599, total 626.00 SEK'));
 sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?)').run('invoice-original',mode==='foreign'?'another-owner':owner,'invoice.pdf','application/pdf',original.length,hash);
 globalThis[key]={env:{DB,BUCKET:{async get(id){const bytes=objects.get(id);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;}}}};
 t.after(()=>{sql.close();delete globalThis[key];});
 let state=emptyState();if(generic)state.company.name='Synthetic Reference Issuer AB';
 state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',number:'0599',ocr:'0599',party:'Synthetic customer AB',total:62500,currency:'SEK',issued:'2026-10-01',due:'2026-10-30',reviewed:true,documentId:mode==='no-document'?'':'invoice-original'}}).state;
 state.transactions=[syntheticBankTransaction({id:'synthetic-payment',amount,party:'Synthetic customer AB',payerReference:'0599',kind:'payment',verified:true,date:'2026-10-26'})];
 const server=compiled('../lib/server.ts',{'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`),'@/app/chatgpt-auth':data('export async function getChatGPTUser(){throw Error("No auth call expected");}'),'./domain':domain});
 const evidence=await import(compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':data('export async function bankgiroAutomaticAccountIssue(){return "";}')}));
 return {state,owner,evidence,objects};
}
for(const mode of ['no-document','missing','tampered','foreign'])test(`active M.George reconciliation keeps ${mode} invoice original in review`,async t=>{
 const f=await fixture(t,{mode}),before=structuredClone(f.state),result=await f.evidence.reconcileWithOriginals(f.owner,f.state);
 assert.equal(result.state.allocations.length,0);assert.equal(balance(result.state,result.state.invoices[0]),62500);assert.ok(result.findings.every(f=>!f.safe));assert.deepEqual(f.state,before);
});
test('pure reconciliation cannot trust a persisted invoice verification flag',async t=>{
 const f=await fixture(t);f.state.invoices[0].invoice_original_verified=true;f.state.invoices[0].invoiceOriginalVerified=true;
 const result=reconcileState(f.state);assert.equal(result.state.allocations.length,0);assert.match(result.findings[0].reason,/Originalfakturan/);
});
test('active exact payment with intact owned invoice original allocates once',async t=>{
 const f=await fixture(t),before=structuredClone(f.state),first=await f.evidence.reconcileWithOriginals(f.owner,f.state),second=await f.evidence.reconcileWithOriginals(f.owner,first.state);
 assert.equal(first.state.allocations.length,1);assert.equal(first.state.allocations[0].amount,62500);assert.equal(second.state.allocations.length,1);assert.equal(balance(first.state,first.state.invoices[0]),0);assert.deepEqual(f.state,before);assert.deepEqual(first.state.transactions,before.transactions);assert.equal('invoiceOriginalVerified' in first.state.invoices[0],false);
});
for(const amount of [25000,70000])test(`active ${amount<62500?'partial':'excess'} payment requires review with intact originals`,async t=>{
 const f=await fixture(t,{amount}),result=await f.evidence.reconcileWithOriginals(f.owner,f.state);
 assert.equal(result.state.allocations.length,0);assert.equal(balance(result.state,result.state.invoices[0]),62500);assert.equal(result.findings[0].safe,false);assert.equal(result.findings[0].kind,amount<62500?'partial':'overpayment');
 const manual=applyCommand(result.state,{type:'match.create',invoiceId:f.state.invoices[0].id,transactionId:f.state.transactions[0].id,amount:Math.min(amount,62500),note:'Synthetic independently reviewed partial/excess payment'}).state;
 assert.equal(manual.allocations[0].amount,Math.min(amount,62500));
});
test('generic reviewed manual invoice still permits exact automatic payment without a document',async t=>{
 const f=await fixture(t,{mode:'no-document',generic:true}),result=await f.evidence.reconcileWithOriginals(f.owner,f.state);
 assert.equal(result.state.allocations.length,1);assert.equal(balance(result.state,result.state.invoices[0]),0);
});
test('existing manual partial amount is preserved and exact remaining payment can settle invoice',async t=>{
 const f=await fixture(t,{amount:37500}),historical=syntheticBankTransaction({id:'historical-payment',amount:25000,party:'Synthetic customer AB',payerReference:'0599',date:'2026-10-25',kind:'payment',verified:true,bankReference:'HISTORICAL'});
 f.state.transactions.push(historical);f.state.allocations=[{id:'manual-historical',invoiceId:f.state.invoices[0].id,transactionId:historical.id,amount:25000,effect:'payment',active:true,note:'Synthetic historical reviewed partial',createdAt:'2026-10-25T00:00:00Z'}];
 const before=structuredClone(f.state.allocations[0]),result=await f.evidence.reconcileWithOriginals(f.owner,f.state);
 assert.equal(result.state.allocations.length,2);assert.deepEqual(result.state.allocations[0],before);assert.equal(result.state.allocations[1].amount,37500);assert.equal(balance(result.state,result.state.invoices[0]),0);
});
