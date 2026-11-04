import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {emptyState,applyCommand} from '../lib/domain.ts';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {randomToken} from '../lib/banking/security.ts';
import {parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {ProviderError} from '../lib/banking/enable-banking.ts';
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64'),url=p=>new URL(p,import.meta.url).href;
function compiled(path,imports={}){let s=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [a,b]of Object.entries(imports))for(const q of ['"',"'"])s=s.replaceAll(q+a+q,JSON.stringify(b));return data(s);}
const appId='11111111-1111-4111-8111-111111111111',accountId='22222222-2222-4222-8222-222222222222',remoteSession='33333333-3333-4333-8333-333333333333',docId='44444444-4444-4444-8444-444444444444';
const iban='SE4280000890119146168423',domestic='890119146168423',origin='https://synthetic.example';
const keyPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keyPair.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END PRIVATE KEY-----\n';
async function fixture(t,readerFailure=false){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const key='currentAccount'+crypto.randomUUID().replaceAll('-',''),f={sql,owner:'synthetic-owner',calls:[],reads:[],objects:new Map(),headers:new Headers({'oai-authenticated-user-id':'synthetic-owner','oai-authenticated-user-email':'owner@example.test'}),env:{BANK_DATA_ENCRYPTION_KEY:randomToken(),ENABLE_BANKING_APPLICATION_ID:appId,ENABLE_BANKING_PRIVATE_KEY:pem,ENABLE_BANKING_ENVIRONMENT:'PRODUCTION',ENABLE_BANKING_KEY_ROTATED:'true'}};globalThis[key]=f;t.after(()=>{assert.equal(sql.prepare('SELECT count(*) AS n FROM bank_locks').get().n,0,'every completed account read releases its operational lease');delete globalThis[key];sql.close();});const ref=`globalThis[${JSON.stringify(key)}]`;
 // Real SQLite with only operational lease/cooldown writes allowed. Date.now
 // drives the test SQL clock as well, so explicit Retry-After tests can advance
 // time without sleeping or depending on the machine's wall clock.
 sql.function('test_bank_clock',()=>new Date(Date.now()).toISOString());
 f.env.DB={prepare(statement){
  assert.match(statement,/^(?:SELECT\b|INSERT INTO bank_locks\b|DELETE FROM bank_locks\b|UPDATE bank_connections SET account_evidence_retry=)/i,'Financial/account-fact D1 writes are forbidden');
  const query=statement.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'test_bank_clock()');
  return {values:[],bind(...args){this.values=args;return this;},async first(){const row=sql.prepare(query).get(...this.values)||null;if(statement.includes('revision, payload FROM workspaces')){f.workspaceReads=(f.workspaceReads||0)+1;f.afterWorkspaceRead?.(f.workspaceReads);}return row;},async all(){return{results:sql.prepare(query).all(...this.values)};},async run(){return this.execute();},execute(){return {success:true,meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};}};
 },async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 f.env.BUCKET={async get(path){f.reads.push(path);const b=f.objects.get(path);f.onOriginalRead?.();return b?{size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;},async put(){throw Error('R2 write forbidden');},async delete(){throw Error('R2 delete forbidden');}};
 const domain=url('../lib/domain.ts'),auth=compiled('../app/chatgpt-auth.ts',{'next/headers':data(`export async function headers(){return ${ref}.headers;}`),'next/navigation':data('export function redirect(){throw Error("Unexpected redirect")}')}),cloud=data(`export const env=${ref}.env;`),server=compiled('../lib/server.ts',{'cloudflare:workers':cloud,'@/app/chatgpt-auth':auth,'./domain':domain});
 const tx=compiled('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')});
 const store=compiled('../lib/banking/store.ts',{'cloudflare:workers':cloud,'@/lib/server':server,'./security':url('../lib/banking/security.ts'),'./runtime-config':url('../lib/banking/runtime-config.ts'),'./transactions':tx,'../bank-consent-policy.js':url('../lib/bank-consent-policy.js'),'../bank-company-authority.js':url('../lib/bank-company-authority.js')});f.store=await import(store);
 const app=await f.store.application(f.owner);f.metadata={kid:appId,name:'Synthetic application',environment:'PRODUCTION',active:true,countries:['SE'],services:['AIS'],redirect_urls:[]};sql.prepare('INSERT INTO bank_applications(owner,application_id,encrypted_key,metadata,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(f.owner,appId,'',JSON.stringify(f.metadata),app.generation,'2026-11-01','2026-11-01');
 f.accounts=[{uid:accountId,account_id:{iban},currency:'SEK'}];f.fresh=new Map([[accountId,{...structuredClone(f.accounts[0]),cash_account_type:'CACC',all_account_ids:[{identification:domestic,scheme_name:'BBAN'}]}]]);
 const encryptedSession=await f.store.encrypt(f.owner,'session:synthetic-connection',remoteSession),encryptedAccounts=await f.store.encrypt(f.owner,'accounts:synthetic-connection',f.accounts);
 sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-connection',f.owner,app.generation,'PRODUCTION','Synthetic bank','SE',encryptedSession,encryptedAccounts,JSON.stringify([accountId]),'2099-01-01','2026-10-01','connected','2026-11-01','2026-11-01');
 f.state=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:iban,date:'2026-10-26',amount:62500,payerReference:'000018',bankReference:'SYNTHETIC-AIS-ENTRY'})]}).state;f.save=()=>sql.prepare('INSERT OR REPLACE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,7,?,?)').run(f.owner,JSON.stringify(f.state),'2026-11-01');f.save();
 const report='Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto\n2026-10-26;Synthetic payer AB;000018;987-6543;625,00;SEK;'+domestic;f.reportBytes=new TextEncoder().encode(report);f.hash=Buffer.from(await crypto.subtle.digest('SHA-256',f.reportBytes)).toString('hex');f.objects.set(f.owner+'/'+docId,f.reportBytes);sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(docId,f.owner,'Synthetic.csv','text/csv',f.reportBytes.length,f.hash,'2026-11-01');
 f.live={status:'AUTHORIZED',accounts:[accountId],accounts_data:[{uid:accountId}],aspsp:{name:'Synthetic bank',country:'SE'},psu_type:'business',access:{valid_until:'2099-01-01'},created:'2026-11-01'};
 t.mock.method(globalThis,'fetch',async(address,init)=>{const u=new URL(address);assert.equal(u.origin,'https://api.enablebanking.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.has('Psu-Ip-Address'),false);f.calls.push(u.pathname);const intercepted=f.onFetch?await f.onFetch(u.pathname):undefined;if(intercepted)return intercepted;if(f.providerError)return new Response(JSON.stringify({error:'RATE_LIMIT',secret:'DO NOT RETURN PROVIDER BODY'}),{status:429,headers:{'Content-Type':'application/json'}});if(u.pathname==='/sessions/'+remoteSession)return Response.json(f.live);const m=u.pathname.match(/^\/accounts\/([a-f0-9-]+)\/details$/);assert.ok(m,'Only session and consent-account detail reads are permitted');return Response.json(f.fresh.get(m[1])??{});});
 f.setAccounts=async(accounts,selected=[accountId])=>{f.accounts=accounts;const encrypted=await f.store.encrypt(f.owner,'accounts:synthetic-connection',accounts);sql.prepare('UPDATE bank_connections SET encrypted_accounts=?,selected_accounts=? WHERE owner=?').run(encrypted,JSON.stringify(selected),f.owner);f.live.accounts=accounts.map(a=>a.uid);f.live.accounts_data=accounts.map(a=>({uid:a.uid}));};
 const provider=readerFailure?data(`export * from ${JSON.stringify(url('../lib/banking/enable-banking.ts'))};export async function getSession(){throw ${ref}.readerFailure;}`):url('../lib/banking/enable-banking.ts');
 const guard=compiled('../lib/banking/account-read-guard.ts',{'../server':server,'./store':store,'./enable-banking':provider,'./account-read-cooldown':url('../lib/banking/account-read-cooldown.ts')});
 const reader=existsSync(new URL('../lib/banking/account-evidence.ts',import.meta.url))?compiled('../lib/banking/account-evidence.ts',{'./account-read-guard':guard,'./account-evidence-contract':url('../lib/banking/account-evidence-contract.ts'),'./account-read-cooldown':url('../lib/banking/account-read-cooldown.ts'),'../account-evidence-presentation':compiled('../lib/account-evidence-presentation.ts',{'./domain':domain}),'../server':server,'../domain':domain,'./store':store,'./transactions':tx,'./enable-banking':provider,'../bankgiro-parser.js':url('../lib/bankgiro-parser.js')}):data('export function readBankAccountEvidence(){throw Error("Not implemented")}');
 const rpc=compiled('../lib/banking/mcp.ts',{'./service':data(`export {failure as bankFailure} from ${JSON.stringify(server)};export function automaticSync(){throw Error('No sync')}export function automaticSyncStatus(){throw Error('No sync')}`),'./account-evidence':reader});f.route=await import(compiled('../app/mcp/route.ts',{'@/lib/banking/mcp':rpc}));
 f.accountRoute=existsSync(new URL('../app/api/bank/account-evidence/route.ts',import.meta.url))?await import(compiled('../app/api/bank/account-evidence/route.ts',{'@/lib/server':server,'@/lib/banking/account-evidence':reader,'@/lib/account-evidence-presentation':compiled('../lib/account-evidence-presentation.ts',{'./domain':domain})})):{};
 f.args=()=>({transactionId:f.state.transactions[0].id,documentId:docId});f.call=async(args=f.args(),options={})=>{const r=await f.route.POST(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bank_account_evidence',arguments:args}}),...options}));let body;try{body=await r.json();}catch{body={};}return{r,body,out:body.result?.structuredContent};};f.snapshot=()=>JSON.stringify(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'bank_locks' ORDER BY name").all().map(({name})=>[name,sql.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));f.financialSnapshot=()=>JSON.stringify(JSON.parse(f.snapshot()).map(([name,rows])=>[name,name==='bank_connections'?rows.map(({account_evidence_retry,retry_after,...row})=>row):rows]));return f;
}
test('current bank-supplied BBAN proves only the selected account alias without any writes',async t=>{const f=await fixture(t),before=f.snapshot(),{out,body}=await f.call();assert.ok(out,JSON.stringify(body));assert.equal(out.status,'matched');assert.equal(out.accountMatch,true);assert.equal(out.changed,false);assert.equal(out.providerContacted,true);assert.equal(out.complete,true);assert.equal(out.rows[0].sourcePath,'all_account_ids[0].identification');assert.equal(out.rows[0].scheme,'BBAN');assert.equal(out.sourceScope,'current_owned_ais_consent');assert.doesNotMatch(JSON.stringify(out),new RegExp(iban+'|'+domestic+'|'+accountId+'|'+remoteSession+'|PRIVATE KEY|encrypted_accounts'));assert.deepEqual(f.calls,['/sessions/'+remoteSession,'/accounts/'+accountId+'/details']);assert.equal(f.snapshot(),before);});
test('missing bank-provided alias remains missing and is never calculated from IBAN',async t=>{const f=await fixture(t);delete f.fresh.get(accountId).all_account_ids;const before=f.snapshot(),{out}=await f.call({transactionId:f.state.transactions[0].id,sha256:f.hash});assert.equal(out.status,'missing');assert.equal(out.accountMatch,false);assert.equal(out.complete,true);assert.equal(f.snapshot(),before);});
test('an alias shared by an unselected account remains ambiguous',async t=>{const f=await fixture(t),other={uid:'55555555-5555-4555-8555-555555555555',account_id:{iban:'SE4550000000058398257466'},currency:'EUR'};await f.setAccounts([...f.accounts,other]);f.fresh.set(other.uid,{...other,cash_account_type:'CACC',all_account_ids:[{identification:domestic,scheme_name:'BBAN'}]});const before=f.snapshot(),{out}=await f.call();assert.equal(out.ambiguous,true);assert.equal(out.accountMatch,false);assert.equal(out.status,'ambiguous');assert.equal(f.snapshot(),before);});
test('company-scoped alias checks never read another company account in the same provider session',async t=>{
 const f=await fixture(t),other={uid:'55555555-5555-4555-8555-555555555555',account_id:{iban:'SE4550000000058398257466'},currency:'SEK'},validUntil='2099-01-01T00:00:00.000Z';
 await f.setAccounts([...f.accounts,other]);f.fresh.set(other.uid,{...other,cash_account_type:'CACC',all_account_ids:[{identification:'1234567',scheme_name:'BBAN'}]});
 const context=f.store.bankCompanyContext(f.owner),metadata={version:'bank-consent-v1',mode:'company',...context,requestedScopes:['accounts:read','transactions:read'],grantedScopes:['accounts:read','transactions:read'],validUntil,corporateAuthorization:{status:'unverified',reason:'CORPORATE_AUTHORIZATION_REQUIRED'}};
 f.sql.prepare('UPDATE bank_connections SET consent_metadata=?,valid_until=?').run(JSON.stringify(metadata),validUntil);
 f.env.BANK_COMPANY_AUTHORIZATIONS=JSON.stringify({version:1,bindings:[{companyId:context.companyId,storageOwnerId:f.owner,provider:'enablebanking',bankName:'Synthetic bank',country:'SE',accountKeys:['iban:'+iban],evidenceId:'synthetic-company-proof',origin:'bank',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil,status:'active'}]});
 const before=f.snapshot(),{out}=await f.call();
 assert.equal(out.status,'incomplete');assert.equal(out.complete,false);assert.equal(out.accountMatch,false);assert.equal(out.resourcesRead,0);
 assert.equal(f.calls.includes('/accounts/'+other.uid+'/details'),false);assert.equal(f.calls.length,0);assert.equal(f.snapshot(),before);
});
test('changed primary identity or currency cannot authorize a bank-provided alias',async t=>{for(const patch of [{account_id:{iban:'SE4550000000058398257466'}},{currency:'EUR'}]){const f=await fixture(t);Object.assign(f.fresh.get(accountId),patch);const before=f.snapshot(),{out}=await f.call();assert.equal(out.status,'mismatch');assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(f.snapshot(),before);}});
test('owner, selector, original and consent security gates reject before contacting the provider',async t=>{for(const mutate of [f=>{f.headers=new Headers();},f=>{f.headers=new Headers({'oai-authenticated-user-id':'foreign','oai-authenticated-user-email':'foreign@example.test'});},f=>{delete f.state.transactions[0].bankDataSha256;f.save();},f=>{f.objects.clear();},f=>{f.objects.set(f.owner+'/'+docId,new TextEncoder().encode('corrupt'));},f=>{f.sql.prepare('UPDATE bank_connections SET status=?').run('disconnected');},f=>{f.sql.prepare('UPDATE bank_connections SET environment=?').run('SANDBOX');},f=>{f.sql.prepare('UPDATE bank_connections SET selected_accounts=?').run('[]');},f=>{f.sql.prepare('UPDATE bank_connections SET valid_until=?').run('2000-01-01');},f=>{f.sql.prepare('UPDATE bank_connections SET app_generation=?').run('old');},f=>{f.metadata.active=false;f.sql.prepare('UPDATE bank_applications SET metadata=?').run(JSON.stringify(f.metadata));}]){const f=await fixture(t);mutate(f);const before=f.snapshot(),{body}=await f.call();assert.ok(body.error||body.result?.isError||body.result?.structuredContent?.status==='blocked');assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);}const f=await fixture(t);for(const args of [{...f.args(),owner:'foreign'},{...f.args(),accountId},{...f.args(),sha256:f.hash},{...f.args(),documentId:'foreign'},{...f.args(),transactionId:'foreign'},{...f.args(),force:true}]){const {body}=await f.call(args);assert.ok(body.error||body.result?.isError||body.result?.structuredContent?.status==='blocked');}assert.deepEqual(f.calls,[]);});
test('MCP transport denies foreign origin and simple content types before any provider read',async t=>{const f=await fixture(t),before=f.snapshot();for(const [headers,status]of [[{'Content-Type':'application/json',Origin:'https://foreign.test'},403],[{'Content-Type':'text/plain'},415]])assert.equal((await f.call(f.args(),{headers})).r.status,status);assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);});
test('stale consent or workspace after a provider read cannot produce a positive result',async t=>{for(const sql of ["UPDATE bank_connections SET selected_accounts='[]'","UPDATE workspaces SET revision=revision+1","UPDATE bank_applications SET generation='changed'"]){const f=await fixture(t);f.onFetch=path=>{if(path.endsWith('/details'))f.sql.exec(sql);};const {out}=await f.call();assert.equal(out.status,'stale');assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(out.changed,false);assert.deepEqual(out.rows,[]);}});
test('provider errors remain bounded safe diagnostics while only operational cooldown is saved',async t=>{const f=await fixture(t);f.providerError=true;const before=f.financialSnapshot(),{out,body}=await f.call();assert.ok(out,JSON.stringify(body));assert.equal(out.status,'error');assert.equal(out.providerContacted,true);assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.doesNotMatch(JSON.stringify(body),/DO NOT RETURN PROVIDER BODY|PRIVATE KEY/);assert.equal(f.financialSnapshot(),before);assert.equal(out.operationalStateChanged,true);});
test('at most five existing consent resources are refreshed and omitted resources prevent uniqueness claims',async t=>{const f=await fixture(t);const extras=Array.from({length:5},(_,i)=>({uid:'66666666-6666-4666-8666-'+String(i+1).padStart(12,'0'),account_id:{other:{identification:'OTHER'+i,scheme_name:'BBAN'}},currency:'SEK'}));await f.setAccounts([...f.accounts,...extras]);for(const a of extras)f.fresh.set(a.uid,{...a,cash_account_type:'CACC',all_account_ids:[]});const before=f.snapshot(),{out}=await f.call();assert.equal(f.calls.filter(p=>p.endsWith('/details')).length,5);assert.equal(out.status,'incomplete');assert.equal(out.complete,false);assert.equal(out.accountMatch,false);assert.equal(out.resourcesTotal,6);assert.equal(out.resourcesRead,5);assert.equal(f.snapshot(),before);});
test('consent revoked during the session read prevents any subsequent account-detail read',async t=>{const f=await fixture(t);f.onFetch=path=>{if(path.startsWith('/sessions/'))f.sql.prepare('UPDATE bank_connections SET selected_accounts=?').run('[]');};const {out}=await f.call();assert.equal(out.status,'stale');assert.equal(out.accountMatch,false);assert.deepEqual(f.calls,['/sessions/'+remoteSession]);});
test('formatting-only alias comparison retains every account digit and requires a known scheme',async t=>{for(const [alias,scheme,matched]of [[domestic.slice(0,5)+' '+domestic.slice(5),'BBAN',true],['0'+domestic,'BBAN',false],[domestic.slice(0,4)+domestic.slice(5),'BBAN',false],[domestic,'BANK',false]]){const f=await fixture(t);f.fresh.get(accountId).all_account_ids=[{identification:alias,scheme_name:scheme}];const before=f.snapshot(),{out}=await f.call();assert.equal(out.accountMatch,matched);assert.equal(f.snapshot(),before);}});
test('a live foreign bank, expired session or missing account blocks detail calls without exposing bank resources',async t=>{for(const mutate of [f=>{f.live.aspsp.name='Other bank';},f=>{f.live.access.valid_until='2000-01-01';},f=>{f.live.accounts=[];},f=>{f.live.psu_type='personal';}]){const f=await fixture(t);mutate(f);const before=f.snapshot(),{out}=await f.call();assert.equal(out.status,'blocked');assert.equal(out.accountMatch,false);assert.equal(f.calls.length,1);assert.equal(f.snapshot(),before);}});
test('duplicate original hashes and malformed stored resource IDs are rejected before network',async t=>{const f=await fixture(t);f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) SELECT ?,owner,filename,mime,size,sha256,created_at FROM documents WHERE id=?').run('77777777-7777-4777-8777-777777777777',docId);const before=f.snapshot(),result=await f.call({transactionId:f.state.transactions[0].id,sha256:f.hash});assert.equal(result.body.result.isError,true);assert.deepEqual(f.calls,[]);assert.deepEqual(f.reads,[]);assert.equal(f.snapshot(),before);await f.setAccounts([{...f.accounts[0],uid:'../injected'}],['../injected']);const again=await f.call();assert.equal(again.body.result.isError,true);assert.deepEqual(f.calls,[]);});
test('a live session account superset cannot claim complete alias uniqueness or trigger reads of new accounts',async t=>{const f=await fixture(t),extra='88888888-8888-4888-8888-888888888888';f.live.accounts.push(extra);f.live.accounts_data.push({uid:extra});f.fresh.set(extra,{uid:extra,account_id:{iban:'SE4550000000058398257466'},all_account_ids:[{identification:domestic,scheme_name:'BBAN'}],currency:'SEK',cash_account_type:'CACC'});const before=f.snapshot(),{out}=await f.call();assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(out.status,'incomplete');assert.equal(out.resourcesRead,0);assert.deepEqual(out.rows,[]);assert.deepEqual(f.calls,['/sessions/'+remoteSession]);assert.equal(f.snapshot(),before);});

test('session schema failure identifies its boundary before account reads without disclosing values or writing',async t=>{
 const f=await fixture(t);f.live.accounts_data=null;f.live.private=accountId;const before=f.snapshot(),{out}=await f.call();
 assert.equal(out.status,'error');assert.equal(out.errorCode,'INVALID_PROVIDER_RESPONSE');assert.equal(out.stage,'session');
 assert.deepEqual(out.validationIssue,{field:'accounts_data',kind:'null'});assert.equal(out.resourcesAttempted,0);assert.equal(out.resourcesRead,0);
 assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(f.snapshot(),before);assert.doesNotMatch(JSON.stringify(out),new RegExp(accountId+'|'+remoteSession+'|'+iban));
});
test('first account schema failure identifies the attempted read while null optional fields remain rejected',async t=>{
 const f=await fixture(t);f.fresh.get(accountId).account_id.other=null;const before=f.snapshot(),{out}=await f.call();
 assert.equal(out.status,'error');assert.equal(out.stage,'account_details');assert.equal(out.errorCode,'INVALID_PROVIDER_RESPONSE');
 assert.deepEqual(out.validationIssue,{field:'account_id.other',kind:'null'});assert.equal(out.resourcesAttempted,1);assert.equal(out.resourcesRead,0);
 assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(f.snapshot(),before);assert.doesNotMatch(JSON.stringify(out),new RegExp(accountId+'|'+remoteSession+'|'+iban));
});

test('forged provider errors cannot leak codes, messages or diagnostic properties through the reader',async t=>{
 for(const code of ['INVALID_PROVIDER_RESPONSE',accountId]){
  const f=await fixture(t),error=new ProviderError(code,'DO NOT RETURN '+iban);error.validationIssue={field:accountId,kind:iban};f.onFetch=()=>{throw error;};
  const before=f.snapshot(),{out}=await f.call();assert.equal(out.status,'error');assert.equal(out.stage,'session');assert.equal(out.validationIssue,null);
  assert.equal(out.errorCode,code==='INVALID_PROVIDER_RESPONSE'?'INVALID_PROVIDER_RESPONSE':'ACCOUNT_EVIDENCE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(out),new RegExp(accountId+'|'+iban+'|DO NOT RETURN'));assert.equal(f.snapshot(),before);
 }
});

test('the constructor code remains compatible without evaluating a changed provider error code getter',async t=>{
 const f=await fixture(t),error=new ProviderError('INVALID_PROVIDER_RESPONSE','Synthetic error');let reads=0;
 Object.defineProperty(error,'code',{get(){reads++;return reads<=2?'INVALID_PROVIDER_RESPONSE':accountId;}});f.onFetch=()=>{throw error;};
 const before=f.snapshot(),{out}=await f.call();assert.equal(out.errorCode,'INVALID_PROVIDER_RESPONSE');assert.equal(reads,0);
 assert.doesNotMatch(JSON.stringify(out),new RegExp(accountId+'|'+iban));assert.equal(out.validationIssue,null);assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(f.snapshot(),before);
});

test('a null live alias collection completes the read but cannot match a domestic report to an IBAN',async t=>{
 const f=await fixture(t);f.fresh.get(accountId).all_account_ids=null;const before=f.snapshot(),{out}=await f.call();
 assert.equal(out.status,'missing');assert.equal(out.complete,true);assert.equal(out.resourcesRead,1);assert.equal(out.accountMatch,false);
 assert.deepEqual(out.rows.map(row=>({status:row.status,matched:row.matched,scheme:row.scheme,sourcePath:row.sourcePath})),[{status:'missing',matched:false,scheme:null,sourcePath:null}]);
 assert.equal(out.changed,false);assert.equal(f.snapshot(),before);assert.doesNotMatch(JSON.stringify(out),new RegExp(accountId+'|'+remoteSession+'|'+iban+'|'+domestic));
});

// The HTTP action preserves financial/account facts; owner leases and cooldowns are operational state.
async function explicitFixture(t,readerFailure=false){const f=await fixture(t,readerFailure);f.state=applyCommand(f.state,{type:'bankgiro.import',documentId:docId,hash:f.hash,name:'Synthetic.csv',rows:parseSpecificationBytes(f.reportBytes,'Synthetic.csv')}).state;f.save();f.post=async(body={...f.args(),revision:7},options={})=>{const r=await f.accountRoute.POST(new Request(origin+'/api/bank/account-evidence',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body),...options}));return {r,out:await r.json()};};return f;}
test('explicit account action route is implemented',async t=>{const f=await fixture(t);assert.equal(typeof f.accountRoute.POST,'function');});
const explicitImplemented=existsSync(new URL('../app/api/bank/account-evidence/route.ts',import.meta.url));
test('same-origin owner action revalidates its report target and returns only transient reader evidence with zero DB/R2 writes',{skip:!explicitImplemented},async t=>{const f=await explicitFixture(t),before=f.snapshot(),{r,out}=await f.post();assert.equal(r.status,200);assert.equal(out.status,'matched');assert.equal(out.changed,false);assert.equal(out.transactionId,f.args().transactionId);assert.equal(out.documentId,docId);assert.equal(out.revision,7);assert.equal(out.accountMatch,true);assert.equal(f.calls.length,2);assert.equal(f.snapshot(),before);assert.equal(f.objects.size,1);assert.match(r.headers.get('Cache-Control'),/no-store/);});
test('account action rejects foreign origin, identity, stale revision, injected fields and arbitrary originals before provider contact',{skip:!explicitImplemented},async t=>{const f=await explicitFixture(t),before=f.snapshot();for(const [body,options,status] of [[{...f.args(),revision:6},{},409],[{...f.args(),revision:7,owner:'foreign'},{},400],[{...f.args(),revision:7,account:'foreign'},{},400],[{...f.args(),revision:7,documentId:'foreign'},{},409],[{...f.args(),revision:7,transactionId:'foreign'},{},404],[{...f.args(),revision:7},{headers:{'Content-Type':'application/json',Origin:'https://foreign.test'}},403],[{...f.args(),revision:7},{headers:{'Content-Type':'application/json'}},403]]){const {r}=await f.post(body,options);assert.equal(r.status,status);}f.headers=new Headers();assert.equal((await f.post()).r.status,401);assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);});
test('account action enforces JSON, bounded streamed body and malformed selectors before provider reads',{skip:!explicitImplemented},async t=>{const f=await explicitFixture(t),before=f.snapshot();for(const [options,status]of [[{headers:{Origin:origin,'Content-Type':'text/plain'}},415],[{body:'{'},400],[{body:JSON.stringify({padding:'x'.repeat(4096)})},413],[{body:JSON.stringify({...f.args(),revision:'7'})},400],[{body:JSON.stringify({...f.args(),revision:7,sha256:f.hash})},400]])assert.equal((await f.post(undefined,options)).r.status,status);assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);});
test('several report originals do not authorize a client-selected bank account check',{skip:!explicitImplemented},async t=>{const f=await explicitFixture(t);f.state=applyCommand(f.state,{type:'bankgiro.import',documentId:'other-report',hash:'e'.repeat(64),name:'Other.csv',rows:parseSpecificationBytes(f.reportBytes,'Other.csv')}).state;f.save();const before=f.snapshot(),{r}=await f.post();assert.equal(r.status,409);assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);});

