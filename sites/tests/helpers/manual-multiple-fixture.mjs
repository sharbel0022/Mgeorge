import {readFileSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {emptyState,applyCommand} from '../../lib/domain.ts';
import {syntheticBankRow} from './bank-api-fixture.mjs';
import {previewFixture,owner,iban} from './reconciliation-preview-fixture.mjs';
export {owner};
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){
 let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});
 for(const [from,to]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
export async function manualMultipleFixture(t,{amounts=[30001,43099],adjust=0}={}){
 let state=emptyState();
 for(let index=0;index<amounts.length;index++)state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',number:String(42+index).padStart(5,'0'),ocr:'',party:'Synthetic explicit customer AB',total:amounts[index],issued:'2026-10-01',due:'2026-12-01',reviewed:true,documentId:index?'synthetic-manual-invoice-'+index:'synthetic-preview-invoice'}}).state;
 const row=syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:amounts.reduce((sum,value)=>sum+value,0)+adjust,party:'Synthetic explicit customer AB',payerReference:'',bankReference:'SYNTHETIC-MANUAL-MULTIPLE',kind:'payment',verified:true},{reference_number:'',remittance_information:state.invoices.map(invoice=>'Faktura '+invoice.number)});
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[row]}).state;
 const f=await previewFixture(t,{state}),control=f.control;
 for(let index=1;index<amounts.length;index++){
  const id='synthetic-manual-invoice-'+index,bytes=new TextEncoder().encode('Synthetic original invoice '+state.invoices[index].number+'; no customer data.'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  f.objects.set(owner+'/'+id,bytes);f.sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,'synthetic.pdf','application/pdf',bytes.length,sha256,'2026-11-02T00:00:00.000Z');
 }
 f.beforeBatch=null;f.afterBatch=null;f.receiptsUnavailable=false;f.receiptsAbsent=false;f.objectVersions=new Map([...f.objects.keys()].map(key=>[key,'synthetic-object-version-1']));
 const get=f.env.BUCKET.get.bind(f.env.BUCKET);f.env.BUCKET.get=async path=>{const object=await get(path);return object?{...object,version:f.objectVersions.get(path),etag:'synthetic-etag-'+f.objectVersions.get(path)}:null;};
 function prepare(query,args=[]){
  const run=()=>{if(f.receiptsUnavailable&&query.includes('SELECT detail FROM audit_events'))throw Error('Synthetic receipt read unavailable');const result=f.sqlite.prepare(query).run(...args);return{meta:{changes:Number(result.changes)},success:true};};
  return {_query:query,_args:args,bind(...values){return prepare(query,values);},async first(){if(query.includes('SELECT detail FROM audit_events')){if(f.receiptsUnavailable)throw Error('Synthetic receipt read unavailable');if(f.receiptsAbsent)return null;}return f.sqlite.prepare(query).get(...args)||null;},async all(){return{results:f.sqlite.prepare(query).all(...args)};},async run(){return run();},_run:run};
 }
 control.env.DB={prepare,async batch(statements){
  if(f.beforeBatch)await f.beforeBatch();f.sqlite.exec('BEGIN IMMEDIATE');let results;
  try{results=statements.map(statement=>statement._run());f.sqlite.exec('COMMIT');}catch(error){f.sqlite.exec('ROLLBACK');throw error;}
  if(f.afterBatch)await f.afterBatch();return results;
 }};
 const servicePath=new URL('../../lib/manual-multiple-allocation-service.ts',import.meta.url),routePath=new URL('../../app/api/manual-allocations/route.ts',import.meta.url);
 let route,previewRoute;
 if(existsSync(servicePath)&&existsSync(routePath)){
  const service=compiled('../../lib/manual-multiple-allocation-service.ts',{'./server':f.modules.server,'./domain':url('../../lib/domain.ts'),'./manual-multiple-allocation.js':url('../../lib/manual-multiple-allocation.js'),'./reconciliation-contract.js':url('../../lib/reconciliation-contract.js'),'./reconciliation-preview':f.modules.preview,'./reconciliation-evidence':f.modules.evidence});
  const imports={'@/lib/server':f.modules.server,'@/lib/manual-multiple-allocation-service':service};
  route=await import(compiled('../../app/api/manual-allocations/route.ts',imports));previewRoute=await import(compiled('../../app/api/manual-allocations/preview/route.ts',imports));
 }
 f.request={transactionId:state.transactions[0].id,allocations:state.invoices.map(invoice=>({invoiceId:invoice.id,amountMinor:invoice.total})),note:'Synthetic explicit review of all source references, originals and whole-ore amounts.'};
 f.call=async(path,body)=>{
  const method=body?'POST':'GET',req=new Request('https://mg.test'+path,{method,headers:{Origin:'https://mg.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const handler=path.startsWith('/api/manual-allocations/preview')?previewRoute?.POST:route?.[method];
  const response=handler?await handler(req):Response.json({error:'Manual allocation route is not implemented'},{status:404});return{status:response.status,body:await response.json()};
 };
 f.stored=()=>Object.fromEntries(['workspaces','audit_events','documents','bank_connections'].map(table=>[table,f.sqlite.prepare('SELECT * FROM '+table+' ORDER BY '+(table==='workspaces'?'owner':'id')).all()]));
 return f;
}
