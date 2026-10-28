import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,applyCommand,parseMoney,paid,balance,available,invoiceStatus,suggestions,validDate} from '../lib/domain.ts';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../lib/imports.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'./bankgiro-parser.js'",JSON.stringify(new URL('../lib/bankgiro-parser.js',import.meta.url).href)).replace("'./payment-references.js'",JSON.stringify(new URL('../lib/payment-references.js',import.meta.url).href)).replace("from './local-ocr'",`from '${new URL('../lib/local-ocr.ts',import.meta.url).href}'`).replace("from './domain'",`from '${new URL('../lib/domain.ts',import.meta.url).href}'`);
const imp=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const invoice=(overrides={})=>({direction:'receivable',party:'Testkund',email:'',number:'1001',ocr:'001019',total:187500,issued:'2026-10-01',due:'2026-10-26',reviewed:true,...overrides});
const tx=(overrides={})=>({date:'2026-10-26',amount:187500,party:'Testkund',payerReference:'001019',kind:'payment',verified:true,...overrides});
const addInvoice=(s,overrides)=>applyCommand(s,{type:'invoice.save',invoice:invoice(overrides)}).state;
const addTx=(s,overrides,options={})=>applyCommand(s,{type:'transactions.import',rows:[tx(overrides)],...options}).state;
const match=(s,amount=s.invoices[0].total,extra={})=>applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:s.transactions[0].id,amount,note:'Kontrollerat originalunderlag',...extra}).state;

test('ordinary camt statement entries without details retain non-collection classification',()=>{
 const statement=(direction,description)=>`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>${direction}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AddtlNtryInf>${description}</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`;
 for(const description of ['KORTKÖP','LÖN','Vanlig kontoöverföring'])assert.equal(imp.parseCAMT(statement('DBIT',description),'test.xml')[0].kind,'unknown');
 assert.equal(imp.parseCAMT(statement('CRDT','Bankgiro inbetalning'),'test.xml')[0].kind,'batch');
});