for(const shift of ['revision','membership','revision-and-membership'])test('explicit action carries its selected owner/revision/report through a '+shift+' shift before reader reload',async t=>{const f=await explicitFixture(t);f.afterWorkspaceRead=count=>{if(count!==1)return;if(shift.includes('membership')){f.state.transactions=f.state.transactions.filter(row=>!row.specification);f.save();}if(shift.includes('revision'))f.sql.exec('UPDATE workspaces SET revision=revision+1');f.shiftSnapshot=f.snapshot();};const {r,out}=await f.post();assert.deepEqual(f.calls,[],'a stale route selection must never contact the bank');assert.equal(r.status,409);assert.equal(out.status,'stale');assert.equal(out.providerContacted,false);assert.equal(f.snapshot(),f.shiftSnapshot,'only the injected concurrent update may change D1');});
test('explicit action reselects report membership again immediately before its first outbound read',async t=>{const f=await explicitFixture(t);f.onOriginalRead=()=>{f.onOriginalRead=null;f.state.transactions=f.state.transactions.filter(row=>!row.specification);f.save();f.shiftSnapshot=f.snapshot();};const {out}=await f.post();assert.deepEqual(f.calls,[]);assert.equal(out.status,'stale');assert.equal(out.providerContacted,false);assert.equal(f.snapshot(),f.shiftSnapshot);});
test('public MCP input cannot supply UI trusted context and still reads an owned report without UI membership',async t=>{const f=await fixture(t),before=f.snapshot();const rejected=await f.call({...f.args(),trusted:{owner:f.owner,revision:7,target:f.args()}});assert.ok(rejected.body.result?.isError||rejected.body.error);assert.deepEqual(f.calls,[]);const {out}=await f.call();assert.equal(out.status,'matched');assert.equal(out.accountMatch,true);assert.equal(f.calls.length,2);assert.equal(f.snapshot(),before);});

