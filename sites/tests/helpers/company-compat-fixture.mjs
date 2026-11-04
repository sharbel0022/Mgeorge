import {readFileSync,readdirSync} from 'node:fs';

/** Historical route fixtures use the same additive schema as the worker. */
export function applyCurrentMigrations(sqlite){
 for(const file of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(file=>/^\d{4}.*\.sql$/.test(file)).sort()){
  sqlite.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));
 }
}

/** Ask SQLite whether a SELECT/CTE opens a write transaction. Never execute it.
 * This keeps read-only test guards strict when tenant-scoped reads use WITH.
 * A write-bearing WITH is rejected just like a direct INSERT/UPDATE/DELETE.
 */
export function isReadOnlySql(sqlite,query){
 if(!/^\s*(SELECT|WITH)\b/i.test(query))return false;
 return sqlite.prepare('EXPLAIN '+query).all().every(row=>
  !(row.opcode==='Transaction'&&row.p2!==0)&&row.opcode!=='OpenWrite'
 );
}

/** Match an existing fault-injection point after the adapter's generated CTEs.
 * This strips only the exact parameterized owner-filter form, not arbitrary SQL.
 */
export function businessSql(query){
 if(!/^WITH\s/.test(query))return query;
 let tail=query.replace(/^WITH\s+/,''),stripped=false;
 const scope=/^([a-z_]+) AS \(SELECT (?:rowid AS rowid,)?\* FROM main\.\1 WHERE owner=\?\)(?:,\s*|\s+)/;
 while(scope.test(tail)){tail=tail.replace(scope,'');stripped=true;}
 return stripped?(/^(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(tail)?tail:'WITH '+tail):query;
}
