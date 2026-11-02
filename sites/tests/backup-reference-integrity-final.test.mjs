import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {BACKUP_TABLES,backupStep,backupStatus,sealBackup,unsealBackup,validateSnapshot} from '../lib/backup-engine.ts';

const owner='synthetic-reference-owner',other='other-synthetic-owner',key='a'.repeat(64),at=new Date('2026-10-30T10:00:00Z');
const id='00000000-0000-4000-8000-000000000001',secondId='00000000-0000-4000-8000-000000000002';
const original=Buffer.from('%PDF-Synthetic reference original'),sha=value=>createHash('sha256').update(value).digest('hex'),digest=sha(original),wrongHash='b'.repeat(64);
const table=(snapshot,name)=>snapshot.tables.find(table=>table.name===name).rows;
const state=()=>({schemaVersion:1,invoices:[],transactions:[],allocations:[],credits:[],imports:[],receipts:[]});
const document=()=>({owner,id,filename:'synthetic.pdf',mime:'application/pdf',size:original.length,sha256:digest,created_at:at.toISOString()});
function durableReference(name){
 const common={owner,document_id:id};
 if(name==='gmail_sources')return{...common,source_id:'synthetic-attachment',metadata:'{}',status:'needs_review',extraction:'{}',created_at:at.toISOString()};
 if(name==='document_jobs')return{...common,state:'queued',engine:'cloud',attempts:0,available_at:at.toISOString(),lease:'',lease_until:'',extraction:'{}',error_code:'',invoice_id:'',automatic:0,updated_at:at.toISOString()};
 if(name==='document_extractions')return{...common,id:'synthetic-extraction',result:'{}',created_at:at.toISOString()};
 return{...common,identity:'synthetic-registration',invoice_id:'invoice',attempt:'synthetic-attempt',total:62500,created_at:at.toISOString()};
}
function snapshot(workspace=state()){
 return{format:'MG-Sites-backup-1',owner,createdAt:at.toISOString(),tables:BACKUP_TABLES.map(name=>({name,rows:name==='workspaces'?[{owner,revision:1,payload:JSON.stringify(workspace),updated_at:at.toISOString()}]:name==='documents'?[document()]:[]}))};
}
function workspaceReference(change){return(snapshot,hash=digest)=>{const row=table(snapshot,'workspaces')[0],value=JSON.parse(row.payload);change(value,hash);row.payload=JSON.stringify(value);};}
const proof=hash=>({version:'bank-file-original-v1',documentId:id,sha256:hash,referenceEvidenceSha256:wrongHash});
const references=[
 {name:'invoice',add:workspaceReference(s=>s.invoices.push({id:'invoice',number:'SYNTHETIC-01',total:62500,documentId:id}))},
 {name:'import',hashed:true,add:workspaceReference((s,hash)=>s.imports.push({id:'import',documentId:id,hash}))},
 {name:'bank file proof',hashed:true,add:workspaceReference((s,hash)=>s.transactions.push({id:'payment',bankFileProof:proof(hash)}))},
 {name:'bank detail original',add:workspaceReference(s=>s.transactions.push({id:'payment',bankDetails:{status:'identified',documentId:id}}))},
 {name:'conflicting incoming file proof',hashed:true,add:workspaceReference((s,hash)=>s.transactions.push({id:'payment',bankEvidenceConflicts:[{at:at.toISOString(),fields:['amount'],incoming:{bankFileProof:proof(hash)}}]}))},
 {name:'revoked Bankgiro link',hashed:true,add:workspaceReference((s,hash)=>{s.bankgiroLinks=[{id:'link',method:'manual_review',documentId:id,sha256:hash,revokedAt:at.toISOString(),transactionSnapshot:wrongHash,specificationSnapshots:{specification:wrongHash}}];})},
 ...['gmail_sources','document_jobs','document_extractions','document_registrations'].map(name=>({name,add:s=>table(s,name).push(durableReference(name))})),
 ...['bank.import_rejected','bank.sync_rejected'].map(action=>({name:action+' conflict file proof',hashed:true,add:(s,hash=digest)=>table(s,'audit_events').push({owner,action,detail:JSON.stringify({retained_conflicts:[{transactionId:'payment',conflicts:[{incoming:{bankFileProof:proof(hash)}}]}]})})})),
 ...[['gmail_sources','extraction'],['document_jobs','extraction'],['document_extractions','result']].map(([name,field])=>({name:name+' retained processing receipt',hashed:true,add:(s,hash=digest)=>table(s,name).push({...durableReference(name),[field]:JSON.stringify({processing:{runner:'local',sha256:hash,version:'document-worker-v3'}})})})),
];
const historicalReferences=[
 {action:'bank.details',detail:()=>({transactionId:'payment',documentId:id})},
 {action:'invoice.save',detail:()=>({command:{type:'invoice.save',invoice:{documentId:id}},automatic:[]})},
 ...['transactions.import','bankgiro.import'].map(action=>({action,hashed:true,detail:(hash=digest)=>({command:{type:action,documentId:id,hash},automatic:[]})})),
 {action:'bank.import_rejected',hashed:true,detail:(hash=digest)=>({command:{type:'bankgiro.import',documentId:id,hash},retained_conflicts:[]})},
 ...['gmail.invoice.review','gmail.invoice.automatic'].map(action=>({action,hashed:true,detail:(hash=digest)=>({invoice:{documentId:id},extraction:{processing:{runner:'local',sha256:hash,version:'document-worker-v3'}}})})),
 {action:'automatic.reconciliation',hashed:true,detail:(hash=digest)=>({decisions:[{kind:'specification_linked',document_id:id,document_hash:hash}]})},
 ...['invoice.save','invoice.reconcile','invoice.void','credit.add','credit.undo','transactions.import','transaction.verify','transaction.ignore','transaction.unverify','transaction.unsplit','transaction.split','match.create','match.undo','settings.save','bankgiro.import'].map(action=>({action,label:action+' known automatic specification decision',hashed:true,detail:(hash=digest)=>({command:action==='bankgiro.import'?{type:action,documentId:secondId,hash:digest}:{type:action,invoice:{documentId:''}},automatic:[{kind:'specification_linked',document_id:id,document_hash:hash}]})})),
];
function historicalSnapshot(reference,hash=digest){
 const current=state();current.transactions=[{id:'payment',bankDetails:{documentId:secondId}}];
 const value=snapshot(current);table(value,'documents').push({...document(),id:secondId});
 table(value,'audit_events').push({id:'synthetic-history',owner,revision:1,action:reference.action,detail:JSON.stringify(reference.detail(hash)),created_at:at.toISOString()});
 return value;
}
for(const reference of historicalReferences){
 const label=reference.label||reference.action;
 test('historical '+label+' retains its owned original after the current original changes',()=>assert.doesNotThrow(()=>validateSnapshot(historicalSnapshot(reference),owner)));
 test('historical '+label+' cannot lose original metadata behind a valid current original',()=>{const value=historicalSnapshot(reference);value.tables.find(t=>t.name==='documents').rows=table(value,'documents').filter(file=>file.id!==id);assert.throws(()=>validateSnapshot(value,owner),/backup_document_reference_missing/);});
 test('historical '+label+' cannot resolve another owner original',()=>{const value=historicalSnapshot(reference);table(value,'documents').find(file=>file.id===id).owner=other;assert.throws(()=>validateSnapshot(value,owner),/backup_owner_mismatch/);});
 if(reference.hashed)test('historical '+label+' rejects conflicting original hash',()=>assert.throws(()=>validateSnapshot(historicalSnapshot(reference,wrongHash),owner),/backup_document_reference_hash_mismatch/));
}

