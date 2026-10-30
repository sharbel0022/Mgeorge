import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {applyCommand,emptyState} from '../lib/domain.ts';

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){
 let code=ts.transpileModule(source(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [name,replacement]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(replacement));
 return data(code);
}

class LocalD1{
 constructor(sql){this.sql=sql;}
 prepare(query){const self=this;return{args:[],bind(...args){this.args=args;return this;},async first(){return self.sql.prepare(query).get(...this.args)||null;},async all(){return{results:self.sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return{meta:{changes:Number(self.sql.prepare(query).run(...this.args).changes)}};}};}
 async batch(statements){this.sql.exec('BEGIN');try{const result=statements.map(s=>s.execute());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}

const origin='https://synthetic-mg.example';
const call={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'reconcile_customer_payments',arguments:{}}};
function request({method='POST',requestOrigin=origin,type='application/json',body=JSON.stringify(call)}={}){
 const req=new Request(origin+'/mcp',{method,headers:{...(requestOrigin===null?{}:{Origin:requestOrigin}),...(type===null?{}:{'Content-Type':type})},...(['GET','HEAD'].includes(method)?{}:{body})});
 if(type===null)req.headers.delete('Content-Type');
 return req;
}

async function fixture(t){
 const key='__mcpSecurity_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(source('../drizzle/'+file));
 const f={sql,owner:'synthetic-alice',headers:new Headers({'oai-authenticated-user-id':'synthetic-alice','oai-authenticated-user-email':'alice@example.test'}),bucketReads:0};
 f.env={DB:new LocalD1(sql),BUCKET:{async get(){f.bucketReads++;throw Error('No file originals in this synthetic MCP fixture');}}};
 globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
 t.mock.method(globalThis,'fetch',async()=>{throw Error('No live network is allowed in MCP security tests');});
 const ref=`globalThis[${JSON.stringify(key)}]`,domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js');
 // The platform identity headers are the mocked boundary. The actual app auth,
 // Origin check, MCP dispatcher, reconciliation, SQL and draft writes all run.
 const auth=compiled('../app/chatgpt-auth.ts',{'next/headers':data(`export async function headers(){return ${ref}.headers;}`),'next/navigation':data('export function redirect(){throw Error("Unexpected redirect")}')});
 const server=compiled('../lib/server.ts',{'cloudflare:workers':data(`export const env=${ref}.env;`),'@/app/chatgpt-auth':auth,'./domain':domain});
 const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
 const evidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine});
 const unusedStore=data('export async function encrypt(){throw Error("No credentials in fixture")}export async function decrypt(){throw Error("No credentials in fixture")}');
 const unusedProvider=data('export function gmailAccount(){return "synthetic@example.test"}export function hasGmailSendScope(){return false}export async function prepareGmailSend(){throw Error("No delivery is allowed")}');
 const messages=compiled('../lib/customer-messages.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-evidence':evidence,'./customer-message-text.js':url('../lib/customer-message-text.js'),'./banking/security':url('../lib/banking/security.ts'),'./banking/store':unusedStore,'./gmail-adapter.js':unusedProvider});
 const unusedBank=data(`export {failure as bankFailure} from ${JSON.stringify(server)};export async function automaticSync(){throw Error('Unexpected bank operation')}export async function automaticSyncStatus(){throw Error('Unexpected bank status')}`);
 const rpc=compiled('../lib/banking/mcp.ts',{'./service':unusedBank,'../server':server,'../customer-messages':messages});
 f.route=await import(compiled('../app/mcp/route.ts',{'@/lib/banking/mcp':rpc}));
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'SYNTHETIC-MCP-001',total:62500,issued:'2026-01-01',due:'2026-01-02',reviewed:true}}).state;
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,1,?,?)').run(f.owner,JSON.stringify(state),'2026-10-30T00:00:00.000Z');
 f.snapshot=()=>JSON.stringify(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sql.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
 f.count=table=>sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return f;
}