test('Swedish money is exact integer öre and rejects ambiguous fractions',()=>{for(const v of ['7 179,16','7\u00a0179,16','7.179,16','7179.16'])assert.equal(parseMoney(v),717916);assert.equal(parseMoney('-98,50'),-9850);assert.throws(()=>parseMoney('1.875'));assert.throws(()=>parseMoney('foo'));assert.throws(()=>parseMoney('1,875.00'));});
test('Calendar dates are real and due today is not overdue',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);const s=addInvoice(emptyState());assert.equal(invoiceStatus(s,s.invoices[0],'2026-10-26').key,'unreconciled');assert.equal(invoiceStatus(s,s.invoices[0],'2026-10-27').key,'unreconciled');const checked=applyCommand(s,{type:'invoice.reconcile',id:s.invoices[0].id,confirm:true,note:'Kontrollerat bankunderlag'}).state;assert.equal(invoiceStatus(checked,checked.invoices[0],'2026-10-26').key,'open');assert.equal(invoiceStatus(checked,checked.invoices[0],'2026-10-27').key,'overdue');});
test('Exact OCR offers a proposal and only confirmation marks paid',()=>{let s=addTx(addInvoice(emptyState()));assert.equal(suggestions(s,s.transactions[0])[0].strength,'strong');assert.equal(balance(s,s.invoices[0]),187500);s=match(s);assert.equal(balance(s,s.invoices[0]),0);assert.equal(invoiceStatus(s,s.invoices[0]).key,'paid');});
test('Equal amounts never resolve identity, even when ambiguous',()=>{let s=addInvoice(addInvoice(emptyState()),{party:'Andra kunden',number:'1002',ocr:'002',total:187500});s=addTx(s,{party:'',payerReference:''});assert.equal(suggestions(s,s.transactions[0]).length,0);assert.throws(()=>match(s),/Beloppet ensamt/);assert.equal(s.allocations.length,0);});
test('Bank reference cannot become invoice evidence or prefix-match',()=>{let s=addInvoice(emptyState(),{number:'123',ocr:'00123'});s=addTx(s,{payerReference:'1234',bankReference:'00123',party:''});assert.ok(suggestions(s,s.transactions[0]).every(x=>x.strength==='weak'));s=addTx(s,{payerReference:'order 1 leverans',party:'',externalId:'second'});assert.ok(suggestions(s,s.transactions[1]).every(x=>x.strength==='weak'));});
test('Closed invoice reference warns about double payment',()=>{let s=match(addTx(addInvoice(emptyState())));s=addTx(s,{externalId:'second',bankReference:'new',description:'Separat betalning'});assert.match(suggestions(s,s.transactions[1])[0].reason,/dubbelbetalning/);assert.equal(suggestions(s,s.transactions[1])[0].amount,0);});
test('Partial payments and overpayment preserve exact unallocated balance',()=>{let s=addTx(addInvoice(emptyState(),{total:200000}),{amount:75000});s=match(s,75000);assert.equal(paid(s,s.invoices[0].id),75000);s=addTx(s,{amount:130000,externalId:'last'});s=match(s,125000,{transactionId:s.transactions[1].id});assert.equal(balance(s,s.invoices[0]),0);assert.equal(available(s,s.transactions[1]),5000);assert.throws(()=>match(s,1));});
test('Wrong cash direction, drafts, unknown and batch rows cannot pay invoices',()=>{let s=addTx(addInvoice(emptyState(),{direction:'payable'}));assert.throws(()=>match(s),/riktning/);s=addTx(addInvoice(emptyState(),{reviewed:false}));assert.throws(()=>match(s),/Granska/);s=addTx(addInvoice(emptyState()),{kind:'unknown',verified:false});assert.throws(()=>match(s),/Granska/);});
test('SEK-only rejects foreign invoice, transaction and extraction amounts',()=>{assert.throws(()=>addInvoice(emptyState(),{currency:'EUR'}));assert.throws(()=>addTx(emptyState(),{currency:'USD'}));const p=imp.extractInvoiceText('Invoice number 42\nAmount due 100.00 EUR\nInvoice date 2026-10-01');assert.equal(p.foreignCurrency,true);assert.equal(p.total,'');});
test('Same file is rejected; repeated stable IDs skipped; changed IDs conflict',()=>{let s=addTx(emptyState(),{externalId:'abc'},{hash:'file1'});assert.throws(()=>addTx(s,{externalId:'abc'},{hash:'file1'}));s=addTx(s,{externalId:'abc'},{hash:'file2'});assert.equal(s.transactions.length,1);assert.throws(()=>addTx(s,{externalId:'abc',amount:100},{hash:'file3'}));});
test('Identical rows without strong IDs remain held for duplicate review',()=>{let s=addTx(emptyState());s=addTx(s);assert.equal(s.transactions.length,2);assert.equal(s.transactions[1].verified,false);assert.equal(s.transactions[1].duplicateOf,s.transactions[0].id);assert.equal(suggestions(s,s.transactions[1]).length,0);});
test('Ignored stable ID cannot be imported as fresh spendable money',()=>{let s=addTx(emptyState(),{externalId:'known'});s=applyCommand(s,{type:'transaction.ignore',id:s.transactions[0].id}).state;assert.throws(()=>addTx(s,{externalId:'known'}),/undantagen/);});
test('Duplicate aggregate cannot bypass protection through splitting',()=>{let s=addTx(emptyState(),{kind:'unknown',verified:false});s=addTx(s,{kind:'unknown',verified:false});assert.throws(()=>applyCommand(s,{type:'transaction.split',id:s.transactions[1].id,rows:[{amount:187500,party:'Testkund'}]}),/dubblettkontroll/);});
test('Batch total must equal details and parent is not allocatable',()=>{let s=addTx(addInvoice(emptyState()),{amount:717916,kind:'unknown',verified:false});const id=s.transactions[0].id;assert.throws(()=>applyCommand(s,{type:'transaction.split',id,rows:[{amount:187500},{amount:530000}]}));s=applyCommand(s,{type:'transaction.split',id,rows:[{amount:187500,party:'Testkund',payerReference:'001019'},{amount:530416,party:'Annan',payerReference:'2002'}]}).state;assert.equal(s.transactions[0].kind,'batch');assert.throws(()=>match(s));s=match(s,187500,{transactionId:s.transactions[1].id});assert.equal(balance(s,s.invoices[0]),0);});
test('Existing allocated payment cannot be reimported as batch plus details',()=>{let s=match(addTx(addInvoice(emptyState(),{total:10000}),{amount:10000,externalId:'entry:one'}),10000);assert.throws(()=>applyCommand(s,{type:'transactions.import',rows:[tx({key:'p',kind:'batch',amount:10000,externalId:'entry:one'}),tx({parentKey:'p',amount:4000,externalId:'a'}),tx({parentKey:'p',amount:6000,externalId:'b'})]}),/redan matchad/);});
test('Existing unallocated parent upgrades safely and total remains invariant',()=>{let s=addTx(emptyState(),{amount:10000,externalId:'entry:one',kind:'unknown',verified:false});s=applyCommand(s,{type:'transactions.import',rows:[tx({key:'p',kind:'batch',amount:10000,externalId:'entry:one'}),tx({parentKey:'p',amount:4000,externalId:'a'}),tx({parentKey:'p',amount:6000,externalId:'b'})]}).state;assert.equal(s.transactions[0].kind,'batch');assert.equal(s.transactions[0].verified,false);assert.throws(()=>applyCommand(s,{type:'transactions.import',rows:[tx({key:'p',kind:'batch',amount:10000,externalId:'entry:one'}),tx({parentKey:'p',amount:10000,externalId:'extra'})]}),/samlingsbelopp|Samlingspost/);});
test('Undo split preserves originals and supports a corrected split',()=>{let s=addTx(emptyState(),{amount:10000,kind:'unknown',verified:false});const id=s.transactions[0].id;s=applyCommand(s,{type:'transaction.split',id,rows:[{amount:6000,party:'A',payerReference:'A1'},{amount:4000,party:'B',payerReference:'B1'}]}).state;s=applyCommand(s,{type:'transaction.unsplit',id}).state;assert.equal(s.transactions.filter(t=>t.parentId===id&&t.ignored).length,2);assert.equal(s.transactions[0].kind,'batch');assert.throws(()=>applyCommand(s,{type:'transaction.verify',id,note:'Försök kringgå specifikationen'}),/betalningsspecifikation/);s=applyCommand(s,{type:'transaction.split',id,rows:[{amount:5000,party:'A',payerReference:'A1'},{amount:5000,party:'B',payerReference:'B1'}]}).state;assert.equal(s.transactions.filter(t=>t.parentId===id&&!t.ignored).length,2);});
test('Credit plus refund is correct and undo cannot orphan the refund',()=>{let s=match(addTx(addInvoice(emptyState(),{total:10000}),{amount:10000}),10000);const paymentId=s.allocations[0].id;s=applyCommand(s,{type:'credit.add',invoiceId:s.invoices[0].id,amount:2000,number:'K1',date:'2026-10-26',note:'Retur'}).state;assert.equal(balance(s,s.invoices[0]),-2000);s=addTx(s,{amount:-2000,externalId:'refund'});s=match(s,2000,{transactionId:s.transactions[1].id,effect:'refund'});assert.equal(balance(s,s.invoices[0]),0);assert.throws(()=>applyCommand(s,{type:'match.undo',id:paymentId,note:'Rättning'}),/återbetalningar/);});
test('Undo normal allocation restores invoice and transaction balances',()=>{let s=match(addTx(addInvoice(emptyState())));const id=s.allocations[0].id;s=applyCommand(s,{type:'match.undo',id,note:'Fel referens'}).state;assert.equal(balance(s,s.invoices[0]),187500);assert.equal(available(s,s.transactions[0]),187500);assert.equal(s.allocations[0].active,false);assert.ok(s.allocations[0].reversedAt);});
test('Parsed CSV preserves quoted separators and bank refs stay distinct',()=>{const p=imp.parseCSV('Rapport Swedbank\nDatum;Belopp;Betalare;Referens;OCR;Valuta\n2026-10-26;"1 875,00";"Andersson; AB";SWED1;001019;SEK');const m=imp.guessMapping(p.headers),r=imp.mapCSV(p,m,'test.csv')[0];assert.equal(r.amount,187500);assert.equal(r.party,'Andersson; AB');assert.equal(r.bankReference,'SWED1');assert.equal(r.payerReference,'001019');assert.equal(r.verified,false);});
test('Malformed CSV, missing date, currency and invalid calendar fail closed',()=>{assert.throws(()=>imp.parseCSV('Datum;Belopp\n2026-10-01;"3'));const p=imp.parseCSV('Datum;Belopp;Valuta\n2026-10-01;300;EUR');assert.throws(()=>imp.mapCSV(p,imp.guessMapping(p.headers),'bad.csv'));assert.throws(()=>imp.normalizeDate('31.02.2026'));});
test('Invoice extraction proposes totals and dates without granting review',()=>{const r=imp.extractInvoiceText('Fakturanummer: 2026-104\nAtt betala: 1 875,00 SEK\nFakturadatum: 2026-10-01\nFörfallodatum: 2026-10-26\nOCR: 001019\nBankgiro: 123-4567');assert.equal(r.number,'2026-104');assert.equal(r.total,'1875.00');assert.equal(r.due,'2026-10-26');assert.equal(r.reviewed,false);});

