import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {emptyState,applyCommand,balance,paymentOriginalIssue} from '../lib/domain.ts';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));return data(code);}
const domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js');
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const iban='SE4280000890119146168423',account='iban:'+iban;
function seed(){
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,party:'Synthetic customer AB',payerReference:'000018',bankReference:'CONSENT-SYNTHETIC-ENTRY',kind:'payment',verified:true})]}).state;
}
async function fixture(t){
 const key='__payment_consent_'+crypto.randomUUID().replaceAll('-','');
 const f={checks:0,connection:{owner:'synthetic-owner',status:'connected',environment:'PRODUCTION',valid_until:'2099-01-01T00:00:00Z',app_generation:'generation',selected_accounts:'["selected"]',bank_name:'Synthetic bank',country:'SE'},application:{owner:'synthetic-owner',generation:'generation'},accounts:[{uid:'selected',currency:'SEK',account_id:{iban}}]};globalThis[key]=f;t.after(()=>delete globalThis[key]);
 const store=data(`const f=globalThis[${JSON.stringify(key)}];export async function connection(){f.checks++;return f.connection;}export async function application(){return f.application;}export async function accounts(){return f.accounts;}`);
 const server=data('export async function readBankOriginalBytes(){throw Error("No file is requested for a retained API original");}export async function readWorkspace(){throw Error("No workspace read is needed in this fixture");}');
 const service=compiled('../lib/bankgiro-service.ts',{'./domain':domain,'./server':server,'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':data('export function stableAccountKey(a){return "iban:"+a.account_id.iban;}')});
 f.evidence=await import(compiled('../lib/reconciliation-evidence.ts',{'./domain':domain,'./server':server,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':service}));return f;
}
const invalid=[
 ['missing connection',f=>{f.connection=null;}],
 ['expired consent',f=>{f.connection.valid_until='2000-01-01T00:00:00Z';}],
 ['disconnected consent',f=>{f.connection.status='disconnected';}],
 ['foreign owner',f=>{f.connection.owner='another-owner';}],
 ['foreign application',f=>{f.application.owner='another-owner';}],
 ['missing application',f=>{f.application=null;}],
 ['wrong application generation',f=>{f.connection.app_generation='old-generation';}],
 ['test environment',f=>{f.connection.environment='SANDBOX';}],
 ['deselected account',f=>{f.connection.selected_accounts='[]';}],
 ['invalid selected accounts',f=>{f.connection.selected_accounts='{}';}],
 ['wrong receiving account',f=>{f.accounts[0].account_id.iban='SE4550000000058398257466';}],
 ['wrong account currency',f=>{f.accounts[0].currency='EUR';}],
 ['ambiguous receiving account',f=>{f.accounts.push(structuredClone(f.accounts[0]));}]
];
for(const [label,mutate] of invalid)test('current '+label+' blocks an intact AIS payment before automatic or explicit allocation',async t=>{
 const f=await fixture(t);mutate(f);const state=seed(),before=structuredClone(state);
 const preview=await f.evidence.reconciliationPreviewWithOriginals('synthetic-owner',state);
 assert.equal(preview.automatic_candidates,0,label);assert.ok(preview.findings.some(item=>/konto|medgivande|bankanslutning/i.test(item.reason)));
 const result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);
 assert.equal(result.state.allocations.length,0);assert.equal(balance(result.state,result.state.invoices[0]),62500);
 assert.match(result.state.transactions[0].bankAccountIssue,/konto|medgivande|bankanslutning/i);
 assert.equal(result.state.transactions[0].bankOriginalIssue,undefined);assert.equal(paymentOriginalIssue(result.state,result.state.transactions[0]),'');
 await assert.rejects(f.evidence.assertPaymentOriginal('synthetic-owner',state,state.transactions[0].id),/konto|medgivande|bankanslutning/i);
 assert.deepEqual(state,before);assert.ok(f.checks>=3);
});
test('current account check accepts one exact selected owned account and caches it only for this request',async t=>{
 const f=await fixture(t),state=seed();const result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);
 assert.equal(result.state.allocations.length,1);assert.equal(balance(result.state,result.state.invoices[0]),0);assert.equal(f.checks,1);
 await f.evidence.assertPaymentOriginal('synthetic-owner',state,state.transactions[0].id);assert.equal(f.checks,2);
});
test('restored consent clears its own hold, preserves the receipt and allocates exactly once',async t=>{
 const f=await fixture(t),state=seed(),receipt=structuredClone(state.transactions[0].bankData);f.connection.status='disconnected';
 const blocked=await f.evidence.reconcileWithOriginals('synthetic-owner',state);assert.equal(blocked.state.allocations.length,0);
 f.connection.status='connected';const recovered=await f.evidence.reconcileWithOriginals('synthetic-owner',blocked.state);
 assert.equal(recovered.state.transactions[0].bankAccountIssue,undefined);assert.equal(recovered.state.transactions[0].bankOriginalIssue,undefined);
 assert.deepEqual(recovered.state.transactions[0].bankData,receipt);assert.equal(recovered.state.allocations.length,1);
 assert.equal((await f.evidence.reconcileWithOriginals('synthetic-owner',recovered.state)).state.allocations.length,1);
});
test('a manually split payment inherits its AIS parent account prerequisite',async t=>{
 const f=await fixture(t),base=seed(),state=applyCommand(base,{type:'transaction.split',id:base.transactions[0].id,rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]}).state,child=state.transactions.find(row=>row.parentId);f.connection.status='disconnected';
 const before=structuredClone(state),result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);
 assert.equal(result.state.allocations.length,0);assert.match(result.state.transactions[0].bankAccountIssue,/konto|medgivande|bankanslutning/i);
 await assert.rejects(f.evidence.assertPaymentOriginal('synthetic-owner',state,child.id));assert.deepEqual(state,before);
});
test('loss of account consent cannot reverse a recorded allocation or replace its original',async t=>{
 const f=await fixture(t),allocated=(await f.evidence.reconcileWithOriginals('synthetic-owner',seed())).state,before=structuredClone(allocated);f.connection=null;
 const result=await f.evidence.reconcileWithOriginals('synthetic-owner',allocated);
 assert.deepEqual(result.state.allocations,before.allocations);assert.equal(balance(result.state,result.state.invoices[0]),0);
 assert.deepEqual(result.state.transactions[0].original,before.transactions[0].original);assert.deepEqual(allocated,before);
});
test('integrity-only availability check remains separate from current consent and never writes',async t=>{
 const f=await fixture(t),state=seed(),before=structuredClone(state);f.connection=null;
 assert.equal(await f.evidence.paymentOriginalAvailabilityIssue('synthetic-owner',state,state.transactions[0].id),'');assert.equal(f.checks,0);assert.deepEqual(state,before);
 delete state.transactions[0].bankDataSha256;assert.match(await f.evidence.paymentOriginalAvailabilityIssue('synthetic-owner',state,state.transactions[0].id),/original|kvitto/i);
});
for(const connected of [false,true])test('a learned payer relation rechecks its previous payment account: '+connected,async t=>{
 const f=await fixture(t);let state=seed();
 // An explicit earlier customer decision is separate from the provider's payer.
 const received=syntheticBankRow({account,date:'2026-10-26',amount:62500,party:'Synthetic third-party payer',payerReference:'000018',bankReference:'CONSENT-LEARNED-SOURCE',kind:'payment',verified:true});
 state=applyCommand({...emptyState(),invoices:structuredClone(state.invoices)},{type:'transactions.import',trustedBankImport:true,rows:[received]}).state;
 state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:62500,note:'Earlier separately reviewed synthetic payer relation.'}).state;
 state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0600',ocr:'000026',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,party:'Synthetic third-party payer',payerReference:'000026',bankReference:'CONSENT-LEARNED-TARGET',kind:'payment',verified:true})]}).state;
 // A stale status is never reused as current permission or permanent rejection.
 state.transactions[0].bankAccountIssue='Earlier account access could not be checked.';
 if(!connected)f.connection.status='disconnected';const before=structuredClone(state),result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);
 assert.equal(result.state.allocations.length,connected?2:1);assert.equal(balance(result.state,result.state.invoices[1]),connected?0:62500);
 assert.equal(!!result.state.transactions[0].bankAccountIssue,!connected);assert.deepEqual(result.state.allocations[0],before.allocations[0]);
 assert.deepEqual(state,before);assert.equal(f.checks,1);
});
