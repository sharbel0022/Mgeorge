import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../lib/domain.ts';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {makeBankgiroXLSX} from './helpers/bankgiro-xlsx-fixture.mjs';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';

const account='iban:SE4280000890119146168423';
function fixture(options={}){
 let state=domain.applyCommand(domain.emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,description:'Bankgiro inbetalning',party:'',payerReference:'',...options.bank})]}).state;
 state=domain.applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Annan syntetisk kund AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',due:'2026-10-31',reviewed:true}}).state;
 const payments=options.payments||[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],bytes=makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date:'2026-10-26',payments,...options.report});
 state=domain.applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-original',hash:'a'.repeat(64),name:'synthetic.xlsx',rows:parseSpecificationBytes(bytes,'synthetic.xlsx')}).state;
 const transaction=state.transactions.find(row=>!row.specification),specification=state.transactions.find(row=>row.specification);
 return {state,transaction,specification,command:{type:'bankgiro.link',transactionId:transaction.id,specificationId:specification.id,note:'Kontrollerat båda originalen och mottagarkontot.',confirmOriginals:true,confirmAccount:true}};
}
const financial=state=>({invoices:state.invoices,transactions:state.transactions,allocations:state.allocations,imports:state.imports});

test('XLSX missing or legacy currency evidence blocks source linking without changing money',()=>{
 for(const legacy of [false,true]){
  const f=fixture({report:{currency:legacy?'SEK':undefined}});if(legacy)delete f.specification.reportEvidence.currencySource;
  const before=structuredClone(financial(f.state)),candidate=domain.bankgiroLinkCandidates(f.state,f.transaction)[0];assert.equal(candidate.canLink,false);assert.match(candidate.reason,/valuta/i);
  assert.throws(()=>domain.applyCommand(f.state,f.command),/valuta/i);assert.deepEqual(financial(f.state),before);
 }
});

