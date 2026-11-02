import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as domain from '../lib/domain.ts';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {MGEORGE_INVOICE_REFERENCE_POLICY} from '../lib/invoice-reference-policy.js';

const {emptyState,applyCommand,balance,available,suggestions}=domain;
const moduleUrl=path=>{
  const file=new URL(path,import.meta.url);
  const code=stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'})
    .replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_,quote,name)=>JSON.stringify(new URL(name+(name.endsWith('.js')||name.endsWith('.ts')?'':'.ts'),file).href));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
};
const reconciliation=await import(moduleUrl('../lib/reconciliation.ts'));
const presentation=await import(moduleUrl('../lib/payment-presentation.ts'));

function fixture({number='0599',reference='',payment=number,company='M.George Vitvaror AB',direction='receivable',party='Synthetic reference customer AB'}={}){
  let state=emptyState();state.company.name=company;
  state=applyCommand(state,{type:'invoice.save',invoice:{direction,party,number,ocr:reference,total:62500,issued:'2026-10-01',due:'2026-10-31',reviewed:true,documentId:'synthetic-reference-invoice'}}).state;
  state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:direction==='receivable'?62500:-62500,party,payerReference:payment,bankReference:'SYNTHETIC-REFERENCE-ENTRY',account:'iban:SE4280000890119146168423',kind:'payment',verified:true})]}).state;
  return state;
}
const allocate=state=>applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:62500,note:'Synthetic exact original check'}).state;

test('Sites describes a policy reference match without declaring bank OCR',()=>{
  const state=fixture({reference:'0599'}),proposal=suggestions(state,state.transactions[0])[0];
  assert.equal(proposal.strength,'strong');assert.doesNotMatch(proposal.reason,/OCR/);assert.match(proposal.reason,/referens.*exakt|exakt.*referens/i);
});

for(const number of ['0001','0599'])test(`Sites derives intended ${number} without changing stored references, bank OCR or balances`,()=>{
  const state=fixture({number}),before=structuredClone(state),invoice=state.invoices[0],transaction=state.transactions[0];
  const facts=reconciliation.invoiceFacts(state,invoice);
  assert.equal(facts.intendedPaymentReference,number);
  assert.equal(facts.referencePolicy.status,'REVIEW');
  assert.equal(facts.referencePolicy.applies,true);
  assert.equal(facts.reference,'');
  assert.equal(facts.ocr,'');
  assert.equal(presentation.bankPaymentReference(transaction).ocr,'');
  assert.equal(reconciliation.analyze(state).filter(f=>f.safe).length,1);
  assert.equal(suggestions(state,transaction)[0].strength,'strong');
  assert.deepEqual(state,before);
  assert.equal(balance(state,invoice),62500);
  assert.equal(available(state,transaction),62500);
  assert.equal(balance(allocate(state),invoice),0);
});

for(const payment of ['599','00599','059','05990','05-99','0599/1','0599 0600',''])test(`Sites never promotes incomplete or different policy reference ${JSON.stringify(payment)}`,()=>{
  const state=fixture({payment}),before=structuredClone(state);
  assert.ok(reconciliation.analyze(state).every(f=>!f.safe));
  assert.ok(suggestions(state,state.transactions[0]).every(f=>f.strength!=='strong'));
  assert.throws(()=>allocate(state),/referens|faktura/i);
  assert.throws(()=>applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:62500,note:'Synthetic attempted bypass',referenceCorrection:true}),/referens|faktura/i);
  assert.deepEqual(state,before);
});

for(const payment of ['0599','0600'])test(`Sites blocks the invoice's conflicting declared reference when bank sends ${payment}`,()=>{
  const state=fixture({reference:'0600',payment}),before=structuredClone(state);
  const facts=reconciliation.invoiceFacts(state,state.invoices[0]);
  assert.equal(facts.referencePolicy.status,'BLOCKED');
  assert.equal(facts.intendedPaymentReference,'0599');
  assert.equal(facts.reference,'0600');
  assert.ok(reconciliation.analyze(state).every(f=>!f.safe));
  assert.ok(suggestions(state,state.transactions[0]).every(f=>f.strength!=='strong'));
  assert.throws(()=>allocate(state),/referens|faktura/i);
  assert.deepEqual(state,before);
});

test('Sites keeps other-company and supplier separate OCR behavior',()=>{
  for(const options of [{company:'Synthetic Other Company AB'},{direction:'payable'}]){
    const state=fixture({...options,reference:'000018',payment:'000018'}),facts=reconciliation.invoiceFacts(state,state.invoices[0]);
    assert.equal(facts.referencePolicy.applies,false);
    assert.equal(facts.intendedPaymentReference,'000018');
    assert.equal(reconciliation.analyze(state).filter(f=>f.safe).length,1);
    assert.equal(balance(allocate(state),state.invoices[0]),0);
  }
});

test('Sites duplicate customer invoice numbers block matching even when another owner is closed',()=>{
  for(const closed of [false,true]){
    let state=fixture();
    state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Other synthetic customer AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',reviewed:true}}).state;
    if(closed)state.credits.push({id:'synthetic-closed-credit',invoiceId:state.invoices[1].id,amount:62500,number:'CLOSED-1',note:'Synthetic historical credit',date:'2026-10-02',active:true});
    const before=structuredClone(state);
    assert.ok(reconciliation.analyze(state).every(f=>!f.safe));
    assert.ok(suggestions(state,state.transactions[0]).every(f=>f.strength!=='strong'));
    assert.throws(()=>allocate(state),/flera|dubblett|referens/i);
    assert.deepEqual(state,before);
  }
});