for(const requestOrigin of ['https://untrusted.example','null','','https://synthetic-mg.example.attacker.test',origin+', https://untrusted.example'])test('MCP rejects foreign or opaque Origin before any draft or audit write: '+JSON.stringify(requestOrigin),async t=>{
 const f=await fixture(t),before=f.snapshot(),req=request({requestOrigin,type:'text/plain;charset=UTF-8'});
 const response=await f.route.POST(req);
 assert.equal(response.status,403);assert.equal(req.bodyUsed,false);assert.equal(f.snapshot()===before,true);assert.equal(f.count('customer_messages'),0);assert.equal(f.count('audit_events'),0);assert.equal(f.bucketReads,0);
});

test('MCP rejects foreign Origin even with an otherwise valid JSON request',async t=>{
 const f=await fixture(t),before=f.snapshot(),req=request({requestOrigin:'https://untrusted.example'});
 const response=await f.route.POST(req);
 assert.equal(response.status,403);assert.equal(req.bodyUsed,false);assert.equal(f.snapshot()===before,true);assert.equal(f.count('customer_messages'),0);assert.equal(f.count('audit_events'),0);
});

for(const type of [null,'text/plain','application/x-www-form-urlencoded','multipart/form-data; boundary=synthetic','application/jsonx','application/json-patch+json'])test('MCP rejects simple or unsupported content type without writes: '+String(type),async t=>{
 const f=await fixture(t),before=f.snapshot(),req=request({requestOrigin:null,type});
 const response=await f.route.POST(req);
 assert.equal(response.status,415);assert.equal(req.bodyUsed,false);assert.equal(f.snapshot()===before,true);assert.equal(f.count('audit_events'),0);
});

for(const type of ['application/json','application/json; charset=utf-8','Application/JSON; Charset=UTF-8'])test('MCP permits authorized same-origin JSON including charset: '+type,async t=>{
 const f=await fixture(t),response=await f.route.POST(request({type})),body=await response.json();
 assert.equal(response.status,200);assert.ok(!body.result.isError);assert.equal(f.count('customer_messages'),1);assert.equal(f.count('audit_events'),1);assert.equal(f.count('customer_deliveries'),0);
});

test('MCP permits an authenticated server/OAuth JSON request without browser Origin',async t=>{
 const f=await fixture(t),response=await f.route.POST(request({requestOrigin:null,type:'application/json; charset=utf-8'})),body=await response.json();
 assert.equal(response.status,200);assert.ok(!body.result.isError);assert.equal(f.count('customer_messages'),1);assert.equal(f.count('audit_events'),1);assert.equal(f.count('customer_deliveries'),0);
});

for(const method of ['GET','HEAD','PUT','PATCH','DELETE','OPTIONS'])test('MCP handler rejects other HTTP methods without reading or dispatching: '+method,async t=>{
 const f=await fixture(t),before=f.snapshot(),req=request({method});
 // The framework exposes only POST. The handler also guards its own method,
 // so a direct or future internal dispatch cannot enter a mutating RPC path.
 const response=await f.route.POST(req);
 assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'POST');assert.equal(req.bodyUsed,false);assert.equal(f.snapshot()===before,true);assert.equal(f.count('audit_events'),0);
});

test('MCP still rejects missing identity and client-supplied owner overrides',async t=>{
 const f=await fixture(t),before=f.snapshot();
 const override=structuredClone(call);override.params.arguments={owner:'synthetic-bob'};
 const foreign=await f.route.POST(request({body:JSON.stringify(override)}));assert.equal((await foreign.json()).error.code,-32602);assert.equal(f.snapshot()===before,true);
 f.headers=new Headers();const anonymous=await f.route.POST(request({requestOrigin:null})),body=await anonymous.json();assert.equal(body.result.isError,true);assert.equal(f.snapshot()===before,true);
});

test('MCP retains bounded JSON parsing and cannot mutate on malformed or oversized bodies',async t=>{
 const f=await fixture(t),before=f.snapshot();
 for(const [body,status]of [['{',400],[' '.repeat(16_385),413]]){const response=await f.route.POST(request({body}));assert.equal(response.status,status);assert.equal(f.snapshot()===before,true);}
});