test('actual manual/API audit forms and unrelated raw command keys remain valid without originals',()=>{
 const value=snapshot();table(value,'documents').length=0;
 for(const [action,detail]of [
  ['invoice.save',{command:{type:'invoice.save',invoice:{documentId:''}},automatic:[]}],
  ['transactions.import',{command:{type:'transactions.import',documentId:'',hash:'manual-row-identity',rows:[{documentId:'ignored-provider-field'}]},automatic:[]}],
  ['bank.import_rejected',{command:{type:'transactions.import',documentId:'',hash:'manual-row-identity'},retained_conflicts:[]}],
  ['invoice.save',{command:{type:'invoice.save',invoice:{},documentId:'ignored-unconsumed-command-field'},automatic:[{kind:'unrelated',document_id:'ignored-key',document_hash:wrongHash}]}],
  ['unrelated.audit',{documentId:'ignored-key',command:{type:'unrelated.audit',documentId:'ignored-key',hash:wrongHash}}],
  ['automatic.reconciliation',{decisions:[{kind:'unrelated',document_id:'ignored-key',document_hash:wrongHash}]}],
 ])table(value,'audit_events').push({owner,action,detail:JSON.stringify(detail)});
 assert.doesNotThrow(()=>validateSnapshot(value,owner));
});

