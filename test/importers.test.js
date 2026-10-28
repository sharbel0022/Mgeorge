import test from 'node:test';import assert from 'node:assert/strict';
import {parseMoney,parseCSV,parseCAMT,parseBankFile,normalizeBankApiTransaction} from '../src/importers.js';
test('parseMoney handles Swedish and international numbers',()=>{
  assert.equal(parseMoney('1 875,50'),187550);assert.equal(parseMoney('-7 179,16'),-717916);assert.equal(parseMoney('1,234.56'),123456);assert.equal(parseMoney('1.234,56'),123456);
  assert.throws(()=>parseMoney('abc'));assert.equal(parseMoney('1.234.567'),123456700);
});
test('CSV handles quoted semicolon text and normalizes signed amounts',()=>{
  const csv='Datum;Belopp;Betalare;OCR;Text\n2026-10-26;"1 875,00";"A; B AB";0604;Kund\n2026-10-14;"-2 000,00";Kylma;8903;Faktura';
  const rows=parseCSV(csv,'MG');assert.equal(rows.length,2);assert.equal(rows[0].payer,'A; B AB');assert.equal(rows[1].amount_cents,-200000);assert.equal(rows[0].account,'MG');
});
test('Bankgiro CSV payment reference is kept distinct from the bank event reference',()=>{
  const rows=parseCSV('Datum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp\\n2026-10-26;Café Gränden Bistro AB;0599;501-8296;625,00','SE2820000842447344810101');
  assert.equal(rows.length,1);
  assert.equal(rows[0].payer,'Café Gränden Bistro AB');
  assert.equal(rows[0].reference,'0599');
  assert.equal(rows[0].bank_reference,'');
  assert.equal(rows[0].amount_cents,62500);
  assert.equal(rows[0].booked_at,'2026-10-26');
});
test('camt.054 splits TxDtls and preserves credit direction',()=>{
  const xml=`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfct><Ntfct><Ntry><Amt Ccy="SEK">1875.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-26</Dt></BookgDt><NtryDtls><TxDtls><Refs><AcctSvcrRef>A12</AcctSvcrRef></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">1875.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Exempelkund AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>0604</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfct></BkToCstmrDbtCdtNtfct></Document>`;
  const x=parseCAMT(xml,'Bankgiro');assert.equal(x.length,1);assert.equal(x[0].payer,'Exempelkund AB');assert.equal(x[0].reference,'0604');assert.equal(x[0].amount_cents,187500);
});
test('XML containing a DOCTYPE is rejected',()=>assert.throws(()=>parseCAMT('<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document></Document>')));
test('normalizes Enable Banking transaction and direction',()=>{
  const r=normalizeBankApiTransaction({status:'BOOK',transaction_amount:{amount:'35.50',currency:'SEK'},credit_debit_indicator:'DBIT',booking_date:'2026-10-24',creditor:{name:'Leverantör AB'},transaction_id:'DETAIL-ABC',entry_reference:'ARCHIVE-ABC'},'SE123');
  assert.equal(r.amount_cents,-3550);assert.equal(r.payer,'Leverantör AB');assert.equal(r.bank_reference,'ARCHIVE-ABC');assert.equal(r.provider_transaction_id,'DETAIL-ABC');
});

const camt=(details,{amount='300.00',currency='SEK',status='BOOK',extra='',prefix=''}={})=>{
  const raw=`<Document><BkToCstmrDbtCdtNtfct><Ntfct><Ntry><Amt Ccy="${currency}">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>${status}</Cd></Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>PARENT</AcctSvcrRef>${extra}<NtryDtls>${details}</NtryDtls></Ntry></Ntfct></BkToCstmrDbtCdtNtfct></Document>`;
  return prefix?raw.replace(/<(\/)?([A-Za-z]+)/g,`<$1${prefix}:$2`).replace(`<${prefix}:Document>`,`<${prefix}:Document xmlns:${prefix}="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">`):raw;
};
const detail=(amount,reference,name='Kund AB',id='')=>`<TxDtls>${id?`<Refs><AcctSvcrRef>${id}</AcctSvcrRef></Refs>`:''}${amount?`<AmtDtls><TxAmt><Amt Ccy="SEK">${amount}</Amt></TxAmt></AmtDtls>`:''}<RltdPties><Dbtr><Nm>${name}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${reference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>`;

