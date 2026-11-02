// Trusted, read-only projection of the existing single-company Node workspace.
// No provider, import, allocation, message or orchestration entry point is called.
import {getSettings,paymentSign} from './db.js';
import {reconciliationData} from './reconciliation.js';
import {digest,decryptObject} from './security.js';
import {parseBankFile,normalizeBankApiTransaction,parseMoney} from './importers.js';
import {hasBankEvidenceConflict,bankFinancialReview} from './bank-evidence.js';
import {bankSpecificationPresentation} from './bankgiro-links.js';
import {readCamtDocument,xmlChildren,xmlPath,xmlValue,camtDate,decodeCamtBytes} from '../sites/lib/camt-xml.js';
import {buildReconciliationPreview,RECONCILIATION_CONTRACT_VERSION} from '../sites/lib/reconciliation-contract.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=value=>typeof value==='string'?value:'';
const accountKey=value=>text(value).replace(/^iban:/i,'').replace(/[\s-]/g,'').toUpperCase();
const hashRow=row=>digest(JSON.stringify({...row,...(Object.hasOwn(row,'content')?{content:row.content==null?null:{sha256:digest(row.content),size:row.content.byteLength}}:{})}));
const referenceCandidates=evidence=>Array.isArray(evidence?.candidates)?evidence.candidates.map(candidate=>({...candidate})):[];