for(const action of ['gmail.invoice.review','gmail.invoice.automatic'])test(action+' legacy manual extraction has no processing receipt to invent',()=>{
 const value=snapshot();table(value,'audit_events').push({owner,action,detail:JSON.stringify({invoice:{documentId:id},extraction:{fields:{invoice_number:{value:'SYNTHETIC-01'}}}})});
 assert.doesNotThrow(()=>validateSnapshot(value,owner));
});

for(const [action,detail]of [
 ['bank.details',{transactionId:'payment'}],['bankgiro.import',{command:{type:'bankgiro.import',hash:digest}}],
 ['gmail.invoice.review',{invoice:{}}],['gmail.invoice.automatic',{invoice:{}}],
])test('historical mandatory '+action+' original cannot become an empty optional reference',()=>{
 const value=snapshot();table(value,'audit_events').push({owner,action,detail:JSON.stringify(detail)});
 assert.throws(()=>validateSnapshot(value,owner),/backup_document_reference_missing/);
});
// These cases fail if any declared reference family is dropped from validation.
// Raw provider/extraction payloads are deliberately not interpreted recursively.
for(const reference of references){
 test('complete snapshot retains '+reference.name,()=>{const value=snapshot();reference.add(value);const before=JSON.stringify(value);assert.doesNotThrow(()=>validateSnapshot(value,owner));assert.equal(JSON.stringify(value),before);});
 test('missing document metadata blocks '+reference.name,()=>{const value=snapshot();reference.add(value);table(value,'documents').length=0;assert.throws(()=>validateSnapshot(value,owner),/backup_document_reference_missing/);});
 test('another owner cannot satisfy '+reference.name,()=>{const value=snapshot();reference.add(value);table(value,'documents')[0].owner=other;assert.throws(()=>validateSnapshot(value,owner),/backup_owner_mismatch/);});
 if(reference.hashed)test('conflicting original hash blocks '+reference.name,()=>{const value=snapshot();reference.add(value,wrongHash);assert.throws(()=>validateSnapshot(value,owner),/backup_document_reference_hash_mismatch/);});
}

test('duplicate manifest document IDs cannot collapse distinct retained metadata or copy checkpoints',()=>{
 const value=snapshot();table(value,'documents').push({...document(),sha256:wrongHash});
 assert.throws(()=>validateSnapshot(value,owner),/backup_document_invalid/);
});

test('manual/API-only legacy snapshots and intentionally rejected Gmail markers remain valid',()=>{
 const legacy=state();legacy.invoices=[{id:'manual',documentId:''}];legacy.imports=[{id:'api',documentId:'',hash:''},{id:'legacy-api'}];
 legacy.transactions=[{id:'api',source:'Enable Banking synthetic',bankData:{arbitrary:{documentId:'provider-identifier',sha256:wrongHash}}}];
 const value=snapshot(legacy);table(value,'documents').length=0;
 table(value,'gmail_sources').push({owner,source_id:'rejected-attachment',document_id:'',status:'rejected',metadata:'{}',extraction:'{}'});
 table(value,'audit_events').push({owner,action:'unrelated.synthetic',detail:JSON.stringify({documentId:'unused-user-field',sha256:wrongHash})});
 const before=JSON.stringify(value),checked=validateSnapshot(value,owner);
 assert.equal(JSON.stringify(value),before);assert.equal(checked.apiEvidence.records_without_receipt,1);
});

test('legacy extraction JSON without a processing receipt remains valid with its owned document',()=>{
 const value=snapshot();for(const [name,field]of [['gmail_sources','extraction'],['document_jobs','extraction'],['document_extractions','result']])table(value,name).push({...durableReference(name),[field]:JSON.stringify({fields:{invoice_number:{value:'SYNTHETIC-01'}},arbitrary:{documentId:'text-only-identifier',sha256:wrongHash}})});
 assert.doesNotThrow(()=>validateSnapshot(value,owner));
});