const bankApi=(overrides={})=>({account:'iban:SE4550000000058398257466',source:'Enable Banking · Swedbank · Företagskonto',kind:'unknown',verified:false,...overrides});

test('Raw and canonical IBANs share stable IDs, including previously stored raw accounts',()=>{
 let s=addTx(emptyState(),{account:'se45 5000 0000 0583 9825 7466',externalId:'entry:stable',source:'bank.xml'});
 assert.equal(s.transactions[0].account,'iban:SE4550000000058398257466');
 // Model a record saved before canonical account names were introduced.
 s.transactions[0].account='SE45 5000 0000 0583 9825 7466';
 s=addTx(s,{account:'iban:SE4550000000058398257466',externalId:'entry:stable',source:'bank.xml'});
 assert.equal(s.transactions.length,1);
 assert.throws(()=>addTx(s,{account:'IBAN:se4550000000058398257466',externalId:'entry:stable',amount:100}),/Samma bank-ID/);
 assert.throws(()=>addTx(s,{account:'SE4550000000058398257466',externalId:'entry:stable',date:'2026-10-25'}),/Samma bank-ID/);
});

test('File hash protection recognises a legacy raw IBAN import account',()=>{
 let s=addTx(emptyState(),{account:'SE4550000000058398257466'},{hash:'same-bank-file',account:'SE4550000000058398257466'});
 s.imports[0].account='SE45 5000 0000 0583 9825 7466';
 assert.throws(()=>addTx(s,{account:'iban:SE4550000000058398257466'},{hash:'same-bank-file',account:'iban:SE4550000000058398257466'}),/redan importerats/);
});

