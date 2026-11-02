import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {audit,openDatabase,recordImport,storeDocument,storeTransactions} from '../src/db.js';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.js';
import {withSyntheticBankOriginal} from './bank-fixtures.js';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
import {encryptObject} from '../src/security.js';
import {bankSpecificationCandidates,confirmBankSpecificationLink,revokeBankSpecificationLink} from '../src/bankgiro-links.js';

const key='a'.repeat(64),failure={code:'backup_foreign_key_violation'};
function sealSqlite(source,archive){
 const bytes=readFileSync(source),header=Buffer.from('MGBAK001'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 writeFileSync(archive,Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]));
 return readFileSync(archive);
}
function fixture(t,damaged=true,sourceId='synthetic-mail'){
 const folder=mkdtempSync(join(tmpdir(),'mg-backup-references-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=join(folder,'source.sqlite'),archive=join(folder,'damaged.mgbak'),target=join(folder,'restore.sqlite'),db=openDatabase(source);
 const document=storeDocument(db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-Synthetic retained original'),source_id:sourceId});
 if(damaged){db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM documents WHERE id=?').run(document.id);db.exec('PRAGMA foreign_keys=ON');}
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,damaged?1:0);
 db.close();
 // Authenticated historical archives can predate validation. Seal actual SQLite
 // bytes directly so verification and restore cannot rely on createBackup.
 const bytes=readFileSync(source);sealSqlite(source,archive);
 return{folder,source,archive,target,bytes,archiveBytes:readFileSync(archive),document};
}

test('creation rejects dangling SQLite references before publishing or replacing an archive',t=>{
 const f=fixture(t),newArchive=join(f.folder,'new.mgbak');
 assert.throws(()=>createBackup(f.source,newArchive,key),failure);
 assert.equal(existsSync(newArchive),false);
 assert.throws(()=>createBackup(f.source,f.archive,key),failure);
 assert.deepEqual(readFileSync(f.archive),f.archiveBytes);
 assert.deepEqual(readFileSync(f.source),f.bytes);
});

test('a damaged source cannot replace an existing complete archive',t=>{
 const f=fixture(t,false),complete=join(f.folder,'complete.mgbak');createBackup(f.source,complete,key);
 const archived=readFileSync(complete),db=openDatabase(f.source);
 db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM documents WHERE id=?').run(f.document.id);db.close();
 const damaged=readFileSync(f.source);
 assert.throws(()=>createBackup(f.source,complete,key),failure);
 assert.deepEqual(readFileSync(complete),archived);assert.equal(verifyBackup(complete,key).verified,true);
 assert.deepEqual(readFileSync(f.source),damaged);
});

test('verification rejects authenticated SQLite archives with broken foreign keys without changing bytes',t=>{
 const f=fixture(t);
 assert.throws(()=>verifyBackup(f.archive,key),failure);
 assert.deepEqual(readFileSync(f.archive),f.archiveBytes);
 assert.deepEqual(readFileSync(f.source),f.bytes);
});

test('restore rejects broken references before creating a destination or changing an existing destination',t=>{
 const f=fixture(t);
 assert.throws(()=>restoreBackup(f.archive,f.target,key),failure);
 assert.equal(existsSync(f.target),false);
 const existing=Buffer.from('Synthetic caller-owned destination');writeFileSync(f.target,existing);
 assert.throws(()=>restoreBackup(f.archive,f.target,key),failure);
 assert.deepEqual(readFileSync(f.target),existing);
 assert.deepEqual(readFileSync(f.archive),f.archiveBytes);
 assert.deepEqual(readFileSync(f.source),f.bytes);
});

test('a complete original and its source relation still verify and restore exactly',t=>{
 const f=fixture(t,false),created=join(f.folder,'created.mgbak');
 assert.equal(createBackup(f.source,created,key).verified,true);
 assert.equal(verifyBackup(f.archive,key).verified,true);
 assert.equal(restoreBackup(f.archive,f.target,key).restored,true);
 const restored=new DatabaseSync(f.target,{readOnly:true});
 try{
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(restored.prepare('SELECT document_id FROM document_sources').get().document_id,f.document.id);
  assert.deepEqual(Buffer.from(restored.prepare('SELECT content FROM documents').get().content),Buffer.from('%PDF-Synthetic retained original'));
 }finally{restored.close();}
 assert.deepEqual(readFileSync(f.source),f.bytes);
});

const referenceMissing={code:'backup_original_missing'},wrongHash='b'.repeat(64);
const historicalActions=[
 ...['document_uploaded','document_attached','document_extracted','document_duplicate_linked','invoice_review_approved','invoice_auto_registered','document_dismissed','document_restored'].map(action=>({action,kind:'document',details:f=>({id:f.document.id})})),
 ...['invoice_created','invoice_updated','invoice_reconciled'].map(action=>({action,kind:'document',details:f=>({document_id:f.document.id})})),
 {action:'bank_import_rejected',kind:'import',details:f=>({import_id:f.importId,source:'file:synthetic.csv'})},
 {action:'bank_evidence_original_attached',kind:'import',details:f=>({original_import_id:f.importId})},
 {action:'bank_evidence_conflict',kind:'import',details:f=>({original_import_ids:[f.importId],incoming:{raw_bank_data:{arbitrary:'provider-data'}}})},
 {action:'bankgiro_xlsx_review_saved',kind:'import',hashed:true,details:f=>({import_id:f.importId,sha256:f.importHash})},
 {action:'bank_specification_linked',kind:'import',hashed:true,details:f=>({import_id:f.importId,original_sha256:f.importHash})},
 {action:'bank_specification_link_revoked',kind:'import',details:f=>({import_id:f.importId})},
 ...['specification_import_id','before','after'].map(field=>({action:'aggregate_replaced',label:'aggregate_replaced '+field,kind:'import',details:f=>({[field]:field==='specification_import_id'?f.importId:{import_id:f.importId}})})),
 {action:'absence_check_invalidated',kind:'import',details:f=>({import_id:f.importId})},
];
function history(t,reference){
 const f=fixture(t,false,null),db=openDatabase(f.source),content=Buffer.from('Synthetic retained bank file');
 f.importId=recordImport(db,{source:'bank_file',name:'synthetic.csv',content,mime_type:'text/csv'});
 f.importHash=db.prepare('SELECT content_sha256 FROM import_jobs WHERE id=?').get(f.importId).content_sha256;
 storeDocument(db,{name:'current.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-Synthetic current original')});
 db.prepare('DELETE FROM audit_events').run();audit(db,reference.action,reference.details(f));
 db.close();return f;
}
for(const reference of historicalActions)test('historical '+(reference.label||reference.action)+' original must survive after current originals change',t=>{
 const f=history(t,reference),complete=join(f.folder,'complete.mgbak');assert.equal(createBackup(f.source,complete,key).verified,true);const before=readFileSync(complete);
 const db=openDatabase(f.source);db.prepare('DELETE FROM '+(reference.kind==='document'?'documents':'import_jobs')+' WHERE id=?').run(reference.kind==='document'?f.document.id:f.importId);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
 const damaged=readFileSync(f.source),archived=sealSqlite(f.source,f.archive),newArchive=join(f.folder,'new.mgbak');
 assert.throws(()=>verifyBackup(f.archive,key),referenceMissing);assert.throws(()=>createBackup(f.source,newArchive,key),referenceMissing);assert.equal(existsSync(newArchive),false);
 assert.throws(()=>restoreBackup(f.archive,f.target,key),referenceMissing);assert.equal(existsSync(f.target),false);
 assert.deepEqual(readFileSync(f.source),damaged);assert.deepEqual(readFileSync(f.archive),archived);assert.deepEqual(readFileSync(complete),before);
});

for(const reference of historicalActions.filter(reference=>reference.hashed))test('historical '+reference.action+' explicit original hash cannot conflict with intact current bytes',t=>{
 const f=history(t,reference),db=openDatabase(f.source),detail=reference.details(f);if('sha256'in detail)detail.sha256=wrongHash;else detail.original_sha256=wrongHash;
 db.prepare('UPDATE audit_events SET details=? WHERE action=?').run(JSON.stringify(detail),reference.action);db.close();sealSqlite(f.source,f.archive);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_hash_mismatch'});
});

test('real uploaded-document producer cannot lose metadata while another valid original remains',t=>{
 const f=fixture(t,false,null),db=openDatabase(f.source);
 storeDocument(db,{name:'current.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-Synthetic current original')});
 const event=db.prepare("SELECT details FROM audit_events WHERE action='document_uploaded' AND json_extract(details,'$.id')=?").get(f.document.id);assert.equal(JSON.parse(event.details).id,f.document.id);
 db.prepare('DELETE FROM documents WHERE id=?').run(f.document.id);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();sealSqlite(f.source,f.archive);
 assert.throws(()=>verifyBackup(f.archive,key),referenceMissing);
});

const bankRow={account:'synthetic-account',booked_at:'2026-10-30',amount_cents:62500,currency:'SEK',payer:'Synthetic payer',reference:'SYNTHETIC-01',bank_reference:'SYNTHETIC-BANK',description:'Synthetic payment'};
test('actual file-import transaction pointers cannot lose retained import metadata without an audit pointer',t=>{
 const f=fixture(t,false,null),db=openDatabase(f.source),result=storeTransactions(db,[bankRow],'file:synthetic.csv',{content:Buffer.from('Synthetic bank CSV original'),mime_type:'text/csv'});
 db.prepare('DELETE FROM import_jobs WHERE id=?').run(result.import_id);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();sealSqlite(f.source,f.archive);
 assert.throws(()=>verifyBackup(f.archive,key),referenceMissing);
});

test('actual rejected-file producer retains conflict import IDs outside foreign keys',t=>{
 const f=fixture(t,false,null),db=openDatabase(f.source);storeTransactions(db,[bankRow],'manual');let rejected;
 try{storeTransactions(db,[{...bankRow,amount_cents:70000}],'file:conflict.csv',{content:Buffer.from('Synthetic rejected CSV original'),mime_type:'text/csv'});}catch(error){rejected=error.import_id;}
 assert.ok(rejected);assert.equal(JSON.parse(db.prepare("SELECT details FROM audit_events WHERE action='bank_import_rejected'").get().details).import_id,rejected);
 db.prepare('DELETE FROM import_jobs WHERE id=?').run(rejected);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();sealSqlite(f.source,f.archive);
 assert.throws(()=>verifyBackup(f.archive,key),referenceMissing);
});

test('known extraction receipt hashes cannot disagree with the retained document original',t=>{
 const f=fixture(t,false,null),db=openDatabase(f.source);
 audit(db,'document_extracted',{id:f.document.id,extraction:{processing:{sha256:wrongHash}}});db.close();sealSqlite(f.source,f.archive);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_hash_mismatch'});
});

test('legacy manual/API import jobs, empty optional references and unrelated raw audit keys remain archival data',t=>{
 const f=fixture(t,false,null),db=openDatabase(f.source),job=recordImport(db,{source:'manual',name:'synthetic API/manual history'});
 for(const action of ['invoice_created','invoice_updated','invoice_reconciled'])audit(db,action,{document_id:''});
 audit(db,'bank_evidence_conflict',{original_import_ids:[],incoming:{document_id:'arbitrary-provider-key'}});
 audit(db,'aggregate_replaced',{transaction_id:'synthetic',children:0});audit(db,'absence_check_invalidated',{import_id:job});audit(db,'absence_check_invalidated',{import_id:''});
 audit(db,'unrelated.synthetic',{document_id:'unused-key',import_id:'unused-key',id:'unused-key',sha256:wrongHash});db.close();sealSqlite(f.source,f.archive);
 assert.equal(verifyBackup(f.archive,key).verified,true);
});

function linkedOriginal(t,revoked){
 const previousKey=process.env.BANK_DATA_KEY;process.env.BANK_DATA_KEY='3'.repeat(64);t.after(()=>{if(previousKey===undefined)delete process.env.BANK_DATA_KEY;else process.env.BANK_DATA_KEY=previousKey;});
 const f=fixture(t,false,null),db=openDatabase(f.source),account='SE4280000890119146168423',owner='synthetic-link-owner';
 storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-625',description:'Synthetic deposit'})],'enablebanking');
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-connection','enablebanking','Synthetic bank',encryptObject({session_id:'synthetic'}),encryptObject([{uid:'account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01',owner,'connected','account');
 const bytes=makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-26',sequence:'83',payments:[{party:'Synthetic payer AB',reference:'SYNTHETIC-01',payerBankgiro:'987-6543',amount:62500}]});
 const importId=recordImport(db,{source:'bank_file',name:'synthetic.xlsx',found:1,review:1,status:'needs_review',content:bytes,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),transactionId=db.prepare('SELECT id FROM bank_transactions').get().id;
 const report=bankSpecificationCandidates(db,transactionId,owner).items[0];assert.equal(report.can_link,true);
 const link=confirmBankSpecificationLink(db,{transaction_id:transactionId,import_id:importId,report_key:report.report_key,confirm:true,originals_checked:true,account_checked:true,evidence:'Synthetic original and account review.'},owner);
 if(revoked)revokeBankSpecificationLink(db,link.id,{evidence:'Synthetic historical revocation.'},owner);
 db.close();return{...f,linkId:link.id};
}
for(const revoked of [false,true])for(const [label,value,code]of [
 ['conflicting checksum',wrongHash,'backup_original_hash_mismatch'],
 ['missing checksum','','backup_original_hash_unavailable'],
 ['non-text checksum',Buffer.from('a'.repeat(64)),'backup_original_hash_unavailable'],
])test((revoked?'revoked':'active')+' typed bank specification link rejects '+label+' after a real confirmation',t=>{
 const f=linkedOriginal(t,revoked),complete=join(f.folder,'valid-link.mgbak');assert.equal(createBackup(f.source,complete,key).verified,true);assert.equal(verifyBackup(complete,key).verified,true);const completeBytes=readFileSync(complete);
 const db=openDatabase(f.source);db.prepare('UPDATE bank_specification_links SET original_sha256=? WHERE id=?').run(value,f.linkId);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
 const source=readFileSync(f.source),archive=sealSqlite(f.source,f.archive),newArchive=join(f.folder,'new.mgbak');
 assert.throws(()=>verifyBackup(f.archive,key),{code});assert.throws(()=>createBackup(f.source,newArchive,key),{code});assert.equal(existsSync(newArchive),false);
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code});assert.equal(existsSync(f.target),false);
 assert.deepEqual(readFileSync(f.source),source);assert.deepEqual(readFileSync(f.archive),archive);assert.deepEqual(readFileSync(complete),completeBytes);
});

