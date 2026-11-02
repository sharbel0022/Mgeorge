import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCommand} from '../../lib/domain.ts';
import {ingestFixture,reportBytes,seedState,hash,account} from './bankgiro-ingest-fixture.mjs';
import {syntheticSource} from './synthetic-bankgiro-source.mjs';
import {createBankgiroIngest} from '../../lib/bankgiro-ingest.js';
import {createBankgiroIngestStore} from '../../lib/bankgiro-ingest-store.js';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
export const accountAlias='8000000123456789';

/** New synthetic source delivery: explicit count/account/deposit facts are
 * retained, not manufactured by the preview adapter or expected-value code. */
export function joinedReport({reference='0599',relation=true}={}){
 const base=new TextDecoder().decode(reportBytes([{amount:'625.00',payer:'Synthetic customer AB',reference,id:'SYNTHETIC-CHILD-1'}]));
 const xml=base.replace('<IBAN>'+account+'</IBAN>','<Othr><Id>'+accountAlias+'</Id></Othr>')
  .replace('<NtryDtls>','<NtryDtls><Btch><NbOfTxs>1</NbOfTxs><TtlAmt Ccy="SEK">625.00</TtlAmt><CdtDbtInd>CRDT</CdtDbtInd></Btch>')
  .replace('<CdtrRefInf><Ref>'+reference+'</Ref></CdtrRefInf>','<RfrdDocInf><Nb>'+reference+'</Nb></RfrdDocInf>')
  .replace('<AcctSvcrRef>SYNTHETIC-DEPOSIT</AcctSvcrRef>',relation?'<AcctSvcrRef>SYNTHETIC-DEPOSIT</AcctSvcrRef>':'');
 const bytes=new TextEncoder().encode(xml);
 return {reportId:'SYNTHETIC-JOINED-0599',filename:'Synthetic-joined-0599.xml',sha256:hash(bytes),bytes};
}

/** C3's real worker, SQL store, retained-original sink, domain and C4 verifier
 * share the same SQLite/R2 workspace. Only Worker bindings/authentication and
 * provider-account decoding are substituted by the established ingest fixture.
 * Synthetic transport is explicitly opted in and network calls are forbidden. */
export async function joinedFixture(t,{reference='0599',withAlias=true,relation=true,sourceEnabled=true,direction='receivable',supplierControl=false}={}){
 let state=seedState({invoice:false});
 const specs=direction==='payable'?[['0599','payable']]:[['0599','receivable'],['599','receivable'],...(supplierControl?[['0599','payable']]:[])];
 for(const [number,invoiceDirection] of specs)state=applyCommand(state,{type:'invoice.save',invoice:{direction:invoiceDirection,party:'Synthetic customer AB',number,ocr:invoiceDirection==='payable'?'000018':'',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true,documentId:'synthetic-joined-'+invoiceDirection+'-'+number}}).state;
 const f=await ingestFixture(t,{state});
 const resources=[{uid:'selected',currency:'SEK',account_id:{iban:account},...(withAlias?{all_account_ids:[{scheme_name:'BBAN',identification:accountAlias}]}:{})}];
 f.sql.prepare('UPDATE bank_connections SET encrypted_accounts=? WHERE owner=?').run(JSON.stringify(resources),f.owner);
 for(const invoice of state.invoices){
  const bytes=new TextEncoder().encode('Synthetic joined invoice original '+invoice.direction+' '+invoice.number+'. No real customer data.');
  f.objects.set(f.owner+'/'+invoice.documentId,bytes);
  f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(invoice.documentId,f.owner,invoice.documentId+'.pdf','application/pdf',bytes.length,hash(bytes),'2026-11-02T00:00:00Z');
 }
 // The existing fixture gives direct sink tests a lease. This test exercises
 // the real worker's own acquisition, completion and replay instead.
 f.sql.prepare('DELETE FROM bankgiro_ingest_leases WHERE owner=?').run(f.owner);
 f.report=joinedReport({reference,relation});f.source=sourceEnabled?syntheticSource([f.report]):null;
 f.worker=()=>createBankgiroIngest({source:f.source,store:createBankgiroIngestStore(f.database),sink:f.sink,allowSynthetic:true});
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Network access is forbidden in joined synthetic acceptance');});
 const key='__seven_agent_joined_'+crypto.randomUUID().replaceAll('-','');globalThis[key]=f;t.after(()=>delete globalThis[key]);
 const domain=local('../../lib/domain.ts'),engine=local('../../lib/reconciliation-engine.js'),{server,store,bankgiro,evidence,reconciliation}=f.moduleUrls;
 const environment=data(`export const env=globalThis[${JSON.stringify(key)}].env;`);
 const presentation=compiled('../../lib/payment-presentation.ts',{'./domain':domain,'./reconciliation-engine.js':engine,'./payment-references.js':local('../../lib/payment-references.js')});
 const candidates=compiled('../../lib/banking/invoice-candidates.ts',{'../domain':domain,'../reconciliation-engine.js':engine,'../payment-presentation':presentation});
 const details=compiled('../../lib/banking/detail-evidence.ts',{'../domain':domain,'../payment-references.js':local('../../lib/payment-references.js'),'../payer-evidence.js':local('../../lib/payer-evidence.js')});
 const verification=compiled('../../lib/payment-verification.ts',{'./account-evidence-presentation':compiled('../../lib/account-evidence-presentation.ts',{'./domain':domain}),'cloudflare:workers':environment,'./server':server,'./domain':domain,'./payment-presentation':presentation,'./bank-api-original.js':local('../../lib/bank-api-original.js'),'./reconciliation-engine.js':engine,'./payment-references.js':local('../../lib/payment-references.js'),'./banking/invoice-candidates':candidates,'./banking/detail-evidence':details,'./reconciliation-evidence':evidence,'./bankgiro-service':bankgiro});
 const preview=compiled('../../lib/reconciliation-preview.ts',{'./domain':domain,'./bankgiro-source-evidence.js':local('../../lib/bankgiro-source-evidence.js'),'./reconciliation-contract.js':local('../../lib/reconciliation-contract.js'),'./payment-verification':verification,'./reconciliation':reconciliation,'./payment-presentation':presentation,'./bankgiro-service':bankgiro,'./banking/store':store,'./payer-evidence.js':local('../../lib/payer-evidence.js'),'./payment-references.js':local('../../lib/payment-references.js'),'./camt-xml.js':local('../../lib/camt-xml.js'),'./server':server});
 const api=await import(preview);f.presentation=await import(presentation);f.reconciliation=await import(reconciliation);f.verification=await import(verification);
 f.preview=async(id)=>{const current=f.read();return api.readReconciliationPreview(f.owner,current.state,current.revision,id);};
 const react={'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')};
 const availability=compiled('../../components/bankgiro-availability.tsx',{...react,'@/lib/domain':domain});
 const {default:BankPayments}=await import(compiled('../../components/bank-payments.tsx',{...react,'@/lib/domain':domain,'@/lib/payment-presentation':presentation,'./bankgiro-availability':availability,'./list-pagination':compiled('../../components/list-pagination.tsx',react)}));
 f.render=()=>{const {state}=f.read();return renderToStaticMarkup(React.createElement(BankPayments,{state,transactions:f.presentation.bankVisibleTransactions(state),candidates:{},open(){throw Error('A read cannot invoke a mutation');}}));};
 return f;
}
