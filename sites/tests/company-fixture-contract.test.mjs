import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {isReadOnlySql,businessSql} from './helpers/company-compat-fixture.mjs';

test('read-only fixture checks accept scoped SELECT but reject write-bearing CTEs',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE documents(owner TEXT,id TEXT)');
 assert.equal(isReadOnlySql(db,'SELECT * FROM documents WHERE owner=?'),true);
 assert.equal(isReadOnlySql(db,'WITH documents AS (SELECT * FROM main.documents WHERE owner=?) SELECT * FROM documents WHERE id=?'),true);
 for(const sql of ['INSERT INTO documents VALUES(?,?)','WITH target AS (SELECT ?) UPDATE documents SET id=?','WITH target AS (SELECT ?) DELETE FROM documents'])assert.equal(isReadOnlySql(db,sql),false);
 assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,0);
});

test('fault hooks strip only parameterized company owner CTEs',()=>{
 const write='UPDATE documents SET id=? WHERE owner=?';
 assert.equal(businessSql('WITH documents AS (SELECT * FROM main.documents WHERE owner=?) '+write),write);
 assert.equal(businessSql('WITH x AS (SELECT 1) '+write),'WITH x AS (SELECT 1) '+write);
});
