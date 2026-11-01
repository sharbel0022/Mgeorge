import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,cpSync,readdirSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {resolve,dirname,basename,join,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {makeBankgiroXLSX} from '../sites/tests/helpers/bankgiro-xlsx-fixture.mjs';
import {syntheticBankRow} from '../sites/tests/helpers/bank-api-fixture.mjs';

// A bounded domain measurement, deliberately separate from authenticated
// original rereads, D1/SQLite concurrency, browser QA and production evidence.
const root=fileURLToPath(new URL('../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map(value=>value.replace(/^--/,'').split('=')));
const phase=args.phase||'after',baseline=args.baseline||'1b017c0';
if(!['before','after'].includes(phase))throw Error('Use --phase=before or --phase=after');
const sha=value=>createHash('sha256').update(value).digest('hex');
const account='SE0000000000000000000000',otherAccount='SE0000000000000000000001';
const payment={party:'Syntetiska Bageriet AB',reference:'0057',payerBankgiro:'987-6543',amount:62500};
const second={party:'Syntetiska Butiken AB',reference:'0058',payerBankgiro:'444-5555',amount:12500};
const definitions=[
 {id:'single-ais-xlsx',link:true},
 {id:'two-independent-equal-amount-ais',link:true,twoAIS:true},
 {id:'complete-two-payer-group',link:true,payments:[{...payment,amount:50000},second]},
 {id:'same-original-twice',link:true,repeat:true},
 {id:'one-day-documented-difference',link:true,date:'2026-10-27',dateNote:'Kontrollerad syntetisk bokföringsskillnad på en dag.'},
 {id:'existing-partial-allocation',link:true,allocated:12500,invoiceTotal:100000},
 {id:'existing-full-allocation',link:true,allocated:62500},
 {id:'different-invoice-customer',link:true,invoiceParty:'Syntetisk Annan Kund AB'},
 {id:'ambiguous-invoice-reference',link:true,ambiguousInvoice:true},
 {id:'manual-link-then-revoke',link:true,revoke:true},
 {id:'wrong-recipient-account',link:false,account:otherAccount},
 {id:'missing-recipient-account',link:false,account:''},
 {id:'four-day-difference',link:false,date:'2026-10-30',dateNote:'Fyra dagar ska inte godtas.'},
 {id:'incorrect-declared-total',link:false,totalAmount:62499,invalidFile:true},
 {id:'incomplete-declared-count',link:false,declaredCount:2,invalidFile:true},
];
const corpus=definitions.map(definition=>({...definition,bytes:makeBankgiroXLSX({account:definition.account??account,date:definition.date??'2026-10-26',payments:definition.payments??[payment],...(definition.totalAmount?{totalAmount:definition.totalAmount}:{}),...(definition.declaredCount?{declaredCount:definition.declaredCount}:{})})}));
const corpusHash=sha(Buffer.concat(corpus.flatMap(c=>[Buffer.from(c.id),Buffer.from(c.bytes)])));
const temp=mkdtempSync(join(tmpdir(),'mgeorge-bankgiro-link-measure-'));
try{
 if(phase==='before'){
  const archive=join(temp,'baseline.tar');execFileSync('git',['archive','--format=tar',`--output=${archive}`,baseline,'sites/lib'],{cwd:root});
  execFileSync('tar',['-xf',archive,'-C',temp]);
 }else cpSync(join(root,'sites/lib'),join(temp,'sites/lib'),{recursive:true});
 symlinkSync(join(root,'sites/node_modules'),join(temp,'node_modules'),'junction');
 writeFileSync(join(temp,'package.json'),'{"type":"module"}\n');
 const files=[];
 function rewrite(directory){for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(directory,entry.name);if(entry.isDirectory())rewrite(path);else if(['.ts','.js'].includes(extname(path))){
  let source=readFileSync(path,'utf8');files.push({path:path.slice(temp.length+1).replaceAll('\\','/'),sha256:sha(source)});if(extname(path)!=='.ts')continue;
  source=source.replace(/(from\s*|import\s*\()(['"])(\.[^'"]+)\2/g,(match,prefix,quote,target)=>{if(extname(target))return match;const resolved=resolve(dirname(path),target);return prefix+quote+target+(existsSync(resolved+'.ts')?'.ts':existsSync(resolved+'.js')?'.js':'')+quote;});
  writeFileSync(path,source);
 }}}
 rewrite(join(temp,'sites/lib'));
 const domain=await import(pathToFileURL(join(temp,'sites/lib/domain.ts')).href);
 const presentation=await import(pathToFileURL(join(temp,'sites/lib/payment-presentation.ts')).href);
 const {parseSpecificationBytes}=await import(pathToFileURL(join(temp,'sites/lib/bankgiro-parser.js')).href);
 const {reconcileState}=await import(pathToFileURL(join(temp,'sites/lib/reconciliation.ts')).href);
 const {emptyState,applyCommand,economicTransactions,balance}=domain;
 const metrics={scenarios:corpus.length,validFiles:corpus.filter(c=>!c.invalidFile).length,invalidFiles:corpus.filter(c=>c.invalidFile).length,negativeLinkScenarios:corpus.filter(c=>!c.link).length,expectedManualRelations:corpus.filter(c=>c.link).length,correctlyConfirmedRelations:0,falseConfirmedRelations:0,financialDuplicateScenarios:0,unchangedEconomicTotals:0,economicRowsTotal:0,retainedReportRowsTotal:0,retainedReportImportRecordsTotal:0,unchangedAllocations:0,correctInvoiceBalances:0,falseAutomaticInvoiceAllocations:0,manualConfirmationDecisions:0,successfulRevocations:0,availableSinglePayerNames:0,preservedSinglePaymentReferences:0,singlePayerDisplayDenominator:corpus.filter(c=>c.link&&!c.revoke&&!(c.payments?.length>1)).length,visibleRowsForSingleDeposit:0,rejectedInvalidFiles:0,inputFileAttempts:corpus.length+corpus.filter(c=>c.repeat).length,successfulImportAttempts:0,processingMs:0};
 const outcomes=[];
 for(const c of corpus){
  let state=emptyState();
  for(let n=0;n<(c.twoAIS?2:1);n++)state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:62500,account,description:c.allocated?'Enskild syntetisk inbetalning':'Bankgiro inbetalning',bankReference:'SYNTHETIC-AIS-'+n,externalId:'SYNTHETIC-AIS-'+n,party:c.allocated?payment.party:'',payerReference:'',kind:c.allocated?'payment':'batch',verified:!!c.allocated})]}).state;
  const targetId=state.transactions.at(-1).id;
  const invoice={id:'synthetic-invoice',direction:'receivable',party:c.invoiceParty??payment.party,number:payment.reference,ocr:'',total:c.invoiceTotal??62500,currency:'SEK',issued:'2026-10-01',due:'2026-11-01',reviewed:true,voided:false,note:'',bankgiro:'',documentId:'',source:'Syntetiskt mätfacit',createdAt:'2026-10-26T00:00:00Z',email:''};
  state.invoices.push(invoice);
  if(c.ambiguousInvoice)state.invoices.push({...invoice,id:'synthetic-invoice-two',party:'Syntetisk Annan Kund AB',number:'0058',ocr:payment.reference});
  if(c.allocated)state.allocations.push({id:'synthetic-allocation',invoiceId:invoice.id,transactionId:targetId,amount:c.allocated,effect:'payment',active:true,note:'Befintlig syntetisk fördelning',createdAt:'2026-10-26T00:00:00Z'});
  const initialEconomy=economicTransactions(state).reduce((n,t)=>n+t.amount,0),initialAllocations=JSON.stringify(state.allocations),initialBalances=state.invoices.map(i=>balance(state,i));
  let imported=false,confirmed=false,revoked=false,error='',relationCount=0,reportRows=0;
  const started=performance.now();
  try{
   const rows=parseSpecificationBytes(c.bytes,'synthetic-'+c.id+'.xlsx'),hash=sha(c.bytes);
   const command={type:'bankgiro.import',rows,documentId:'synthetic-original-'+c.id,hash,name:'synthetic-'+c.id+'.xlsx'};
   state=applyCommand(state,command).state;metrics.successfulImportAttempts++;imported=true;
   if(c.repeat){state=applyCommand(state,command).state;metrics.successfulImportAttempts++;}
   reportRows=state.transactions.filter(t=>t.specification).length;
   const specificationId=state.transactions.find(t=>t.specification).id;
   try{state=applyCommand(state,{type:'bankgiro.link',transactionId:targetId,specificationId,note:'Båda syntetiska originalen och mottagarkontot kontrollerade mot facit.',confirmOriginals:true,confirmAccount:true,dateDifferenceNote:c.dateNote??''}).state;confirmed=true;metrics.manualConfirmationDecisions++;}
   catch(e){error=String(e.message);}
   relationCount=(state.bankgiroLinks||[]).filter(l=>!l.revokedAt).length;
   if(c.revoke&&confirmed){const relation=state.bankgiroLinks.find(l=>!l.revokedAt);state=applyCommand(state,{type:'bankgiro.unlink',id:relation.id,note:'Den syntetiska originalrelationen återtas utan ekonomisk förändring.'}).state;revoked=true;}
   // This is the real shared domain matcher, not a display-only assertion.
   state=reconcileState(state).state;
  }catch(e){error=String(e.message);}
  metrics.processingMs+=performance.now()-started;
  if(c.invalidFile&&!imported)metrics.rejectedInvalidFiles++;
  if(c.link&&confirmed)metrics.correctlyConfirmedRelations++;
  if(!c.link&&confirmed)metrics.falseConfirmedRelations++;
  if(revoked)metrics.successfulRevocations++;
  const economic=economicTransactions(state),sum=economic.reduce((n,t)=>n+t.amount,0),allocationsEqual=JSON.stringify(state.allocations)===initialAllocations,balancesEqual=JSON.stringify(state.invoices.map(i=>balance(state,i)))===JSON.stringify(initialBalances);
  metrics.economicRowsTotal+=economic.length;metrics.retainedReportRowsTotal+=state.transactions.filter(t=>t.specification).length;metrics.retainedReportImportRecordsTotal+=state.imports.filter(i=>i.documentId?.startsWith('synthetic-original-')).length;
  if(sum!==initialEconomy||economic.length!==(c.twoAIS?2:1))metrics.financialDuplicateScenarios++;else metrics.unchangedEconomicTotals++;
  if(allocationsEqual)metrics.unchangedAllocations++;else metrics.falseAutomaticInvoiceAllocations+=Math.max(0,state.allocations.length-JSON.parse(initialAllocations).length);
  if(balancesEqual)metrics.correctInvoiceBalances++;
  const target=state.transactions.find(t=>t.id===targetId),view=presentation.bankPaymentView(state,target),visible=presentation.bankVisibleTransactions(state);
  if(c.link&&!c.revoke&&!(c.payments?.length>1)){
   if(view.payer===payment.party)metrics.availableSinglePayerNames++;
   if(view.reference.value===payment.reference&&view.reference.ocr==='')metrics.preservedSinglePaymentReferences++;
   metrics.visibleRowsForSingleDeposit+=visible.filter(t=>t.id===targetId||t.specification).length;
  }
  outcomes.push({case:c.id,expectedLink:c.link,invalidFile:!!c.invalidFile,imported,confirmed,revoked,relationCountBeforeRevoke:relationCount,reportRows,economicRows:economic.length,economicCents:sum,allocations:state.allocations.length,allocationsUnchanged:allocationsEqual,invoiceBalances:state.invoices.map(i=>balance(state,i)),balancesUnchanged:balancesEqual,visibleRows:visible.length,displayPayerAvailable:view.payer===payment.party,displayReferenceCorrect:view.reference.value===payment.reference&&view.reference.ocr==='',error});
 }
 metrics.processingMs=Number(metrics.processingMs.toFixed(4));metrics.msPerInputFileAttempt=Number((metrics.processingMs/metrics.inputFileAttempts).toFixed(4));
 const report={schema:'mgeorge-bankgiro-ais-linking-domain-v1',phase,measuredAt:new Date().toISOString(),baselineCommit:execFileSync('git',['rev-parse',baseline],{cwd:root,encoding:'utf8'}).trim(),candidateCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),candidateWorktreeDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),corpusSha256:corpusHash,facitSha256:sha(JSON.stringify(definitions)),runnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),fixtureSourcesSha256:sha(readFileSync(join(root,'sites/tests/helpers/bankgiro-xlsx-fixture.mjs'))+readFileSync(join(root,'sites/tests/helpers/bank-api-fixture.mjs'))),scope:'Identical synthetic XLSX bytes, Sites domain import/manual-link/revoke/reconciliation/presentation. Excludes authenticated API original rereads, active consent, database concurrency, browser and production. Timing includes parse/import/link/revoke/domain reconciliation; fixture creation and initial state excluded. Single observation, no production SLA.',metrics,outcomes,librarySourceSha256:sha(JSON.stringify(files))};
 const output=resolve(root,args.output||`docs/measurements/bankgiro-ais-linking-${phase}.json`);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase,corpusSha256:corpusHash,output,metrics},null,2));
 if(metrics.financialDuplicateScenarios||metrics.falseConfirmedRelations||metrics.falseAutomaticInvoiceAllocations||metrics.correctInvoiceBalances!==corpus.length||phase==='after'&&metrics.correctlyConfirmedRelations!==metrics.expectedManualRelations)process.exitCode=1;
}finally{if(dirname(resolve(temp))!==resolve(tmpdir())||!basename(temp).startsWith('mgeorge-bankgiro-link-measure-'))throw Error('Temporary cleanup path outside measurement workspace.');rmSync(temp,{recursive:true,force:true});}
