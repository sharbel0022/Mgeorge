import assert from 'node:assert/strict';

export function normalizationContracts(test,analyze){
 const fixture=()=>({invoices:[{id:'invoice',direction:'customer',kind:'invoice',currency:'SEK',party:'Café Kund AB',organization_number:'',invoice_number:'SYN-017',reference:'SYN-017',issued_at:'2026-01-01',total_cents:12345,remaining_cents:12345}],transactions:[{id:'payment',account:'synthetic-account',amount_cents:12345,available_cents:12345,currency:'SEK',booked_at:'2026-10-01',payer:'Café Kund AB',reference:'SYN-017',bank_reference:'SYNTHETIC-BANK-017',verified:true}],links:[]});
 const safe=data=>analyze(data).filter(f=>f.safe).map(f=>[f.invoice_id,f.transaction_id,f.amount_cents]);
 test('equivalent Unicode/case/spacing retains exact payer identity without changing input',()=>{
  const data=fixture();data.invoices[0].party='ＣＡＦÉ  Kund AB';data.transactions[0].payer='cafe\u0301 kund-ab';
  const before=structuredClone(data);assert.deepEqual(safe(data),[['invoice','payment',12345]]);assert.deepEqual(data,before);
 });
 test('a learned third-party identity requires the exact receiving account',()=>{
  const data=fixture();data.transactions[0].payer='Tredje Betalaren';data.links=[{party:'café kund ab',payer:'TREDJE BETALAREN',account:'synthetic-account'}];
  assert.deepEqual(safe(data),[['invoice','payment',12345]]);data.links[0].account='different-account';assert.deepEqual(safe(data),[]);
 });
 test('explicit conflicting organization identities cannot be overridden by an equal name',()=>{
  const data=fixture();data.invoices[0].organization_number='556000-0001';data.transactions[0].payer_organization_number='556000-0002';
  assert.deepEqual(safe(data),[]);data.transactions[0].payer_organization_number='5560000001';assert.deepEqual(safe(data),[['invoice','payment',12345]]);
 });
 test('new analyses read changed invoice, payer and learned-link identities afresh',()=>{
  const data=fixture();assert.deepEqual(safe(data),[['invoice','payment',12345]]);
  data.transactions[0].payer='Other payer';assert.deepEqual(safe(data),[]);
  data.links=[{party:'Café Kund AB',payer:'Other payer',account:'synthetic-account'}];assert.deepEqual(safe(data),[['invoice','payment',12345]]);
  data.invoices[0].party='Different customer';assert.deepEqual(safe(data),[]);
  data.links[0].party='Different customer';assert.deepEqual(safe(data),[['invoice','payment',12345]]);
  data.links[0].payer='Unrelated payer';assert.deepEqual(safe(data),[]);
 });
 test('normalization-equivalent names never override duplicate references or competing payments',()=>{
  const data=fixture();data.invoices.push({...data.invoices[0],id:'other-invoice',party:'CAFÉ KUND AB'});assert.deepEqual(safe(data),[]);
  data.invoices.pop();data.transactions.push({...data.transactions[0],id:'other-payment',bank_reference:'OTHER-SYNTHETIC-BANK'});assert.deepEqual(safe(data),[]);
 });
}
