import {isReadOnlySql} from './company-compat-fixture.mjs';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {emptyState,applyCommand} from '../../lib/domain.ts';
import {apiPayerEvidence} from '../../lib/payer-evidence.js';
import {syntheticBankRow} from './bank-api-fixture.mjs';
import {makeBankgiroXLSX} from './bankgiro-xlsx-fixture.mjs';
import {syntheticCamt} from './camt-integrity.mjs';
import {parseSpecificationBytes} from '../../lib/bankgiro-parser.js';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){
 let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});
 for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
const hash=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
export const owner='synthetic-preview-owner',iban='SE4280000890119146168423';
const previewPolicy={version:'mgeorge-reconciliation-v1',companyId:'synthetic-company',invoiceNumberIsPaymentReference:true,preserveLeadingZeros:true,comparison:'exact',source:'Explicit synthetic server policy. No company-name derivation.'};
export function previewState({number='0599',reference='0599',party='Synthetic customer AB',company='M.George Vitvaror AB',batch=false}={}){
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party,number,ocr:'',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true,documentId:'synthetic-preview-invoice'}}).state;
 state.company.name=company;
 const row=syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:62500,party:batch?'':party,payerReference:batch?'':reference,bankReference:'SYNTHETIC-PREVIEW-DEPOSIT',kind:batch?'batch':'payment',description:batch?'Bankgiro inbetalning':'',verified:!batch});
 row.payerEvidence=apiPayerEvidence(row.bankData,true,{collective:batch});
 return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[row]}).state;
}
export function addPreviewReport(state,{manual=false,linked=false}={}){
 const target=state.transactions[0];
 const xml=syntheticCamt.replace('SYNTHETIC-ENTRY',target.bankReference).replace('Syntetisk Kund AB','Synthetic customer AB').replace('<Ref>000018</Ref>','<Ref>0599</Ref>').replace('<Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp>','').replace('<NtryDtls>','<NtryDtls><Btch><NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt><CdtDbtInd>CRDT</CdtDbtInd></Btch>');
 const bytes=linked?new TextEncoder().encode(xml):new Uint8Array(makeBankgiroXLSX({currency:'SEK',account:iban,date:'2026-10-26',payments:[{party:'Synthetic customer AB',reference:'0599',payerBankgiro:'987-6543',amount:62500}]}));
 return {bytes,name:linked?'synthetic-preview-report.xml':'synthetic-preview-report.xlsx',manual};
}

