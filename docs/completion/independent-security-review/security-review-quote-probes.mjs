import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const [rootArg,outArg]=process.argv.slice(2),root=resolve(rootArg),output=resolve(outArg);
const {companyFixture}=await import(pathToFileURL(resolve(root,'sites/tests/helpers/company-storage-fixture.mjs')));
const cleanup=[],f=companyFixture({after(fn){cleanup.push(fn);}}),results=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=resolve(root,'sites/lib/company-storage.js'),sourceBefore=hash(readFileSync(source));
async function probe(name,operation){try{await operation();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:String(error.message)});}}
try{
 await f.create('company-a','actor-a');await f.create('company-b','actor-b');
 const a=await f.scope(),b=await f.scope('actor-b','company-b'),db=f.database(a);
 const reads=[
  'SELECT owner FROM"workspaces"',
  'SELECT owner FROM[workspaces]',
  'SELECT owner FROM`workspaces`',
  'SELECT x.owner FROM"workspaces"AS"x"',
  'SELECT "x".owner FROM"workspaces"AS"x"WHERE "x".revision=0',
  'WITH"x"AS(SELECT owner FROM"workspaces")SELECT owner FROM"x"',
  'WITH RECURSIVE"x"AS(SELECT owner FROM[workspaces])SELECT owner FROM"x"',
  'WITH"x"AS(SELECT 1)SELECT owner FROM"workspaces"UNION SELECT owner FROM[workspaces]',
  'SELECT w.owner FROM"workspaces"AS"w"JOIN(SELECT 1)AS"x"ON 1=1',
  'SELECT owner FROM((("workspaces")))',
  'SELECT \'--\' AS "/* label */",owner FROM"workspaces"',
 ];
 for(const query of reads)await probe(query,async()=>{assert.deepEqual((await db.prepare(query).all()).results.map(row=>row.owner),[a.owner]);});
 for(const table of ['company_application_tokens','company_application_token_control','company_memberships','companies','sqlite_schema'])for(const quote of ['"','`','[']){
  const q=quote+table+(quote==='['?']':quote),query='SELECT * FROM'+q;
  await probe(query,async()=>assert.throws(()=>db.prepare(query),{code:'COMPANY_SQL_DENIED'}));
 }
 await probe('compact batch retains owner',async()=>{const rows=await db.batch([db.prepare('SELECT owner FROM"workspaces"')]);assert.deepEqual(rows[0].results.map(row=>row.owner),[a.owner]);});
 await probe('compact authorized write retains other owner',async()=>{await db.prepare('UPDATE"workspaces"SET revision=revision+1 WHERE owner=?').bind(a.owner).run();assert.equal(f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(a.owner).revision,1);assert.equal(f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(b.owner).revision,0);});
}finally{for(const fn of cleanup.reverse())fn();}
assert.equal(hash(readFileSync(source)),sourceBefore,'source must remain unchanged throughout review');
const report={schema:'completion-independent-quote-review-v1',root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceSha256:sourceBefore,scriptSha256:hash(readFileSync(new URL(import.meta.url))),runtime:process.version,syntheticOnly:true,providerCalls:0,productionWrites:0,total:results.length,pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass).length,results};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({head:report.head,total:report.total,pass:report.pass,fail:report.fail,sourceSha256:report.sourceSha256}));
if(report.fail)process.exitCode=1;
