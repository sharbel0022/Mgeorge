import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticCamt} from './camt-integrity.mjs';

const debtorBankgiro='0000599',creditorBankgiro='0012345';
const account=(role,scheme,id)=>'<'+role+'Acct><Id><Othr><Id>'+id+'</Id>'+(scheme===null?'':'<SchmeNm>'+scheme+'</SchmeNm>')+'</Othr></Id></'+role+'Acct>';
function report({debtorScheme='<Prtry>BGNR</Prtry>',creditorScheme='<Prtry>BANKGIRO</Prtry>',direction='CRDT',code=''}={}){
 return syntheticCamt
  .replace('<CdtDbtInd>CRDT</CdtDbtInd>','<CdtDbtInd>'+direction+'</CdtDbtInd>')
  .replace('</RltdPties>',account('Dbtr',debtorScheme,debtorBankgiro)+account('Cdtr',creditorScheme,creditorBankgiro)+'<Cdtr><Nm>Syntetisk Mottagare AB</Nm></Cdtr></RltdPties>')
  .replace(/<RmtInf>[\s\S]*?<\/RmtInf>/,'<RmtInf><Ustrd>0599</Ustrd></RmtInf>')
  .replace('</TxDtls>',code+'</TxDtls>');
}

// Synthetic generic parser cases, not bank-issued XSD or MIG certification.
export function camtBankgiroTests({parse,fields}){
 test('CAMT preserves explicit Bankgiro account strings, payer, reference and amount',()=>{
  for(const [debtorScheme,creditorScheme] of [
   ['<Prtry>BGNR</Prtry>','<Prtry>BANKGIRO</Prtry>'],
   ['<Cd>BGNR</Cd>','<Prtry>BANKGIRO</Prtry>']
  ]){
   const row=fields(parse(report({debtorScheme,creditorScheme}))[0]);
   assert.equal(row.bankgiro,creditorBankgiro);
   assert.equal(row.payerBankgiro,debtorBankgiro);
   assert.equal(row.payer,'Syntetisk Kund AB');
   assert.equal(row.reference,'0599');
   assert.equal(row.amount,62500);
   assert.equal(row.date,'2026-10-26');
  }
 });
 test('CAMT debit account roles preserve the owned and counterparty Bankgiro separately',()=>{
  const row=fields(parse(report({direction:'DBIT'}))[0]);
  assert.equal(row.bankgiro,debtorBankgiro);
  assert.equal(row.payerBankgiro,creditorBankgiro);
  assert.equal(row.payer,'Syntetisk Mottagare AB');
  assert.equal(row.reference,'0599');
  assert.equal(row.amount,-62500);
 });
 test('CAMT lookalike or unrelated account schemes never become Bankgiro evidence',()=>{
  for(const scheme of ['NOTBGNR','NOTBANKGIRO','BGNR-OTHER','OTHER-BANKGIRO','BBAN']){
   const row=fields(parse(report({debtorScheme:'<Prtry>'+scheme+'</Prtry>',creditorScheme:'<Cd>'+scheme+'</Cd>'}))[0]);
   assert.equal(row.bankgiro,'',scheme);
   assert.equal(row.payerBankgiro,'',scheme);
  }
 });
 test('CAMT account scheme choices are unambiguous and scalar',()=>{
  for(const scheme of [
   '<Cd>BBAN</Cd><Prtry>BGNR</Prtry>',
   '<Prtry>BANKGIRO</Prtry><Cd>BGNR</Cd>',
   '<Cd>BGNR</Cd><Cd>BBAN</Cd>',
   '<Prtry>BGNR</Prtry><Prtry>BANKGIRO</Prtry>',
   '<Cd><Prtry>BGNR</Prtry></Cd>',
   '<Unknown>BGNR</Unknown>',
   '<Prtry/>',
   ''
  ]){
   assert.throws(()=>parse(report({debtorScheme:scheme})),/tvetyd|kontoschema|XML/i);
   assert.throws(()=>parse(report({creditorScheme:scheme})),/tvetyd|kontoschema|XML/i);
  }
 });
 test('CAMT transaction codes cannot substitute for an explicit Bankgiro account scheme',()=>{
  const code='<BkTxCd><Prtry><Cd>BGNR</Cd><Issr>BANKGIRO</Issr></Prtry></BkTxCd>';
  const row=fields(parse(report({debtorScheme:null,creditorScheme:null,code}))[0]);
  assert.equal(row.bankgiro,'');
  assert.equal(row.payerBankgiro,'');
  assert.equal(row.reference,'0599');
 });
}