// The real provider, reader, MCP and explicit UI route must preserve the advice
// together. Financial/account-fact writes, R2 writes and non-consent provider routes are forbidden.
for(const [header,status,provenance,notBefore]of [
 ['7200','known','retry_after_seconds','2026-11-02T12:00:00.000Z'],
 ['Mon, 02 Nov 2026 13:00:00 GMT','known','retry_after_http_date','2026-11-02T13:00:00.000Z'],
 [null,'unknown','retry_after_missing',undefined],
 ['private-'+accountId,'unknown','retry_after_invalid',undefined],
 ['999999999999999999999999999999999999','manual_block','retry_after_exceeds_limit',undefined],
])test('account-details 429 transports '+provenance+' while preserving financial and account facts',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-02T10:00:00.000Z'));
 const f=await explicitFixture(t),before=f.financialSnapshot();f.onFetch=path=>{if(path.startsWith('/accounts/'))return new Response(JSON.stringify({error:'ASPSP_RATE_LIMIT_EXCEEDED',private:accountId}),{status:429,headers:header===null?{}:{'Retry-After':header}});};
 const {r,out}=await f.post();assert.equal(r.status,200);assert.equal(out.status,'error');assert.equal(out.errorCode,'BANK_RATE_LIMIT');assert.equal(out.stage,'account_details');
 assert.deepEqual(out.retryAdvice,{status,checkedAt:'2026-11-02T10:00:00.000Z',provenance,...notBefore?{notBefore}:{}});
 assert.equal(out.changed,false);assert.equal(out.providerContacted,true);assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.deepEqual(out.rows,[]);
 assert.equal(out.resourcesAttempted,1);assert.equal(out.resourcesRead,0);assert.equal(f.financialSnapshot(),before);assert.equal(f.objects.size,1);assert.equal(out.operationalStateChanged,true);
 assert.deepEqual(f.calls,['/sessions/'+remoteSession,'/accounts/'+accountId+'/details']);
 assert.doesNotMatch(JSON.stringify(out),new RegExp(accountId+'|'+remoteSession+'|'+iban+'|'+domestic+'|ASPSP_RATE_LIMIT|private-'));
});
test('session 429 advice stays bound to session stage with only a durable operational wait',async t=>{
 const f=await fixture(t),before=f.financialSnapshot();f.providerError=true;const {out}=await f.call();
 assert.equal(out.errorCode,'BANK_RATE_LIMIT');assert.equal(out.stage,'session');assert.equal(out.retryAdvice?.status,'unknown');assert.equal(out.retryAdvice?.provenance,'retry_after_missing');
 assert.equal(out.resourcesAttempted,0);assert.equal(out.resourcesRead,0);assert.deepEqual(f.calls,['/sessions/'+remoteSession]);assert.equal(f.financialSnapshot(),before);assert.equal(out.operationalStateChanged,true);
});
test('forged rate-limit error metadata and getters cannot become trusted reader retry advice',async t=>{
 for(const getters of [false,true]){
  const f=await fixture(t),error=new ProviderError('BANK_RATE_LIMIT','private '+iban,429,true);let reads=0;
  for(const name of ['retryAfter','retryBlocked','retryAdvice'])if(getters)Object.defineProperty(error,name,{get(){reads++;throw Error('Getter must not run');}});else error[name]=name==='retryAdvice'?{status:'known',checkedAt:'2026-11-02T10:00:00.000Z',notBefore:'2026-11-02T12:00:00.000Z',provenance:'retry_after_seconds'}:name==='retryAfter'?7200:false;
  f.onFetch=()=>{throw error;};const before=f.snapshot(),{out}=await f.call();
  assert.equal(out.status,'error');assert.equal(out.errorCode,'BANK_RATE_LIMIT');assert.equal(out.retryAdvice,null);assert.equal(reads,0);assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.equal(f.snapshot(),before);
  assert.doesNotMatch(JSON.stringify(out),new RegExp(iban+'|'+accountId+'|private|2099'));
 }
});
test('explicit action also rejects a changed authenticated owner before the reader contacts any bank',async t=>{const f=await explicitFixture(t),before=f.snapshot();f.afterWorkspaceRead=count=>{if(count===1)f.headers=new Headers({'oai-authenticated-user-id':'foreign-owner','oai-authenticated-user-email':'foreign@example.test'});};const {r,out}=await f.post();assert.equal(r.status,409);assert.equal(out.status,'stale');assert.equal(out.providerContacted,false);assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);});