/** Real verifier/domain/SQLite; only owned storage and provider-account decoding are substituted. */
export async function previewFixture(t,{state=previewState(),report,consent=true}={}){
 assert.ok(existsSync(new URL('../../lib/reconciliation-preview.ts',import.meta.url)),'Sites reconciliation preview adapter is implemented');
 assert.ok(existsSync(new URL('../../app/api/reconciliation/preview/route.ts',import.meta.url)),'Dedicated read-only reconciliation preview GET is implemented');
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../../drizzle',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));
 const key='__reconciliation_preview_'+crypto.randomUUID().replaceAll('-',''),invoiceBytes=new TextEncoder().encode('Synthetic invoice original. No real customer data.');
 const f={sqlite,state,revision:23,queries:[],originalReads:[],resources:[{uid:'synthetic-selected',currency:'SEK',account_id:{iban}}],objects:new Map(),authenticated:true,beforeRead:null};
 const insertOriginal=async(id,filename,mime,bytes)=>{
  const sha256=await hash(bytes);f.objects.set(owner+'/'+id,bytes);
  sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,filename,mime,bytes.length,sha256,'2026-11-02T00:00:00.000Z');return sha256;
 };
 await insertOriginal('synthetic-preview-invoice','synthetic-preview-invoice.pdf','application/pdf',invoiceBytes);
 if(report){
  const sha256=await insertOriginal('synthetic-preview-report',report.name,/\.xml$/.test(report.name)?'application/xml':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',report.bytes);
  f.state=applyCommand(f.state,{type:'bankgiro.import',documentId:'synthetic-preview-report',hash:sha256,name:report.name,rows:parseSpecificationBytes(report.bytes,report.name)}).state;
  if(report.manual)f.state=applyCommand(f.state,{type:'bankgiro.link',transactionId:f.state.transactions[0].id,specificationId:f.state.transactions.find(row=>row.specification).id,note:'Synthetic original relation, not allocation approval.',confirmOriginals:true,confirmAccount:true}).state;
 }
 sqlite.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,f.revision,JSON.stringify(f.state),'2026-11-02T00:00:00.000Z');
 const connection={id:'synthetic-preview-connection',owner,app_generation:'synthetic-generation',environment:'PRODUCTION',bank_name:'Synthetic bank',country:'SE',encrypted_session:'synthetic-private-session-material',encrypted_accounts:'synthetic-private-account-material',selected_accounts:'["synthetic-selected"]',valid_until:'2099-01-01T00:00:00Z',date_from:'2026-10-01',status:consent?'connected':'disconnected',created_at:'2026-10-01',updated_at:'2026-10-01'};
 const fields=Object.keys(connection);sqlite.prepare('INSERT INTO bank_connections('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...Object.values(connection));
 const DB={prepare(query){assert.ok(isReadOnlySql(sqlite,query),'Preview may only issue read-only SELECT/CTE statements');return{bind(...args){f.queries.push({query,args});return{async first(){return sqlite.prepare(query).get(...args)||null;},async all(){return{results:sqlite.prepare(query).all(...args)};}};}};},async batch(){throw Error('Preview must not execute a write batch');}};
 f.env={DB,BUCKET:{async get(path){f.originalReads.push(path);assert.ok(path.startsWith(owner+'/'));if(f.beforeRead)await f.beforeRead(path);const bytes=f.objects.get(path);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer}:null;}}};
 globalThis[key]=f;t.after(()=>{sqlite.close();delete globalThis[key];});
 const ref=`globalThis[${JSON.stringify(key)}]`,domain=url('../../lib/domain.ts'),engine=url('../../lib/reconciliation-engine.js');
 const server=compiled('../../lib/server.ts',{'./company-storage.js':new URL('../../lib/company-storage.js',import.meta.url).href,'cloudflare:workers':data(`export const env=${ref}.env;`),'@/app/chatgpt-auth':data(`const f=${ref};export async function getChatGPTUser(){return f.authenticated?{userId:${JSON.stringify(owner)}}:null;}`),'./domain':domain});
 const store=data(`const f=${ref};export async function connection(requestedOwner){if(requestedOwner!==${JSON.stringify(owner)})throw Error('Foreign owner');return f.sqlite.prepare('SELECT * FROM bank_connections WHERE owner=?').get(requestedOwner)||null;}export async function application(requestedOwner){return {owner:requestedOwner,generation:'synthetic-generation'};}export async function accounts(){return structuredClone(f.resources);}`);
 const service=compiled('../../lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':url('../../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':data('export function stableAccountKey(account){return "iban:"+account.account_id.iban;}')});
 const reconciliation=compiled('../../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
 const evidence=compiled('../../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':service});
 const presentation=compiled('../../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':url('../../lib/payment-references.js')});
 const candidates=compiled('../../lib/banking/invoice-candidates.ts',{'../domain':domain,'../reconciliation-engine.js':engine,'../payment-presentation':presentation});
 const details=compiled('../../lib/banking/detail-evidence.ts',{'../domain':domain,'../payment-references.js':url('../../lib/payment-references.js'),'../payer-evidence.js':url('../../lib/payer-evidence.js')});
 const verification=compiled('../../lib/payment-verification.ts',{'./account-evidence-presentation':compiled('../../lib/account-evidence-presentation.ts',{'./domain':domain}),'./domain':domain,'./payment-presentation':presentation,'./reconciliation-engine.js':engine,'./reconciliation-evidence':evidence,'./bankgiro-service':service,'./banking/invoice-candidates':candidates,'./banking/detail-evidence':details,'./server':server,'cloudflare:workers':data(`export const env=${ref}.env;`),'./bank-api-original.js':url('../../lib/bank-api-original.js'),'./payment-references.js':url('../../lib/payment-references.js')});
 const preview=compiled('../../lib/reconciliation-preview.ts',{'./domain':domain,'./bankgiro-source-evidence.js':url('../../lib/bankgiro-source-evidence.js'),'./reconciliation-contract.js':url('../../lib/reconciliation-contract.js'),'./reconciliation':reconciliation,'./payment-verification':verification,'./payment-presentation':presentation,'./bankgiro-service':service,'./banking/store':store,'./payer-evidence.js':url('../../lib/payer-evidence.js'),'./payment-references.js':url('../../lib/payment-references.js'),'./camt-xml.js':url('../../lib/camt-xml.js'),'./server':server});
 const api=await import(preview),route=await import(compiled('../../app/api/reconciliation/preview/route.ts',{'@/lib/server':server,'@/lib/reconciliation-preview':preview}));
 f.read=()=>{const row=sqlite.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(owner);return{revision:row.revision,state:JSON.parse(row.payload)};};
 f.preview=options=>api.readReconciliationPreview(owner,f.state,f.revision,options?.transactionId||f.state.transactions[0].id,{referencePolicy:previewPolicy,...options});
 f.get=async(id=f.state.transactions[0].id)=>{const response=await route.GET(new Request('https://mg.test/api/reconciliation/preview'+(id===null?'':'?transactionId='+encodeURIComponent(id))));return{response,body:await response.json()};};
 return {...f,control:f,api,route};
}
