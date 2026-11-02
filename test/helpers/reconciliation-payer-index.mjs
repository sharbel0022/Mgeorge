import assert from 'node:assert/strict';

export const payerFixture=()=>({invoices:[{id:'invoice',direction:'customer',kind:'invoice',currency:'SEK',party:'Invoice Owner',organization_number:'',invoice_number:'SYN-17',reference:'SYN-17',issued_at:'2026-01-01',total_cents:10000,remaining_cents:10000}],transactions:[{id:'payment',account:'Synthetic A',amount_cents:10000,available_cents:10000,currency:'SEK',booked_at:'2026-10-01',payer:'External Payer',payer_organization_number:'',reference:'SYN-17',bank_reference:'SYNTHETIC-BANK',verified:true}],links:[]});
export const payerLink=(extra={})=>({invoice_id:'unrelated-invoice-id',party:'Invoice Owner',organization_number:'',payer:'External Payer',account:'Synthetic A',...extra});

// Literal expected decisions are independent of either engine or its index.
export const payerCases=[
 ['unlearned external payer stays different',false,()=>{}],
 ['learned identity crosses invoice IDs using customer identity',true,d=>d.links=[payerLink()]],
 ['learned payer Unicode/case/punctuation equivalence is retained',true,d=>{d.transactions[0].payer='ＥＸＴＥＲＮＡＬ---ＰＡＹＥＲ';d.links=[payerLink()];}],
 ['link on another account is rejected',false,d=>d.links=[payerLink({account:'Synthetic B'})]],
 ['account label casing is exact',false,d=>d.links=[payerLink({account:'synthetic a'})]],
 ['account whitespace is exact',false,d=>d.links=[payerLink({account:'Synthetic A '})]],
 ['direct name identity does not require a learned account link',true,d=>{d.transactions[0].payer='Invoice Owner';d.transactions[0].account='Synthetic B';d.links=[payerLink()];}],
 ['matching nonempty bank/invoice organizations override different names',true,d=>{d.invoices[0].organization_number='556000-0001';d.transactions[0].payer_organization_number='5560000001';}],
 ['conflicting nonempty bank/invoice organizations cannot use name or link',false,d=>{d.invoices[0].organization_number='556000-0001';d.transactions[0].payer_organization_number='5560000002';d.transactions[0].payer='Invoice Owner';d.links=[payerLink({payer:'Invoice Owner',organization_number:'5560000001'})];}],
 ['missing bank organization permits direct name fallback',true,d=>{d.invoices[0].organization_number='556000-0001';d.transactions[0].payer='Invoice Owner';}],
 ['missing invoice organization permits linked party fallback despite link org',true,d=>{d.transactions[0].payer_organization_number='5560000002';d.links=[payerLink({organization_number:'5560000001'})];}],
 ['missing linked organization permits linked party fallback',true,d=>{d.invoices[0].organization_number='5560000001';d.links=[payerLink()];}],
 ['both raw link/invoice organizations use organization instead of party',true,d=>{d.invoices[0].organization_number='5560000001';d.links=[payerLink({party:'Other Invoice Party',organization_number:'556000-0001'})];}],
 ['mismatched raw link/invoice organizations block equal linked party',false,d=>{d.invoices[0].organization_number='5560000001';d.links=[payerLink({organization_number:'5560000002'})];}],
 ['dash-space-only raw organizations retain empty normalized link equality',true,d=>{d.invoices[0].organization_number=' - ';d.links=[payerLink({party:'Other Invoice Party',organization_number:'--  '})];}],
 ['raw empty-normalized invoice org cannot use same-party nonempty link org',false,d=>{d.invoices[0].organization_number=' - ';d.links=[payerLink({organization_number:'5560000001'})];}],
 ['tab org remains nonempty and conflicts before name fallback',false,d=>{d.invoices[0].organization_number='\t';d.transactions[0].payer_organization_number='5560000001';d.transactions[0].payer='Invoice Owner';}],
 ['empty normalized payer cannot be supplied by empty normalized link',false,d=>{d.transactions[0].payer='---';d.links=[payerLink({payer:'... ‘ ’'})];}],
 ['colliding payer/account bucket retains every identity candidate',true,d=>d.links=[payerLink({party:'Other Owner'}),payerLink()]],
 ['other-account matching link cannot hide current-account mismatch',false,d=>d.links=[payerLink({account:'Synthetic B'}),payerLink({party:'Other Owner'})]],
 ['strict account equality rejects NaN',false,d=>{d.transactions[0].account=NaN;d.links=[payerLink({account:NaN})];}],
];

export function payerIndexContracts(test,analyze){
 for(const [name,safe,mutate]of payerCases)test(name,()=>{
  const data=payerFixture();mutate(data);const before=structuredClone(data);
  assert.deepEqual(analyze(data).map(f=>[f.invoice_id,f.transaction_id,f.kind,f.safe,f.amount_cents]),[['invoice','payment',safe?'correct':'different_payer',safe,10000]]);
  assert.deepEqual(data,before);
 });
 test('every analysis reads changed link, invoice, organization and account evidence',()=>{
  const data=payerFixture(),read=()=>analyze(data).filter(f=>f.safe).length,actual=[read()];
  data.links.push(payerLink());actual.push(read());data.links[0].account='Synthetic B';actual.push(read());
  data.links[0].account='Synthetic A';data.links[0].party='Other Owner';actual.push(read());
  data.invoices[0].party='Other Owner';actual.push(read());
  data.links[0].organization_number='5560000002';data.invoices[0].organization_number='5560000001';actual.push(read());
  data.links[0].organization_number='5560000001';actual.push(read());
  data.transactions[0].payer_organization_number='5560000002';actual.push(read());
  assert.deepEqual(actual,[0,1,0,0,1,0,1,0]);
 });
 test('adding, renaming and removing learned payer links stays fresh',()=>{
  const data=payerFixture(),safe=()=>analyze(data).filter(f=>f.safe).length;
  assert.equal(safe(),0);data.links.push(payerLink());assert.equal(safe(),1);
  data.links[0].payer='Different Payer';assert.equal(safe(),0);
  data.transactions[0].payer='Different Payer';assert.equal(safe(),1);
  data.transactions[0].account='Synthetic B';assert.equal(safe(),0);
  data.links[0].account='Synthetic B';assert.equal(safe(),1);
  data.links.splice(0);assert.equal(safe(),0);
 });
 test('duplicate invoice IDs do not share payer identity between invoice objects',()=>{
  const data=payerFixture();data.links=[payerLink()];
  data.invoices.push({...data.invoices[0],party:'Other Owner',reference:'SYN-18',invoice_number:'SYN-18'});
  const before=structuredClone(data);
  assert.deepEqual(analyze(data).map(f=>[f.invoice_id,f.kind,f.safe]),[['invoice','correct',true],['invoice','different_payer',false]]);
  assert.deepEqual(data,before);
 });
 test('grouping duplicate invoice IDs still tests each actual invoice identity',()=>{
  const data=payerFixture();data.links=[payerLink()];data.transactions[0].amount_cents=data.transactions[0].available_cents=20000;data.transactions[0].reference='SYN-17 SYN-18';
  data.invoices.push({...data.invoices[0],party:'Other Owner',reference:'SYN-18',invoice_number:'SYN-18'});
  assert.deepEqual(analyze(data).map(f=>[f.invoice_id,f.kind,f.safe,f.amount_cents]),[['invoice','wrong_reference',false,10000]]);
 });
}