test('manual link retains both originals and every financial field without counting report money',()=>{
 const f=fixture(),result=domain.applyCommand(f.state,f.command),link=result.state.bankgiroLinks[0];
 assert.deepEqual(financial(result.state),financial(f.state));assert.equal(link.method,'manual_review');assert.equal(link.transactionId,f.transaction.id);assert.deepEqual(link.specificationIds,[f.specification.id]);assert.equal(link.documentId,'synthetic-original');assert.equal(link.sha256,'a'.repeat(64));assert.equal(link.note,f.command.note);
 assert.equal(domain.economicTransactions(result.state).length,1);assert.equal(domain.economicTransactions(result.state)[0].amount,62500);assert.equal(domain.balance(result.state,result.state.invoices[0]),62500);assert.equal(result.state.allocations.length,0);
 assert.equal(domain.activeBankgiroLink(result.state,f.transaction.id).rows[0].payerReference,'0599');
});
test('candidate is a proposal only and same date amount does not mutate originals',()=>{
 const f=fixture(),before=structuredClone(f.state),[candidate]=domain.bankgiroLinkCandidates(f.state,f.transaction);
 assert.equal(candidate.specificationId,f.specification.id);assert.equal(candidate.canLink,true);assert.equal(candidate.dateDifference,0);assert.deepEqual(f.state,before);assert.equal(domain.activeBankgiroLink(f.state,f.transaction.id),undefined);
});
test('manual relation covers the entire complete multi-payer report group',()=>{
 const f=fixture({payments:[{party:'Test A AB',reference:'0599',payerBankgiro:'987-6543',amount:12500},{party:'Test B AB',reference:'0600',payerBankgiro:'123-4567',amount:50000}]}),result=domain.applyCommand(f.state,f.command);
 assert.equal(result.state.bankgiroLinks[0].specificationIds.length,2);assert.equal(domain.activeBankgiroLink(result.state,f.transaction.id).rows.length,2);assert.deepEqual(financial(result.state),financial(f.state));assert.equal(domain.economicTransactions(result.state).length,1);
});
test('a complete later report retains shared observations from an earlier partial report',()=>{
 const first={party:'Test A AB',reference:'0599',payerBankgiro:'987-6543',amount:25000},second={party:'Test B AB',reference:'0600',payerBankgiro:'123-4567',amount:37500},f=fixture({payments:[first]});
 const complete=domain.applyCommand(f.state,{type:'bankgiro.import',documentId:'complete-original',hash:'b'.repeat(64),name:'complete.xlsx',rows:parseSpecificationBytes(makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date:'2026-10-26',sequence:'42',payments:[first,second]}),'complete.xlsx')}).state;
 const candidates=domain.bankgiroLinkCandidates(complete,f.transaction),candidate=candidates.find(item=>item.rows.some(row=>row.bankFileProof.documentId==='complete-original'));
 assert.equal(candidate.rows.length,2);assert.equal(candidate.canLink,true);assert.equal(candidates.find(item=>item.specificationId===f.specification.id),undefined);assert.throws(()=>domain.applyCommand(complete,f.command),/summa|belopp/i);
 const linked=domain.applyCommand(complete,{...f.command,specificationId:candidate.specificationId}).state;assert.equal(domain.activeBankgiroLink(linked,f.transaction.id).rows.length,2);assert.equal(domain.economicTransactions(linked).length,1);assert.equal(linked.transactions.filter(row=>row.bankFileProof?.documentId==='synthetic-original').length,1);
});
test('same pair is idempotent and cannot create a second active relation',()=>{
 const f=fixture(),first=domain.applyCommand(f.state,f.command).state,second=domain.applyCommand(first,f.command).state;
 assert.deepEqual(second,first);assert.equal(second.bankgiroLinks.length,1);
});
test('report group cannot attach to another bank transaction with identical date and amount',()=>{
 const f=fixture();f.state=domain.applyCommand(f.state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'DISTINCT-SYNTHETIC-ENTRY',description:'Bankgiro inbetalning'})]}).state;
 const other=f.state.transactions.find(row=>!row.specification&&row.id!==f.transaction.id),linked=domain.applyCommand(f.state,f.command).state;
 assert.throws(()=>domain.applyCommand(linked,{...f.command,transactionId:other.id}),/redan.*koppl|annan bankhändelse/i);
});
test('the same semantic report in different XLSX originals cannot be claimed by two distinct AIS deposits',()=>{
 for(const legacy of [false,true]){
  const f=fixture(),bank=domain.applyCommand(f.state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'SECOND-INDEPENDENT-AIS',description:'Bankgiro inbetalning'})]}).state;
  const secondBank=bank.transactions.find(row=>!row.specification&&row.id!==f.transaction.id),rows=parseSpecificationBytes(makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date:'2026-10-26',shiftRows:1,payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),'layout-variant.xlsx'),both=domain.applyCommand(bank,{type:'bankgiro.import',rows,documentId:'layout-variant-original',hash:'b'.repeat(64),name:'layout-variant.xlsx'}).state;
  const secondSpec=both.transactions.find(row=>row.bankFileProof?.documentId==='layout-variant-original'),linked=domain.applyCommand(both,f.command).state;
  if(legacy)delete linked.bankgiroLinks[0].reportKey;
  const candidate=domain.bankgiroLinkCandidates(linked,secondBank).find(item=>item.specificationId===secondSpec.id);
  assert.equal(candidate.canLink,false);assert.match(candidate.reason,/rapport|specifikation.*redan|redan.*koppl/i);
  assert.throws(()=>domain.applyCommand(linked,{...f.command,transactionId:secondBank.id,specificationId:secondSpec.id}),/rapport|specifikation.*redan|redan.*koppl/i);
  assert.deepEqual(financial(linked),financial(both));assert.equal(linked.bankgiroLinks.length,1);
  const revoked=domain.applyCommand(linked,{type:'bankgiro.unlink',id:linked.bankgiroLinks[0].id,note:'Fel AIS vald; båda original kontrolleras på nytt.'}).state;
  assert.equal(domain.applyCommand(revoked,{...f.command,transactionId:secondBank.id,specificationId:secondSpec.id}).state.bankgiroLinks.length,2);
 }
});
test('distinct report sequence numbers preserve two independent equal-value deposits',()=>{
 const f=fixture(),state=domain.applyCommand(f.state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'SECOND-INDEPENDENT-AIS',description:'Bankgiro inbetalning'})]}).state,secondBank=state.transactions.find(row=>!row.specification&&row.id!==f.transaction.id);
 const rows=parseSpecificationBytes(makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date:'2026-10-26',sequence:'42',payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),'distinct-report.xlsx'),both=domain.applyCommand(state,{type:'bankgiro.import',rows,documentId:'distinct-report-original',hash:'b'.repeat(64),name:'distinct-report.xlsx'}).state,secondSpec=both.transactions.find(row=>row.bankFileProof?.documentId==='distinct-report-original'),linked=domain.applyCommand(both,f.command).state;
 assert.equal(domain.bankgiroLinkCandidates(linked,secondBank).find(item=>item.specificationId===secondSpec.id).canLink,true);assert.equal(domain.applyCommand(linked,{...f.command,transactionId:secondBank.id,specificationId:secondSpec.id}).state.bankgiroLinks.length,2);
});
test('wrong or missing explicit recipient account blocks manual linking despite checkbox',()=>{
 for(const report of [{account:'SE2080000890119146168431'},{account:''}]){const f=fixture({report});assert.equal(domain.bankgiroLinkCandidates(f.state,f.transaction)[0].canLink,false);assert.throws(()=>domain.applyCommand(f.state,f.command),/konto/i);}
});
test('a documented date difference up to three days is retained but never inferred silently',()=>{
 const f=fixture({report:{date:'2026-10-28'}});assert.equal(domain.bankgiroLinkCandidates(f.state,f.transaction)[0].dateDifference,2);
 assert.throws(()=>domain.applyCommand(f.state,f.command),/datum.*förklar|datumskillnad/i);
 const result=domain.applyCommand(f.state,{...f.command,dateDifferenceNote:'Bankens specifikation har senare avräkningsdatum.'});assert.equal(result.state.bankgiroLinks[0].dateDifferenceNote,'Bankens specifikation har senare avräkningsdatum.');assert.deepEqual(financial(result.state),financial(f.state));
});
test('more than three days between originals is outside the manual linking boundary',()=>{const f=fixture({report:{date:'2026-10-30'}});assert.throws(()=>domain.applyCommand(f.state,{...f.command,dateDifferenceNote:'Otillräcklig förklaring'}),/datum|dagar/i);});
test('wrong report sum and incomplete individual rows cannot attach',()=>{
 for(const mutate of [f=>{f.specification.amount=62499;},f=>{f.specification.specificationCount=2;},f=>{f.specification.specificationTotal=62501;}]){const f=fixture();mutate(f);assert.throws(()=>domain.applyCommand(f.state,f.command),/summa|antal|fullständig|belopp/i);}
});
test('manual relation needs both explicit confirmations and a review note',()=>{for(const extra of [{confirmOriginals:false},{confirmAccount:false},{note:''}]){const f=fixture();assert.throws(()=>domain.applyCommand(f.state,{...f.command,...extra}),/bekräft|kontroller|beskriv|anteckning/i);}});
test('AIS original receipt integrity cannot be overridden by a manual relation',()=>{for(const mutate of [f=>{delete f.transaction.bankDataSha256;},f=>{f.transaction.bankData.transaction_amount.amount='624.00';},f=>{f.transaction.bankReference='ALTERED';}]){const f=fixture();mutate(f);assert.throws(()=>domain.applyCommand(f.state,f.command),/original|bankuppgift|bank-ID|kvitto|kontrollsumma/i);}});
test('review specification cannot substitute a forged original or unrelated detail response for retained observations',()=>{for(const mutate of [f=>{f.specification.original.party='Förfalskad originalavsändare';},f=>{f.specification.original.payerReference='9999';},f=>{f.specification.bankDetails={status:'identified',party:'Förfalskat detaljnamn',payerReference:'9999'};}]){const f=fixture();mutate(f);assert.throws(()=>domain.applyCommand(f.state,f.command),/original|uppgifter|specifikation/i);}});
test('linked presentation becomes inactive if an original financial snapshot changes',()=>{
 for(const mutate of [s=>{s.transactions[0].amount++;},s=>{s.transactions[1].party='Ändrad observation';},s=>{s.transactions[1].bankFileProof.sha256='b'.repeat(64);},s=>{s.transactions[0].bankData.note='Changed raw original';}]){const f=fixture(),s=domain.applyCommand(f.state,f.command).state;mutate(s);assert.equal(domain.activeBankgiroLink(s,f.transaction.id),undefined);}
});
test('unlink is reversible audit data and preserves originals, balances and active allocations',()=>{
 const f=fixture(),linked=domain.applyCommand(f.state,f.command).state,id=linked.bankgiroLinks[0].id,result=domain.applyCommand(linked,{type:'bankgiro.unlink',id,note:'Originalens samband behöver kontrolleras på nytt.'});
 assert.equal(domain.activeBankgiroLink(result.state,f.transaction.id),undefined);assert.ok(result.state.bankgiroLinks[0].revokedAt);assert.match(result.state.bankgiroLinks[0].revocationNote,/på nytt/);assert.deepEqual(financial(result.state),financial(f.state));
 assert.throws(()=>domain.applyCommand(linked,{type:'bankgiro.unlink',id,note:''}),/beskriv|anteckning/i);
 assert.equal(domain.applyCommand(result.state,f.command).state.bankgiroLinks.length,2);
});