test('a legacy snapshot without the typed bank specification link table remains valid',t=>{
 const f=fixture(t,false,null),db=openDatabase(f.source);db.exec('DROP TABLE bank_specification_links');db.close();sealSqlite(f.source,f.archive);
 assert.equal(verifyBackup(f.archive,key).verified,true);
});

function bankgiroQueueFixture(t){
 const f=fixture(t,false),db=openDatabase(f.source),original=db.prepare('SELECT content,fingerprint FROM documents WHERE id=?').get(f.document.id);
 db.prepare("UPDATE documents SET source='bankgiro_source',metadata=? WHERE id=?").run(JSON.stringify({owner:'local-admin'}),f.document.id);
 const importId=recordImport(db,{source:'bank_file',name:'synthetic.csv',content:original.content,mime_type:'text/csv'});
 db.prepare('UPDATE import_jobs SET owner=? WHERE id=?').run('local-admin',importId);
 db.prepare("INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,document_id,import_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run('queue','local-admin','synthetic','contract','report',original.fingerprint,'synthetic.csv','1',f.document.id,importId,'IMPORTED',1,1);
 return {...f,db,importId};
}
test('Bankgiro backup validates queue original and import owner/hash references',t=>{
 for(const mutation of ["UPDATE bankgiro_ingest_jobs SET document_id='missing'","UPDATE documents SET metadata='{\"owner\":\"other\"}'","UPDATE bankgiro_ingest_jobs SET sha256='"+'0'.repeat(64)+"'","UPDATE bankgiro_ingest_jobs SET import_id='missing'","UPDATE import_jobs SET owner='other'","UPDATE bankgiro_ingest_jobs SET document_id=NULL"]){
 const f=bankgiroQueueFixture(t);f.db.exec(mutation);f.db.close();
 assert.throws(()=>createBackup(f.source,join(f.folder,'queue-invalid.mgbak'),key),error=>['backup_original_missing','backup_original_hash_mismatch','backup_original_reference_invalid'].includes(error.code),mutation);
 }
});
test('Bankgiro backup restores queue status with exact owned original and import references',t=>{
 const f=bankgiroQueueFixture(t);f.db.close();const archive=join(f.folder,'queue-valid.mgbak');
 createBackup(f.source,archive,key);assert.equal(verifyBackup(archive,key).verified,true);restoreBackup(archive,f.target,key);
 const restored=new DatabaseSync(f.target,{readOnly:true});try{const row=restored.prepare('SELECT status,document_id,import_id FROM bankgiro_ingest_jobs').get();assert.equal(row.status,'IMPORTED');assert.equal(row.document_id,f.document.id);assert.equal(row.import_id,f.importId);}finally{restored.close();}
});
