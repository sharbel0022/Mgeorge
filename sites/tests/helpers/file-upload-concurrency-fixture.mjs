import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL('../../lib/'+path,import.meta.url).href;
export function compiled(path,imports){
 imports={'./document-triage.js':local('document-triage.js'),'./economy-summary.js':local('economy-summary.js'),'./invoice-details.js':local('invoice-details.js'),...imports};
 let code=ts.transpileModule(readFileSync(new URL('../../'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [name,url]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(url));
 return data(code);
}
const environment=data('export const env=new Proxy({}, {get:(_,key)=>globalThis.uploadRaceFixture.env[key]});');
const auth=data('export async function getChatGPTUser(){const f=globalThis.uploadRaceFixture;return f.users?.length?f.users.shift():f.user;}');
const domain=local('domain.ts');
const server=compiled('lib/server.ts',{'cloudflare:workers':environment,'@/app/chatgpt-auth':auth,'./domain':domain});
export const files=await import(compiled('app/api/files/route.ts',{'cloudflare:workers':environment,'@/lib/server':server,'@/lib/domain':domain}));
const unused=(...names)=>data(names.map(name=>`export function ${name}(){throw Error('Unexpected unrelated ${name}');}`).join('\n'));
const store=data('export const connection=async()=>null;export const accounts=async()=>[];export const application=async()=>null;export const encrypt=async(owner,purpose,value)=>JSON.stringify(value);export const decrypt=async(owner,purpose,value)=>JSON.parse(value);export const storageReady=()=>true;');
const bankgiro=compiled('lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':local('bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':unused('stableAccountKey')});
export const evidence=await import(compiled('lib/evidence-read.ts',{'./server':server,'./domain':domain,'./payment-presentation':unused('bankPaymentView','bankPaymentInvoiceAssessment','bankPaymentFieldSources'),'./payment-verification':unused('readPaymentVerification'),'./bankgiro-service':bankgiro,'./reconciliation-engine.js':local('reconciliation-engine.js'),'./payment-references.js':local('payment-references.js'),'./banking/invoice-candidates':unused('matchingDocumentCandidates')}));
const security=local('banking/security.ts');
const fields=compiled('lib/invoice-fields.js',{'./domain':domain});
const processing=compiled('lib/document-processing.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./banking/security':security,'./invoice-fields.js':fields,'./server-pdf':unused('serverPdfText')});
const adapter=data(`export const hasGmailSendScope=()=>false;export const gmailAccount=()=> 'owner@example.test';export const isGmailConfigured=()=>true;export async function fetchGmailInvoiceDocuments(){return globalThis.uploadRaceFixture.gmailResult;}export const gmailAuthorizationUrl=()=>'';export async function exchangeGmailCode(){throw Error('unused OAuth');}export async function gmailProfile(){}export async function revokeGmailTokens(){}`);
export const gmail=await import(compiled('lib/gmail-service.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./banking/security':security,'./banking/store':store,'./invoice-fields.js':fields,'./document-processing':processing,'./gmail-adapter.js':adapter,'./customer-messages':data('export async function reconcileAndPrepare(){}')}));