for(const [label,value]of [
 ['empty object',{}],['missing document ID',{version:'bank-file-original-v1',sha256:digest}],['empty document ID',{version:'bank-file-original-v1',documentId:'',sha256:digest}],
 ['missing hash',{version:'bank-file-original-v1',documentId:id}],['empty hash',{version:'bank-file-original-v1',documentId:id,sha256:''}],['malformed hash',{version:'bank-file-original-v1',documentId:id,sha256:'invalid'}],
 ['unknown version',{version:'unknown',documentId:id,sha256:digest}],['non-object','synthetic-proof'],['array',[]],
])for(const path of ['transaction','incoming conflict','rejected audit conflict'])test('an explicitly present '+label+' file proof is rejected in '+path,()=>{
 const retained=state();retained.transactions=[{id:'api',source:'Enable Banking synthetic',bankData:{synthetic:'retained-provider-JSON'},bankDataVersion:'bank-api-original-v1',bankDataSha256:sha(JSON.stringify({synthetic:'retained-provider-JSON'}))}];
 const archive=snapshot(retained),row=table(archive,'workspaces')[0],payload=JSON.parse(row.payload);
 if(path==='transaction')payload.transactions[0].bankFileProof=value;
 if(path==='incoming conflict')payload.transactions[0].bankEvidenceConflicts=[{at:at.toISOString(),fields:['amount'],incoming:{bankFileProof:value}}];
 if(path==='rejected audit conflict')table(archive,'audit_events').push({owner,action:'bank.import_rejected',detail:JSON.stringify({retained_conflicts:[{transactionId:'api',conflicts:[{incoming:{bankFileProof:value}}]}]})});
 row.payload=JSON.stringify(payload);
 assert.throws(()=>validateSnapshot(archive,owner),/backup_document_reference_invalid/);
});

for(const value of [undefined,null])test('absent or null optional file proofs and bank details preserve valid API-only snapshots: '+String(value),()=>{
 const retained=state();retained.transactions=[{id:'api',source:'Enable Banking synthetic',bankData:{synthetic:'retained-provider-JSON'},bankDataVersion:'bank-api-original-v1',bankDataSha256:sha(JSON.stringify({synthetic:'retained-provider-JSON'})),bankFileProof:value,bankDetails:value,bankEvidenceConflicts:[{incoming:{bankFileProof:value}}]}];
 const archive=snapshot(retained);table(archive,'documents').length=0;
 assert.equal(validateSnapshot(archive,owner).apiEvidence.records_checked,1);
});

for(const name of ['gmail_sources','document_jobs','document_extractions','document_registrations'])for(const documentId of ['',null,undefined])test(name+' cannot certify a durable original relation without a document ID: '+String(documentId),()=>{
 const archive=snapshot(),row=durableReference(name);row.document_id=documentId;table(archive,name).push(row);
 assert.throws(()=>validateSnapshot(archive,owner),/backup_document_reference_missing/);
});

test('a rejected Gmail marker cannot retain an explicit processing hash without its original ID',()=>{
 const archive=snapshot(),row=durableReference('gmail_sources');row.status='rejected';row.document_id='';row.extraction=JSON.stringify({processing:{runner:'local',sha256:digest,version:'document-worker-v3'}});table(archive,'gmail_sources').push(row);
 assert.throws(()=>validateSnapshot(archive,owner),/backup_document_reference_missing/);
});

for(const family of ['bank detail original','Bankgiro link'])for(const documentId of ['',null,undefined])test(family+' cannot retain an explicitly present original relation without its ID: '+String(documentId),()=>{
 const retained=state();
 if(family==='bank detail original')retained.transactions=[{id:'payment',bankDetails:{status:'missing',documentId}}];
 else retained.bankgiroLinks=[{id:'link',documentId,sha256:digest,revokedAt:at.toISOString()}];
 const archive=snapshot(retained);
 assert.throws(()=>validateSnapshot(archive,owner),/backup_document_reference_missing/);
});

for(const sha256 of ['',null,undefined,'invalid'])test('a retained Bankgiro link requires its original hash: '+String(sha256),()=>{
 const retained=state();retained.bankgiroLinks=[{id:'link',documentId:id,sha256,revokedAt:at.toISOString()}];
 assert.throws(()=>validateSnapshot(snapshot(retained),owner),/backup_document_reference_invalid/);
});

