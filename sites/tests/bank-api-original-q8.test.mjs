import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url).pathname;
const url=p=>pathToFileURL(root+p).href,data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(root+path,'utf8'),{mode:'transform'});for(const [name,value]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(value));return data(code);}
const domain=url('lib/domain.ts'),engine=url('lib/reconciliation-engine.js');
const {emptyState,applyCommand,balance,invoicePaymentEvidenceIssue,hasValidAbsenceCheck,paymentOriginalIssue}=await import(domain);
const reconciliation=compiled('lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const {reconcileWithOriginals,assertPaymentOriginal}=await import(compiled('lib/reconciliation-evidence.ts',{'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./server':data('export async function readBankOriginalBytes(){throw Error("No file original requested in this API-only fixture");}')}));
const {normalizeTransactions}=await import(compiled('lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('lib/payment-references.js')}));
async function state(){
 const raw={status:'BOOK',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',debtor:{name:'Synthetic customer AB'},reference_number:'000018',entry_reference:'Q8-SYNTHETIC-API-ORIGINAL'};
 const normalized=await normalizeTransactions([raw],{accountKey:'iban:SE4280000890119146168423',accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});
 let s=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'SYNTHETIC-Q8',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 return applyCommand(s,{type:'transactions.import',trustedBankImport:true,name:'Synthetic API',rows:normalized.rows}).state;
}
test('positive: retained provider original supports an exact synthetic allocation',async()=>{
 const s=await state(),result=await reconcileWithOriginals('synthetic-owner',s);
 assert.equal(result.state.allocations.filter(a=>a.active).length,1);
});
for(const [label,damage]of [
 ['changed payer in retained API original',t=>{t.bankData.debtor.name='Different synthetic payer';}],
 ['changed amount in retained API original',t=>{t.bankData.transaction_amount.amount='700.00';}],
 ['lost retained API original',t=>{delete t.bankData;}],
 ['unbooked retained API original',t=>{t.bankData.status='PDNG';}]
])test(label+' must not remain an original-verified automatic payment',async()=>{
 const s=await state();damage(s.transactions[0]);
 const result=await reconcileWithOriginals('synthetic-owner',s);
 assert.equal(result.state.allocations.filter(a=>a.active).length,0);
 assert.ok(result.state.transactions[0].bankOriginalIssue);
});
test('provider normalization retains a versioned checksum of the complete received JSON',async()=>{
 const s=await state(),t=s.transactions[0];assert.equal(t.bankDataVersion,'bank-api-original-v1');assert.equal(t.bankDataSha256,createHash('sha256').update(JSON.stringify(t.bankData),'utf8').digest('hex'));assert.equal(t.bankData.debtor.name,'Synthetic customer AB');
});
for(const damage of [t=>{t.bankData.transaction_amount.amount='700.00';},t=>{delete t.bankData;},t=>{delete t.bankDataSha256;}])test('manual proof cannot override a changed or absent bank API original',async()=>{
 const s=await state();damage(s.transactions[0]);await assert.rejects(assertPaymentOriginal('synthetic-owner',s,s.transactions[0].id),/original|kontrollsumma|bankuppgif/i);assert.throws(()=>applyCommand(s,{type:'transaction.verify',id:s.transactions[0].id,party:'Synthetic customer AB',payerReference:'000018',note:'Free text is not a replacement for the received original.'}),/original|kontrollsumma|bankuppgif/i);
});
test('an existing allocation keeps its money but loses current proof when the API original is damaged',async()=>{
 const before=await state(),s=(await reconcileWithOriginals('synthetic-owner',before)).state,allocation=structuredClone(s.allocations[0]);s.transactions[0].bankData.debtor.name='Changed original';assert.equal(balance(s,s.invoices[0]),0);assert.match(invoicePaymentEvidenceIssue(s,s.invoices[0].id),/original|kontrollsumma|bankuppgif/i);assert.deepEqual(s.allocations[0],allocation);
});
test('a forged current projection cannot replace the bank payer without an explicit retained verification',async()=>{
 const s=await state();s.transactions[0].party='Different synthetic payer';s.invoices[0].party='Different synthetic payer';assert.equal((await reconcileWithOriginals('synthetic-owner',s)).state.allocations.length,0);
});
test('explicit separate manual verification preserves the original bank payer and checksum',async()=>{
 const original=await state(),bank=structuredClone(original.transactions[0]);const s=applyCommand(original,{type:'transaction.verify',id:bank.id,party:'Separately verified synthetic payer',payerReference:'000018',note:'Synthetic independently checked identity correction'}).state;assert.deepEqual(s.transactions[0].bankData,bank.bankData);assert.deepEqual(s.transactions[0].original,bank.original);assert.equal(s.transactions[0].bankDataSha256,bank.bankDataSha256);assert.equal(s.transactions[0].verification.party,'Separately verified synthetic payer');await assertPaymentOriginal('synthetic-owner',s,bank.id);
});
test('new receipt loss and missing old receipt cannot become current absence evidence',async()=>{
 for(const old of [false,true]){const s=await state();delete s.transactions[0].bankDataSha256;if(old)delete s.transactions[0].bankDataVersion;s.invoices[0].reconciledAt='2026-10-27T00:00:00Z';s.invoices[0].reconciliationNote='A previous full period check';assert.equal(hasValidAbsenceCheck(s,s.invoices[0]),false);assert.throws(()=>applyCommand(s,{type:'invoice.reconcile',id:s.invoices[0].id,confirm:true,note:'New free text'}),/original|bankunderlag|bankuppgif/i);}
});
test('fresh identical provider evidence establishes a missing old receipt once without more money',async()=>{
 const fresh=await state(),s=structuredClone(fresh),raw=structuredClone(s.transactions[0]);delete s.transactions[0].bankDataSha256;delete s.transactions[0].bankDataVersion;const normalized=await normalizeTransactions([raw.bankData],{accountKey:raw.account,accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});const after=applyCommand(s,{type:'transactions.import',trustedBankImport:true,name:'Fresh synthetic evidence',rows:normalized.rows}).state;assert.equal(after.transactions.length,1);assert.equal(after.transactions[0].bankDataSha256,fresh.transactions[0].bankDataSha256);assert.equal(after.transactions[0].bankDataVersion,'bank-api-original-v1');assert.deepEqual(after.transactions[0].original,s.transactions[0].original);assert.deepEqual(after.transactions[0].bankData,s.transactions[0].bankData);assert.equal((await reconcileWithOriginals('synthetic-owner',after)).state.allocations.length,1);
});
test('raw hash and account-scoped provider identity both must agree',async()=>{
 const s=await state();s.transactions[0].account='iban:SE4550000000058398257466';s.transactions[0].original.account=s.transactions[0].account;assert.equal((await reconcileWithOriginals('synthetic-owner',s)).state.allocations.length,0);
});

for(const [label,mutate]of [
 ['current reference',t=>{t.payerReference='000026';}],
 ['original reference',t=>{t.original.payerReference='000026';}],
 ['current bank identifier',t=>{t.bankReference='FORGED';}],
 ['current date',t=>{t.date='2026-10-27';}],
 ['current description',t=>{t.description='Changed projection';}],
 ['original description',t=>{t.original.description='Changed original projection';}],
 ['reference evidence',t=>{t.referenceEvidence={candidates:[],incomplete:false};}],
 ['receipt version',t=>{t.bankDataVersion='unknown-v2';}],
 ['malformed receipt',t=>{t.bankDataSha256='not-a-hash';}],
 ['empty raw object',t=>{t.bankData={};}],
 ['null raw object',t=>{t.bankData=null;}],
 ['array raw object',t=>{t.bankData=[];}],
])test('retained API evidence detects '+label+' without modifying its original or allocation',async()=>{
 const s=await state();mutate(s.transactions[0]);const before=JSON.stringify(s);assert.ok(paymentOriginalIssue(s,s.transactions[0]));assert.equal(JSON.stringify(s),before);assert.equal((await reconcileWithOriginals('synthetic-owner',s)).state.allocations.length,0);
});
test('manual specification remains protected by its API ancestor and preserves recorded child money',async()=>{
 const s=await state(),split=applyCommand(s,{type:'transaction.split',id:s.transactions[0].id,rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]}).state,child=split.transactions.find(t=>t.parentId);
 const matched=applyCommand(split,{type:'match.create',invoiceId:split.invoices[0].id,transactionId:child.id,amount:62500,note:'Synthetic specification verified separately'}).state;
 assert.equal(paymentOriginalIssue(matched,matched.transactions[1]),'');const before=structuredClone(matched.allocations);
 delete matched.transactions[0].bankData;assert.ok(paymentOriginalIssue(matched,matched.transactions[1]));assert.equal(balance(matched,matched.invoices[0]),0);assert.deepEqual(matched.allocations,before);
 const unallocated=structuredClone(split);delete unallocated.transactions[0].bankData;assert.equal((await reconcileWithOriginals('synthetic-owner',unallocated)).state.allocations.length,0);
});
test('a current collection label cannot be changed into an individual payment despite a valid raw checksum',async()=>{
 const raw={status:'BOOK',transaction_amount:{amount:'625.00',currency:'SEK'},credit_debit_indicator:'CRDT',booking_date:'2026-10-26',debtor:{name:'Synthetic customer AB'},reference_number:'000018',entry_reference:'SYNTHETIC-AGGREGATE',bank_transaction_code:{description:'Samlingsinsättning'}};
 const normalized=await normalizeTransactions([raw],{accountKey:'Synthetic account',accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});let s=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;
 const t=s.transactions[0];assert.equal(t.kind,'batch');assert.equal(paymentOriginalIssue(s,t),'');t.kind='payment';t.verified=true;t.description='';t.original.description='';assert.ok(paymentOriginalIssue(s,t));
});
test('in-place raw mutation cannot reuse an earlier successful checksum cache',async()=>{
 const s=await state(),t=s.transactions[0];assert.equal(paymentOriginalIssue(s,t),'');t.bankData.debtor.name='Changed after first validation';assert.ok(paymentOriginalIssue(s,t));
});
test('a new receipt marker with a missing checksum cannot be repaired as unversioned evidence',async()=>{
 const s=await state(),t=s.transactions[0],raw=structuredClone(t.bankData);delete t.bankDataSha256;
 const normalized=await normalizeTransactions([raw],{accountKey:t.account,accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});const after=applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;assert.equal(after.transactions[0].bankDataSha256,undefined);assert.ok(paymentOriginalIssue(after,after.transactions[0]));
});
test('contradictory fresh bank evidence keeps both original receipts and all prior money',async()=>{
 const s=(await reconcileWithOriginals('synthetic-owner',await state())).state,t=s.transactions[0],raw=structuredClone(t.bankData),before=structuredClone(t),allocations=structuredClone(s.allocations);raw.debtor.name='A different bank payer';
 const normalized=await normalizeTransactions([raw],{accountKey:t.account,accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});const after=applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;
 assert.equal(after.transactions.length,1);assert.deepEqual(after.allocations,allocations);assert.deepEqual(after.transactions[0].bankData,before.bankData);assert.equal(after.transactions[0].bankDataSha256,before.bankDataSha256);const conflict=after.transactions[0].bankEvidenceConflicts[0];assert.deepEqual(conflict.incoming.bankData,raw);assert.equal(conflict.incoming.bankDataSha256,createHash('sha256').update(JSON.stringify(raw),'utf8').digest('hex'));assert.equal(conflict.incoming.bankDataVersion,'bank-api-original-v1');
});

for(const value of ['',null])test('review: present invalid receipt fields cannot be recovered as absent: '+JSON.stringify(value),async()=>{
 const s=(await reconcileWithOriginals('synthetic-owner',await state())).state,t=s.transactions[0];t.bankDataSha256=value;t.bankDataVersion=value;
 const before=structuredClone(s),normalized=await normalizeTransactions([structuredClone(t.bankData)],{accountKey:t.account,accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});
 const result=applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:normalized.rows}).state;
 assert.ok(paymentOriginalIssue(result,result.transactions[0]));assert.equal(result.transactions[0].bankDataSha256,value);assert.equal(result.transactions[0].bankDataVersion,value);assert.deepEqual(result.transactions[0],before.transactions[0]);assert.deepEqual(result.allocations,before.allocations);assert.equal(balance(result,result.invoices[0]),0);
});

for(const [label,damage]of [
 ['missing parent',(s,child)=>{s.transactions=s.transactions.filter(t=>t.id===child.id);}],
 ['missing intermediate parent',(_s,child)=>{child.parentId='missing-synthetic-middle';}],
 ['self cycle',(_s,child)=>{child.parentId=child.id;}],
 ['parent-child cycle',(s,child)=>{s.transactions.find(t=>t.id===child.parentId).parentId=child.id;}]
])test('review: '+label+' blocks split-child proof without inventing money or reversing history',async()=>{
 const s=await state(),split=applyCommand(s,{type:'transaction.split',id:s.transactions[0].id,rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]}).state,child=split.transactions.find(t=>t.parentId);
 assert.equal(paymentOriginalIssue(split,child),'');await assertPaymentOriginal('synthetic-owner',split,child.id);
 const allocated=applyCommand(split,{type:'match.create',invoiceId:split.invoices[0].id,transactionId:child.id,amount:62500,note:'Synthetic retained allocation.'}).state;
 damage(split,child);const before=structuredClone(split);assert.ok(paymentOriginalIssue(split,child));assert.deepEqual(split,before);
 await assert.rejects(assertPaymentOriginal('synthetic-owner',split,child.id));assert.throws(()=>applyCommand(split,{type:'transaction.verify',id:child.id,note:'A note cannot replace lost ancestry.'}));
 const result=await reconcileWithOriginals('synthetic-owner',split);assert.equal(result.state.allocations.length,0);assert.equal(result.state.transactions.length,split.transactions.length);assert.equal(balance(result.state,result.state.invoices[0]),62500);
 split.invoices[0].reconciledAt='2026-10-29T00:00:00.000Z';split.invoices[0].reconciliationNote='Prior synthetic period review.';assert.equal(hasValidAbsenceCheck(split,split.invoices[0]),false);
 damage(allocated,allocated.transactions.find(t=>t.id===child.id));const history=structuredClone(allocated.allocations);assert.ok(invoicePaymentEvidenceIssue(allocated,allocated.invoices[0].id));assert.equal(balance(allocated,allocated.invoices[0]),0);assert.deepEqual((await reconcileWithOriginals('synthetic-owner',allocated)).state.allocations,history);
});