export const bytes=new TextEncoder().encode('Betalningsdatum;Avsändare;Betalningsreferens;Bankgironummer/Avinummer;Belopp;Valuta;Mottagarkonto\n2026-10-26;Synthetic payer AB;000018;987-6543;625,00;SEK;12345678');
const {parseSpecificationBytes}=await import(local('bankgiro-parser.js'));
assert.equal(parseSpecificationBytes(bytes.buffer,'synthetic.csv').length,1);
export function upload(){const form=new FormData();form.set('file',new File([bytes],'synthetic.csv'));return new Request('https://mg.test/api/files',{method:'POST',headers:{origin:'https://mg.test'},body:form});}
export const sync=()=>new Request('https://mg.test/api/gmail/sync',{method:'POST',headers:{origin:'https://mg.test'}});
export function fixture(t,{parallel=false,order='arrival',failure='',failInsert=1,readFailure=false,deleteFailure=false}={}){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>/^\d{4}.*\.sql$/.test(name)).sort())sqlite.exec(readFileSync(new URL('../../drizzle/'+name,import.meta.url),'utf8'));
 const objects=new Map(),puts=[],waiters=[];let insertCount=0,insertStarted=false,readFailed=false,outcomeReads=0,releaseLoser;
 const DB={prepare(sql){return{sql,args:[],bind(...args){this.args=args;return this;},async first(){
   if(insertStarted&&/SELECT .* FROM documents WHERE owner=\? AND sha256=\?/i.test(sql)){
    outcomeReads++;
    if(!readFailed&&(readFailure==='gmail'?/^SELECT id FROM/.test(sql):readFailure&&outcomeReads===(readFailure===true?1:readFailure))){readFailed=true;throw Error('D1_ERROR: synthetic outcome read unavailable');}
   }
   return sqlite.prepare(sql).get(...this.args)||null;
  },async all(){return{results:sqlite.prepare(sql).all(...this.args)};},execute(){
   const insertion=/INSERT INTO documents\s*\(/i.test(sql);if(insertion){insertStarted=true;insertCount++;}
   try{
    if(insertion&&insertCount===failInsert&&failure==='before')throw Error('D1_ERROR: synthetic write rejected');
    const result=sqlite.prepare(sql).run(...this.args);
    if(insertion&&insertCount===failInsert&&failure==='after')throw Error('D1_ERROR: synthetic response lost after commit');
    return{success:true,meta:{changes:Number(result.changes)}};
   }finally{if(insertion)releaseLoser?.();}
  },async run(){return this.execute();}};},async batch(items){sqlite.exec('BEGIN');let results;try{results=items.map(item=>item.execute());sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}return results;}};
 // Faults in a D1 batch must distinguish rejection (rollback) from a reply
 // lost after COMMIT, matching the storage contract rather than faking SQL.
 const batch=DB.batch.bind(DB);DB.batch=async items=>{
  const insertion=items.some(item=>/INSERT INTO documents\s*\(/i.test(item.sql));
  if(!insertion||failure!=='after'||insertCount+1!==failInsert)return batch(items);
  sqlite.exec('BEGIN');const saved=insertCount;let results;
  try{results=items.map(item=>{if(/INSERT INTO documents\s*\(/i.test(item.sql)){insertStarted=true;insertCount++;const result=sqlite.prepare(item.sql).run(...item.args);return{success:true,meta:{changes:Number(result.changes)}};}return item.execute();});sqlite.exec('COMMIT');}catch(error){insertCount=saved;sqlite.exec('ROLLBACK');throw error;}
  releaseLoser?.();throw Error('D1_ERROR: synthetic response lost after commit');
 };
 const BUCKET={async put(key,value){objects.set(key,new Uint8Array(value).slice());puts.push(key);if(parallel&&puts.length<=2){await new Promise(resolve=>{waiters.push({resolve,kind:Buffer.isBuffer(value)?'gmail':'manual'});if(waiters.length===2){if(['manual','gmail'].includes(order)){const winner=waiters.find(item=>item.kind===order),loser=waiters.find(item=>item!==winner);assert.ok(winner);releaseLoser=loser.resolve;winner.resolve();}else waiters.forEach(item=>item.resolve());}});}},async get(key){const value=objects.get(key);return value?{size:value.length,body:value,arrayBuffer:async()=>value.slice().buffer}:null;},async delete(key){if(deleteFailure)throw Error('R2_ERROR: synthetic cleanup failed');objects.delete(key);}};
 const f={sqlite,objects,puts,user:{userId:'synthetic-owner',email:'owner@example.test'},env:{DB,BUCKET,DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'owner@example.test'}};
 f.gmailResult={tokens:{access_token:'synthetic'},received:1,duplicate:0,documents:[{source_id:'synthetic-message:1',name:'synthetic.csv',mime_type:'text/csv',content_base64:Buffer.from(bytes).toString('base64'),metadata:{from:'sender@example.test',to:'owner@example.test'},direction:'payable',subject:'Synthetic',received_at:'2026-11-02T10:00:00Z'}],rejected_source_ids:[],truncated:false,next_page_token:''};
 sqlite.prepare('INSERT INTO gmail_connections(owner,email,tokens) VALUES(?,?,?)').run(f.user.userId,f.user.email,'{}');
 globalThis.uploadRaceFixture=f;t.after(()=>{sqlite.close();delete globalThis.uploadRaceFixture;});return f;
}
export const rows=f=>f.sqlite.prepare('SELECT id,owner,sha256 FROM documents ORDER BY owner,id').all();
export async function readable(id){const result=await files.GET(new Request('https://mg.test/api/files?id='+id));assert.equal(result.status,200);assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);}