// Directly reading code here used to throw out of the safe reader catch and let
// both outer API serializers disclose the getter's private exception message.
for(const endpoint of ['mcp','ui'])test('a throwing provider code getter stays inside the safe '+endpoint+' reader response',async t=>{
 const f=endpoint==='ui'?await explicitFixture(t):await fixture(t),error=new ProviderError('BANK_RATE_LIMIT','Synthetic safe message',429,true);let reads=0;
 Object.defineProperty(error,'code',{get(){reads++;throw Error('SYNTHETIC_PRIVATE_GETTER_MESSAGE');}});f.onFetch=()=>{throw error;};
 const before=f.snapshot(),result=endpoint==='ui'?await f.post():await f.call(),{r,out}=result;
 assert.doesNotMatch(JSON.stringify(result.body??out),/SYNTHETIC_PRIVATE_GETTER_MESSAGE|Synthetic safe message/);
 assert.equal(r.status,200);assert.equal(out.status,'error');assert.equal(out.errorCode,'BANK_RATE_LIMIT');assert.equal(out.retryAdvice,null);assert.equal(reads,0);
 assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.deepEqual(out.rows,[]);assert.equal(f.snapshot(),before);assert.deepEqual(f.calls,['/sessions/'+remoteSession]);
 if(endpoint==='mcp')assert.notEqual(result.body.result.isError,true);
});
test('unconstructed and proxied errors cannot run code or prototype traps at the reader boundary',async t=>{
 for(const kind of ['unconstructed','proxy','revoked']){
  const f=await explicitFixture(t,true);let reads=0;
  const getter=()=>{reads++;throw Error('SYNTHETIC_PRIVATE_TRAP_MESSAGE');};
  const unconstructed=Object.create(ProviderError.prototype);Object.defineProperty(unconstructed,'code',{get:getter});
  const proxy=new Proxy(new ProviderError('BANK_RATE_LIMIT','SYNTHETIC_PRIVATE_TRAP_MESSAGE',429,true),{get:getter,getPrototypeOf:getter,getOwnPropertyDescriptor:getter});
  const revoked=Proxy.revocable(new ProviderError('BANK_RATE_LIMIT','SYNTHETIC_PRIVATE_TRAP_MESSAGE'),{});revoked.revoke();
  f.readerFailure=kind==='unconstructed'?unconstructed:kind==='proxy'?proxy:revoked.proxy;
  const before=f.snapshot(),{r,out}=await f.post();assert.equal(r.status,200);assert.equal(out.status,'error');assert.equal(out.errorCode,'ACCOUNT_EVIDENCE_UNAVAILABLE');assert.equal(out.retryAdvice,null);assert.equal(out.validationIssue,null);assert.equal(reads,0);
  assert.equal(out.accountMatch,false);assert.equal(out.complete,false);assert.deepEqual(out.rows,[]);assert.equal(f.snapshot(),before);assert.deepEqual(f.calls,[]);
  assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE_TRAP_MESSAGE/);
 }
});

