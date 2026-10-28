import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState,applyCommand,specificationPreview,paymentInvoiceAssessment,economicTransactions,balance,available} from '../lib/domain.ts';
import {parseBankgiroXML,parseBankgiroCSV,parseSpecificationBytes} from '../lib/bankgiro-parser.js';
const account='SE4280000890119146168423';
export const xml=(details=detail(),amount='625.00',extra='')=>`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>${account}</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><ValDt><Dt>2026-10-27</Dt></ValDt><AcctSvcrRef>SWED-TEST-1</AcctSvcrRef>${extra}<NtryDtls>${details}</NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
export function detail({amount='625.00',ref='0599',payer='Café Gränden Bistro AB',id='CHILD-1'}={}){return `<TxDtls><Refs><TxId>${id}</TxId></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">${amount}</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>${payer}</Nm></Dbtr><DbtrAcct><Id><Othr><Id>501-8296</Id><SchmeNm><Prtry>BGNR</Prtry></SchmeNm></Othr></Id></DbtrAcct></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${ref}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>`;}
const command=(rows,hash='fixture-1')=>({type:'bankgiro.import',rows,documentId:'retained-original',hash,name:'TEST.xml'});
const parent=(overrides={})=>({date:'2026-10-26',amount:62500,party:'',payerReference:'58197013',bankReference:'SWED-TEST-1',externalId:'api-id',account,description:'Bankgiro inbetalning',kind:'batch',source:'Enable Banking',...overrides});
const setup=(overrides={})=>applyCommand(emptyState(),{type:'transactions.import',rows:[parent(overrides)]}).state;
const invoice=(s,overrides={})=>applyCommand(s,{type:'invoice.save',invoice:{direction:'receivable',party:'Café Gränden Bistro AB',number:'0599',ocr:'0599',total:62500,currency:'SEK',issued:'2026-10-01',due:'2026-10-28',reviewed:true,...overrides}}).state;
const importRows=(s,rows=parseBankgiroXML(xml()),hash='fixture-1')=>applyCommand(s,command(rows,hash)).state;
function compile(path,imports){let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [a,b]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+a+q,JSON.stringify(b));return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const domain=new URL('../lib/domain.ts',import.meta.url).href;
const engine=new URL('../lib/reconciliation-engine.js',import.meta.url).href;
const {reconcileState,analyze}=await import(compile('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine}));

test('Bankgiro XML preserves Café, 0599, sender BG, settlement date and individual ID',()=>{const [r]=parseBankgiroXML(xml());assert.equal(r.party,'Café Gränden Bistro AB');assert.equal(r.payerReference,'0599');assert.equal(r.amount,62500);assert.equal(r.payerBankgiro,'501-8296');assert.equal(r.settlementDate,'2026-10-27');assert.equal(r.bankReference,'CHILD-1');assert.equal(r.parentBankReference,'SWED-TEST-1');});
test('exact invoice, verified payer and linked original can reconcile automatically',()=>{let s=importRows(invoice(setup()));s=reconcileState(s).state;assert.equal(balance(s,s.invoices[0]),0);assert.equal(s.allocations.length,1);assert.equal(paymentInvoiceAssessment(s,s.transactions[1]).status,'verified');assert.equal(s.transactions[0].payerReference,'58197013');assert.equal(s.transactions[0].kind,'batch');});
test('0599 missing never marks equal-amount 0594 paid',()=>{let s=importRows(invoice(setup(),{number:'0594',ocr:'0594'}));s=reconcileState(s).state;assert.equal(s.allocations.length,0);assert.match(paymentInvoiceAssessment(s,s.transactions[1]).message,/faktura 0599 saknas/);});
test('same amount on several invoices is never payment evidence',()=>{let s=invoice(invoice(setup(),{number:'0594',ocr:'0594'}),{number:'0600',ocr:'0600'});s=reconcileState(importRows(s)).state;assert.equal(s.allocations.length,0);});
test('payment without OCR keeps identified payer but does not auto allocate',()=>{let s=importRows(invoice(setup()),parseBankgiroXML(xml(detail({ref:''}))));assert.equal(s.transactions[1].party,'Café Gränden Bistro AB');assert.equal(reconcileState(s).state.allocations.length,0);});
test('wrong OCR owned by a different customer never moves to another invoice',()=>{let s=invoice(invoice(setup(),{number:'0599',ocr:'0599',party:'Annan kund'}),{number:'0594',ocr:'0594'});s=reconcileState(importRows(s)).state;assert.equal(s.allocations.length,0);assert.ok(analyze(s).some(f=>f.kind==='reference_conflict'));});
test('partial payment retains exact remaining öre',()=>{let s=reconcileState(importRows(invoice(setup(),{total:100001}))).state;assert.equal(balance(s,s.invoices[0]),37501);});
test('overpayment allocates invoice total and retains remainder on child only',()=>{let s=reconcileState(importRows(invoice(setup(),{total:60000}))).state;assert.equal(balance(s,s.invoices[0]),0);assert.equal(available(s,s.transactions[1]),2500);});
test('two individual payments replace collective economically once and API refresh is idempotent',()=>{const rows=parseBankgiroXML(xml(detail({amount:'125.00'})+detail({amount:'500.00',ref:'0600',payer:'Kund B',id:'CHILD-2'})));let s=importRows(setup(),rows);assert.equal(s.transactions.length,3);assert.equal(economicTransactions(s).reduce((n,t)=>n+t.amount,0),62500);s=applyCommand(s,{type:'transactions.import',rows:[parent({externalId:'api-id'})]}).state;assert.equal(economicTransactions(s).reduce((n,t)=>n+t.amount,0),62500);});
test('wrong account or booking date remains blocked and cannot be manually verified',()=>{for(const override of [{account:'SE2080000890119146168431'},{date:'2026-10-25'},{bankReference:'OTHER'}]){const rows=parseBankgiroXML(xml()).map(r=>({...r,...override,parentBankReference:override.bankReference||r.parentBankReference})),s=importRows(invoice(setup()),rows);assert.equal(s.transactions[1].specificationStatus,'review');assert.equal(reconcileState(s).state.allocations.length,0);assert.equal(economicTransactions(s).reduce((n,t)=>n+t.amount,0),62500);assert.throws(()=>applyCommand(s,{type:'transaction.verify',id:s.transactions[1].id,note:'test',party:s.transactions[1].party}),/kopplas/);}});
test('incomplete sums and declared counts cannot unlock parent',()=>{assert.throws(()=>parseBankgiroXML(xml(detail({amount:'600.00'}))),/summan/);assert.throws(()=>parseBankgiroXML(xml(detail(),'625.00','<NtryDtls><Btch><NbOfTxs>2</NbOfTxs></Btch></NtryDtls>')),/antal/);assert.throws(()=>parseBankgiroXML(xml(detail({amount:'125.00'})+detail({amount:'500.00'})).replace('<AmtDtls><TxAmt><Amt Ccy="SEK">125.00</Amt></TxAmt></AmtDtls>','')),/individuellt belopp/);});
test('same file and changed filename do not create a second spendable payment',()=>{let s=importRows(setup());s=importRows(s);assert.equal(s.transactions.length,2);s=importRows(s,parseBankgiroXML(xml()),'same-content-new-hash');assert.equal(s.transactions.length,2);assert.equal(economicTransactions(s).reduce((n,t)=>n+t.amount,0),62500);});
test('overlapping Swedbank individual payment holds specification for duplicate review',()=>{let s=setup();s=applyCommand(s,{type:'transactions.import',rows:[{...parent(),kind:'payment',externalId:'individual-1',description:'Individual payment',bankReference:'CHILD-1',party:'Café Gränden Bistro AB',payerReference:'0599',verified:true}]}).state;s=importRows(s);assert.equal(s.transactions.at(-1).verified,false);assert.equal(s.transactions.at(-1).specificationStatus,'review');});
test('scanned, malformed, DTD, oversized and foreign currency inputs fail safely',()=>{assert.throws(()=>parseSpecificationBytes(new TextEncoder().encode('%PDF-1.7 scan'),'bank.xml'));assert.throws(()=>parseBankgiroXML(xml().replace('</Ntry>','</Wrong>')));assert.throws(()=>parseBankgiroXML('<!DOCTYPE x>'+xml()));assert.throws(()=>parseBankgiroXML(xml().replaceAll('Ccy="SEK"','Ccy="EUR"')));assert.throws(()=>parseSpecificationBytes(new Uint8Array(15_000_001),'bank.csv'));});
const csv='Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto;Bankreferens\n2026-10-26;Café Gränden Bistro AB;0599;501-8296;625,00;SEK;'+account+';SWED-TEST-1';
test('Bankgiro CSV mapping preserves sender BG separately and matches whole batch',()=>{const rows=parseBankgiroCSV(csv);assert.equal(rows[0].payerReference,'0599');assert.equal(rows[0].payerBankgiro,'501-8296');assert.equal(rows[0].recipientBankgiro,'');assert.equal(specificationPreview(setup(),rows).linked,1);});
test('Windows-1252 input and missing mandatory currency are handled explicitly',()=>{const bytes=Buffer.from(csv.replace('ä','a').replace('ä','a'),'latin1');assert.match(parseSpecificationBytes(bytes,'BANK.csv')[0].party,/Café/);assert.throws(()=>parseBankgiroCSV(csv.replace(';Valuta','').replace(';SEK','')),/valuta saknas/);});
test('selected parent is checked and previously allocated or conflicting batch cannot release',()=>{const s=setup(),rows=parseBankgiroXML(xml());assert.equal(specificationPreview(s,rows,'other-parent').review,1);s.allocations.push({transactionId:s.transactions[0].id,active:true});assert.equal(specificationPreview(s,rows).review,1);});
test('pending specification can be reevaluated when original bank parent arrives later',()=>{let s=importRows(emptyState());assert.equal(s.transactions[0].specificationStatus,'review');s=applyCommand(s,{type:'transactions.import',rows:[parent()]}).state;s=importRows(s);assert.equal(s.transactions.length,2);assert.equal(s.transactions[0].specificationStatus,'linked');assert.equal(economicTransactions(s).reduce((n,t)=>n+t.amount,0),62500);});
test('same reference across two invoices remains ambiguous and keeps allocation empty',()=>{let s=invoice(invoice(setup()),{party:'En annan kund',number:'2222',ocr:'0599'});s=reconcileState(importRows(s)).state;assert.equal(s.allocations.length,0);assert.equal(paymentInvoiceAssessment(s,s.transactions[1]).status,'ambiguous');});

test('V3 ISO namespace is resolved, not guessed from root attributes or foreign local names',()=>{
 const prefixed=xml().replace(/<(\/)?([A-Za-z][\w]*)/g,'<$1iso:$2').replace('xmlns=','xmlns:iso=');
 assert.equal(parseBankgiroXML(prefixed)[0].payerReference,'0599');
 for(const input of [xml().replace('xmlns=','data-schema='),xml().replace('urn:iso:std:iso:20022:tech:xsd:camt.054.001.02','https://untrusted.example/camt.054.001.02'),xml().replace('<Amt Ccy="SEK">625.00</Amt>','<Amt xmlns="urn:foreign" Ccy="SEK">625.00</Amt>'),prefixed.replace('xmlns:iso=','xmlns:other=')])assert.throws(()=>parseBankgiroXML(input));
 const foreign=xml().replace('<NtryDtls>','<NtryDtls xmlns="urn:foreign">');
 assert.throws(()=>parseBankgiroXML(foreign),/namnrymd/);
});

test('V3 mixed XML references retain independent evidence and free text without a false conflict',()=>{
 const input=xml(detail({ref:'000018'}).replace('<RmtInf>','<RmtInf><Ustrd>Tack för hjälpen</Ustrd>').replace('</Strd>','<RfrdDocInf><Nb>0599</Nb></RfrdDocInf></Strd>'));
 const [r]=parseBankgiroXML(input);assert.equal(r.payerReference,'000018');assert.equal(r.remittanceMessage,'Tack för hjälpen');
 assert.deepEqual(new Set(r.referenceEvidence.candidates.filter(c=>c.kind!=='message').map(c=>c.value)),new Set(['000018','0599']));
 const s=reconcileState(importRows(invoice(setup(),{ocr:'000018'}),[r])).state;assert.equal(s.allocations.length,1);assert.equal(s.transactions[1].referenceParts.length,3);
});

test('V3 explicit Swedish OCR type validates checksum while a numeric invoice number stays separate',()=>{
 for(const ref of ['000018','000019']){
  const [r]=parseBankgiroXML(xml(detail({ref}).replace('<CdtrRefInf>','<CdtrRefInf><Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp>')));
  assert.equal(r.payerReference,ref);assert.equal(r.referenceEvidence.candidates.find(c=>c.kind==='ocr').validity,ref==='000018'?'checksum_valid':'checksum_invalid');
  const s=reconcileState(importRows(invoice(setup(),{ocr:ref}),[r])).state;assert.equal(s.allocations.length,ref==='000018'?1:0);
 }
 const [r]=parseBankgiroXML(xml());assert.equal(r.referenceEvidence.candidates[0].kind,'structured');assert.equal(r.referenceEvidence.candidates[0].validity,'unchecked');
});

test('V3 payer organisation and masked account survive original import',()=>{
 const input=xml(detail().replace('</Nm>','</Nm><Id><OrgId><Othr><Id>556123-4567</Id></Othr></OrgId></Id>'));
 const [r]=parseBankgiroXML(input);assert.equal(r.organizationNumber,'556123-4567');assert.equal(r.payerAccount,'•••• 8296');
 const s=importRows(setup(),[r]);assert.equal(s.transactions[1].payerAccount,'•••• 8296');assert.equal(s.transactions[1].organizationNumber,'556123-4567');
});

test('V3 conflicting individual references and a different payer never create allocations',()=>{
 const conflict=xml(detail().replace('</Strd>','<RfrdDocInf><Nb>0600</Nb></RfrdDocInf></Strd>'));
 const mismatch=xml(detail({payer:'Annan betalare AB'}));
 for(const input of [conflict,mismatch]){const s=reconcileState(importRows(invoice(setup()),parseBankgiroXML(input))).state;assert.equal(s.allocations.length,0);}
});

test('V3 company Bankgiro mistaken for OCR blocks automation even if an invoice stores it',()=>{
 const s=importRows(invoice(setup(),{ocr:'5819-7013',bankgiro:'5819-7013'}),parseBankgiroXML(xml(detail({ref:'58197013'}))));
 assert.equal(reconcileState(s).state.allocations.length,0);assert.ok(analyze(s).some(f=>/eget Bankgironummer/.test(f.reason)));
});

test('V3 pending retained specification automatically links once the matching aggregate arrives',()=>{
 let s=invoice(importRows(emptyState())),pending=s.transactions[0];assert.equal(pending.specificationStatus,'review');
 s=applyCommand(s,{type:'transactions.import',rows:[parent()]}).state;
 const before=structuredClone(s),result=reconcileState(s);assert.deepEqual(s,before);assert.equal(result.state.transactions.length,2);assert.equal(result.state.transactions[0].specificationStatus,'linked');assert.equal(result.state.allocations.length,1);
 assert.equal(result.decisions[0].kind,'specification_linked');assert.equal(result.decisions[0].document_id,'retained-original');assert.equal(result.decisions[0].document_hash,'fixture-1');
 const again=reconcileState(result.state);assert.equal(again.decisions.length,0);assert.equal(again.state.allocations.length,1);
});

test('V3 automatic reevaluation cannot release wrong-account or incomplete stored specifications',()=>{
 for(const overrides of [{account:'other'},{amount:60000}]){
  let s=invoice(importRows(emptyState()));s.transactions[0]={...s.transactions[0],...overrides};s=applyCommand(s,{type:'transactions.import',rows:[parent()]}).state;
  const result=reconcileState(s);assert.equal(result.state.transactions[0].specificationStatus,'review');assert.equal(result.decisions.length,0);assert.equal(result.state.allocations.length,0);
 }
});

test('V3 repeated individual identifiers cannot remove aggregate money through child deduplication',()=>{
 for(const second of [detail({amount:'312.50'}),detail({amount:'312.50',ref:'0600',payer:'Annan kund'})]){
  const rows=parseBankgiroXML(xml(detail({amount:'312.50'})+second)),s=importRows(setup(),rows);
  assert.ok(s.transactions.filter(t=>t.specification).every(t=>t.specificationStatus==='review'));
  assert.equal(economicTransactions(s).reduce((sum,t)=>sum+t.amount,0),62500);assert.equal(reconcileState(s).state.allocations.length,0);
 }
});

test('V3 malformed bare XML entity cannot become a verified payer name',()=>{
 assert.throws(()=>parseBankgiroXML(xml(detail({payer:'A & B AB'}))),/XML-entitet/);
 assert.equal(parseBankgiroXML(xml(detail({payer:'A &amp; B AB'})))[0].party,'A & B AB');
});

test('V3 ignored, duplicate, missing or legacy siblings never relink a subset of the original entry',()=>{
 const rows=parseBankgiroXML(xml(detail({amount:'625.00'})+detail({amount:'625.00',ref:'0600',payer:'Annan kund AB',id:'CHILD-2'}),'1250.00'));
 for(const mode of ['ignored','duplicate','missing','legacy']){
  let s=invoice(importRows(emptyState(),rows));assert.equal(s.transactions.length,2);
  if(mode==='ignored')s=applyCommand(s,{type:'transaction.ignore',id:s.transactions[1].id}).state;
  if(mode==='duplicate')s.transactions[1].duplicateOf='possible-original';
  if(mode==='missing')s.transactions.pop();
  if(mode==='legacy')for(const t of s.transactions){delete t.specificationGroup;delete t.specificationCount;delete t.specificationTotal;}
  s=applyCommand(s,{type:'transactions.import',rows:[parent()]}).state;
  const before=structuredClone(s),result=reconcileState(s);assert.deepEqual(s,before);assert.equal(result.decisions.length,0,mode);assert.equal(result.state.allocations.length,0,mode);assert.equal(result.state.transactions[0].specificationStatus,'review',mode);
 }
 let full=invoice(importRows(emptyState(),rows));full=applyCommand(full,{type:'transactions.import',rows:[parent({amount:125000})]}).state;
 const valid=reconcileState(full);assert.equal(valid.state.transactions[0].specificationStatus,'linked');assert.equal(valid.state.transactions[1].specificationStatus,'linked');assert.equal(valid.state.allocations.length,0); // Equal-sized payments still require duplicate/identity review.
});

test('V3 competing bare Ustrd values cannot silently pay only the first invoice',()=>{
 for(const structured of ['', '<Strd><CdtrRefInf><Ref>0599</Ref></CdtrRefInf></Strd>']){
  const input=xml(detail().replace(/<RmtInf>[\s\S]*?<\/RmtInf>/,'<RmtInf>'+structured+'<Ustrd>0599</Ustrd><Ustrd>0600</Ustrd></RmtInf>'));
  const [row]=parseBankgiroXML(input);let s=invoice(invoice(setup()),{number:'0600',ocr:'0600',total:100000});s=importRows(s,[row]);
  assert.equal(reconcileState(s).state.allocations.length,0);assert.ok(analyze(s).every(f=>!f.safe));assert.equal(row.remittanceMessage,'0599\n0600');
 }
});

test('ISO reversal booleans and malformed reversal flags cannot become incoming payments',()=>{
 for(const flag of ['true','1','TRUE','yes'])assert.throws(()=>parseBankgiroXML(xml(detail(),'625.00',`<RvslInd>${flag}</RvslInd>`)),/Återför|återför|Ogiltig/);
 for(const flag of ['false','0'])assert.equal(parseBankgiroXML(xml(detail(),'625.00',`<RvslInd>${flag}</RvslInd>`))[0].amount,62500);
});

test('duplicate financial XML singletons never silently select the first bank fact',()=>{
 for(const [before,after]of [
  ['<Amt Ccy="SEK">625.00</Amt>','<Amt Ccy="SEK">625.00</Amt><Amt Ccy="SEK">999.00</Amt>'],
  ['<CdtDbtInd>CRDT</CdtDbtInd>','<CdtDbtInd>CRDT</CdtDbtInd><CdtDbtInd>DBIT</CdtDbtInd>'],
  ['<BookgDt><Dt>2026-10-26</Dt></BookgDt>','<BookgDt><Dt>2026-10-26</Dt><Dt>2026-10-25</Dt></BookgDt>'],
  ['<Dbtr><Nm>Café Gränden Bistro AB</Nm></Dbtr>','<Dbtr><Nm>Café Gränden Bistro AB</Nm><Nm>Annan betalare AB</Nm></Dbtr>'],
  ['<Refs><TxId>CHILD-1</TxId></Refs>','<Refs><TxId>CHILD-1</TxId><TxId>CHILD-2</TxId></Refs>'],
 ])assert.throws(()=>parseBankgiroXML(xml().replace(before,after)),/XML|tvetyd|flera/);
});

test('CSV dates cannot discard trailing content and XML date-times remain explicit',()=>{
 assert.throws(()=>parseBankgiroCSV(csv.replace('2026-10-26','2026-10-26fel')),/datum/);
 assert.throws(()=>parseBankgiroXML(xml().replace('<Dt>2026-10-26</Dt>','<Dt>2026-10-26fel</Dt>')),/datum/);
 assert.equal(parseBankgiroXML(xml().replace('<Dt>2026-10-26</Dt>','<DtTm>2026-10-26T12:30:00+01:00</DtTm>'))[0].date,'2026-10-26');
});

test('ambiguous CSV headers, column counts and malformed quoted payer names fail closed',()=>{
 for(const input of [
  csv.replace(';Belopp;',';Belopp;Inbetalningsbelopp;').replace(';625,00;',';625,00;999,00;'),
  csv.replace(';Avsändare;',';Avsändare;Betalare;').replace(';Café Gränden Bistro AB;',';Café Gränden Bistro AB;Annan kund;'),
  csv+';extra-column',
  csv.replace('Café Gränden Bistro AB','Café "Gränden" Bistro AB'),
  csv.replace('Café Gränden Bistro AB','"Café Gränden Bistro AB"annat'),
 ])assert.throws(()=>parseBankgiroCSV(input),/CSV|kolumn|citat|tvetyd/i);
 assert.equal(parseBankgiroCSV(csv.replace('Café Gränden Bistro AB','"Café ""Gränden""; Bistro AB"'))[0].party,'Café "Gränden"; Bistro AB');
});

