import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,files,gmail,upload,sync,rows,readable} from './helpers/file-upload-concurrency-fixture.mjs';

for(const order of ['manual','gmail'])test(`Gmail/manual overlap uses the ${order} winner for source, queue and counts`,async t=>{
 const f=fixture(t,{parallel:true,order}),[manual,synced]=await Promise.all([files.POST(upload()),gmail.gmailSync(sync())]),body=await manual.json(),result=await synced.json();
 assert.equal(manual.status,200);assert.equal(synced.status,200);assert.equal(rows(f).length,1);assert.equal(f.objects.size,1);assert.equal(body.id,rows(f)[0].id);await readable(body.id);
 assert.equal(result.imported,order==='manual'?0:1);assert.equal(result.duplicates,order==='manual'?1:0);assert.equal(body.duplicate===true,order==='gmail');
 assert.deepEqual(f.sqlite.prepare('SELECT document_id,status FROM gmail_sources').all().map(r=>({...r})),[{document_id:body.id,status:'needs_review'}]);
 assert.deepEqual(f.sqlite.prepare('SELECT document_id,state FROM document_jobs').all().map(r=>({...r})),[{document_id:body.id,state:'waiting_ocr'}]);
 assert.deepEqual({...f.sqlite.prepare('SELECT imported,duplicates FROM gmail_runs').get()},{imported:result.imported,duplicates:result.duplicates});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});
for(const failure of ['before','after'])test(`Gmail overlapping ${failure}-commit error preserves exact bytes and retry source identity`,async t=>{
 const f=fixture(t,{parallel:true,order:'gmail',failure}),pending=Promise.allSettled([files.POST(upload()),gmail.gmailSync(sync())]),pair=await pending;
 assert.equal(pair[0].status,'fulfilled');assert.equal(pair[0].value.status,200);assert.equal(pair[1].status,'rejected');assert.equal(rows(f).length,1);assert.equal(f.objects.size,1);const id=rows(f)[0].id;await readable(id);
 const retried=await(await gmail.gmailSync(sync())).json();assert.equal(retried.imported,0);assert.equal(retried.duplicates,1);assert.equal(f.sqlite.prepare('SELECT document_id FROM gmail_sources').get().document_id,id);assert.equal(f.sqlite.prepare('SELECT document_id FROM document_jobs').get().document_id,id);assert.equal(rows(f).length,1);assert.equal(f.objects.size,1);
});
for(const order of ['manual','gmail'])test(`Gmail outcome read failure retains originals when ${order} wins and retry binds the source`,async t=>{
 const f=fixture(t,{parallel:true,order,readFailure:'gmail'}),pair=await Promise.allSettled([files.POST(upload()),gmail.gmailSync(sync())]);assert.equal(pair[0].status,'fulfilled');assert.equal(pair[0].value.status,200);assert.equal(pair[1].status,'rejected');assert.equal(rows(f).length,1);assert.equal(f.objects.size,order==='manual'?2:1);const id=rows(f)[0].id;await readable(id);
 const retried=await(await gmail.gmailSync(sync())).json();assert.equal(retried.imported,0);assert.equal(retried.duplicates,1);assert.equal(f.sqlite.prepare('SELECT document_id FROM gmail_sources').get().document_id,id);assert.equal(f.sqlite.prepare('SELECT document_id FROM document_jobs').get().document_id,id);
});
test('Gmail losing-upload cleanup failure keeps canonical source, queue and counts',async t=>{
 const f=fixture(t,{parallel:true,order:'manual',deleteFailure:true}),[manual,synced]=await Promise.all([files.POST(upload()),gmail.gmailSync(sync())]),body=await manual.json(),result=await synced.json();assert.equal(manual.status,200);assert.equal(synced.status,200);assert.equal(result.imported,0);assert.equal(result.duplicates,1);assert.equal(rows(f).length,1);assert.equal(f.objects.size,2);await readable(body.id);assert.equal(f.sqlite.prepare('SELECT document_id FROM gmail_sources').get().document_id,body.id);assert.equal(f.sqlite.prepare('SELECT document_id FROM document_jobs').get().document_id,body.id);
});