test('API and file copies are quarantined in either order despite different account labels',()=>{
 const api=bankApi({externalId:'enable-banking:one',bankReference:'API-ENTRY',payerReference:'',party:''});
 const file={account:'Swedbank företagskonto',source:'inbetalningar.xml',externalId:'transaction:file-one',bankReference:'FILE-ENTRY'};
 for(const pair of [[api,file],[file,api]]){
  let s=addTx(addInvoice(emptyState()),pair[0]);
  s=addTx(s,pair[1]);
  assert.equal(s.transactions.length,2);
  assert.equal(s.transactions[1].duplicateOf,s.transactions[0].id);
  assert.equal(s.transactions[1].verified,false);
  assert.equal(suggestions(s,s.transactions[1]).length,0);
  assert.throws(()=>match(s,187500,{transactionId:s.transactions[1].id}),/Granska/);
  assert.equal(balance(s,s.invoices[0]),187500);
 }
});

test('An API payment without a stable ID stays duplicate-held after review changes its fields',()=>{
 const original=bankApi({externalId:'',bankReference:'',party:'',payerReference:'',description:'Banköverföring'});
 let s=addTx(addInvoice(emptyState()),original);
 s=applyCommand(s,{type:'transaction.verify',id:s.transactions[0].id,party:'Testkund',payerReference:'001019',note:'Jämfört med bankens betalningsspecifikation'}).state;
 s=match(s);
 s=addTx(s,original);
 assert.equal(s.transactions.length,2);
 assert.equal(s.transactions[1].duplicateOf,s.transactions[0].id);
 assert.equal(s.transactions[1].verified,false);
 assert.throws(()=>applyCommand(s,{type:'transaction.verify',id:s.transactions[1].id,note:'Granskad'}),/dubblett/);
 assert.equal(paid(s,s.invoices[0].id),187500);
});