test('Sites policy and display reads preserve historical allocations and make conflicts reviewable',()=>{
  let state=fixture({company:'Synthetic Other Company AB',reference:'0600',payment:'0600'});
  state=allocate(state);
  state.company.name='M.George Vitvaror AB';
  const before=structuredClone(state),facts=reconciliation.invoiceFacts(state,state.invoices[0]);
  const view=presentation.bankPaymentView(state,state.transactions[0]);
  assert.equal(facts.referencePolicy.status,'BLOCKED');
  assert.equal(facts.remaining_cents,0);
  assert.equal(facts.paid_cents,62500);
  assert.equal(view.invoiceVerified,false);
  assert.equal(view.verified,false);
  assert.deepEqual(state,before);
});

test('Sites settings preserve a configured policy and validate an explicit change without changing money',()=>{
  let state=fixture();
  state.company.invoiceReferencePolicies=[];
  const before=structuredClone(state);
  const saved=applyCommand(state,{type:'settings.save',name:'M.George Vitvaror AB',email:'synthetic@example.test'}).state;
  assert.deepEqual(saved.company.invoiceReferencePolicies,[]);
  assert.deepEqual(saved.invoices,before.invoices);
  assert.deepEqual(saved.allocations,before.allocations);
  assert.throws(()=>applyCommand(state,{type:'settings.save',name:'M.George Vitvaror AB',email:'synthetic@example.test',invoiceReferencePolicies:[{version:'invented'}]}),/policy|regel|referens|configuration/i);
  assert.deepEqual(state,before);
});

test('Sites preserves captured original references through later edits and blocks conflicts',()=>{
  let state=emptyState();
  state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic reference customer AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',reviewed:true,referenceOriginal:{invoice_number:' 0599 ',reference:'0600',issuer_name:'M.George Vitvaror AB'}}}).state;
  assert.equal(state.invoices[0].referenceOriginal.invoice_number,' 0599 ');
  assert.equal(reconciliation.invoiceFacts(state,state.invoices[0]).referencePolicy.status,'BLOCKED');
  const original=structuredClone(state.invoices[0].referenceOriginal);
  state=applyCommand(state,{type:'invoice.save',invoice:{...state.invoices[0],referenceOriginal:undefined,note:'Synthetic note change'}}).state;
  assert.deepEqual(state.invoices[0].referenceOriginal,original);
  assert.equal(reconciliation.invoiceFacts(state,state.invoices[0]).referencePolicy.status,'BLOCKED');
  assert.equal(balance(state,state.invoices[0]),62500);
});

test('Sites includes same-number customer and supplier invoices in distinct issuer scopes',()=>{
  let state=fixture();
  state=applyCommand(state,{type:'invoice.save',invoice:{direction:'payable',party:'Synthetic supplier AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',reviewed:true}}).state;
  assert.equal(reconciliation.analyze(state).filter(f=>f.safe).length,1);
  assert.equal(balance(allocate(state),state.invoices[0]),0);
});

for(const reference of ['0600','599','05-99'])test(`Sites manual verification cannot hide retained bank reference ${reference}`,()=>{
  let state=fixture({payment:reference});
  state=applyCommand(state,{type:'transaction.verify',id:state.transactions[0].id,party:state.transactions[0].party,payerReference:'0599',note:'Synthetic correction, not new bank evidence'}).state;
  const before=structuredClone(state);
  assert.ok(domain.invoiceReferenceMatchIssue(state,state.invoices[0],state.transactions[0]));
  assert.ok(reconciliation.analyze(state).every(f=>!f.safe));
  assert.throws(()=>allocate(state),/referens|original/i);
  assert.deepEqual(state,before);
});

test('Sites custom explicit policy reserves other invoices numbers as well as their references',()=>{
  let state=fixture({number:'0001',reference:'0599',payment:'0599'});
  state.company.invoiceReferencePolicies=[{...MGEORGE_INVOICE_REFERENCE_POLICY,referenceSource:'explicit_reference'}];
  state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Another synthetic customer AB',number:'0599',ocr:'0600',total:62500,issued:'2026-10-01',reviewed:true}}).state;
  assert.ok(domain.invoiceReferenceMatchIssue(state,state.invoices[0],state.transactions[0]));
  assert.ok(reconciliation.analyze(state).every(f=>!f.safe));
  assert.throws(()=>allocate(state),/flera|dubblett|referens/i);
});

test('Sites does not replace the original behind an existing captured reference snapshot',()=>{
  let state=fixture();state.invoices[0].referenceOriginal={invoice_number:'0599',reference:'0599'};
  const before=structuredClone(state);
  assert.throws(()=>applyCommand(state,{type:'invoice.save',invoice:{...state.invoices[0],documentId:'different-synthetic-original',referenceOriginal:{invoice_number:'0599',reference:'0600'}}}),/original|underlag/i);
  assert.deepEqual(state,before);
});