test('collective entry without child amounts retains total exactly once and requires specification',()=>{
  const rows=parseCAMT(camt(detail('','101')+detail('','102')));
  assert.equal(rows.length,1);assert.equal(rows[0].amount_cents,30000);assert.equal(rows[0].is_aggregate,true);assert.match(rows[0].review_reason,/betalningsspecifikation/);assert.equal(rows[0].aggregate_parent_reference,'PARENT');
});
test('collective entry with inconsistent child sum is never expanded into a wrong balance',()=>{
  const rows=parseCAMT(camt(detail('100.00','101')+detail('100.00','102')));
  assert.equal(rows.length,1);assert.equal(rows[0].amount_cents,30000);assert.equal(rows[0].is_aggregate,true);
});
test('complete collective specification preserves child amounts and stable independent IDs',()=>{
  const rows=parseCAMT(camt(detail('100.00','101','A AB','CHILD1')+detail('200.00','102','B AB','CHILD2')));
  assert.equal(rows.length,2);assert.equal(rows.reduce((s,x)=>s+x.amount_cents,0),30000);assert.deepEqual(rows.map(x=>x.bank_reference),['CHILD1','CHILD2']);assert.ok(rows.every(x=>x.parent_bank_reference==='PARENT'));
});
test('split child references do not reuse the collective bank reference',()=>{
  const rows=parseCAMT(camt(detail('100.00','101')+detail('200.00','102')));
  assert.notEqual(rows[0].bank_reference,rows[1].bank_reference);assert.notEqual(rows[0].bank_reference,'PARENT');
});
test('namespace prefixes, current party nesting and XML numeric entities are supported',()=>{
  const xml=camt(detail('300.00','&#48;606','A &amp; B AB'));
  // Multi-character prefixes previously failed because of an unescaped regex backslash.
  const namespaced=camt(detail('300.00','&#48;606','A &amp; B AB'),{prefix:'camt054'});
  const [row]=parseCAMT(namespaced);assert.equal(row.reference,'0606');assert.equal(row.payer,'A & B AB');
  assert.equal(parseCAMT(xml)[0].reference,'0606');
});
test('reported batch count must agree with complete per-payment details',()=>{
  const xml=camt(detail('100.00','101')+detail('200.00','102'),{extra:'<NtryDtls><Btch><NbOfTxs>3</NbOfTxs></Btch></NtryDtls>'});
  const rows=parseCAMT(xml);assert.equal(rows.length,1);assert.equal(rows[0].is_aggregate,true);
});
test('shared child service reference never reuses a parent ID',()=>{
  const rows=parseCAMT(camt(detail('100.00','101','A AB','PARENT')+detail('200.00','102','B AB','PARENT')));
  assert.notEqual(rows[0].bank_reference,'PARENT');assert.notEqual(rows[1].bank_reference,'PARENT');assert.notEqual(rows[0].bank_reference,rows[1].bank_reference);
});
test('foreign currency XML, CSV and API records are rejected instead of relabeled SEK',()=>{
  assert.throws(()=>parseCAMT(camt(detail('300.00','101'),{currency:'EUR'})),/Valutan EUR/);
  assert.throws(()=>parseCSV('Datum;Belopp;Valuta\n2026-10-26;300;EUR'),/Valutan EUR/);
  assert.throws(()=>normalizeBankApiTransaction({status:'BOOK',credit_debit_indicator:'CRDT',booking_date:'2026-10-26',transaction_amount:{amount:'300',currency:'EUR'}},'MG'),/Valutan EUR/);
});
test('CSV credit zero does not hide a real debit and mixed nonzero sides need review',()=>{
  const [row]=parseCSV('Datum;Debet;Kredit;Text\n2026-10-26;125,50;0,00;Uttag');assert.equal(row.amount_cents,-12550);
  assert.throws(()=>parseCSV('Datum;Debet;Kredit\n2026-10-26;125,50;10,00'),/Både debet och kredit/);
});
test('invalid calendar dates are rejected by each import path',()=>{
  assert.throws(()=>parseCSV('Datum;Belopp\n2026-02-31;100'),/Ogiltigt datum/);
  assert.throws(()=>parseCAMT(camt(detail('300.00','101')).replace('2026-10-26','2026-02-31')),/Ogiltigt datum/);
  assert.throws(()=>normalizeBankApiTransaction({status:'BOOK',credit_debit_indicator:'DBIT',booking_date:'2026-02-31',transaction_amount:{amount:'1',currency:'SEK'}},'MG'),/Ogiltigt datum/);
});
test('missing data rows fail import instead of silently losing money',()=>{
  assert.throws(()=>parseCSV('Datum;Belopp\n2026-10-26;100\n;200'),/CSV-rad 3/);
});
test('pending camt records are skipped and malformed XML is rejected',()=>{
  assert.throws(()=>parseCAMT(camt(detail('300.00','101'),{status:'PDNG'})),/bokförda/);
  assert.throws(()=>parseCAMT(camt(detail('300.00','101')).replace('</Ntry>','</wrong>')),/XML-struktur/);
});
test('CSV collective Bankgiro deposit requires a specification',()=>{
  const [row]=parseCSV('Datum;Belopp;Text\n2026-10-26;300;Bankgiro inbetalning');assert.equal(row.is_aggregate,true);
});
test('file encoding rejects invalid base64 and oversized numeric values',()=>{
  assert.throws(()=>parseBankFile('bank.csv','invalid$='),/felaktig/);
  assert.throws(()=>parseMoney(Number.MAX_SAFE_INTEGER),/stort belopp/);
});