test('Matching API/file totals cannot turn a duplicate aggregate into spendable details',()=>{
 const fileBatch=tx({account:'SE45 5000 0000 0583 9825 7466',source:'camt.054.xml',externalId:'entry:batch',kind:'batch',verified:false,key:'batch'});
 const s=addTx(emptyState(),bankApi({externalId:'enable-banking:aggregate',bankReference:'BANK-AGGREGATE'}));
 assert.throws(()=>applyCommand(s,{type:'transactions.import',rows:[fileBatch,tx({account:fileBatch.account,source:fileBatch.source,parentKey:'batch',amount:87500,externalId:'entry:child-a'}),tx({account:fileBatch.account,source:fileBatch.source,parentKey:'batch',amount:100000,externalId:'entry:child-b'})]}),/samlingspost|samlingsbetalning|befintliga posten/i);
 assert.equal(s.transactions.length,1);
 assert.equal(s.transactions[0].kind,'unknown');
});

test('Conservative duplicate checks preserve distinct payments for explicit confirmation',()=>{
 let s=addTx(emptyState(),bankApi({externalId:'enable-banking:one'}));
 s=addTx(s,{account:'Annat företagskonto',source:'annat-konto.csv',externalId:'other-account-payment'});
 const second=s.transactions[1].id;
 assert.ok(s.transactions[1].duplicateOf);
 s=applyCommand(s,{type:'transaction.verify',id:second,confirmDistinct:true,note:'Kontrollerat separata kontoutdrag: två olika inbetalningar'}).state;
 assert.equal(s.transactions[1].duplicateOf,'');
 assert.equal(s.transactions[1].verified,true);
 assert.equal(s.transactions.length,2);
});

test('Duplicate quarantine respects direction, account and distinct stable provider IDs',()=>{
 let s=addTx(emptyState(),bankApi({externalId:'enable-banking:first',bankReference:'first'}));
 s=addTx(s,bankApi({externalId:'enable-banking:second',bankReference:'second'}));
 assert.equal(s.transactions[1].duplicateOf,'');
 s=addTx(s,{account:'Swedbank',source:'bank.csv',amount:-187500,externalId:'debit'});
 assert.equal(s.transactions[2].duplicateOf,'');
 let separate=addTx(emptyState(),bankApi({externalId:'',bankReference:''}));
 separate=addTx(separate,bankApi({account:'iban:SE1412000000000012345678',externalId:'',bankReference:''}));
 assert.equal(separate.transactions[1].duplicateOf,'');
});

