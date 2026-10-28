import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listTransactions} from '../src/db.js';
import {normalizeBankApiTransaction,parseCSV,parseCAMT} from '../src/importers.js';
import {digest} from '../src/security.js';
import {reconciliationData} from '../src/reconciliation.js';

const raw=(more={})=>({status:'BOOK',entry_reference:'ARCHIVE-1',transaction_id:'temporary',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:'625.00',currency:'SEK'},debtor:{name:'Testkund AB'},reference_number:'0599',details:{invoice_number:'0600'},...more});
function fixture(t){const folder=mkdtempSync(join(tmpdir(),'mg-ref-')),db=openDatabase(join(folder,'db.sqlite'));t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});return db;}
test('bank original and all reference candidates survive SQLite, duplicate sync and changed response',t=>{const db=fixture(t);const input=raw(),normalized=normalizeBankApiTransaction(input,'account');storeTransactions(db,[normalized],'enablebanking');const saved=listTransactions(db)[0];assert.deepEqual(saved.raw_bank_data,input);assert.equal(saved.reference_evidence.candidates.length,2);input.details.invoice_number='changed-after-normalization';assert.equal(normalized.raw_bank_data.details.invoice_number,'0600');const again=storeTransactions(db,[normalizeBankApiTransaction(raw({transaction_id:'new-lookup',reference_number:'changed'}),'account')],'enablebanking');assert.equal(again.duplicate,1);assert.deepEqual(listTransactions(db)[0].raw_bank_data,saved.raw_bank_data);assert.equal(listTransactions(db).length,1);});
test('conflicting repeat bank amounts roll back the complete batch and preserved originals',t=>{const db=fixture(t);storeTransactions(db,[normalizeBankApiTransaction(raw(),'account')],'enablebanking');assert.throws(()=>storeTransactions(db,[normalizeBankApiTransaction(raw({entry_reference:'NEW'}),'account'),normalizeBankApiTransaction(raw({transaction_amount:{amount:'626.00',currency:'SEK'}}),'account')],'enablebanking'));assert.equal(listTransactions(db).length,1);assert.equal(listTransactions(db)[0].amount_cents,62500);});
test('CSV retains OCR and invoice fields separately with original column names',()=>{const [x]=parseCSV('Datum;Belopp;OCR;Fakturanummer;Betalare\n2026-10-26;625,00;1234567897;0599;Testkund AB');assert.equal(x.reference,'1234567897');assert.ok(x.reference_evidence.candidates.some(c=>c.value==='0599'&&c.source.includes('Fakturanummer')));});
test('camt keeps structured references and referred invoice numbers together',()=>{const [x]=parseCAMT('<Document><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-26</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Strd><CdtrRefInf><Ref>1234567897</Ref></CdtrRefInf><RfrdDocInf><Nb>0599</Nb></RfrdDocInf></Strd><Ustrd>Faktura 0599</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>');assert.ok(x.reference_evidence.candidates.some(c=>c.value==='0599'));assert.ok(x.reference_evidence.candidates.some(c=>c.source.includes('CdtrRefInf')));});
test('a later verified API response attaches missing raw evidence without replacing existing financial fields',t=>{const db=fixture(t),first=normalizeBankApiTransaction(raw(),'account');delete first.raw_bank_data;delete first.reference_evidence;storeTransactions(db,[first],'enablebanking');const before=listTransactions(db)[0];storeTransactions(db,[normalizeBankApiTransaction(raw({reference_number:'0600'}),'account')],'enablebanking');const after=listTransactions(db)[0];assert.equal(after.id,before.id);assert.equal(after.reference,'0599');assert.equal(after.raw_bank_data.reference_number,'0600');assert.equal(after.amount_cents,before.amount_cents);assert.equal(listTransactions(db).length,1);});

test('retained bank original stores a separate SHA-256 of its exact bytes',t=>{
  const db=fixture(t),content=Buffer.from('Datum;Belopp;Betalare;Referens\n2026-10-26;625;Testkund AB;0599\n');
  const result=storeTransactions(db,parseCSV(content.toString(),'MG'),'file:bank.csv',{content,mime_type:'text/csv'});
  const original=db.prepare('SELECT content,content_sha256 FROM import_jobs WHERE id=?').get(result.import_id);
  assert.equal(original.content_sha256,digest(content));assert.deepEqual(Buffer.from(original.content),content);
});

