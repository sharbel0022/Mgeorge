import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,iban,docId} from './helpers/evidence-read-fixture.mjs';

function addReportHistory(f,{count=1,foreign=false,hash=f.hash}={}){
 const insert=f.sql.prepare('INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,document_id,status,attempts,import_id,payment_count,created_at,updated_at,registration_binding) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let n=0;n<count;n++)insert.run((foreign?'foreign-':'')+'receipt-'+String(n).padStart(3,'0'),foreign?'foreign-owner':f.owner,'synthetic-source','private-scope','synthetic-report-'+n,hash,'Synthetic.csv','private-generation',docId,'REVIEW',2,'synthetic-import',1,1793491200000+n,1793577600000+n,'private-authorization-binding');
}

test('retained report provenance traces original imports observations and recorded allocations without claiming bank verification',async t=>{
 const f=await fixture(t);addReportHistory(f);addReportHistory(f,{foreign:true});
 f.state.imports.push({id:'synthetic-import',hash:f.hash,account:iban,name:'Synthetic.csv',count:1,createdAt:'2026-11-01T00:00:00Z',documentId:docId});
 const tx=f.state.transactions[0];tx.importId='synthetic-import';tx.bankFileProof={version:'bank-file-original-v1',documentId:docId,sha256:f.hash};
 f.state.allocations.push({id:'synthetic-allocation',transactionId:tx.id,invoiceId:f.state.invoices[0].id,amount:62500,effect:'payment',active:false,note:'private-review-note',createdAt:'2026-11-02T00:00:00Z',reversedAt:'2026-11-03T00:00:00Z'});f.save();
 const before=f.snapshot(),{out,body}=await f.call('retained_report_evidence',{documentId:docId});assert.ok(out,JSON.stringify(body));
 assert.ok(out.provenance,'the retained original must expose its stored evidence trail');
 const p=out.provenance;assert.equal(p.verificationScope,'retained_history_only');assert.equal(p.bankAuthenticityVerified,false);assert.equal(p.invoiceRelationshipVerified,false);
 assert.equal(p.original.sizeBytes,f.reportBytes.length);assert.equal(p.original.retainedAt,'2026-11-01');
 assert.equal(p.imports.total,1);assert.equal(p.imports.items[0].importId,'synthetic-import');assert.equal(p.imports.items[0].originalHashMatches,true);
 assert.equal(p.sourceReceipts.total,1);assert.equal(p.sourceReceipts.items[0].sourceId,'synthetic-source');assert.equal(p.sourceReceipts.items[0].status,'REVIEW');assert.equal(p.sourceReceipts.items[0].attempts,2);assert.equal(p.sourceReceipts.items[0].receivedAt,'2026-11-01T00:00:00.000Z');
 assert.equal(p.observations.total,1);assert.equal(p.observations.items[0].transactionId,tx.id);
 assert.equal(p.allocations.total,1);assert.equal(p.allocations.items[0].invoiceNumber,'0599');assert.equal(p.allocations.items[0].active,false);assert.equal(p.allocations.items[0].amountCents,62500);
 assert.equal(p.complete,true);assert.equal(out.targetRelationProved,false);
 assert.doesNotMatch(JSON.stringify(out),/private-scope|private-generation|private-authorization-binding|private-review-note|foreign-owner/);
 assert.doesNotMatch(JSON.stringify(out),new RegExp(iban));assert.equal(f.snapshot(),before);
});

test('retained history does not join another original merely because its invoice reference amount and date agree',async t=>{
 const f=await fixture(t);f.state.imports.push({id:'unrelated-import',hash:f.hash,account:iban,name:'Other.csv',count:1,createdAt:'2026-11-01',documentId:'unrelated-original'});f.save();addReportHistory(f,{foreign:true});
 const before=f.snapshot(),{out}=await f.call('retained_report_evidence',{documentId:docId});assert.ok(out.provenance);
 for(const key of ['imports','observations','allocations','sourceLinks','sourceReceipts'])assert.equal(out.provenance[key].total,0,key);
 assert.equal(out.targetRelationProved,false);assert.equal(f.snapshot(),before);
});

test('retained history exposes contradictory hashes and missing invoice identities without manufacturing relationships',async t=>{
 const f=await fixture(t),wrong='0'.repeat(64);addReportHistory(f,{hash:wrong});
 f.state.imports.push({id:'conflicting-import',hash:wrong,account:iban,name:'Synthetic.csv',count:1,createdAt:'2026-11-01',documentId:docId});
 const tx=f.state.transactions[0];tx.bankFileProof={version:'bank-file-original-v1',documentId:docId,sha256:wrong};
 f.state.allocations.push({id:'orphan-allocation',transactionId:tx.id,invoiceId:'missing-invoice',amount:62500,effect:'payment',active:true,note:'',createdAt:'2026-11-01'});f.save();
 const before=f.snapshot(),{out}=await f.call('retained_report_evidence',{documentId:docId});assert.ok(out.provenance);
 assert.equal(out.provenance.imports.items[0].originalHashMatches,false);assert.equal(out.provenance.sourceReceipts.items[0].originalHashMatches,false);assert.equal(out.provenance.observations.items[0].originalHashMatches,false);
 assert.equal(out.provenance.allocations.items[0].invoicePresent,false);assert.equal(out.provenance.allocations.items[0].invoiceNumber,null);assert.equal(out.provenance.invoiceRelationshipVerified,false);
 assert.equal(out.integrity,'passed','original bytes and historical metadata conflicts are separate facts');assert.equal(f.snapshot(),before);
});

test('retained source history is independently paginated with stable IDs and exact totals',async t=>{
 const f=await fixture(t);addReportHistory(f,{count:12});const before=f.snapshot();
 const first=await f.call('retained_report_evidence',{documentId:docId,historyLimit:5});assert.ok(first.out,JSON.stringify(first.body));
 assert.equal(first.out.provenance.sourceReceipts.total,12);assert.equal(first.out.provenance.sourceReceipts.items.length,5);assert.equal(first.out.provenance.nextOffset,5);assert.equal(first.out.complete,false);
 const second=await f.call('retained_report_evidence',{documentId:docId,historyLimit:5,historyOffset:5});assert.equal(second.out.provenance.nextOffset,10);
 const last=await f.call('retained_report_evidence',{documentId:docId,historyLimit:5,historyOffset:10});assert.equal(last.out.provenance.nextOffset,null);assert.equal(last.out.provenance.complete,true);
 const ids=[...first.out.provenance.sourceReceipts.items,...second.out.provenance.sourceReceipts.items,...last.out.provenance.sourceReceipts.items].map(row=>row.receiptId);assert.equal(new Set(ids).size,12);assert.equal(f.snapshot(),before);
});

test('retained provenance marks a changed receipt snapshot incomplete while remaining read-only',async t=>{
 const f=await fixture(t);addReportHistory(f);const get=f.env.BUCKET.get;f.env.BUCKET.get=async path=>{f.sql.prepare("UPDATE bankgiro_ingest_jobs SET status='BLOCKED' WHERE owner=?").run(f.owner);return get(path);};
 const {out}=await f.call('retained_report_evidence',{documentId:docId});assert.ok(out.provenance);assert.equal(out.provenance.snapshotCurrent,false);assert.equal(out.provenance.complete,false);assert.equal(out.complete,false);assert.equal(out.changed,false);
});

test('retained history detects a workspace change during its final receipt snapshot',async t=>{
 const f=await fixture(t);addReportHistory(f);
 const prepare=f.env.DB.prepare;let receiptReads=0,afterConcurrentWrite;
 f.env.DB.prepare=statement=>{
  const prepared=prepare(statement);
  return {bind(...args){
   const bound=prepared.bind(...args);
   return {...bound,async all(){
    const result=await bound.all();
    if(statement.includes('FROM bankgiro_ingest_jobs')&&++receiptReads===2){
     const next=structuredClone(f.state);
     next.imports.push({id:'concurrent-import',hash:f.hash,account:iban,name:'Concurrent.csv',count:1,createdAt:'2026-11-05',documentId:docId});
     f.sql.prepare('UPDATE workspaces SET revision=revision+1,payload=? WHERE owner=?').run(JSON.stringify(next),f.owner);
     afterConcurrentWrite=f.snapshot();
    }
    return result;
   }};
  }};
 };
 const {out,body}=await f.call('retained_report_evidence',{documentId:docId});assert.ok(out,JSON.stringify(body));
 const current=f.sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(f.owner);
 assert.equal(current.revision,8);assert.equal(out.revision,7);
 assert.equal(JSON.parse(current.payload).imports.filter(row=>row.documentId===docId).length,1);
 assert.equal(out.provenance.imports.total,0,'the retained response describes the earlier workspace');
 assert.equal(out.snapshotCurrent,false,'the final awaited history reads must remain inside the workspace revision check');
 assert.equal(out.provenance.snapshotCurrent,false);assert.equal(out.provenance.complete,false);assert.equal(out.complete,false);
 assert.equal(out.changed,false);assert.equal(f.snapshot(),afterConcurrentWrite,'the reader must not add mutations beyond the simulated concurrent writer');
});

test('retained provenance preserves manual and revoked source decisions separately from bank identity',async t=>{
 const f=await fixture(t),tx=f.state.transactions[2];f.state.bankgiroLinks=[{id:'manual-history',method:'manual_review',transactionId:tx.id,specificationIds:[],documentId:docId,sha256:f.hash,note:'private-source-note',dateDifferenceNote:'private-date-note',createdAt:'2026-11-01',transactionSnapshot:'private-target-snapshot',specificationSnapshots:{},revokedAt:'2026-11-02',revocationNote:'private-revocation-note'}];f.save();
 const before=f.snapshot(),{out}=await f.call('retained_report_evidence',{documentId:docId});assert.equal(out.provenance.sourceLinks.total,1);assert.equal(out.provenance.sourceLinks.items[0].method,'manual_review');assert.equal(out.provenance.sourceLinks.items[0].revokedAt,'2026-11-02');assert.equal(out.provenance.allocations.total,0);assert.equal(out.provenance.invoiceRelationshipVerified,false);assert.equal(out.targetRelationProved,false);assert.doesNotMatch(JSON.stringify(out),/private-/);assert.equal(f.snapshot(),before);
});

test('oversized retained history never exceeds the RPC budget or silently claims completeness',async t=>{
 const f=await fixture(t);addReportHistory(f,{count:20});f.sql.prepare('UPDATE bankgiro_ingest_jobs SET source_id=?,report_id=report_id||? WHERE owner=?').run('s'.repeat(500),'r'.repeat(500),f.owner);
 const before=f.snapshot(),{out,body}=await f.call('retained_report_evidence',{documentId:docId,historyLimit:20});assert.ok(out,JSON.stringify(body));assert.equal(out.outputLimited,true);assert.equal(out.complete,false);assert.equal(out.provenance.complete,false);assert.equal(out.provenance.nextOffset,0);assert.equal(out.provenance.sourceReceipts.total,20);assert.equal(out.provenance.sourceReceipts.items.length,0);assert.ok(Buffer.byteLength(JSON.stringify(body))<=65536);assert.equal(f.snapshot(),before);
 const narrow=await f.call('retained_report_evidence',{documentId:docId,historyLimit:1});assert.equal(narrow.out.outputLimited,false);assert.equal(narrow.out.provenance.sourceReceipts.items.length,1);assert.equal(narrow.out.provenance.nextOffset,1);
});

test('invalid history pages fail before opening original bytes',async t=>{
 const f=await fixture(t),before=f.snapshot();for(const args of [{historyOffset:-1},{historyOffset:0.5},{historyOffset:100001},{historyLimit:0},{historyLimit:21},{historyLimit:'5'}]){const {body}=await f.call('retained_report_evidence',{documentId:docId,...args});assert.equal(body.result.isError,true);}
 const forbidden=await f.call('payment_evidence',{reference:'0599',historyOffset:0});assert.equal(forbidden.body.result.isError,true);assert.deepEqual(f.reads,[]);assert.equal(f.snapshot(),before);
});