function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const objects=new Map(),puts=[],gets=[];
 const bucket={async get(path){gets.push(path);const bytes=objects.get(path);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,bytes){puts.push(path);objects.set(path,new Uint8Array(bytes));}};
 const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:sql.prepare(query).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const initial=state();initial.invoices=[{id:'invoice',number:'SYNTHETIC-01',total:62500,documentId:id}];
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,1,JSON.stringify(initial),at.toISOString());
 const insertDocument=()=>sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,'synthetic.pdf','application/pdf',original.length,digest,at.toISOString());insertDocument();
 sql.prepare('INSERT INTO document_registrations(owner,document_id,identity,invoice_id,attempt,total,created_at) VALUES(?,?,?,?,?,?,?)').run(owner,id,'synthetic-registration','invoice','synthetic-attempt',62500,at.toISOString());
 objects.set(owner+'/'+id,new Uint8Array(original));
 return{sql,db,bucket,objects,puts,gets,insertDocument};
}
async function finish(f,date=at,limit=5){for(let n=0;n<10;n++){const result=await backupStep(f.db,f.bucket,owner,key,date,limit);if(['complete','failed'].includes(result.status))return result;}assert.fail('synthetic backup did not finish');}

for(const kind of ['empty file proof','hash without proof ID','job receipt without ID','registration without ID','bank details without ID','Bankgiro link without ID'])test('actual damaged '+kind+' fails before a zero-file snapshot is published',async t=>{
 const f=fixture(t),retained=state();retained.transactions=[{id:'api',source:'Enable Banking synthetic',bankData:{synthetic:'retained-provider-JSON'},bankDataVersion:'bank-api-original-v1',bankDataSha256:sha(JSON.stringify({synthetic:'retained-provider-JSON'}))}];
 if(kind==='empty file proof')retained.transactions[0].bankFileProof={};
 if(kind==='hash without proof ID')retained.transactions[0].bankFileProof={version:'bank-file-original-v1',sha256:digest};
 if(kind==='bank details without ID')retained.transactions[0].bankDetails={status:'missing',documentId:''};
 if(kind==='Bankgiro link without ID')retained.bankgiroLinks=[{id:'link',documentId:'',sha256:digest,revokedAt:at.toISOString()}];
 f.sql.prepare('DELETE FROM document_registrations').run();f.sql.prepare('DELETE FROM documents').run();
 f.sql.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(retained));
 if(kind==='job receipt without ID')f.sql.prepare('INSERT INTO document_jobs(owner,document_id,available_at,extraction,updated_at) VALUES(?,?,?,?,?)').run(owner,'',at.toISOString(),JSON.stringify({processing:{runner:'local',sha256:digest,version:'document-worker-v3'}}),at.toISOString());
 if(kind==='registration without ID')f.sql.prepare('INSERT INTO document_registrations(owner,document_id,identity,invoice_id,attempt,total,created_at) VALUES(?,?,?,?,?,?,?)').run(owner,'','synthetic-registration','invoice','synthetic-attempt',62500,at.toISOString());
 const before=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()])),payload=f.sql.prepare('SELECT payload FROM workspaces').get().payload,result=await finish(f);
 assert.equal(result.status,'failed');assert.equal(result.error,kind.includes('proof')?'backup_document_reference_invalid':'backup_document_reference_missing');assert.equal(result.verified_at,'');assert.equal(f.puts.length,0);
 assert.equal(f.sql.prepare('SELECT payload FROM workspaces').get().payload,payload);for(const [path,bytes]of before)assert.deepEqual(f.objects.get(path),bytes);
});