test('tampered retained file cannot remain verified automatic payment evidence',t=>{
  const db=fixture(t),content=Buffer.from('Datum;Belopp;Betalare;Referens\n2026-10-26;625;Testkund AB;0599\n');
  const result=storeTransactions(db,parseCSV(content.toString(),'MG'),'file:bank.csv',{content,mime_type:'text/csv'});
  assert.equal(reconciliationData(db).transactions[0].verified,true);
  db.prepare('UPDATE import_jobs SET content=? WHERE id=?').run(Buffer.from('changed original'),result.import_id);
  assert.equal(reconciliationData(db).transactions[0].verified,false);
});

test('preserved API bank JSON has its own immutable SHA-256 independent of references',t=>{
  const db=fixture(t),original=raw();storeTransactions(db,[normalizeBankApiTransaction(original,'MG')],'enablebanking');
  const before=listTransactions(db)[0];assert.equal(before.raw_bank_data_sha256,digest(JSON.stringify(original)));
  storeTransactions(db,[normalizeBankApiTransaction(raw({reference_number:'changed'}),'MG')],'enablebanking');
  assert.equal(listTransactions(db)[0].raw_bank_data_sha256,before.raw_bank_data_sha256);
  db.prepare('UPDATE bank_transactions SET raw_bank_data=? WHERE id=?').run(JSON.stringify({...original,debtor:{name:'Tampered'}}),before.id);
  assert.equal(reconciliationData(db).transactions[0].verified,false);
  db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256='' WHERE id=?").run(before.id);
  assert.equal(reconciliationData(db).transactions[0].verified,false);
});

test('legacy API identity without retained bank original remains review-only',t=>{
  const db=fixture(t),payment=normalizeBankApiTransaction(raw(),'MG');delete payment.raw_bank_data;
  storeTransactions(db,[payment],'enablebanking');
  assert.equal(reconciliationData(db).transactions[0].verified,false);
});

test('additive original hash migration retains historical bytes and import identities',t=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-hash-upgrade-')),path=join(folder,'db.sqlite');let db=openDatabase(path);
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  const content=Buffer.from('Datum;Belopp\n2026-10-26;625\n'),result=storeTransactions(db,parseCSV(content.toString(),'MG'),'file:legacy.csv',{content,mime_type:'text/csv'});
  const before=listTransactions(db)[0];db.exec('ALTER TABLE import_jobs DROP COLUMN content_sha256;');db.close();db=openDatabase(path);
  const after=db.prepare('SELECT content,content_sha256 FROM import_jobs WHERE id=?').get(result.import_id);
  assert.equal(after.content_sha256,digest(content));assert.deepEqual(Buffer.from(after.content),content);assert.equal(listTransactions(db)[0].id,before.id);
});

test('API SHA migration hashes retained originals atomically while missing originals stay unverified',t=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-api-hash-upgrade-')),path=join(folder,'db.sqlite');let db=openDatabase(path);
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  const genuine=normalizeBankApiTransaction(raw(),'MG'),missing=normalizeBankApiTransaction(raw({entry_reference:'MISSING-ORIGINAL'}),'MG');delete missing.raw_bank_data;
  storeTransactions(db,[genuine,missing],'enablebanking');const before=listTransactions(db);
  db.exec('ALTER TABLE bank_transactions DROP COLUMN raw_bank_data_sha256;');db.close();db=openDatabase(path);
  const transactions=reconciliationData(db).transactions;
  assert.equal(transactions.find(x=>x.bank_reference==='ARCHIVE-1').verified,true);
  assert.equal(transactions.find(x=>x.bank_reference==='MISSING-ORIGINAL').verified,false);
  assert.deepEqual(new Set(transactions.map(x=>x.id)),new Set(before.map(x=>x.id)));
  assert.deepEqual(transactions.find(x=>x.bank_reference==='ARCHIVE-1').raw_bank_data,genuine.raw_bank_data);
});