for(const [label,patch] of [
 ['zero-padded sequence',{sequence:'00041'}],
 ['changed payer',{payments:[{party:'Different synthetic payer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}],
 ['changed reference',{payments:[{party:'Syntetiskt café AB',reference:'0600',payerBankgiro:'987-6543',amount:62500}]}],
 ['different day within the same year',{date:'2026-10-27'}],
 ['formatted recipient bankgiro',{recipientBankgiro:'12345678'}]
])for(const legacy of [false,true])test('one ELIN deposit with '+label+' cannot be reserved for two AIS entries'+(legacy?' by a legacy link':''),()=>{
 const f=fixture(),bank=domain.applyCommand(f.state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'SECOND-ELIN-DEPOSIT',description:'Bankgiro inbetalning'})]}).state;
 const secondBank=bank.transactions.find(row=>!row.specification&&row.id!==f.transaction.id);
 const rows=parseSpecificationBytes(makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date:'2026-10-26',payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...patch}),'variant.xlsx');
 const both=domain.applyCommand(bank,{type:'bankgiro.import',rows,documentId:'variant-original',hash:'e'.repeat(64),name:'variant.xlsx'}).state,secondSpec=both.transactions.find(row=>row.bankFileProof?.documentId==='variant-original'),linked=domain.applyCommand(both,f.command).state;
 if(legacy)delete linked.bankgiroLinks[0].reportKey;
 const before=structuredClone(financial(linked)),candidate=domain.bankgiroLinkCandidates(linked,secondBank).find(row=>row.specificationId===secondSpec.id);
 assert.equal(candidate.canLink,false);assert.match(candidate.reason,/rapport|insättning|specifikation/i);
 assert.throws(()=>domain.applyCommand(linked,{...f.command,transactionId:secondBank.id,specificationId:secondSpec.id,dateDifferenceNote:'Synthetic date review.'}),/rapport|insättning|specifikation/i);
 assert.equal(linked.bankgiroLinks.length,1);assert.equal(linked.allocations.length,0);assert.deepEqual(financial(linked),before);
 const revoked=domain.applyCommand(linked,{type:'bankgiro.unlink',id:linked.bankgiroLinks[0].id,note:'Separately approved synthetic source correction.'}).state;
 assert.equal(domain.applyCommand(revoked,{...f.command,transactionId:secondBank.id,specificationId:secondSpec.id,dateDifferenceNote:'Synthetic date review.'}).state.bankgiroLinks.length,2);
});
for(const [label,patch] of [
 ['sequence',{sequence:'42'}],
 ['year',{date:'2027-10-26'}],
 ['recipient bankgiro',{recipientBankgiro:'8765-4321'}]
])test('ELIN deposit reservation is scoped by '+label,()=>{
 const f=fixture(),date=patch.date||'2026-10-26',bank=domain.applyCommand(f.state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date,amount:62500,bankReference:'OTHER-SCOPED-ELIN-DEPOSIT',description:'Bankgiro inbetalning'})]}).state,secondBank=bank.transactions.find(row=>!row.specification&&row.id!==f.transaction.id);
 const rows=parseSpecificationBytes(makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date,payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}],...patch}),'distinct.xlsx'),both=domain.applyCommand(bank,{type:'bankgiro.import',rows,documentId:'distinct-scoped-original',hash:'f'.repeat(64),name:'distinct.xlsx'}).state,secondSpec=both.transactions.find(row=>row.bankFileProof?.documentId==='distinct-scoped-original'),linked=domain.applyCommand(both,f.command).state;
 assert.equal(domain.bankgiroLinkCandidates(linked,secondBank).find(row=>row.specificationId===secondSpec.id).canLink,true);
 assert.equal(domain.applyCommand(linked,{...f.command,transactionId:secondBank.id,specificationId:secondSpec.id}).state.bankgiroLinks.length,2);
 assert.equal(linked.allocations.length,0);
});