test('API Bankgiro totals need a complete specification and cannot be verified with a note',()=>{
 let s=addTx(addInvoice(emptyState()),bankApi({externalId:'enable-banking:batch',description:'Bankgiro inbetalning',party:'',payerReference:''}));
 const parent=s.transactions[0];assert.equal(parent.kind,'batch');assert.equal(parent.verified,false);assert.deepEqual(suggestions(s,parent),[]);
 assert.throws(()=>applyCommand(s,{type:'transaction.verify',id:parent.id,party:'Testkund',payerReference:'001019',note:'Beloppet är lika'}),/Betalardetaljer saknas – importera betalningsspecifikation/);
 assert.throws(()=>match(s),/Granska/);assert.equal(balance(s,s.invoices[0]),187500);
 // Older saved rows also need the source detail, even if previously marked verified.
 s.transactions[0].kind='payment';s.transactions[0].verified=true;
 assert.throws(()=>match(s),/betalningsspecifikation/);assert.deepEqual(suggestions(s,s.transactions[0]),[]);
});
test('Complete individual names, references and sum are required for a Bankgiro specification',()=>{
 let s=addTx(addInvoice(emptyState()),bankApi({externalId:'enable-banking:batch',description:'Bankgiro samlingsinbetalning',party:'Bankgirot AB',payerReference:''}));const id=s.transactions[0].id;
 for(const row of [{amount:187500,party:'Testkund'},{amount:187500,payerReference:'001019'},{amount:187500,party:'Bankgirot AB',payerReference:'001019'}])assert.throws(()=>applyCommand(s,{type:'transaction.split',id,rows:[row]}),/betalningsspecifikation/);
 assert.throws(()=>applyCommand(s,{type:'transaction.split',id,rows:[{amount:187499,party:'Testkund',payerReference:'001019'}]}),/Summan/);
 s=applyCommand(s,{type:'transaction.split',id,rows:[{amount:187500,party:'Testkund',payerReference:'001019'}]}).state;
 assert.equal(s.transactions[0].kind,'batch');assert.equal(s.transactions[1].parentId,id);s=match(s,187500,{transactionId:s.transactions[1].id});assert.equal(balance(s,s.invoices[0]),0);
});
test('CSV Bankgiro totals are classified for specification rather than single-payment review',()=>{
 const parsed=imp.parseCSV('Datum;Belopp;Betalare;OCR;Text;Valuta\n2026-10-26;1875,00;Bankgirot AB;;Bankgiro inbetalning;SEK');
 const [row]=imp.mapCSV(parsed,imp.guessMapping(parsed.headers),'bank.csv');assert.equal(row.kind,'batch');assert.match(row.description,/Betalardetaljer saknas – importera betalningsspecifikation/);
 const complete=imp.parseCSV('Datum;Belopp;Betalare;OCR;Text;Valuta\n2026-10-26;1875,00;Testkund;001019;Bankgiro inbetalning;SEK');assert.equal(imp.mapCSV(complete,imp.guessMapping(complete.headers),'bank.csv')[0].kind,'unknown');
});
test('Manual approval needs matching reference or matching named payer and amount',()=>{
 let s=addTx(addInvoice(emptyState()),{payerReference:'',party:'Annan kund'});assert.deepEqual(suggestions(s,s.transactions[0]),[]);assert.throws(()=>match(s),/Beloppet ensamt/);
 s=addTx(addInvoice(emptyState()),{payerReference:'',party:'Testkund'});assert.equal(suggestions(s,s.transactions[0])[0].strength,'weak');assert.equal(balance(match(s),s.invoices[0]),0);
 const noIdentity=addTx(addInvoice(emptyState()),{kind:'unknown',verified:false,payerReference:'',party:'',description:'Banköverföring'});assert.throws(()=>applyCommand(noIdentity,{type:'transaction.verify',id:noIdentity.transactions[0].id,note:'Bara lika belopp'}),/saknas/);
 const exact=addTx(addInvoice(emptyState()),{party:'',payerReference:'001019',amount:75000});assert.equal(suggestions(exact,exact.transactions[0])[0].strength,'strong');assert.equal(balance(match(exact,75000),exact.invoices[0]),112500);
});
test('Incoming customer and outgoing supplier evidence cannot cross directions',()=>{
 let incoming=addTx(addInvoice(emptyState()),{payerReference:'001019',amount:187500});incoming=addInvoice(incoming,{direction:'payable',number:'SUP-1',party:'Testkund',ocr:'001019'});assert.equal(suggestions(incoming,incoming.transactions[0]).length,1);assert.throws(()=>match(incoming,187500,{invoiceId:incoming.invoices[1].id}),/riktning/);
 let outgoing=addTx(addInvoice(emptyState(),{direction:'payable'}),{amount:-187500,payerReference:'001019'});outgoing=addInvoice(outgoing,{number:'CUST-2',party:'Testkund',ocr:'001019'});assert.equal(suggestions(outgoing,outgoing.transactions[0]).length,1);assert.throws(()=>match(outgoing,187500,{invoiceId:outgoing.invoices[1].id}),/riktning/);assert.equal(balance(match(outgoing),outgoing.invoices[0]),0);
});
