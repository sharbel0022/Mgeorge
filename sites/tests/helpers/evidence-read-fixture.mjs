import {isReadOnlySql} from './company-compat-fixture.mjs';
import assert from 'node:assert/strict';
import {after} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {applyCommand} from '../../lib/domain.ts';
import {genericCompanyState as emptyState} from './reference-policy-fixture.mjs';
import {syntheticBankRow} from './bank-api-fixture.mjs';
import {syntheticConnection} from './bank-account-fixture.mjs';

const testDirectory=new URL('../',import.meta.url);
// Reuse the compiled graph while each test keeps isolated SQLite/R2 fixtures.
// Short private file URLs preserve main's bound on nested module URL memory.
const fixtureKey='evidenceRead'+crypto.randomUUID().replaceAll('-','');
const moduleDirectory=mkdtempSync(join(tmpdir(),'mgeorge-mcp-evidence-')),moduleFiles=new Map();
after(()=>rmSync(moduleDirectory,{recursive:true,force:true}));
const data=s=>{const hash=createHash('sha256').update(s).digest('hex');if(!moduleFiles.has(hash)){const path=join(moduleDirectory,hash+'.mjs');writeFileSync(path,s,{flag:'wx'});moduleFiles.set(hash,pathToFileURL(path).href);}return moduleFiles.get(hash);},url=p=>new URL(p,testDirectory).href;
function compiled(path,imports={}){let code=stripTypeScriptTypes(readFileSync(new URL(path,testDirectory),'utf8'),{mode:'transform'});for(const [a,b]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+a+q,JSON.stringify(b));return data(code);}
export const origin='https://synthetic.example',iban='SE4280000890119146168423',docId='11111111-1111-4111-8111-111111111111';
export async function fixture(t){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle',testDirectory)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,testDirectory),'utf8'));
 const key=fixtureKey,f={sql,owner:'synthetic-owner',headers:new Headers({'oai-authenticated-user-id':'synthetic-owner','oai-authenticated-user-email':'owner@example.test'}),reads:[],objects:new Map(),env:{}};globalThis[key]=f;t.after(()=>{sql.close();delete globalThis[key];});t.mock.method(globalThis,'fetch',async()=>{throw Error('Network forbidden');});
 const ref=`globalThis[${JSON.stringify(key)}]`;
 f.env.DB={prepare(statement){assert.ok(isReadOnlySql(sql,statement),'read tools may only issue read-only SELECT/CTE');return{bind(...args){return{async first(){return sql.prepare(statement).get(...args)||null;},async all(){return{results:sql.prepare(statement).all(...args)};},async run(){throw Error('D1 write forbidden');}};}};},async batch(){throw Error('D1 batch forbidden');}};
 f.env.BUCKET={async get(path){f.reads.push(path);const b=f.objects.get(path);return b?{size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;},async put(){throw Error('R2 write forbidden');},async delete(){throw Error('R2 delete forbidden');}};
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',number:'0599',ocr:'000018',party:'Synthetic customer AB',total:62500,issued:'2026-10-01',due:'2026-11-01',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:62500,account:iban,party:'Synthetic customer AB',payerReference:'000018',bankReference:'EXACT-ONE'}),syntheticBankRow({date:'2026-10-27',amount:125000,account:iban,party:'Synthetic customer AB',payerReference:'000018',bankReference:'EXACT-TWO'}),syntheticBankRow({date:'2026-10-26',amount:62500,account:iban,party:'',payerReference:'',bankReference:'AIS-NO-REF'})]}).state;
 f.state=state;f.save=()=>sql.prepare('INSERT OR REPLACE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,7,?,?)').run(f.owner,JSON.stringify(f.state),'2026-11-01');f.save();
 const conn=syntheticConnection(f.owner,iban);sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...['id','owner','app_generation','environment','bank_name','country','encrypted_session','encrypted_accounts','selected_accounts','valid_until','date_from','status','created_at','updated_at'].map(k=>conn[k]));
 const csv='Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto\n2026-10-26;Synthetic payer AB;000018;987-6543;625,00;SEK;'+iban;
 f.reportBytes=new TextEncoder().encode(csv);f.hash=Buffer.from(await crypto.subtle.digest('SHA-256',f.reportBytes)).toString('hex');f.objects.set(f.owner+'/'+docId,f.reportBytes);sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(docId,f.owner,'Synthetic.csv','text/csv',f.reportBytes.length,f.hash,'2026-11-01');
 f.snapshot=()=>JSON.stringify(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sql.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
 const domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js'),auth=compiled('../app/chatgpt-auth.ts',{'next/headers':data(`export async function headers(){return ${ref}.headers;}`),'next/navigation':data('export function redirect(){throw Error("No redirect")}')});
 const server=compiled('../lib/server.ts',{'./company-storage.js':new URL('../lib/company-storage.js',testDirectory).href,'cloudflare:workers':data(`export const env=new Proxy({}, {get(_target,key){return ${ref}.env[key];}});`),'@/app/chatgpt-auth':auth,'./domain':domain});
 const store=data(`import {db} from ${JSON.stringify(server)};export async function connection(owner){return db().prepare('SELECT * FROM bank_connections WHERE owner=?').bind(owner).first();}export async function application(owner){return {owner,generation:'synthetic-generation'};}export async function accounts(conn){return JSON.parse(conn.encrypted_accounts);}`);
 const tx=compiled('../lib/banking/transactions.ts',{'../domain':domain,'./security':url('../lib/banking/security.ts'),'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')});
 const bankgiro=compiled('../lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':tx});
 const presentation=compiled('../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':url('../lib/payment-references.js')});
 const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
 const evidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':bankgiro});
 const candidates=compiled('../lib/banking/invoice-candidates.ts',{'../domain':domain,'../reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',testDirectory).href,'../payment-presentation':presentation});
 const detail=compiled('../lib/banking/detail-evidence.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')});
 const verification=compiled('../lib/payment-verification.ts',{'./account-evidence-presentation':compiled('../lib/account-evidence-presentation.ts',{'./domain':domain}),'cloudflare:workers':data(`export const env=new Proxy({}, {get(_target,key){return ${ref}.env[key];}});`),'./server':server,'./domain':domain,'./payment-presentation':presentation,'./bank-api-original.js':url('../lib/bank-api-original.js'),'./reconciliation-engine.js':engine,'./payment-references.js':url('../lib/payment-references.js'),'./banking/invoice-candidates':candidates,'./banking/detail-evidence':detail,'./reconciliation-evidence':evidence,'./bankgiro-service':bankgiro});
 const reader=existsSync(new URL('../lib/evidence-read.ts',testDirectory))?compiled('../lib/evidence-read.ts',{'./server':server,'./domain':domain,'./payment-presentation':presentation,'./payment-verification':verification,'./bankgiro-service':bankgiro,'./reconciliation-engine.js':engine,'./payment-references.js':url('../lib/payment-references.js'),'./invoice-reference-policy.js':url('../lib/invoice-reference-policy.js'),'./banking/invoice-candidates':candidates}):data('export function readPaymentEvidence(){throw Error("Reader not implemented")}');
 const rpc=compiled('../lib/banking/mcp.ts',{'./service':data(`export {failure as bankFailure} from ${JSON.stringify(server)};export function automaticSync(){throw Error('No sync')}export function automaticSyncStatus(){throw Error('No sync')}`),'../evidence-read':reader});
 f.route=await import(compiled('../app/mcp/route.ts',{'@/lib/banking/mcp':rpc}));
 f.call=async(name,args={},requestOptions={})=>{const r=await f.route.POST(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),...requestOptions}));const raw=await r.text();let body;try{body=JSON.parse(raw);}catch{body={raw};}return{r,body,out:body.result?.structuredContent};};return f;
}
