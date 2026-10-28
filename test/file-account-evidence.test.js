import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listTransactions} from '../src/db.js';
import {parseCAMT} from '../src/importers.js';
import {analyzeReconciliation,reconciliationData} from '../src/reconciliation.js';
import {encryptObject} from '../src/security.js';

process.env.BANK_DATA_KEY='3'.repeat(64);delete process.env.ENCRYPTION_KEY;
const account='SE4280000890119146168423';
const xml=(reported=account)=>`<Document><BkToCstmrDbtCdtNtfct><Ntfct>${reported?`<Acct><Id><IBAN>${reported}</IBAN></Id></Acct>`:''}<Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>SYNTHETIC-1</AcctSvcrRef><NtryDtls><TxDtls><AmtDtls><TxAmt><Amt Ccy="SEK">625.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Syntetisk Kund AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>000018</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfct></BkToCstmrDbtCdtNtfct></Document>`;
function fixture(t){const folder=mkdtempSync(join(tmpdir(),'mg-file-account-')),db=openDatabase(join(folder,'db.sqlite'));t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('synthetic','customer','001','Syntetisk Kund AB',62500,'000018','2026-10-01');return db;}
function approve(db,{owner='synthetic-owner',selected=account,valid_until='2099-01-01T00:00:00Z'}={}){db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-bank','enablebanking','Syntetisk Bank',encryptObject({session_id:'synthetic-session'}),encryptObject([{uid:'synthetic-account',account_id:{iban:selected},currency:'SEK'}]),valid_until,owner,'connected','synthetic-account');}
function imported(db,selected=account,reported=account){const content=Buffer.from(xml(reported));storeTransactions(db,parseCAMT(content.toString(),selected),'file:synthetic.xml',{content,mime_type:'application/xml'});return reconciliationData(db);}

test('an arbitrary account alias cannot relabel a retained bank original into automatic payment evidence',t=>{
  const db=fixture(t);approve(db);const data=imported(db,'unverified-company-account');
  assert.equal(data.transactions[0].verified,false);assert.equal(analyzeReconciliation(data)[0].safe,false);
});
test('a typed IBAN without an owned active approved bank account remains review-only',t=>{
  const db=fixture(t),data=imported(db);assert.equal(data.transactions[0].verified,false);
});
test('exact file account and bank facts with an active owned selected account support automation',t=>{
  const db=fixture(t);approve(db);const data=imported(db);assert.equal(data.transactions[0].verified,true);assert.equal(analyzeReconciliation(data)[0].safe,true);
  const stored=listTransactions(db)[0];assert.equal(stored.account_evidence.reported_account,account);assert.equal(stored.account_evidence.selected_account,account);assert.equal(stored.account_evidence.exact_match,true);
});
test('missing report account, masked selection, ownerless and expired approvals remain review-only',t=>{
  for(const scenario of [{reported:''},{selected:'****8423'},{owner:''},{valid_until:'2000-01-01T00:00:00Z'},{approvedAccount:'SE4550000000058398257466'}]){
    const db=fixture(t);approve(db,{owner:scenario.owner??'synthetic-owner',selected:scenario.approvedAccount??account,valid_until:scenario.valid_until??'2099-01-01T00:00:00Z'});
    assert.equal(imported(db,scenario.selected??account,scenario.reported??account).transactions[0].verified,false);
  }
});
test('changing stored bank facts while keeping a valid original SHA cannot authorize file matching',t=>{
  const db=fixture(t);approve(db);imported(db);const before=listTransactions(db)[0];
  db.prepare("UPDATE bank_transactions SET payer='Other Customer' WHERE id=?").run(before.id);
  assert.equal(reconciliationData(db).transactions[0].verified,false);assert.equal(listTransactions(db)[0].id,before.id);
});

test('legacy account provenance migration preserves IDs, balances and originals without inventing account evidence',t=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-file-account-upgrade-')),path=join(folder,'db.sqlite');let db=openDatabase(path);
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  approve(db);const content=Buffer.from(xml(''));
  const result=storeTransactions(db,parseCAMT(content.toString(),'legacy-alias'),'file:legacy.xml',{content,mime_type:'application/xml'}),before=listTransactions(db)[0];
  db.exec('ALTER TABLE bank_transactions DROP COLUMN account_evidence;');db.close();db=openDatabase(path);
  const after=listTransactions(db)[0];assert.equal(after.id,before.id);assert.equal(after.account,before.account);assert.equal(after.amount_cents,before.amount_cents);assert.equal(after.allocated_cents,before.allocated_cents);assert.deepEqual(after.account_evidence,{});
  assert.deepEqual(Buffer.from(db.prepare('SELECT content FROM import_jobs WHERE id=?').get(result.import_id).content),content);
  assert.equal(reconciliationData(db).transactions[0].verified,false);
});
