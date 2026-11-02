import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,files,evidence,upload,rows,readable,bytes} from './helpers/file-upload-concurrency-fixture.mjs';

test('overlapping same-owner uploads converge on one readable original and canonical ID',async t=>{
 const f=fixture(t,{parallel:true}),results=await Promise.all([files.POST(upload()),files.POST(upload())]);assert.deepEqual(results.map(r=>r.status),[200,200]);const pair=await Promise.all(results.map(r=>r.json()));
 assert.equal(rows(f).length,1,'one owner/hash must have one persisted document');assert.equal(pair[0].id,pair[1].id);assert.deepEqual(pair.map(r=>r.duplicate===true).sort(),[false,true]);assert.equal(f.objects.size,1);await readable(pair[0].id);
});
test('overlapping uploads keep exact-hash retained report evidence unambiguous',async t=>{
 const f=fixture(t,{parallel:true}),pair=await Promise.all([files.POST(upload()),files.POST(upload())]),first=await pair[0].json(),result=await(await evidence.readRetainedReportEvidence({sha256:first.sha256})).json();
 assert.equal(result.ambiguous,false);assert.equal(result.integrity,'passed');assert.equal(result.complete,true);assert.equal(result.documentId,first.id);assert.equal(result.rows.length,1);assert.equal(f.objects.size,1);
});
test('identical overlapping bytes remain distinct for different owners',async t=>{
 const f=fixture(t,{parallel:true});f.users=[f.user,{userId:'foreign-owner',email:'foreign@example.test'}];const pair=await Promise.all([files.POST(upload()),files.POST(upload())]),bodies=await Promise.all(pair.map(r=>r.json()));
 assert.deepEqual(pair.map(r=>r.status),[200,200]);assert.equal(rows(f).length,2);assert.notEqual(bodies[0].id,bodies[1].id);assert.equal(f.objects.size,2);await readable(bodies[0].id);assert.equal((await files.GET(new Request('https://mg.test/api/files?id='+bodies[1].id))).status,404);
});
for(const failure of ['before','after'])test(`overlapping ${failure}-commit failure preserves the winner and a retry reuses its ID`,async t=>{
 const f=fixture(t,{parallel:true,failure}),pair=await Promise.all([files.POST(upload()),files.POST(upload())]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,500]);assert.equal(rows(f).length,1);assert.equal(f.objects.size,1);const winner=rows(f)[0];await readable(winner.id);
 const retry=await(await files.POST(upload())).json();assert.equal(retry.id,winner.id);assert.equal(retry.duplicate,true);assert.equal(rows(f).length,1);assert.equal(f.objects.size,1);
});
test('a failed outcome read after successful overlapping insertion retains uncertain objects',async t=>{
 const f=fixture(t,{parallel:true,readFailure:true}),pair=await Promise.all([files.POST(upload()),files.POST(upload())]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,500]);assert.equal(rows(f).length,1);assert.ok(f.objects.size>=1);await readable(rows(f)[0].id);const retry=await(await files.POST(upload())).json();assert.equal(retry.id,rows(f)[0].id);assert.equal(retry.duplicate,true);
});
test('an unreadable losing insert outcome retains its uploaded object instead of guessing it is unused',async t=>{
 const f=fixture(t,{parallel:true,readFailure:2}),pair=await Promise.all([files.POST(upload()),files.POST(upload())]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,500]);assert.equal(rows(f).length,1);assert.equal(f.objects.size,2);await readable(rows(f)[0].id);
 const retry=await(await files.POST(upload())).json();assert.equal(retry.id,rows(f)[0].id);assert.equal(retry.duplicate,true);assert.equal(f.objects.size,2);
});
test('failed cleanup of a losing concurrent upload still returns the canonical retained original',async t=>{
 const f=fixture(t,{parallel:true,deleteFailure:true}),pair=await Promise.all([files.POST(upload()),files.POST(upload())]),bodies=await Promise.all(pair.map(r=>r.json()));assert.deepEqual(pair.map(r=>r.status),[200,200]);assert.equal(rows(f).length,1);assert.equal(bodies[0].id,bodies[1].id);assert.equal(f.objects.size,2,'a failed cleanup may leave only the losing upload orphaned');await readable(bodies[0].id);assert.deepEqual(f.objects.get('synthetic-owner/'+bodies[0].id),bytes);
});
