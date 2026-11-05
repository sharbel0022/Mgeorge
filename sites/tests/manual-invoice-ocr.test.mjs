import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceImports,dataModule} from './helpers/invoice-module-loader.mjs';
import {layoutInvoiceText} from '../../test/helpers/pdf-layout-ocr.mjs';
import {emptyState,applyCommand,invoiceReferenceDecision,balance} from '../lib/domain.ts';
import {packet,digest,bankgiroText} from '../../test/helpers/ocr-bankgiro-cases.mjs';
const imports=await loadInvoiceImports();

test('reinterpreting pasted text cannot replace the first retained original reference observation',()=>{
  const source='Fakturanummer: 0599\nBetalningsreferens: 0600';
  const first=imports.extractInvoiceText(source),edited=imports.extractInvoiceText(source.replace('0600','0599'),first.referenceOriginal);
  assert.equal(edited.ocr,'0599');
  assert.equal(edited.referenceOriginal.reference,'0600');
});

for(const viaFile of [false,true])test(`manual ${viaFile?'file':'pasted text'} keeps original references after editable correction`,async()=>{
  const text='Fakturanummer: 0599\nBetalningsreferens: 0600\nAtt betala: 625,00 SEK\nFakturadatum: 2026-10-01';
  const fields=viaFile?(await imports.readInvoiceFile(new File([text],'synthetic-own-invoice.txt',{type:'text/plain'}),'owner@example.test')).fields:imports.extractInvoiceText(text);
  assert.deepEqual(fields.referenceOriginal,{invoice_number:'0599',reference:'0600'});
  const state=applyCommand(emptyState(),{type:'invoice.save',invoice:{...fields,direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'0599',total:62500,issued:'2026-10-01',reviewed:true}}).state;
  assert.equal(invoiceReferenceDecision(state,state.invoices[0]).status,'BLOCKED');
  assert.equal(balance(state,state.invoices[0]),62500);
  assert.equal(state.allocations.length,0);
});

for(const [name,from,to,field,expected]of [
  ['character spaced leading zeros','Fakturanummer: 0606','Fakturanummer: 0 6 0 6','number','0606'],
  ['complete unsupported invoice identifier','Fakturanummer: 0606','Fakturanummer: 0606.9','number',''],
  ['missing invoice number before another label','Fakturanummer: 0606','Fakturanummer:\nOCR: 000018','number',''],
  ['complete OCR token','OCR: 000018','OCR: 000018x','ocr',''],
  ['generic reference with preserved zeros','OCR: 000018','Betalningsreferens: AB/000018','ocr','AB/000018'],
  ['adjacent integer amount columns','3 750,00 SEK','1000    2000 SEK','total',''],
])test('manual proposals use strict source fields: '+name,()=>{
  const result=imports.extractInvoiceText(layoutInvoiceText.replace(from,to));
  assert.equal(result[field],expected);assert.equal(result.reviewed,false);
});

test('manual suggestions withhold conflicting invoice identities and totals',()=>{
  const result=imports.extractInvoiceText(layoutInvoiceText+'\nFakturanummer: 0607\nAtt betala: 4 000,00 SEK');
  assert.equal(result.number,'');assert.equal(result.total,'');assert.equal(result.reviewed,false);
});

test('manual file metadata reports conflicts without substituting the source invoice number',async()=>{
  const result=await imports.readInvoiceFile(new File([layoutInvoiceText],'Faktura 0607.txt',{type:'text/plain'}),'owner@example.test');
  assert.equal(result.fields.number,'0606');assert.match(result.warning,/Motstridigt fakturanummer/);assert.equal(result.fields.reviewed,false);
});

test('manual file parsing retains invalid-field review evidence',async()=>{
  const result=await imports.readInvoiceFile(new File([layoutInvoiceText.replace('0606','0606.9')],'syntetiskt.txt',{type:'text/plain'}),'owner@example.test');
  assert.equal(result.fields.number,'');assert.match(result.warning,/fakturanummer/);
});

const email=(body,attachmentText=null)=>attachmentText===null?
  `From: Forwarding Service <forwarder@example.test>\r\nTo: owner@example.test\r\nSubject: Faktura 0999\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`:
  `From: Forwarding Service <forwarder@example.test>\r\nTo: owner@example.test\r\nSubject: Faktura 0999\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="synthetic"\r\n\r\n--synthetic\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n--synthetic\r\nContent-Type: application/pdf; name="Faktura 0606.pdf"\r\nContent-Disposition: attachment; filename="Faktura 0606.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(attachmentText).toString('base64')}\r\n--synthetic--\r\n`;

test('forwarder metadata cannot fabricate a missing invoice party or number',async()=>{
  const result=await imports.readInvoiceFile(new File([email('Här kommer underlaget.')],'syntetiskt.eml',{type:'message/rfc822'}),'owner@example.test');
  assert.equal(result.fields.party,'');assert.equal(result.fields.number,'');assert.equal(result.fields.total,'');
});