// Agent 2: real reader/SQL/provider boundaries. Losing the first cooldown would
// permit a second request against the same unknown or still active bank limit.
for(const header of [null,'7200'])test('a stored '+(header===null?'unknown':'active')+' account cooldown blocks the next request before any provider call',async t=>{
 const f=await explicitFixture(t);f.onFetch=path=>path.endsWith('/details')?new Response('',{status:429,headers:header===null?{}:{'Retry-After':header}}):undefined;
 const first=await f.post();assert.equal(first.out.errorCode,'BANK_RATE_LIMIT');assert.equal(f.calls.length,2);
 f.onFetch=null;const second=await f.post();
 assert.equal(f.calls.length,2,'a saved provider cooldown must prevent both session and detail requests');
 assert.equal(second.out.providerContacted,false);assert.equal(second.out.accountMatch,false);
 const saved=f.sql.prepare('SELECT * FROM bank_connections WHERE owner=?').get(f.owner);
 assert.equal(JSON.parse(saved.account_evidence_retry).status,header===null?'unknown':'known');
});

test('two concurrent account evidence reads share the bank owner lease',async t=>{
 const f=await explicitFixture(t);let release,started;const entered=new Promise(resolve=>{started=resolve;}),wait=new Promise(resolve=>{release=resolve;});
 f.onFetch=async path=>{if(path.endsWith('/details')&&f.calls.filter(value=>value.endsWith('/details')).length===1){started();await wait;}};
 const first=f.post();await entered;const second=await f.post();release();const done=await first;
 assert.equal(done.out.accountMatch,true);assert.equal(second.r.status,409);
 assert.equal(f.calls.filter(path=>path.endsWith('/details')).length,1,'the second request must not reach the provider');
 assert.equal(f.sql.prepare('SELECT count(*) AS count FROM bank_locks').get().count,0);
});