for(const [firstGiro,secondGiro] of [['123-4566','0123-4566'],['0123-4566','123-4566']])test('Sites rejects a stale second reservation when recipient Bankgiro padding changes from '+firstGiro+' to '+secondGiro,()=>{
 const f=fixture({report:{recipientBankgiro:firstGiro}}),bank=domain.applyCommand(f.state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'SYNTHETIC-PADDED-GIRO-SECOND',description:'Bankgiro inbetalning'})]}).state,secondBank=bank.transactions.find(row=>!row.specification&&row.id!==f.transaction.id);
 const rows=parseSpecificationBytes(makeBankgiroXLSX({currency:'SEK',account:account.slice(5),date:'2026-10-26',sequence:'41',recipientBankgiro:secondGiro,payments:[{party:'Syntetiskt café AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}),'padded-giro.xlsx'),both=domain.applyCommand(bank,{type:'bankgiro.import',rows,documentId:'padded-giro-original',hash:'e'.repeat(64),name:'padded-giro.xlsx'}).state,secondSpec=both.transactions.find(row=>row.bankFileProof?.documentId==='padded-giro-original');
 const stale=domain.bankgiroLinkCandidates(both,secondBank).find(row=>row.specificationId===secondSpec.id);assert.equal(stale.canLink,true);
 assert.equal(both.transactions.find(row=>row.id===f.specification.id).recipientBankgiro,firstGiro);assert.equal(secondSpec.recipientBankgiro,secondGiro);
 const before=structuredClone(financial(both)),linked=domain.applyCommand(both,f.command).state,command={...f.command,transactionId:secondBank.id,specificationId:stale.specificationId};
 const current=domain.bankgiroLinkCandidates(linked,secondBank).find(row=>row.specificationId===secondSpec.id);
 assert.equal(current.canLink,false);assert.match(current.reason,/insättning|rapport|koppl/i);
 assert.throws(()=>domain.applyCommand(linked,command),/insättning|rapport|koppl/i);
 assert.equal(linked.bankgiroLinks.filter(link=>!link.revokedAt).length,1);assert.equal(linked.allocations.length,0);assert.deepEqual(financial(linked),before);
 assert.equal(linked.transactions.find(row=>row.id===f.specification.id).recipientBankgiro,firstGiro);assert.equal(linked.transactions.find(row=>row.id===secondSpec.id).recipientBankgiro,secondGiro);
});