test('an email attachment is the invoice source and retains its OCR review provenance',async()=>{
  // PDF decoding is covered by real PDF tests. This boundary double supplies
  // the OCR decoder result so mail-body mixing and provenance can be isolated.
  const local=dataModule(`export async function imageText(){throw Error('unexpected image');}export async function pdfInvoiceText(){return {text:${JSON.stringify(layoutInvoiceText)},ocr:true,confidence:73};}`);
  const imp=await loadInvoiceImports({'./local-ocr':local});
  const body='Fakturanummer: 0999\nAtt betala: 8 000,00 SEK';
  const result=await imp.readInvoiceFile(new File([email(body,'%PDF-synthetic')],'syntetiskt.eml',{type:'message/rfc822'}),'owner@example.test');
  assert.equal(result.fields.number,'0606');assert.equal(result.fields.total,'3750.00');
  assert.equal(result.ocr,true);assert.equal(result.confidence,73);assert.match(result.warning,/Motstridigt fakturanummer/);
  assert.equal(result.fields.party,'Testbolaget AB');assert.equal(result.fields.reviewed,false);
  assert.ok(!result.text.includes('8 000,00'));
});

for(const kind of ['png','pdf','eml'])for(const scenario of ['high','low','missing','other-original'])test(`manual ${kind} binds bankgiro word proof to the selected original: ${scenario}`,async()=>{
  const bytes=Buffer.from('%PDF-synthetic selected invoice '+kind),evidence=scenario==='missing'?undefined:packet(bankgiroText,{inputHash:digest(scenario==='other-original'?Buffer.from('another synthetic original'):bytes),confidence:scenario==='low'?0:95});
  // The decoder's own claimed input hash must never replace the independently
  // hashed selected file/attachment at this consumer boundary.
  const decoded={text:bankgiroText,ocr:true,confidence:99,ocrEvidence:evidence,inputSha256:evidence?.inputSha256};
  const local=dataModule(`const decoded=${JSON.stringify(decoded)};export async function imageText(){return decoded;}export async function pdfInvoiceText(){return decoded;}`),imp=await loadInvoiceImports({'./local-ocr':local});
  const file=new File([kind==='eml'?email('Bankgiro: 999-9999',bytes.toString()):bytes],'synthetic.'+kind,{type:kind==='png'?'image/png':kind==='pdf'?'application/pdf':'message/rfc822'});
  const result=await imp.readInvoiceFile(file,'owner@example.test');
  assert.equal(result.ocrInputSha256,digest(bytes));assert.deepEqual(result.ocrEvidence,evidence);
  assert.equal(result.fields.bankgiro,scenario==='high'?'123-4567':'');assert.equal(result.fields.reviewed,false);
  assert.equal(result.text,bankgiroText);assert.ok(!result.text.includes('999-9999'));assert.match(result.extraction.fields.bankgiro.evidence,/123-4567/);
  if(scenario!=='high')assert.match(result.warning,/Bankgiro.*ordunderlag/);
});

test('multiple PDF originals in one email cannot borrow word evidence or combine invoice fields',async()=>{
  const original=email('Bankgiro: 999-9999','%PDF-first'),second='--synthetic\r\nContent-Type: application/pdf; name="second.pdf"\r\nContent-Disposition: attachment; filename="second.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('%PDF-second').toString('base64')+'\r\n';
  const source=original.replace('--synthetic--\r\n',second+'--synthetic--\r\n');
  const local=dataModule("export async function imageText(){throw Error('unexpected decoder');}export async function pdfInvoiceText(){throw Error('must not select among multiple originals');}"),imp=await loadInvoiceImports({'./local-ocr':local});
  const result=await imp.readInvoiceFile(new File([source],'synthetic.eml',{type:'message/rfc822'}),'owner@example.test');
  assert.equal(result.text,'');assert.equal(result.fields.bankgiro,'');assert.equal(result.fields.number,'');assert.equal(result.fields.total,'');assert.match(result.warning,/flera PDF-bilagor/);
});

for(const repeats of [1500,4500])test('manual OCR retains bounded interpretation text separately from its shorter display text: '+repeats,async()=>{
  const bytes=Buffer.from('synthetic long invoice original'),text=bankgiroText+'\n'+'Syntetiskt bilageinnehåll utan nya fält.\n'.repeat(repeats);
  assert.ok(text.length>50000);assert.equal(text.length<=150000,repeats===1500);
  const decoded={text,ocr:true,confidence:99,ocrEvidence:packet(text,{inputHash:digest(bytes)})};
  const local=dataModule(`const decoded=${JSON.stringify(decoded)};export async function imageText(){return decoded;}export async function pdfInvoiceText(){return decoded;}`),imp=await loadInvoiceImports({'./local-ocr':local});
  const result=await imp.readInvoiceFile(new File([bytes],'synthetic.png',{type:'image/png'}),'owner@example.test');
  assert.equal(result.text.length,50000);assert.equal(result.interpretationText,text.slice(0,150000));assert.equal(result.fields.bankgiro,repeats===1500?'123-4567':'');
  assert.equal(result.ocrEvidence.textSha256,digest(text));assert.equal(result.ocrInputSha256,digest(bytes));
  if(repeats===4500)assert.match(result.warning,/Bankgiro.*ordunderlag/);
});
