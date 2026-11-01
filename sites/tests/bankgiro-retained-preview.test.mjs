import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState} from '../lib/domain.ts';
const url=p=>new URL(p,import.meta.url).href,data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
function compiled(path,imports){let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [a,b] of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+a+q,JSON.stringify(b));return data(code);}
const domain=url('../lib/domain.ts'),account='SE4280000890119146168423',documentId='11111111-1111-4111-8111-111111111111';
const xml='<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><Othr><Id>890119146168423</Id></Othr></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>SYNTHETIC-PARENT</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>SYNTHETIC-CHILD</TxId></Refs><RmtInf><Strd><CdtrRefInf><Ref>000018</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>';
async function fixture(t,reportAccount='890119146168423'){
 const sql=new DatabaseSync(':memory:'),key='retainedPreview'+crypto.randomUUID().replaceAll('-','');t.after(()=>{sql.close();delete globalThis[key];});
 sql.exec('CREATE TABLE documents(id TEXT,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT);CREATE TABLE workspaces(owner TEXT,revision INTEGER,payload TEXT);CREATE TABLE audit_events(id TEXT);');
 const bytes=new TextEncoder().encode(xml.replace('890119146168423',reportAccount)),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),objects=new Map([['owner/'+documentId,bytes]]);
 const f={sql,objects,user:{userId:'owner'},reads:0,aliases:[],accountResources:null,env:{}};globalThis[key]=f;
 f.env.DB={prepare(statement){assert.match(statement,/^SELECT /);return{bind(...args){return{async first(){return sql.prepare(statement).get(...args)||null;}};}};}};
 f.env.BUCKET={async get(id){f.reads++;const b=objects.get(id);return b?{size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;}};
 sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?)').run(documentId,'owner','Synthetic.xml','application/xml',bytes.length,hash);sql.prepare('INSERT INTO workspaces VALUES(?,?,?)').run('owner',7,JSON.stringify(emptyState()));
 const ref=`globalThis[${JSON.stringify(key)}]`,server=compiled('../lib/server.ts',{'cloudflare:workers':data(`export const env=${ref}.env;`),'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return ${ref}.user;}`),'./domain':domain});
 const transactions=compiled('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')});
 const store=data(`export async function connection(owner){return {owner,status:'connected',environment:'PRODUCTION',app_generation:'synthetic',valid_until:'2099-01-01',selected_accounts:'["selected"]',bank_name:'Swedbank',country:'SE'};}export async function application(owner){return {owner,generation:'synthetic'};}export async function accounts(){return ${ref}.accountResources||[{uid:'selected',currency:'SEK',account_id:{iban:${JSON.stringify(account)}},all_account_ids:${ref}.aliases}];}`);
 const service=compiled('../lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':transactions});
 f.route=await import(compiled('../app/api/bankgiro/preview/route.ts',{'@/lib/server':server,'@/lib/bankgiro-service':service}));f.hash=hash;
 f.get=async(query='documentId='+documentId)=>{assert.equal(typeof f.route.GET,'function','retained originals need an authenticated GET preview');return f.route.GET(new Request('https://mg.test/api/bankgiro/preview?'+query));};return f;
}
test('retained preview keeps raw account and blocks inferred BBAN to IBAN identity without writes',async t=>{const f=await fixture(t),r=await f.get(),out=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(out.hash,f.hash);assert.equal(out.revision,7);assert.equal(out.rows[0].account,'890119146168423');assert.match(out.rows[0].bankgiroAccountIssue,/mottagarkonto/);assert.equal(out.rawRows[0].account,'890119146168423');assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,7);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);assert.equal(f.objects.size,1);});
test('retained preview resolves only the exact selected provider alias and preserves original rows',async t=>{const f=await fixture(t);f.aliases=[{scheme_name:'BBAN',identification:'890119146168423'}];const r=await f.get(),out=await r.json();assert.equal(r.status,200);assert.equal(out.rows[0].account,'iban:'+account);assert.equal(out.rows[0].recipientAccount,'890119146168423');assert.equal(out.rows[0].bankgiroAccountIssue,'');assert.equal(out.rawRows[0].account,'890119146168423');});
const reportAlias='890119146168423',resource=(more={})=>({uid:'selected',currency:'SEK',account_id:{iban:account},all_account_ids:[{scheme_name:'BBAN',identification:reportAlias}],...more});
for(const [name,other] of [
 ['missing scheme',{identification:reportAlias}],
 ['unknown scheme',{scheme_name:'OTHER',identification:reportAlias}],
 ['non-string scheme',{scheme_name:42,identification:reportAlias}],
 ['non-string value',{scheme_name:'BBAN',identification:890119146168423}],
])test(`retained preview blocks account_id.other with ${name} without rewriting the report`,async t=>{
 const f=await fixture(t);f.accountResources=[resource({account_id:{iban:account,other},all_account_ids:[]})];const response=await f.get(),out=await response.json();assert.equal(response.status,200,out.error);assert.equal(out.rows[0].account,reportAlias);assert.match(out.rows[0].bankgiroAccountIssue,/mottagarkonto/);assert.equal(out.rawRows[0].account,reportAlias);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,7);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
for(const [name,additional] of [
 ['unselected account',resource({uid:'unselected',account_id:{iban:'SE4550000000058398257466'}})],
 ['other currency account',resource({uid:'foreign-currency',currency:'EUR',account_id:{iban:'SE4550000000058398257466'}})],
])test(`retained preview blocks an alias also held by an ${name}`,async t=>{
 const f=await fixture(t);f.accountResources=[resource(),additional];const response=await f.get(),out=await response.json();assert.equal(response.status,200,out.error);assert.equal(out.rows[0].account,reportAlias);assert.match(out.rows[0].bankgiroAccountIssue,/mottagarkonto/);assert.equal(out.rawRows[0].account,reportAlias);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,7);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
for(const location of ['account_id.other','all_account_ids'])for(const [scheme,alias] of [['IBAN','SE4550000000058398257466'],['BBAN',reportAlias],['CPAN','0012345678901']])test(`retained preview resolves an exact ${scheme} from ${location}`,async t=>{
 const f=await fixture(t,alias),identifier={scheme_name:scheme.toLowerCase(),identification:alias};f.accountResources=[location==='account_id.other'?resource({account_id:{iban:account,other:identifier},all_account_ids:[]}):resource({all_account_ids:[identifier]})];const response=await f.get(),out=await response.json();assert.equal(response.status,200,out.error);assert.equal(out.rows[0].account,'iban:'+account);assert.equal(out.rows[0].recipientAccount,alias);assert.equal(out.rows[0].bankgiroAccountIssue,'');assert.equal(out.rawRows[0].account,alias);
});
test('retained preview rejects unauthenticated and foreign owners before reading object bytes',async t=>{const f=await fixture(t);f.user=null;assert.equal((await f.get()).status,401);f.user={userId:'foreign'};const r=await f.get();assert.equal(r.status,400);assert.equal(f.reads,0);assert.doesNotMatch(await r.text(),/000018|890119146168423/);});
test('retained preview rejects missing and invalid document or target IDs without object reads',async t=>{const f=await fixture(t);for(const query of ['', 'documentId=..%2Foriginal','documentId='+documentId+'&targetId=..%2Ftarget'])assert.equal((await f.get(query)).status,400);assert.equal(f.reads,0);});
test('retained preview rejects corrupted original bytes and oversized retained files',async t=>{const f=await fixture(t);f.objects.set('owner/'+documentId,new TextEncoder().encode(xml.replace('000018','000026')));const corrupt=await f.get();assert.equal(corrupt.status,400);assert.match((await corrupt.json()).error,/kontrollsumma/);f.sql.prepare('UPDATE documents SET size=15000001').run();const oversized=await f.get();assert.equal(oversized.status,400);assert.match((await oversized.json()).error,/storlek/);assert.equal(f.reads,1);});