test('a malformed persisted wait cannot silently authorize an account detail read',async t=>{
 const f=await explicitFixture(t);f.sql.prepare('UPDATE bank_connections SET retry_after=? WHERE owner=?').run('unknown-provider-wait',f.owner);
 const {out}=await f.post();assert.equal(f.calls.length,0);assert.equal(out.providerContacted,false);assert.equal(out.accountMatch,false);
});

test('account evidence is added as a versioned identity-only contract',async t=>{
 const f=await explicitFixture(t),{out}=await f.post();assert.equal(out.status,'matched');
 assert.equal(out.bankAccountEvidence?.schemaVersion,'1.0.0');assert.equal(out.bankAccountEvidence.status,'verified');
 assert.equal(out.bankAccountEvidence.bankgiroMapping.status,'blocked');assert.equal(out.bankAccountEvidence.paymentReconciliationAllowed,false);
 assert.equal(out.bankAccountEvidence.aliases[0].sourcePath,'all_account_ids[0].identification');
});

test('unknown account wait survives expiry of the transaction-sync fallback',async t=>{
 const f=await explicitFixture(t);let at=Date.now();t.mock.method(Date,'now',()=>at);
 f.onFetch=path=>path.endsWith('/details')?new Response('',{status:429}):undefined;
 await f.post();at+=7*3600_000;f.onFetch=null;
 const result=await f.post();assert.equal(f.calls.length,2);assert.equal(result.out.providerContacted,false);assert.equal(result.out.status,'blocked');
 assert.equal(result.out.bankAccountEvidence.status,'blocked');
});