function identifiers(resource){
 if(!resource||typeof resource!=='object')return [];
 const out=[{scheme:'IBAN',value:resource.account_id?.iban}];
 const other=resource.account_id?.other;if(other)out.push({scheme:other.scheme_name,value:other.identification});
 if(Array.isArray(resource.all_account_ids))out.push(...resource.all_account_ids.map(id=>({scheme:id?.scheme_name,value:id?.identification})));
 return out.filter(id=>typeof id.scheme==='string'&&['IBAN','BBAN','CPAN'].includes(id.scheme.toUpperCase())&&/^[A-Z0-9]{1,80}$/.test(accountKey(id.value))).map(id=>accountKey(id.value));
}
function accountResources(connections){
 return connections.map(connection=>{let resources;try{resources=decryptObject(connection.accounts_json);}catch{}return {connection,complete:Array.isArray(resources),resources:Array.isArray(resources)?resources:[]};});
}
function currentAccount(resources,owner,reported,currency,checkedAt){
 const key=accountKey(reported),matches=[];let ambiguous=false;
 for(const context of resources){
  if(context.connection.owner!==owner||context.connection.status!=='connected'||!(Date.parse(context.connection.valid_until)>Date.parse(checkedAt)))continue;
  if(!context.complete){ambiguous=true;continue;}
  const holders=context.resources.filter(resource=>identifiers(resource).includes(key));
  if(!holders.length)continue;
  if(holders.length!==1){ambiguous=true;continue;}
  const selected=context.resources.filter(resource=>resource?.uid===context.connection.selected_account_uid),resource=holders[0];
  if(selected.length!==1||selected[0]!==resource||resource.currency!==currency||currency!=='SEK'||!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(accountKey(resource.account_id?.iban))){ambiguous=true;continue;}
  matches.push({connection:context.connection,resource});
 }
 // Multiple active owner consents claiming the same identifier are ambiguous.
 if(ambiguous||matches.length!==1)return {status:'BLOCKED',ownerId:owner,accountId:key,currency,source:'missing',proofId:'',reason:'Aktuellt entydigt ägarbundet valt SEK-konto saknas.'};
 const {connection,resource}=matches[0];
 return {status:'VERIFIED',ownerId:owner,accountId:accountKey(resource.account_id.iban),currency,source:'bank_account_resource',proofId:digest(JSON.stringify([connection.id,hashRow(connection),key,resource.uid])),validUntil:connection.valid_until};
}
function ownedObservation(row,imports,resources,owner){
 const original=imports.get(row.import_id);
 if(original?.owner)return original.owner===owner;
 const holders=resources.filter(context=>context.resources.some(resource=>identifiers(resource).includes(accountKey(row.account))));
 if(holders.length)return holders.some(context=>context.connection.owner===owner)&&!holders.some(context=>context.connection.owner&&context.connection.owner!==owner);
 // Only these established administrators own unbound legacy records in the
 // single-company Node application. An arbitrary principal gets no fallback.
 return owner==='administrator'||owner==='local-admin';
}
function fileGroups(job,rows){
 if(/\.xlsx$/i.test(job.name)){
  const groups=new Map();
  for(const row of rows){const report=row.account_evidence?.report||{},key=JSON.stringify([report.reportId,report.sheet,report.reportDate,row.account_evidence?.reported_account]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return [...groups.values()].map((group,index)=>{
   const row=group[0],report=row.account_evidence.report,integer=value=>typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
   const identity=[accountKey(row.account_evidence.reported_account),row.booked_at,report.recipientBankgiro,report.sequence,group.length,group.reduce((sum,x)=>sum+x.amount_cents,0),group.map(x=>[x.payer,x.reference,x.payer_bankgiro,x.amount_cents]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))];
   return {id:`report:${job.id}:${index}`,reportKey:digest(JSON.stringify(identity)),bankDepositId:'',accountId:accountKey(row.account_evidence.reported_account),currency:row.account_evidence.explicit_currency===true?row.currency:'',bookedDate:'',totalMinor:integer(report.totalCents),paymentCount:integer(report.paymentCount),rows:group};
  });
 }
 if(!/\.xml$/i.test(job.name))return [];
 const document=readCamtDocument(decodeCamtBytes(job.content)),statement=document.namespace.includes('camt.053.')?'Stmt':'Ntfctn',container=document.namespace.includes('camt.053.')?'BkToCstmrStmt':'BkToCstmrDbtCdtNtfctn',groups=[];
 for(const report of xmlChildren(xmlPath(document,container),statement))for(const entry of xmlChildren(report,'Ntry')){
  const bankDepositId=xmlValue(entry,'AcctSvcrRef')||xmlValue(entry,'NtryRef'),details=xmlChildren(entry,'NtryDtls'),declared=details.map(detail=>xmlValue(detail,'Btch','NbOfTxs'));
  const count=declared.length&&declared.every(value=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0)?declared.reduce((sum,value)=>sum+Number(value),0):null;
  const amount=xmlPath(entry,'Amt'),direction=xmlValue(entry,'CdtDbtInd'),reported=accountKey(xmlValue(report,'Acct','Id','IBAN')||xmlValue(report,'Acct','Id','Othr','Id'));
  groups.push({id:`report:${job.id}:${groups.length}`,bankDepositId,accountId:reported,currency:text(amount?.attributes?.Ccy),bookedDate:camtDate(entry,'BookgDt',true),totalMinor:amount?parseMoney(amount.text.trim())*(direction==='DBIT'?-1:1):null,paymentCount:count,rows:rows.filter(row=>accountKey(row.account_evidence?.reported_account)===reported&&(row.parent_bank_reference===bankDepositId||row.bank_reference===bankDepositId))});
 }
 return groups;
}
function buildInput(db,{owner,referencePolicy},checkedAt){
 const data=reconciliationData(db,{owner}),settings=getSettings(db),allImports=db.prepare('SELECT * FROM import_jobs ORDER BY created_at,id').all(),imports=new Map(allImports.map(row=>[row.id,row])),connections=db.prepare('SELECT * FROM bank_connections ORDER BY id').all(),resources=accountResources(connections);
 const stored=data.transactions.filter(row=>ownedObservation(row,imports,resources,owner)),storedIds=new Set(stored.map(row=>row.id)),rawTransactions=db.prepare('SELECT * FROM bank_transactions ORDER BY id').all().filter(row=>storedIds.has(row.id));
 const documentRows=db.prepare('SELECT * FROM documents ORDER BY id').all(),files=new Map(),groups=[],jobs=[],seenOriginals=new Set();
 const scopedImports=allImports.filter(job=>job.owner?job.owner===owner:stored.some(row=>row.import_id===job.id)||owner==='administrator'||owner==='local-admin');
 // Prefer originals actually referenced by retained observations over identical
 // retry receipts. All receipts still participate in the freshness hash.
 const bankImports=scopedImports.filter(job=>['bank_file','enablebanking','manual'].includes(job.source)).sort((a,b)=>Number(stored.some(row=>row.import_id===b.id))-Number(stored.some(row=>row.import_id===a.id))||a.id.localeCompare(b.id));
 for(const job of bankImports){
  const file=job.source==='bank_file',intact=!!job.content&&/^[a-f0-9]{64}$/.test(job.content_sha256)&&digest(job.content)===job.content_sha256;
  let rows=[],issue='';
  if(file){
   if(!intact)issue='Bankfilens ägda original eller kontrollsumma saknas.';
   else try{rows=parseBankFile(job.name,Buffer.from(job.content).toString('base64'),'');}catch{issue='Bankfilens bevarade original kan inte tolkas fullständigt.';}
   files.set(job.id,{job,rows,intact,issue});
   if(!issue&&!seenOriginals.has(job.content_sha256)){
    try{groups.push(...fileGroups(job,rows).map(group=>({...group,job})));seenOriginals.add(job.content_sha256);}catch{issue='Rapportens ursprungliga antal, belopp eller identitet kan inte läsas.';files.get(job.id).issue=issue;}
   }
  }
  jobs.push({id:job.id,status:issue||job.status==='blocked'||job.status==='error'?'blocked':job.status==='completed'?'complete':'pending',complete:!issue&&job.status==='completed'});
 }
 const sourceFor=row=>{
  const file=files.get(row.import_id),matches=file&&!file.issue?file.rows.filter(candidate=>candidate.bank_reference&&candidate.bank_reference===row.bank_reference&&accountKey(candidate.account_evidence?.reported_account)===accountKey(row.account)):[];
  if(matches.length===1)return {record:matches[0],source:'bank_file',id:file.job.id,sha256:file.job.content_sha256};
  if(row.source==='enablebanking'&&row.raw_bank_data_sha256&&digest(JSON.stringify(row.raw_bank_data))===row.raw_bank_data_sha256){try{const record=normalizeBankApiTransaction(row.raw_bank_data,row.account);if(record)return {record,source:'bank_api',id:row.id,sha256:row.raw_bank_data_sha256};}catch{}}
  return {record:null,source:'unknown',id:row.import_id||row.id,sha256:file?.job.content_sha256||row.raw_bank_data_sha256||''};
 };
 const transactions=stored.map(row=>{
  const source=sourceFor(row),original=source.record,accountEvidence=currentAccount(resources,owner,row.account,row.currency,checkedAt),financial=bankFinancialReview(row),parents=row.parent_bank_reference?stored.filter(parent=>parent.id!==row.id&&accountKey(parent.account)===accountKey(row.account)&&parent.bank_reference===row.parent_bank_reference):[];
  const replaced=!!row.excluded&&row.is_aggregate&&row.exclusion_reason==='Ersatt av enskilda betalningar i bankens betalningsspecifikation';
  return {id:row.id,bankId:text(original?.bank_reference||row.bank_reference),accountId:accountKey(row.account),amountMinor:row.amount_cents,currency:row.currency,bookedDate:row.booked_at,kind:row.is_aggregate?'aggregate':'payment',economic:!row.excluded,ignored:!!row.excluded&&!replaced,duplicateOf:'',original:{status:row.original_verified&&original?'VERIFIED':'BLOCKED',source:source.source,id:source.id,sha256:source.sha256,...(!row.original_verified?{reason:'Bankoriginalets kvitto eller härledda fakta kan inte verifieras.'}:{})},accountEvidence,payerEvidence:original?.payer_evidence||row.payer_evidence||null,references:referenceCandidates(original?.reference_evidence||row.reference_evidence),referenceIncomplete:!!(original?.reference_evidence||row.reference_evidence)?.incomplete,parentId:row.parent_bank_reference?(parents.length===1?parents[0].id:`unresolved-bank-parent:${row.parent_bank_reference}`):'',reportId:'',reversal:financial?.kind==='reversal'||financial?.kind==='refund',holdReason:row.automatic_match_hold?.reason||financial?.reason||'',conflict:hasBankEvidenceConflict(row)||parents.length>1};
 });
 const byId=new Map(transactions.map(row=>[row.id,row])),reports=[],relationships=[];
 for(const group of groups){
  const accountEvidence=currentAccount(resources,owner,group.accountId,group.currency,checkedAt),paymentIds=[];
  for(const [index,row] of group.rows.entries()){
   const candidates=stored.filter(candidate=>candidate.import_id===group.job.id&&candidate.bank_reference&&candidate.bank_reference===row.bank_reference&&accountKey(candidate.account)===accountKey(row.account_evidence?.reported_account));
   let observation=candidates.length===1?byId.get(candidates[0].id):null;
   if(!observation){
    const id=`observation:${group.id}:${index}`;
    observation={id,bankId:text(row.bank_reference),accountId:accountEvidence.status==='VERIFIED'?accountEvidence.accountId:group.accountId,amountMinor:row.amount_cents,currency:group.currency,bookedDate:group.bookedDate,kind:row.is_aggregate?'aggregate':'payment',economic:false,ignored:false,duplicateOf:'',original:{status:'VERIFIED',source:/\.xlsx$/i.test(group.job.name)?'bankgiro_file':'bank_file',id:group.job.id,sha256:group.job.content_sha256},accountEvidence,payerEvidence:row.payer_evidence||null,references:referenceCandidates(row.reference_evidence),referenceIncomplete:!!row.reference_evidence?.incomplete,parentId:'',reportId:group.id,reversal:false,holdReason:'',conflict:false};
    transactions.push(observation);byId.set(id,observation);
   }
   // Ambiguous overlapping originals cannot silently replace earlier lineage.
   if(observation.reportId&&observation.reportId!==group.id)observation.conflict=true;
   observation.reportId=group.id;paymentIds.push(observation.id);
  }
  const report={id:group.id,bankDepositId:group.bankDepositId,accountId:accountEvidence.status==='VERIFIED'?accountEvidence.accountId:group.accountId,currency:group.currency,bookedDate:group.bookedDate,totalMinor:group.totalMinor,paymentCount:group.paymentCount,paymentIds,original:{status:'VERIFIED',source:/\.xlsx$/i.test(group.job.name)?'bankgiro_file':'bank_file',id:group.job.id,sha256:group.job.content_sha256}};
  reports.push(report);
  const parents=transactions.filter(row=>row.kind==='aggregate'&&row.bankId&&row.bankId===group.bankDepositId&&row.accountId===report.accountId);
  if(parents.length===1){relationships.push({id:`bank-relationship:${group.id}:${parents[0].id}`,reportId:group.id,transactionId:parents[0].id,method:'bank_identity',status:'VERIFIED',active:true});for(const id of paymentIds){const row=byId.get(id);if(row.id!==parents[0].id)row.parentId=parents[0].id;}}
 }
 // Missing/invalid pending originals must remain visible even if their rows
 // could not be parsed. Zero is a blocked placeholder, never economic money.
 for(const job of bankImports.filter(job=>job.source==='bank_file'))if(!groups.some(group=>group.job.id===job.id)&&!stored.some(row=>row.import_id===job.id)&&(!files.get(job.id)?.intact||files.get(job.id)?.issue||job.status!=='completed')){
  transactions.push({id:`observation:import:${job.id}`,bankId:'',accountId:'',amountMinor:0,currency:'',bookedDate:'',kind:'aggregate',economic:false,ignored:false,duplicateOf:'',original:{status:'BLOCKED',source:'bank_file',id:job.id,sha256:job.content_sha256,reason:files.get(job.id)?.issue||'Rapporten väntar på fullständig granskning.'},accountEvidence:currentAccount(resources,owner,'','',checkedAt),payerEvidence:null,references:[],referenceIncomplete:true,parentId:'',reportId:'',reversal:false,holdReason:'',conflict:false});
 }
 const links=db.prepare('SELECT * FROM bank_specification_links WHERE owner=? ORDER BY id').all(owner);
 for(const link of links){
  const group=groups.find(group=>group.job.id===link.import_id&&group.reportKey===link.report_key),reportId=group?.id||`unresolved-report:${link.import_id}`,presentation=storedIds.has(link.transaction_id)?bankSpecificationPresentation(db,link.transaction_id,owner):null;
  relationships.push({id:link.id,reportId,transactionId:link.transaction_id,method:'manual_review',status:presentation?.id===link.id?'REVIEW':'BLOCKED',active:!link.revoked_at});
 }
 // C1 owns persisted policy and its reviewed server projection. A company
 // name cannot establish that policy. Until the consumer is integrated, the
 // GET route passes no policy and remains conservatively blocked.
 const policy=referencePolicy??null,companyId=text(policy?.companyId)||`workspace:${owner}`;
 const invoices=data.invoices.map(invoice=>{
  const original=documentRows.find(doc=>doc.id===invoice.document_id&&doc.invoice_id===invoice.id),intact=!!original?.content&&original.status==='registered'&&/^[a-f0-9]{64}$/.test(original.fingerprint)&&digest(original.content)===original.fingerprint;
  // Canonical direction is the obligation's cashflow. Node stores a standalone
  // credit as its own positive-face-value invoice with reversed paymentSign;
  // it is not a negative payment on a different, ordinary invoice. Preserve
  // that history while keeping every new credit proposal in separate review.
  return {id:invoice.id,companyId,number:invoice.invoice_number,explicitReference:invoice.reference,customerName:invoice.party,customerOrganizationNumber:invoice.organization_number,direction:paymentSign(invoice)>0?'receivable':'payable',currency:invoice.currency,totalMinor:invoice.total_cents,creditMinor:0,reviewed:intact&&invoice.kind!=='credit',voided:false,issuedDate:invoice.issued_at,evidenceIssue:invoice.payment_evidence_issue||(!intact?'Fakturans registrerade original kan inte verifieras.':invoice.kind==='credit'?'Kreditfakturan kräver separat återbetalningsgranskning.':'')};
 });
 // Every recorded allocation constrains company invoice balances. A source
 // outside the readable bank scope stays unresolved and blocks the core; it
 // must never disappear and make already allocated money available again.
 // Each Node allocation settles its referenced obligation, including a
 // standalone credit. The canonical refund effect instead means reversing a
 // payment against the same ordinary invoice; Node does not store that here.
 const allocations=data.allocations.map(row=>({id:row.id,invoiceId:row.invoice_id,transactionId:row.transaction_id,amountMinor:row.amount_cents,active:true,effect:'payment'}));
 const customerRelationships=data.links.filter(link=>link.verified_by===owner&&link.evidence).map(link=>({id:link.id,invoiceId:link.invoice_id,accountId:accountKey(link.account),payerName:link.payer,payerOrganizationNumber:'',approved:true,active:true,evidence:link.evidence}));
 const context={settings:digest(JSON.stringify(settings)),transactions:rawTransactions.map(row=>[row.id,hashRow(row)]),invoices:db.prepare('SELECT * FROM invoices ORDER BY id').all().map(row=>[row.id,hashRow(row)]),documents:documentRows.map(row=>[row.id,hashRow(row)]),allocations:data.allocations.map(row=>[row.id,hashRow(row)]),payerLinks:db.prepare('SELECT * FROM payer_links ORDER BY id').all().map(row=>[row.id,hashRow(row)]),imports:scopedImports.map(row=>[row.id,hashRow(row)]),sourceLinks:links.map(row=>[row.id,hashRow(row)]),consents:connections.map(row=>[row.id,hashRow(row)]),originalHistory:db.prepare("SELECT * FROM audit_events WHERE action IN ('aggregate_replaced','invoice_review_approved','invoice_auto_registered','invoice_created','invoice_updated','invoice_reconciled') ORDER BY rowid").all().map(row=>[row.id,hashRow(row)])};
 return {contractVersion:RECONCILIATION_CONTRACT_VERSION,ownerId:owner,companyId,revision:digest(JSON.stringify(context)),checkedAt,complete:true,referencePolicy:policy,transactions,invoices,allocations,reports,relationships,customerRelationships,importJobs:jobs,evidenceContext:context};
}

export async function readReconciliationPreview(db,{owner,transactionId,referencePolicy}={}){
 if(typeof owner!=='string'||!owner.trim())throw fail(401,'Ägarautentisering krävs för förhandsgranskningen.');
 if(transactionId!==undefined&&(typeof transactionId!=='string'||!transactionId||transactionId.length>1000))throw fail(400,'Ogiltig bankhändelse.');
 // A read savepoint gives every SQL read one consistent SQLite snapshot. It
 // works within an existing transaction and never acquires a write reservation.
 db.exec('SAVEPOINT reconciliation_preview_read');
 let input;
 try{input=buildInput(db,{owner,referencePolicy},new Date().toISOString());db.exec('RELEASE reconciliation_preview_read');}
 catch(error){db.exec('ROLLBACK TO reconciliation_preview_read');db.exec('RELEASE reconciliation_preview_read');throw error;}
 if(transactionId&&!input.transactions.some(row=>row.id===transactionId))throw fail(404,'Bankhändelsen saknas.');
 const preview=await buildReconciliationPreview(input);
 // The complete competition set remains visible and bound to the snapshot,
 // including when the caller selects one transaction for presentation.
 return transactionId?{...preview,selectedTransactionId:transactionId}:preview;
}
