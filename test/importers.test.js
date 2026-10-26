import test from 'node:test';import assert from 'node:assert/strict';
import {parseMoney,parseCSV,parseCAMT,normalizeBankApiTransaction} from '../src/importers.js';
test('parseMoney handles Swedish and international numbers',()=>{
  assert.equal(parseMoney('1 875,50'),187550);assert.equal(parseMoney('-7 179,16'),-717916);assert.equal(parseMoney('1,234.56'),123456);assert.equal(parseMoney('1.234,56'),123456);
  assert.throws(()=>parseMoney('abc'));assert.equal(parseMoney('1.234.567'),123456700);
});
test('CSV handles quoted semicolon text and normalizes signed amounts',()=>{
  const csv='Datum;Belopp;Betalare;OCR;Text\n2026-10-26;"1 875,00";"A; B AB";0604;Kund\n2026-10-14;"-2 000,00";Kylma;8903;Faktura';
  const rows=parseCSV(csv,'MG');assert.equal(rows.length,2);assert.equal(rows[0].payer,'A; B AB');assert.equal(rows[1].amount_cents,-200000);assert.equal(rows[0].account,'MG');
});
test('camt.054 splits TxDtls and preserves credit direction',()=>{
  const xml=`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfct><Ntfct><Ntry><Amt Ccy="SEK">1875.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-26</Dt></BookgDt><NtryDtls><TxDtls><Refs><AcctSvcrRef>A12</AcctSvcrRef></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">1875.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Exempelkund AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>0604</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfct></BkToCstmrDbtCdtNtfct></Document>`;
  const x=parseCAMT(xml,'Bankgiro');assert.equal(x.length,1);assert.equal(x[0].payer,'Exempelkund AB');assert.equal(x[0].reference,'0604');assert.equal(x[0].amount_cents,187500);
});
test('XML containing a DOCTYPE is rejected',()=>assert.throws(()=>parseCAMT('<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document></Document>')));
test('normalizes Enable Banking transaction and direction',()=>{
  const r=normalizeBankApiTransaction({transaction_amount:{amount:'35.50',currency:'SEK'},credit_debit_indicator:'DBIT',booking_date:'2026-10-24',creditor:{name:'Leverantör AB'},transaction_id:'ABC'},'SE123');
  assert.equal(r.amount_cents,-3550);assert.equal(r.payer,'Leverantör AB');assert.equal(r.bank_reference,'ABC');
});
