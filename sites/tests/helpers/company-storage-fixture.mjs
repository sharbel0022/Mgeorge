import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createCompanyDatabase,resolveCompanyScope,provisionCompany,companyDirectory} from '../../lib/company-storage.js';

export function companyFixture(t,{beforeCompanyMigration}={}){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort()){if(name.startsWith('0019_')&&beforeCompanyMigration)beforeCompanyMigration(sql);sql.exec(readFileSync(new URL('../../drizzle/'+name,import.meta.url),'utf8'));}
 const f={sql,beforeBatch:null};t.after(()=>sql.close());
 f.raw={prepare(query){return{query,args:[],bind(...args){return {...this,args};},async first(column){const row=sql.prepare(query).get(...this.args);return column?row?.[column]??null:row??null;},async all(){return{results:sql.prepare(query).all(...this.args),success:true,meta:{changes:0}};},async run(){return this.execute();},execute(){const s=sql.prepare(query);if(s.columns().length)return{results:s.all(...this.args),success:true,meta:{changes:0}};return{results:[],success:true,meta:{changes:Number(s.run(...this.args).changes)}};}};},async batch(statements){if(f.beforeBatch)await f.beforeBatch(statements);sql.exec('BEGIN');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 f.create=(id,actorId='actor-a')=>provisionCompany(f.raw,{id,name:'Synthetic '+id,actorId,verifiedBy:actorId,verificationEvidence:'Authenticated creation of an empty synthetic company.'});
 f.scope=async(actorId='actor-a',companyId='company-a')=>{const d=await companyDirectory(f.raw,actorId);return resolveCompanyScope(f.raw,actorId,{companyId,contextVersion:d.contextVersion});};
 f.database=scope=>createCompanyDatabase(f.raw,async()=>scope);
 return f;
}
