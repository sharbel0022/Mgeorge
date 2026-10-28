import test from 'node:test';
import assert from 'node:assert/strict';

export const account='SE4280000890119146168423';
export const syntheticCamt=`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
<BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>SYNTHETIC-MESSAGE</MsgId><CreDtTm>2026-10-27T10:00:00Z</CreDtTm></GrpHdr><Ntfctn><Id>SYNTHETIC-REPORT</Id>
<Acct><Id><IBAN>${account}</IBAN></Id><Ccy>SEK</Ccy><Svcr><FinInstnId><BIC>SYNTHETIC</BIC></FinInstnId></Svcr></Acct>
<Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><ValDt><Dt>2026-10-27</Dt></ValDt><AcctSvcrRef>SYNTHETIC-ENTRY</AcctSvcrRef>
<NtryDtls><TxDtls><Refs><TxId>SYNTHETIC-CHILD</TxId></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">625.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Syntetisk Kund AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp><Ref>000018</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls>
</Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

// Run the same malicious/ambiguous originals through each existing importer.
export function camtIntegrityTests({parse,parseBytes,report}){
 test('V4 explicit generic ISO versions and canonical containers preserve actual references',()=>{
  for(const version of ['02','08'])for(const kind of ['053','054']){
   let xml=syntheticCamt.replace('054.001.02',kind+'.001.'+version);
   if(kind==='053')xml=xml.replaceAll('BkToCstmrDbtCdtNtfctn','BkToCstmrStmt').replaceAll('Ntfctn','Stmt');
   const row=parse(xml)[0],evidence=report(row);assert.equal(evidence.messageId,'SYNTHETIC-MESSAGE');assert.equal(evidence.reportId,'SYNTHETIC-REPORT');assert.equal(evidence.accountServicer,'SYNTHETIC');assert.equal(evidence.valueDate,'2026-10-27');assert.equal(evidence.namespace.endsWith(kind+'.001.'+version),true);
  }
 });
 test('V4 missing, foreign and unknown namespaces cannot become bank evidence',()=>{
  for(const xml of [syntheticCamt.replace(' xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"',''),syntheticCamt.replace('camt.054.001.02','camt.054.001.99'),syntheticCamt.replace('<Nm>','<Nm xmlns="urn:foreign">'),syntheticCamt.replace('<RmtInf>','<RmtInf xmlns="">')])assert.throws(()=>parse(xml),/namnrymd|version/i);
 });
 test('V4 mixed report types and unknown financial wrappers stop the complete file',()=>{
  for(const xml of [syntheticCamt.replace('</Document>','<BkToCstmrStmt/></Document>'),syntheticCamt.replace('<NtryDtls>','<NtryDtls><UnknownPayment/>'),syntheticCamt.replace('<RmtInf>','<RmtInf><UnknownReference/>'),syntheticCamt.replace('</Strd>','<RfrdDocInf><OCR>000018</OCR></RfrdDocInf></Strd>'),syntheticCamt.replace('<CdOrPrtry>','<CdOrPrtry><OCR>000018</OCR>')])assert.throws(()=>parse(xml),/XML|struktur/i);
 });
 test('V4 references outside the supported remittance path cannot acquire a false field source',()=>{
  const without=syntheticCamt.replace(/<RmtInf>[\s\S]*?<\/RmtInf>/,'');
  for(const field of ['<RltdRmtInf><Bogus><CdtrRefInf><Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp><Ref>000018</Ref></CdtrRefInf></Bogus></RltdRmtInf>','<RltdRmtInf><Bogus><RfrdDocInf><Nb>000018</Nb></RfrdDocInf></Bogus></RltdRmtInf>','<RltdRmtInf><RmtLctnPstlAdr><Bogus><CdtrRefInf><Ref>000018</Ref></CdtrRefInf></Bogus></RmtLctnPstlAdr></RltdRmtInf>'])assert.throws(()=>parse(without.replace('</TxDtls>',field+'</TxDtls>')),/XML|struktur/i);
  const remittance=syntheticCamt.match(/<RmtInf>[\s\S]*?<\/RmtInf>/)[0];assert.throws(()=>parse(syntheticCamt.replace(remittance,remittance+remittance)),/tvetyd|flera/i);
  const row=parse(without.replace('</TxDtls>','<RltdRmtInf><RmtId>000018</RmtId></RltdRmtInf></TxDtls>'))[0];assert.equal(row.payerReference??row.reference,'');assert.equal((row.referenceEvidence??row.reference_evidence).candidates.length,0);
 });
 test('V4 detail reversals, corrections and unknown extensions require separate review',()=>{
  for(const field of ['<RvslInd>true</RvslInd>','<RvslInd>1</RvslInd>','<RvslInd/>','<RtrInf><Rsn><Cd>AC01</Cd></Rsn></RtrInf>','<SplmtryData/>'])assert.throws(()=>parse(syntheticCamt.replace('<TxDtls>','<TxDtls>'+field)),/återför|granskning/i);
 });
 test('V4 ambiguous individual amounts and mixed date/account/payer choices fail closed',()=>{
  for(const xml of [
   syntheticCamt.replace('</TxAmt>','</TxAmt><InstdAmt><Amt Ccy="SEK">625.00</Amt></InstdAmt>'),
   syntheticCamt.replace('</Prtry>','</Prtry><Cd>SCOR</Cd>'),
   syntheticCamt.replace('<Dt>2026-10-26</Dt>','<Dt>2026-10-26</Dt><DtTm>2026-10-26T12:00:00Z</DtTm>'),
   syntheticCamt.replace('</IBAN>','</IBAN><Othr><Id>OTHER-ACCOUNT</Id></Othr>'),
   syntheticCamt.replace('</Nm>','</Nm><Pty><Nm>Annan kund</Nm></Pty>')
  ])assert.throws(()=>parse(xml),/tvetyd/i);
 });
 test('V4 batch counts, currency, direction and local totals are validated together',()=>{
  const insert=fields=>syntheticCamt.replace('<NtryDtls>','<NtryDtls><Btch>'+fields+'</Btch>');
  assert.equal(parse(insert('<NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt><CdtDbtInd>CRDT</CdtDbtInd>')).length,1);
  for(const fields of ['<NbOfTxs>1e0</NbOfTxs>','<NbOfTxs/>','<NbOfTxs>2</NbOfTxs>','<TtlAmt Ccy="SEK">624.99</TtlAmt>','<TtlAmt Ccy="EUR">625.00</TtlAmt>','<CdtDbtInd>DBIT</CdtDbtInd>'])assert.throws(()=>parse(insert(fields)),/antal|totalbelopp|valuta|riktning/i);
  assert.throws(()=>parse(syntheticCamt.replace('<NtryDtls>','<NtryDtls><Btch><NbOfTxs>1</NbOfTxs></Btch></NtryDtls><NtryDtls>')),/antal/i);
 });
 test('V4 BOOK, booking date, value date and original SEK are mandatory facts',()=>{
  for(const xml of [syntheticCamt.replace('<Sts>BOOK</Sts>',''),syntheticCamt.replace('<BookgDt><Dt>2026-10-26</Dt></BookgDt>',''),syntheticCamt.replace('2026-10-27</Dt>','2026-02-31</Dt>'),syntheticCamt.replaceAll(' Ccy="SEK"',''),syntheticCamt.replace('<Ccy>SEK</Ccy>','<Ccy>EUR</Ccy>')])assert.throws(()=>parse(xml),/BOOK|datum|valuta/i);
 });
 test('V4 malformed XML cannot silently alter a bank payer or reference',()=>{
  for(const xml of [syntheticCamt.replace('Kund AB','Kund & AB'),syntheticCamt.replace('Kund AB','Kund &#1; AB'),syntheticCamt.replace('Kund AB','Kund\u0001 AB'),syntheticCamt.replace('<Nm>','<Nm unknown:field="x">'),syntheticCamt.replace('<Nm>','<Nm>first<Unexpected/>'),syntheticCamt.replace('<Sts>BOOK</Sts>','<Sts>BOOK<Cd>PDNG</Cd></Sts>')])assert.throws(()=>parse(xml),/XML/i);
 });
 test('V4 an invalid UTF-8 XML original is never retried as a different encoding',()=>{
  const text=syntheticCamt.replace('Kund AB','Café AB'),latin1=Uint8Array.from(Buffer.from(text,'latin1'));
  assert.throws(()=>parseBytes(latin1),/UTF-8|kodning/i);
  assert.throws(()=>parse(syntheticCamt.replace('encoding="UTF-8"','encoding="Windows-1252"')),/kodning/i);
  assert.equal(parseBytes(new TextEncoder().encode(text)).length,1);
 });
}