for(const evidence of ['manual_verified','bank_file','bankgiro_file'])for(const [field,damage]of [
 ['payer',t=>{t.party='Changed synthetic payer';}],
 ['reference',t=>{t.payerReference='000026';}],
 ['reference evidence',t=>{t.referenceEvidence={candidates:[],incomplete:false};}]
])test('review: relabel to '+evidence+' cannot bypass current API '+field,async()=>{
 const s=await state(),t=s.transactions[0],original=structuredClone(t.original),raw=structuredClone(t.bankData);t.evidence=evidence;damage(t);s.invoices[0].party=t.party;s.invoices[0].ocr=t.payerReference;
 assert.ok(paymentOriginalIssue(s,t));await assert.rejects(assertPaymentOriginal('synthetic-owner',s,t.id));assert.equal((await reconcileWithOriginals('synthetic-owner',s)).state.allocations.length,0);assert.deepEqual(t.original,original);assert.deepEqual(t.bankData,raw);
});

test('review: an explicit manual verification remains valid under its separate label and does not rewrite API facts',async()=>{
 const s=await state(),original=structuredClone(s.transactions[0]);const verified=applyCommand(s,{type:'transaction.verify',id:original.id,party:'Separately reviewed synthetic payer',payerReference:'000026',note:'Synthetic independently retained identity verification.'}).state;
 verified.transactions[0].evidence='manual_verified';assert.equal(paymentOriginalIssue(verified,verified.transactions[0]),'');await assertPaymentOriginal('synthetic-owner',verified,original.id);assert.deepEqual(verified.transactions[0].original,original.original);assert.deepEqual(verified.transactions[0].bankData,original.bankData);assert.equal(verified.transactions[0].bankDataSha256,original.bankDataSha256);
 verified.transactions[0].payerReference='000018';assert.ok(paymentOriginalIssue(verified,verified.transactions[0]));
});