const apiTransaction=(extra={})=>({status:'BOOK',entry_reference:'ARCHIVE-1',transaction_id:'LOOKUP-1',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:'125.00',currency:'SEK'},debtor:{name:'Kund AB'},reference_number:'0001234',...extra});
test('only explicitly booked API transactions are normalized',()=>{
  for(const status of [undefined,'PDNG','CNCL','HOLD','OTHR','RJCT','SCHD'])assert.equal(normalizeBankApiTransaction(apiTransaction({status}),'MG'),null);
  assert.equal(normalizeBankApiTransaction(null,'MG'),null);
});
test('stable entry reference has priority and transient detail IDs never become deduplication IDs',()=>{
  const first=normalizeBankApiTransaction(apiTransaction(),'stable-account-hash');
  const renewed=normalizeBankApiTransaction(apiTransaction({transaction_id:'DIFFERENT-LOOKUP-ID'}),'stable-account-hash');
  assert.equal(first.bank_reference,renewed.bank_reference);assert.notEqual(first.provider_transaction_id,renewed.provider_transaction_id);
  const without=normalizeBankApiTransaction(apiTransaction({entry_reference:undefined}),'MG');assert.equal(without.bank_reference,'');
  assert.equal(normalizeBankApiTransaction(apiTransaction({entry_reference:'NOTPROVIDED'}),'MG').bank_reference,'');
});
test('bank reference, company Bankgiro, OCR and payer remain distinct',()=>{
  const r=normalizeBankApiTransaction(apiTransaction({creditor_account:{other:{scheme_name:'BGNR',identification:'1234-5678'}},bank_transaction_code:{description:'Bankgiro inbetalning'},remittance_information:['Faktura 0001234'],note:'Verifierat underlag'}),'MG');
  assert.equal(r.bankgiro,'1234-5678');assert.equal(r.reference,'0001234');assert.equal(r.bank_reference,'ARCHIVE-1');assert.equal(r.payer,'Kund AB');assert.ok(!r.is_aggregate);
  assert.match(r.description,/Bankgiro inbetalning/);assert.match(r.description,/Faktura 0001234/);
  const csv=parseCSV('Datum;Belopp;Bankgiro;OCR;Bankreferens;Betalare\n2026-10-26;125;1234-5678;0001234;ARCHIVE-1;Kund AB')[0];assert.equal(csv.bankgiro,'1234-5678');assert.equal(csv.reference,'0001234');
});
test('Bankgiro metadata cannot disguise a collective deposit as an individual payer',()=>{
  const collective=normalizeBankApiTransaction(apiTransaction({debtor:{name:'Bankgirot AB'},reference_number:undefined,bank_transaction_code:{description:'Bankgiro inbetalning'},remittance_information:['Insättning 1234-5678']}),'MG');
  assert.equal(collective.is_aggregate,true);assert.equal(collective.review_reason,'Betalardetaljer saknas – importera betalningsspecifikation.');
  const batch=normalizeBankApiTransaction(apiTransaction({bank_transaction_code:{description:'Samlad bankgiroinsättning'}}),'MG');assert.equal(batch.is_aggregate,true);
});
test('API missing currency and invalid payment direction fail instead of being inferred',()=>{
  assert.throws(()=>normalizeBankApiTransaction(apiTransaction({transaction_amount:{amount:'125'}}),'MG'),/utan valuta/);
  assert.throws(()=>normalizeBankApiTransaction(apiTransaction({credit_debit_indicator:'OTHER'}),'MG'),/betalningsriktning/);
});
test('API purchase date is never substituted for a missing accounting date',()=>{
  const fallback=normalizeBankApiTransaction(apiTransaction({booking_date:undefined,transaction_date:'2026-10-20',value_date:'2026-10-26'}),'MG');assert.equal(fallback.booked_at,'2026-10-26');
  assert.throws(()=>normalizeBankApiTransaction(apiTransaction({booking_date:undefined,transaction_date:'2026-10-20',value_date:undefined}),'MG'),/Ogiltigt datum/);
});