test('an explicit elapsed provider deadline permits one new serialized account read',async t=>{
 const f=await explicitFixture(t);let at=Date.now();t.mock.method(Date,'now',()=>at);
 f.onFetch=path=>path.endsWith('/details')?new Response('',{status:429,headers:{'Retry-After':'120'}}):undefined;
 await f.post();at+=121000;f.onFetch=null;
 const result=await f.post();assert.equal(f.calls.length,4);assert.equal(result.out.accountMatch,true);assert.equal(result.out.bankAccountEvidence.status,'verified');
});

test('aborted account requests release the lease and leave all financial originals unchanged',async t=>{
 const f=await explicitFixture(t),before=f.snapshot();f.onFetch=path=>{if(path.endsWith('/details'))throw new DOMException('Synthetic abort','AbortError');};
 const {out}=await f.post();assert.equal(out.accountMatch,false);assert.equal(out.bankAccountEvidence.status,'blocked');
 assert.equal(out.errorCode,'BANK_NETWORK_ERROR');assert.equal(f.snapshot(),before);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bank_locks').get().n,0);
});

test('a lost bank lease cannot publish a successful alias result',async t=>{
 const f=await explicitFixture(t);f.onFetch=path=>{if(path.endsWith('/details'))f.sql.exec("UPDATE bank_locks SET expires_at='2000-01-01T00:00:00.000Z'");};
 const {out}=await f.post();assert.equal(out.status,'error');assert.equal(out.bankAccountEvidence.status,'blocked');assert.equal(out.accountMatch,false);assert.equal(out.providerContacted,true);assert.equal(out.operationalStateChanged,true);
 assert.equal(JSON.parse(f.sql.prepare('SELECT account_evidence_retry AS value FROM bank_connections').get().value).status,'pending');
});