test('missing metadata behind retained registrations fails before publishing and preserves a prior complete backup',async t=>{
 const f=fixture(t),baseline=await finish(f);assert.equal(baseline.status,'complete');assert.equal(baseline.files,1);
 const before=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()])),workspace=f.sql.prepare('SELECT payload FROM workspaces').get().payload;
 f.sql.prepare('DELETE FROM documents WHERE id=? AND owner=?').run(id,owner);
 const putCount=f.puts.length,date=new Date('2026-10-31T10:00:00Z'),damaged=await finish(f,date);
 assert.equal(damaged.status,'failed');assert.equal(damaged.error,'backup_document_reference_missing');assert.equal(damaged.verified_at,'');
 assert.equal(f.puts.length,putCount,'an incomplete database must not publish a snapshot');
 for(const [path,bytes]of before)assert.deepEqual(f.objects.get(path),bytes);
 assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM documents').get().count,0,'backup must not recreate missing metadata');
 assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM document_registrations').get().count,1);
 assert.equal(f.sql.prepare('SELECT payload FROM workspaces').get().payload,workspace);
 assert.equal((await backupStatus(f.db,owner)).last_verified.id,baseline.id);
 // External recovery of the exact retained metadata makes a bounded retry valid.
 f.insertDocument();const recovered=await finish(f,date,1);assert.equal(recovered.id,damaged.id);assert.equal(recovered.status,'complete');assert.equal(recovered.attempts,1);
 for(const [path,bytes]of before)assert.deepEqual(f.objects.get(path),bytes);
});

test('a historical bank-details original remains required after refresh replaces the current reference',async t=>{
 const f=fixture(t),retained=state();retained.transactions=[{id:'payment',bankDetails:{documentId:secondId}}];
 f.sql.prepare('UPDATE workspaces SET payload=?').run(JSON.stringify(retained));f.sql.prepare('DELETE FROM document_registrations').run();
 f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(secondId,owner,'current.json','application/json',original.length,digest,at.toISOString());
 f.objects.set(owner+'/'+secondId,new Uint8Array(original));
 f.sql.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-history',owner,1,'bank.details',JSON.stringify({transactionId:'payment',documentId:id}),at.toISOString());
 const complete=await finish(f);assert.equal(complete.status,'complete');assert.equal(complete.files,2);
 const before=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()])),puts=f.puts.length,payload=f.sql.prepare('SELECT payload FROM workspaces').get().payload;
 f.sql.prepare('DELETE FROM documents WHERE id=?').run(id);
 const failed=await finish(f,new Date('2026-10-31T10:00:00Z'));
 assert.equal(failed.status,'failed');assert.equal(failed.error,'backup_document_reference_missing');assert.equal(failed.verified_at,'');assert.equal(f.puts.length,puts);
 assert.equal(f.sql.prepare('SELECT payload FROM workspaces').get().payload,payload);for(const [path,bytes]of before)assert.deepEqual(f.objects.get(path),bytes);
 assert.equal((await backupStatus(f.db,owner)).last_verified.id,complete.id);
});

for(const phase of ['running','verifying'])test('resumed '+phase+' backup revalidates references in its authenticated frozen snapshot',async t=>{
 const f=fixture(t);
 if(phase==='running'){
  f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(secondId,owner,'second.pdf','application/pdf',original.length,digest,at.toISOString());
  f.objects.set(owner+'/'+secondId,new Uint8Array(original));
 }
 const first=await backupStep(f.db,f.bucket,owner,key,at,1);assert.equal(first.status,phase);
 const row=f.sql.prepare('SELECT * FROM backup_runs WHERE id=?').get(first.id),value=JSON.parse(new TextDecoder().decode(await unsealBackup(f.objects.get(row.snapshot_key),key,owner,row.id,'snapshot')));
 const workspace=table(value,'workspaces')[0],retained=JSON.parse(workspace.payload);
 retained.invoices[0].documentId='00000000-0000-4000-8000-000000000999';workspace.payload=JSON.stringify(retained);
 const plain=new TextEncoder().encode(JSON.stringify(value)),encrypted=await sealBackup(plain,key,owner,row.id,'snapshot');
 f.objects.set(row.snapshot_key,encrypted);f.sql.prepare('UPDATE backup_runs SET snapshot_hash=? WHERE id=?').run(sha(plain),row.id);
 const before=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()])),putCount=f.puts.length,result=await backupStep(f.db,f.bucket,owner,key,at,1);
 assert.equal(result.status,'failed');assert.equal(result.error,'backup_document_reference_missing');assert.equal(result.verified_at,'');assert.equal(f.puts.length,putCount);
 for(const [path,bytes]of before)assert.deepEqual(f.objects.get(path),bytes);
 assert.equal((await backupStatus(f.db,owner)).last_verified,null);
});
