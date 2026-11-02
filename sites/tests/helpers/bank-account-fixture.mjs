import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
export function syntheticConnection(owner='synthetic-owner',iban='SE4280000890119146168423'){
 return{id:'synthetic-connection',owner,status:'connected',environment:'PRODUCTION',valid_until:'2099-01-01T00:00:00Z',app_generation:'synthetic-generation',selected_accounts:'["selected"]',bank_name:'Synthetic bank',country:'SE',encrypted_session:'synthetic-session-resource',encrypted_accounts:JSON.stringify([{uid:'selected',currency:'SEK',account_id:{iban}}]),date_from:'2026-10-01',created_at:'2026-10-01',updated_at:'2026-10-01'};
}
/** Minimal real consent table for small D1 fixtures; full migration fixtures
 * retain their real table. Financial fences read the same persisted values. */
export function retainSyntheticConsent(sql,resource=syntheticConnection()){
 retainSyntheticIngestTables(sql);
 const fields=Object.keys(resource);sql.exec('CREATE TABLE IF NOT EXISTS bank_connections('+fields.map(field=>field+' TEXT NOT NULL').join(',')+',UNIQUE(owner))');
 sql.prepare('INSERT OR REPLACE INTO bank_connections('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...Object.values(resource));return resource;
}
/** Real empty source census for small fixtures; full migrations retain rows. */
export function retainSyntheticIngestTables(sql){
 sql.exec(readFileSync(new URL('../../drizzle/0017_bankgiro_auto_ingest.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE `','CREATE TABLE IF NOT EXISTS `').replaceAll('CREATE UNIQUE INDEX `','CREATE UNIQUE INDEX IF NOT EXISTS `').replaceAll('CREATE INDEX `','CREATE INDEX IF NOT EXISTS `'));
}
export function syntheticAccountStore(owner='synthetic-owner',iban='SE4280000890119146168423'){
 const resource=syntheticConnection(owner,iban);
 return data(`export async function connection(){return ${JSON.stringify(resource)};}export async function application(){return ${JSON.stringify({owner,generation:resource.app_generation})};}export async function accounts(){return ${resource.encrypted_accounts};}`);
}
/** A complete current synthetic provider resource for original-integrity tests.
 * The real account verifier still checks owner, generation, expiry, selection,
 * currency and exact account identity. Negative consent cases live separately.
 */
export function syntheticAccountService(owner='synthetic-owner',iban='SE4280000890119146168423'){
 const store=syntheticAccountStore(owner,iban);
 const server=data('export async function readWorkspace(){throw Error("Not used by consent verification");}export async function readBankOriginalBytes(){throw Error("Not used by consent verification");}');
 const imports={'./server':server,'./domain':url('../../lib/domain.ts'),'./bankgiro-parser.js':url('../../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':data('export function stableAccountKey(account){return "iban:"+account.account_id.iban;}')};
 let code=stripTypeScriptTypes(readFileSync(new URL('../../lib/bankgiro-service.ts',import.meta.url),'utf8'),{mode:'transform'});
 for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