for(const samePrimary of [true,false])test('a returned typed alias requires exact singular hash continuity when the primary number is absent: '+samePrimary,async t=>{
 const f=await fixture(t),primary='synthetic-primary-account-hash';
 const accountKey='enable-account:'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['SE','synthetic bank',primary])))).toString('hex');
 await f.setAccounts([{uid:accountId,currency:'SEK',identification_hash:primary}]);
 f.fresh.set(accountId,{currency:'SEK',cash_account_type:'CACC',identification_hash:samePrimary?primary:'different-primary',identification_hashes:[primary],all_account_ids:[{identification:domestic,scheme_name:'BBAN'}]});
 f.state=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:accountKey,date:'2026-10-26',amount:62500,payerReference:'000018',bankReference:'SYNTHETIC-HASH-ENTRY'})]}).state;f.save();
 const {out}=await f.call();assert.equal(out.accountMatch,samePrimary);assert.equal(out.bankAccountEvidence.status,samePrimary?'verified':'blocked');
 assert.doesNotMatch(JSON.stringify(out),new RegExp(primary+'|'+domestic+'|'+accountId));
});

test('an unsaved provider cooldown leaves a durable pending guard and prevents the next account read',async t=>{
 const f=await explicitFixture(t),before=f.financialSnapshot(),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{if(statements.some(s=>typeof s.values?.[0]==='string'&&s.values[0].includes('"status":"unknown"')))throw Error('Synthetic cooldown persistence failure');return batch(statements);};
 f.onFetch=path=>path.endsWith('/details')?new Response('',{status:429}):undefined;
 const first=await f.post();assert.notEqual(first.out.bankAccountEvidence?.status,'verified');assert.equal(f.calls.length,2);
 assert.notEqual(f.sql.prepare('SELECT account_evidence_retry AS value FROM bank_connections').get().value,'','uncertain bank response must have a durable pre-request guard');
 f.env.DB.batch=batch;f.onFetch=null;
 const second=await f.post();assert.equal(second.out.providerContacted,false);assert.equal(second.out.bankAccountEvidence.status,'blocked');assert.equal(f.calls.length,2);assert.equal(f.financialSnapshot(),before);
});

test('a lost lease after a provider throttle retains uncertainty and accurately reports provider contact',async t=>{
 const f=await explicitFixture(t),before=f.financialSnapshot();
 f.onFetch=path=>{if(path.endsWith('/details')){f.sql.exec("UPDATE bank_locks SET expires_at='2000-01-01T00:00:00.000Z'");return new Response('',{status:429});}};
 const first=await f.post();assert.equal(first.out.providerContacted,true);assert.equal(first.out.bankAccountEvidence.status,'blocked');assert.equal(first.out.operationalStateChanged,true);
 f.onFetch=null;const second=await f.post();assert.equal(second.out.providerContacted,false);assert.equal(second.out.bankAccountEvidence.status,'blocked');assert.equal(f.calls.length,2);assert.equal(f.financialSnapshot(),before);
});

test('a failure to persist pending intent prevents the first outbound bank request',async t=>{
 const f=await explicitFixture(t),before=f.snapshot(),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{if(statements.some(s=>typeof s.values?.[0]==='string'&&s.values[0].includes('"status":"pending"')))throw Error('Synthetic pre-request persistence failure');return batch(statements);};
 const result=await f.post();assert.notEqual(result.out.bankAccountEvidence?.status,'verified');assert.deepEqual(f.calls,[]);assert.equal(f.snapshot(),before);
});
