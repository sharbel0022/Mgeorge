import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {changeCompanyMembership} from '../lib/company-storage.js';

// Test real SQLite execution through the tenant adapter. SQL is repository-owned,
// but a harmless literal or alias must never disable its default owner filter.
async function fixture(t){
 const f=companyFixture(t);
 await f.create('company-a','actor-a');await f.create('company-b','actor-b');
 const a=await f.scope(),b=await f.scope('actor-b','company-b');
 for(const scope of [a,b])await f.database(scope).prepare('UPDATE workspaces SET payload=? WHERE owner=?').bind(JSON.stringify({private:scope.context.companyId}),scope.owner).run();
 return{f,a,b,database:f.database(a)};
}

for(const [name,query]of [
 ['line-comment marker',"SELECT '--' AS marker, owner, payload FROM workspaces"],
 ['escaped quote before marker',"SELECT 'it''s -- data' AS marker, owner, payload FROM workspaces"],
 ['block markers spanning a table',"SELECT '/*' AS marker, owner, payload FROM workspaces WHERE '*/'='*/'"],
 ['nested marker strings',"SELECT '/* -- */' AS marker, owner, payload FROM workspaces"],
 ['newline inside a literal',"SELECT '--\n/*' AS marker, owner, payload FROM workspaces WHERE '*/'='*/'"],
 ['CTE literal',"WITH label(value) AS (SELECT '--') SELECT owner,payload FROM workspaces,label"],
 ['actual comments beside literals',"/* leading ' -- */ -- comment\n SELECT '/*' AS marker, owner, payload FROM workspaces /* real comment */ WHERE '*/'='*/'"],
 ['quoted alias',"SELECT owner AS \"-- alias\", payload FROM workspaces"],
 ['escaped quoted alias',"SELECT owner AS \"quote\"\"-- alias\", payload FROM workspaces"],
 ['backtick alias',"SELECT owner AS `-- alias`, payload FROM workspaces"],
 ['bracket alias',"SELECT owner AS [-- alias], payload FROM workspaces"],
 ['mixed quote characters in alias',"SELECT owner AS \"'-- alias\", payload FROM workspaces"],
])test('tenant read remains scoped with '+name,async t=>{
 const {database}=await fixture(t),result=await database.prepare(query).all();
 assert.equal(result.results.length,1,'a tenant query must not return the other company');
 assert.equal(result.results[0].payload,JSON.stringify({private:'company-a'}));
});

for(const table of ['company_application_tokens','company_application_token_control','companies','company_memberships']){
 for(const [kind,query]of [
  ['line',`SELECT '--' AS marker, * FROM ${table}`],
  ['block',`SELECT '/*' AS marker, * FROM ${table} WHERE '*/'='*/'`],
  ['quoted alias',`SELECT * FROM ${table} AS "-- alias"`],
 ])test(`tenant SQL cannot conceal ${table} using a ${kind} marker`,async t=>{
  const {database}=await fixture(t);
  assert.throws(()=>database.prepare(query),{code:'COMPANY_SQL_DENIED'});
 });
}

test('untrusted bound values remain literal data, including comment markers and global table names',async t=>{
 const {f,a,b,database}=await fixture(t),value="-- /* */ ' \" company_application_tokens main.workspaces";
 await database.prepare('UPDATE workspaces SET payload=? WHERE owner=?').bind(value,a.owner).run();
 assert.deepEqual((await database.prepare('SELECT payload FROM workspaces WHERE payload=?').bind(value).all()).results.map(row=>row.payload),[value]);
 assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(b.owner).payload,JSON.stringify({private:'company-b'}));
});

test('a marker literal does not grant a viewer mutation or catalogue capability',async t=>{
 const {f,a}=await fixture(t);
 await changeCompanyMembership(f.raw,a,{actorId:'reader',role:'viewer',status:'active'});
 const database=f.database(await f.scope('reader')),before=f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all();
 await assert.rejects(database.prepare("WITH label(value) AS (SELECT '--') UPDATE workspaces SET payload=? WHERE owner=?").bind('forbidden',a.owner).run(),{code:'COMPANY_FORBIDDEN'});
 assert.throws(()=>database.prepare("SELECT '--',* FROM 'company_application_tokens'"),{code:'COMPANY_SQL_DENIED'});
 assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all(),before);
});

test('leading comments and the existing fixed JSON authorization fence remain usable',async t=>{
 const {database}=await fixture(t);
 const query="/* ' -- */ --\n WITH row AS (SELECT * FROM workspaces) SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE json('COMPANY_BOUNDARY_MISMATCH') END AS allowed FROM row";
 assert.equal((await database.prepare(query).first()).allowed,1);
});

// Independent review found SQLite accepts a quoted token immediately beside a
// keyword. Removing its delimiters must not join FROM and the table into one
// inspection token. Raw execution first establishes each SQL form is valid.
for(const [kind,left,right]of [['double quote','"','"'],['bracket','[',']'],['backtick','`','`']]){
 const quoted=value=>left+value+right,table=quoted('workspaces'),alias=quoted('w'),cte=quoted('visible');
 for(const [name,query,copies]of [
  ['FROM boundary',`SELECT owner,payload FROM${table}`,1],
  ['SELECT boundary',`SELECT${quoted('owner')},payload FROM${table}`,1],
  ['AS boundary',`SELECT w.owner,w.payload FROM${table}AS${alias}`,1],
  ['WHERE boundary',`SELECT owner,payload FROM${table}WHERE 1=1`,1],
  ['JOIN boundary',`SELECT w.owner,w.payload FROM(SELECT 1) AS seed JOIN${table}AS${alias}ON 1=1`,1],
  ['UNION boundary',`SELECT owner,payload FROM${table}UNION ALL SELECT owner,payload FROM${table}`,2],
  ['WITH boundary',`WITH${cte}AS(SELECT owner,payload FROM${table})SELECT*FROM${cte}`,1],
 ])test(`adjacent ${kind} identifier stays tenant-scoped at ${name}`,async t=>{
  const {f,a,database}=await fixture(t);
  assert.equal(f.sql.prepare(query).all().length,2*copies,'the independent two-company SQL form must be valid');
  const rows=(await database.prepare(query).all()).results;
  assert.equal(rows.length,copies,'quoted token boundaries must not expose another company');
  assert.ok(rows.every(row=>row.owner===a.owner&&row.payload===JSON.stringify({private:'company-a'})));
 });
 for(const name of ['company_application_tokens','company_application_token_control','companies','company_memberships'])test(`adjacent ${kind} identifier cannot read ${name}`,async t=>{
  const {f,database}=await fixture(t),query=`SELECT*FROM${quoted(name)}`;
  assert.doesNotThrow(()=>f.sql.prepare(query).all(),'the reserved-table query is valid SQLite');
  assert.throws(()=>database.prepare(query),{code:'COMPANY_SQL_DENIED'});
 });
 test(`adjacent ${kind} UPDATE preserves a legitimate owner-bound write`,async t=>{
  const {f,a,b,database}=await fixture(t),before=f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(b.owner);
  await database.prepare(`UPDATE${table}SET payload=? WHERE owner=?`).bind('synthetic-own-update',a.owner).run();
  assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(a.owner).payload,'synthetic-own-update');
  assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(b.owner),before);
 });
}