test('review: exact trusted file replay binds its own reference metadata while API and manual originals remain separate',async()=>{
 const api=await state(),provider=api.transactions[0],bytes=Buffer.from(`Datum;Belopp;Betalare;OCR;Referens;Valuta;Transaktions-id;Konto\n2026-10-26;625,00;Synthetic customer AB;000018;${provider.bankReference};SEK;${provider.externalId};${provider.account}`),hash=createHash('sha256').update(bytes).digest('hex'),documentId='synthetic-api-file';
 const {parseCSV,guessMapping,mapCSV}=await import(compiled('lib/imports.ts',{'./domain':domain,'./local-ocr':data('export async function imageText(){} export async function pdfInvoiceText(){}'),'./payment-references.js':url('lib/payment-references.js'),'./bankgiro-parser.js':url('lib/bankgiro-parser.js')}));
 const parsed=parseCSV(bytes.toString()),rows=mapCSV(parsed,guessMapping(parsed.headers),'Synthetic.csv'),fileCommand={type:'transactions.import',trustedBankFileImport:true,documentId,hash,name:'Synthetic.csv',rows};
 let s=applyCommand({...emptyState(),invoices:structuredClone(api.invoices)},fileCommand).state;
 const fresh=await normalizeTransactions([structuredClone(provider.bankData)],{accountKey:provider.account,accountLabel:'Synthetic account',bankName:'Synthetic bank',dateFrom:'2026-10-01',dateTo:'2026-10-30'});
 s=applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:fresh.rows}).state;assert.equal(s.transactions.length,1);
 const original=structuredClone(s.transactions[0].original),raw=structuredClone(s.transactions[0].bankData),receipt=s.transactions[0].bankDataSha256;
 s=applyCommand(s,fileCommand).state;assert.notDeepEqual(s.transactions[0].referenceEvidence,provider.referenceEvidence);assert.equal(paymentOriginalIssue(s,s.transactions[0]),'');
 const reader=await import(compiled('lib/reconciliation-evidence.ts',{'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./server':data(`export async function readBankOriginalBytes(owner,id){if(owner!=='synthetic-owner'||id!==${JSON.stringify(documentId)})throw Error('Wrong file owner or ID');return {sha256:${JSON.stringify(hash)},size:${bytes.length}};}`)}));
 s=await reader.assertPaymentOriginal('synthetic-owner',s,s.transactions[0].id);s=applyCommand(s,{type:'transaction.verify',id:s.transactions[0].id,note:'Synthetic exact retained file and account checked.'}).state;
 const result=await reader.reconcileWithOriginals('synthetic-owner',s);assert.equal(result.state.allocations.length,1);assert.equal(balance(result.state,result.state.invoices[0]),0);
 const payment=result.state.transactions[0];assert.deepEqual(payment.original,original);assert.deepEqual(payment.bankData,raw);assert.equal(payment.bankDataSha256,receipt);
 const allocations=structuredClone(result.state.allocations);payment.referenceEvidence={candidates:[],incomplete:false};assert.ok(paymentOriginalIssue(result.state,payment));await assert.rejects(reader.assertPaymentOriginal('synthetic-owner',result.state,payment.id));assert.deepEqual(result.state.allocations,allocations);
});
