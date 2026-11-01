import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {matchingCases,matchingAccount as account} from '../test/bank-matching-corpus.js';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const runnerRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(option('--source-root')||runnerRoot);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceFiles=['src/db.js','src/importers.js','src/reconciliation.js','src/security.js','src/bank-evidence.js','src/payment-references.js','sites/lib/payment-references.js','sites/lib/payer-evidence.js','sites/lib/camt-payer.js','sites/lib/camt-xml.js','sites/lib/reference-evidence-compat.js'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(path=>[path,existsSync(join(sourceRoot,path))?hash(join(sourceRoot,path)):null]));
const initialHashes=sourceHashes();
const load=path=>import(pathToFileURL(join(sourceRoot,path)).href);
const [{openDatabase,storeTransactions,listInvoices,listTransactions,allocate},{normalizeBankApiTransaction,parseCSV},{analyzeReconciliation,reconciliationData,runReconciliation},{encryptObject}]=await Promise.all([load('src/db.js'),load('src/importers.js'),load('src/reconciliation.js'),load('src/security.js')]);
// Process-local synthetic encryption key. No .env, server, remote service or production DB is opened.
process.env.BANK_DATA_KEY='3'.repeat(64);delete process.env.ENCRYPTION_KEY;
const git=command=>{const r=spawnSync('git',['-C',sourceRoot,...command],{encoding:'utf8',windowsHide:true});return r.status===0?r.stdout.trim():null;};
const revision=option('--source-revision')||git(['rev-parse','HEAD']);
const folder=mkdtempSync(join(tmpdir(),'mg-matching-benchmark-'));
let counter=0;
function fixture(){
 const db=openDatabase(join(folder,`synthetic-${counter++}.sqlite`));
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-bank','enablebanking','Synthetic bank',encryptObject({session_id:'synthetic-session'}),encryptObject([{uid:'synthetic-account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01T00:00:00Z','synthetic-owner','connected','synthetic-account');
 return db;
}
function invoice(db,{id='invoice',number='SYN-1',reference='000018',party='Synthetic customer AB',total=10000,organization=''}={}){
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at,organization_number,bankgiro) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'customer',number,party,total,reference,'2026-10-01',organization,reference==='58197013'?'5819-7013':'');
}
function raw({payer='Synthetic customer AB',reference='000018',amount=10000,description='',bankId='SYNTHETIC-BANK-1',fields={}}={}){
 return {status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:amount<0?'DBIT':'CRDT',transaction_amount:{amount:Math.trunc(Math.abs(amount)/100)+'.'+String(Math.abs(amount)%100).padStart(2,'0'),currency:'SEK'},debtor:{name:payer},creditor:{name:payer},reference_number:reference,entry_reference:bankId,...(description?{bank_transaction_code:{description}}:{}),...structuredClone(fields)};
}
function api(db,values={},selected=account,source='enablebanking'){
 const original=raw(values),transaction=normalizeBankApiTransaction(original,selected);
 return storeTransactions(db,[transaction],source);
}
function file(db,reported=account){
 const content=Buffer.from(`Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN\n2026-10-26;100.00;SEK;Synthetic customer AB;000018;SYNTHETIC-FILE-1;${reported}\n`);
 return storeTransactions(db,parseCSV(content.toString('utf8'),account),'file:synthetic.csv',{content,mime_type:'text/csv'});
}
const org=(value,scheme='COID')=>({identification:value,scheme_name:scheme,issuer:'SE'});
function prepare(db,scenario){
 if(scenario.mode==='invalid-ocr'||scenario.mode==='invalid-sebg')invoice(db,{reference:'000019'});
 else if(scenario.mode==='customer-id')invoice(db,{organization:'5560160680'});
 else if(scenario.mode==='own-bankgiro')invoice(db,{reference:'58197013'});
 else if(!['payer-link','unverified-link'].includes(scenario.mode))invoice(db);
 switch(scenario.mode){
  case'api':api(db,scenario.payment);break;
  case'file':file(db);break;
  case'wrong-account':file(db,'SE3550000000054910000003');break;
  case'equal-invoices':invoice(db,{id:'second',number:'SYN-2',reference:'000026'});api(db,{reference:''});break;
  case'multiple-references':invoice(db,{id:'second',number:'SYN-2',reference:'000026'});api(db,{fields:{invoice_number:'SYN-2'}});break;
  case'invalid-ocr':api(db,{reference:'000019',fields:{ocr:'000019'}});break;
  case'invalid-sebg':api(db,{reference:'000019',fields:{reference_number_schema:'SEBG'}});break;
  case'missing-original':api(db);db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256=''").run();break;
  case'payer-link':case'unverified-link':{
   invoice(db,{id:'historical',number:'SYN-HISTORY',reference:'000026'});
   api(db,{payer:'Synthetic private payer',reference:'000026',bankId:'SYNTHETIC-HISTORICAL'},account,scenario.mode==='unverified-link'?'manual':'enablebanking');
   allocate(db,'historical',listTransactions(db)[0].id,10000);
   invoice(db);api(db,{payer:'Synthetic private payer'});break;
  }
  case'duplicate-source':api(db);api(db,{bankId:'SYNTHETIC-SECOND-SOURCE'},'synthetic-other-account');break;
  case'two-payments':api(db);api(db,{bankId:'SYNTHETIC-SECOND-PAYMENT'});break;
  case'conflicting-payer':api(db,{fields:{debtor:{name:'Synthetic customer AB',organisation_id:[org('5560160680'),org('5560000000')]}}});break;
  case'changed-payer-id':api(db,{fields:{debtor:{name:'Synthetic customer AB',organisation_id:org('CUSTOMER-1','CUST')}}});api(db,{fields:{debtor:{name:'Synthetic customer AB',organisation_id:org('CUSTOMER-2','CUST')}}});break;
  case'customer-id':api(db,{fields:{debtor:{name:'Unrelated synthetic company',organisation_id:org('5560160680','CUST')}}});break;
  case'own-bankgiro':api(db,{reference:'58197013'});break;
  default:throw Error('Unknown synthetic scenario '+scenario.mode);
 }
}
const results=[];
try{
 for(const scenario of matchingCases){
  const db=fixture();
  try{
   let rejected='';try{prepare(db,scenario);}catch(error){if(scenario.expected!=='blocked')throw error;rejected=error.message;}
   const before=db.prepare('SELECT COUNT(*) n FROM allocations').get().n,evidence=reconciliationData(db);
   const suggestions=analyzeReconciliation(evidence),safe=suggestions.filter(s=>s.safe&&s.amount_cents>0);
   // The actual boundary, rather than safe:true alone, determines the measured outcome.
   runReconciliation(db);
   const allocationCount=db.prepare('SELECT COUNT(*) n FROM allocations').get().n-before;
   const transactions=listTransactions(db),actual=allocationCount?'automatic':rejected&&!transactions.length?'blocked':'manual';
   results.push({id:scenario.id,expected:scenario.expected,actual,correct:actual===scenario.expected,automatic_candidates:safe.length,analyzer_agrees_with_boundary:!!safe.length===!!allocationCount,new_allocations:allocationCount,transaction_count:transactions.length,paid_cents:listInvoices(db).find(i=>i.id==='invoice')?.paid_cents||0,available_cents:transactions.reduce((n,t)=>n+t.available_cents,0),finding_kinds:[...new Set(suggestions.map(s=>s.kind))],...(rejected?{rejection:rejected}:{})});
  }catch(error){results.push({id:scenario.id,expected:scenario.expected,actual:'error',correct:false,error:error.message});}
  finally{db.close();}
 }
 const replayDb=fixture();let replay;
 try{
  invoice(replayDb);const first=api(replayDb);runReconciliation(replayDb);const second=api(replayDb);runReconciliation(replayDb);
  replay={attempts:2,first_imported:first.imported,repeated_imported:second.imported,repeated_duplicates:second.duplicate,stored_transactions:listTransactions(replayDb).length,allocations:replayDb.prepare('SELECT COUNT(*) n FROM allocations').get().n,paid_cents:listInvoices(replayDb)[0].paid_cents};
 }finally{replayDb.close();}
 const abortDb=fixture();let aborted;
 try{
  api(abortDb);let rejection='';try{storeTransactions(abortDb,[normalizeBankApiTransaction(raw({bankId:'SYNTHETIC-NEW-IN-ABORTED-BATCH'}),account),normalizeBankApiTransaction(raw({amount:12000}),account)],'enablebanking');}catch(error){rejection=error.code||error.message;}
  aborted={attempts:1,rejected_imports:rejection?1:0,rejection,new_payment_rows:abortDb.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE bank_reference='SYNTHETIC-NEW-IN-ABORTED-BATCH'").get().n,stored_transactions:listTransactions(abortDb).length,conflict_records:listTransactions(abortDb).reduce((n,t)=>n+t.bank_evidence_conflicts.length,0)};
 }finally{abortDb.close();}
 const evaluated=results.filter(r=>r.actual!=='blocked'&&r.actual!=='error'),tp=evaluated.filter(r=>r.expected==='automatic'&&r.actual==='automatic').length,fp=evaluated.filter(r=>r.expected!=='automatic'&&r.actual==='automatic').length,fn=evaluated.filter(r=>r.expected==='automatic'&&r.actual!=='automatic').length,manual=evaluated.filter(r=>r.actual==='manual').length;
 const stable=JSON.stringify(initialHashes)===JSON.stringify(sourceHashes());
 const report={schema:'synthetic-bank-matching-benchmark-v1',generated_at:new Date().toISOString(),source:{root:sourceRoot,revision,dirty:git(['status','--porcelain'])!==null?!!git(['status','--porcelain']):null,stable_during_run:stable,file_sha256:initialHashes},runner_sha256:hash(fileURLToPath(import.meta.url)),corpus_sha256:hash(join(runnerRoot,'test/bank-matching-corpus.js')),scope:'Synthetic Node reconciliationData -> pure analyzeReconciliation -> atomic runReconciliation with real temporary SQLite and preserved synthetic bank originals. No live API or production evidence.',definitions:{automatic:'At least one new allocation at the real reconciliation boundary.',manual_rate:'Cases without automatic allocation divided by evaluated persisted-payment cases; rejected originals and setup errors are reported separately.',truth:'Fixed case outcomes in bank-matching-corpus.js; this is a bounded regression benchmark, not a production error-rate estimate.'},metrics:{cases:results.length,evaluated_payment_cases:evaluated.length,expected_automatic:evaluated.filter(r=>r.expected==='automatic').length,automatic_true_positives:tp,automatic_false_positives:fp,automatic_false_negatives:fn,automatic_precision:tp+fp?tp/(tp+fp):null,automatic_recall:tp+fn?tp/(tp+fn):null,manual_review_cases:manual,manual_rate:evaluated.length?manual/evaluated.length:null,blocked_original_cases:results.filter(r=>r.actual==='blocked').length,errors:results.filter(r=>r.actual==='error').length,correct_cases:results.filter(r=>r.correct).length},import_replay:replay,aborted_import:aborted,cases:results};
 const output=option('--output');if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({revision,metrics:report.metrics,import_replay:replay,aborted_import:aborted,...(output?{output:resolve(output)}:{})},null,2));
 if(report.metrics.errors||!stable)process.exitCode=1;
}finally{rmSync(folder,{recursive:true,force:true});}
