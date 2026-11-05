import {identity,db,readWorkspace,response} from './server';
import {balance,economicTransactions,validDate,invoiceReferenceDecision,invoiceReferenceMatches,type State,type Transaction,type Invoice} from './domain';
import {bankPaymentView,bankPaymentInvoiceAssessment,bankPaymentFieldSources} from './payment-presentation';
import {readPaymentVerification} from './payment-verification';
import {bankgiroRetainedPreview} from './bankgiro-service';
import {exactReference} from './reconciliation-engine.js';
import {matchingReferenceValues} from './payment-references.js';
import {strictInvoiceReferenceMatch} from './invoice-reference-policy.js';
import {matchingDocumentCandidates} from './banking/invoice-candidates';

// The MCP text block is a short summary, rather than a second serialized copy.
// This leaves room for the largest permitted request ID in the RPC envelope.
const DATA_BYTE_LIMIT=24_000,RPC_BYTE_LIMIT=65_536;
type Args=Record<string,unknown>;
const object=(v:unknown):v is Args=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const reference=(v:unknown):v is string=>typeof v==='string'&&v.length<=100&&!!v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
function argumentsFor(value:unknown,kind:'payment'|'report'):Args&{offset:number;limit:number}{
 if(!object(value))throw Error('Ogiltiga läsargument.');
 const allowed=kind==='payment'?['transactionId','reference','amountCents','date','offset','limit']:['documentId','sha256','transactionId','offset','limit','historyOffset','historyLimit'];
 if(Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Okänt läsargument. Ägare och konton kan inte väljas av anroparen.');
 if(kind==='payment'){
  if((value.transactionId!==undefined)===(value.reference!==undefined))throw Error('Välj exakt ett bankhändelse-ID eller en exakt referens.');
  if(value.reference!==undefined&&!reference(value.reference))throw Error('Välj en giltig exakt referens.');
  if(value.transactionId!==undefined&&(value.date!==undefined||value.amountCents!==undefined))throw Error('Datum och belopp är endast sökförslag tillsammans med en referens.');
  if(value.date!==undefined&&(typeof value.date!=='string'||!validDate(value.date)))throw Error('Ogiltigt sökdatum.');
  if(value.amountCents!==undefined&&(!Number.isSafeInteger(value.amountCents)||value.amountCents===0||Math.abs(value.amountCents as number)>100_000_000_000))throw Error('Ogiltigt sökbelopp i heltalsören.');
 }else{
  if((value.documentId!==undefined)===(value.sha256!==undefined))throw Error('Välj exakt ett original-ID eller en SHA256-kontrollsumma.');
  if(value.documentId!==undefined&&!validId(value.documentId))throw Error('Ogiltigt original-ID.');
  if(value.sha256!==undefined&&(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)))throw Error('Ogiltig SHA256-kontrollsumma.');
 }
 if(value.transactionId!==undefined&&!validId(value.transactionId))throw Error('Ogiltigt bankhändelse-ID.');
 const limit=value.limit??(kind==='payment'?1:20),offset=value.offset??0,max=kind==='payment'?5:100;
 if(!Number.isSafeInteger(limit)||(limit as number)<1||(limit as number)>max||!Number.isSafeInteger(offset)||(offset as number)<0||(offset as number)>100_000)throw Error('Ogiltig sidindelning.');
 if(kind==='report')for(const [key,min,max,fallback]of [['historyOffset',0,100000,0],['historyLimit',1,20,10]] as const){const n=value[key]??fallback;if(!Number.isSafeInteger(n)||(n as number)<min||(n as number)>max)throw Error('Ogiltig sidindelning för importhistorik.');}
 if(kind==='payment'&&value.transactionId!==undefined&&(offset!==0||limit!==1))throw Error('Ett bankhändelse-ID läses en gång utan sidindelning.');
 return {...value,offset:offset as number,limit:limit as number};
}
function invoiceFact(state:State,i:Invoice){
 const referencePolicy=invoiceReferenceDecision(state,i);
 return {invoiceId:i.id,number:i.number,ocr:i.ocr,direction:i.direction,party:i.party,totalCents:i.total,remainingCents:balance(state,i),reviewed:i.reviewed,originalAttached:!!i.documentId,referencePolicy,intendedPaymentReference:referencePolicy.intendedPaymentReference};
}
function registry(state:State,ref:string){
 const found=ref?state.invoices.filter(i=>!i.voided&&invoiceReferenceMatches(state,i,ref)):[];
 return {reference:ref,matchCount:found.length,ambiguous:found.length>1,complete:found.length<=20,invoices:found.slice(0,20).map(i=>invoiceFact(state,i))};
}
/** Search every preserved identifier from the selected reference original.
 * Detail, report and AIS identifiers remain separate source observations. */
function referenceSearch(state:State,t:Transaction,query:string){
 const source=bankPaymentFieldSources(state,t).reference,values=matchingReferenceValues(source.evidence,source.value.value);
 const direction=t.amount>0?'receivable':'payable',active=state.invoices.filter(i=>!i.voided);
 const scoped=active.some(i=>i.direction===direction&&invoiceReferenceDecision(state,i).applies);
 const invoices=active.filter(i=>!scoped||i.direction===direction),owners=invoices.filter(i=>values.some(value=>invoiceReferenceMatches(state,i,value,true)));
 const contradictory=values.length>1&&!invoices.some(i=>values.every(value=>invoiceReferenceMatches(state,i,value)));
 const blockedOwner=invoices.some(i=>{
  const policy=invoiceReferenceDecision(state,i);
  return policy.applies&&policy.status==='BLOCKED'&&values.some(value=>invoiceReferenceMatches(state,i,value,true));
 });
 // This query-only shape selects the workspace's comparison mode. It is never
 // exposed as an invoice, registered owner, intended reference or bank proof.
 const queryScope=invoiceReferenceDecision(state,{number:query,ocr:query,direction});
 return {sourceKind:source.kind,values,matchedValues:values.filter(value=>queryScope.applies?strictInvoiceReferenceMatch(value,query):exactReference(value,query)),incomplete:!!source.evidence?.incomplete,invalidChecksum:!!source.evidence?.candidates.some(c=>c.validity==='checksum_invalid'),conflicting:owners.length>1||contradictory||blockedOwner};
}
async function context(){
 const user=await identity(),workspace=await db().prepare('SELECT revision FROM workspaces WHERE owner=?').bind(user.userId).first<{revision:number}>(),{state,revision}=await readWorkspace(user.userId);
 return {user,state,revision,base:{changed:false,checkedAt:new Date().toISOString(),revision,scope:{kind:'authenticated_owner',email:user.email},workspacePresent:!!workspace,dataByteLimit:DATA_BYTE_LIMIT,rpcByteLimit:RPC_BYTE_LIMIT}};
}
/** Remove known account identifiers even if copied into a free-text verifier fact.
 * Unknown bank relationship IDs are omitted separately; only organization IDs
 * have a useful, explicitly typed identity meaning in this diagnostic. */
function privateProjection(value:unknown,state:State,extraAccounts:string[]=[]):any{
 const accounts=new Set(extraAccounts);
 for(const t of state.transactions)for(const v of [t.account,t.original?.account,t.recipientAccount,t.payerAccount])if(v){accounts.add(v);accounts.add(v.replace(/^iban:/i,''));}
 const redact=(v:any):any=>{
  if(typeof v==='string'){let out=v;for(const account of accounts)if(account.length>=6)out=out.split(account).join('[konto maskerat]');return out.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g,'[konto maskerat]');}
  if(Array.isArray(v))return v.map(redact);
  if(object(v))return Object.fromEntries(Object.entries(v).map(([k,item])=>[k,redact(item)]));
  return v;
 };
 return redact(value);
}
function safeVerification(report:Awaited<ReturnType<typeof readPaymentVerification>>){
 return {...report,steps:report.steps.map(step=>({...step,facts:step.facts.filter(f=>!/^((Råvärde identifierare|Identifierare|Identifierartyp|Utfärdare|Fältsökväg identifierare) \d+|Avsändarens Bankgiro \/ avinummer)$/.test(f.label))}))};
}
/** Whole values are omitted, never cut into a misleading valid reference prefix. */
function bounded(data:any,key:'payments'|'rows'){
 const size=()=>new TextEncoder().encode(JSON.stringify(data)).byteLength;
 data.outputLimited=false;
 if(size()<=DATA_BYTE_LIMIT)return data;
 data.outputLimited=true;data.complete=false;
 while(data[key]?.length>1&&size()>DATA_BYTE_LIMIT){data[key].pop();data.nextOffset=data.offset+data[key].length;}
 if(size()>DATA_BYTE_LIMIT){
  const omit=(v:any):any=>typeof v==='string'&&v.length>1000?'[Hela värdet utelämnat: svarets storleksgräns]':Array.isArray(v)?v.map(omit):object(v)?Object.fromEntries(Object.entries(v).map(([k,item])=>[k,omit(item)])):v;
  data=omit(data);
 }
 if(new TextEncoder().encode(JSON.stringify(data)).byteLength>DATA_BYTE_LIMIT){
  // Preserve selection/counts and explicitly withhold detail, without advancing
  // pagination past an omitted row. The original remains in the private UI.
  data[key]=[];data.nextOffset=data.offset;data.detailOmitted='Underlaget överskrider svarets storleksgräns. Granska originalet i den privata arbetsytan.';
  if(data.registry)data.registry={matchCount:data.registry.matchCount,ambiguous:data.registry.ambiguous,complete:false,invoices:[]};
  if(data.sourceCandidates)data.sourceCandidates=[];
  if(data.provenance){
   for(const key of ['imports','sourceReceipts','observations','allocations','sourceLinks'])data.provenance[key].items=[];
   data.provenance.complete=false;data.provenance.nextOffset=data.provenance.offset;
   data.provenance.detailOmitted='Historiken överskrider svarets storleksgräns. Begär färre historikposter.';
  }
 }
 return data;
}

type ReportDocument={id:string;size:number;sha256:string;created_at:string};
type ReportReceipt={id:string;source_id:string;report_id:string;sha256:string;status:string;attempts:number;available_at:string|null;import_id:string|null;created_at:number;updated_at:number};
/** Project only retained bookkeeping. Source scope/generation/bindings and raw
 * provider payloads never leave the private storage boundary through history. */
async function reportReceiptSnapshot(owner:string,documentId:string,offset:number,limit:number){
 const database=db(),[count,rows]=await Promise.all([
  database.prepare('SELECT COUNT(*) total FROM bankgiro_ingest_jobs WHERE owner=? AND document_id=?').bind(owner,documentId).first<{total:number}>(),
  database.prepare('SELECT id,source_id,report_id,sha256,status,attempts,available_at,import_id,created_at,updated_at FROM bankgiro_ingest_jobs WHERE owner=? AND document_id=? ORDER BY created_at,id LIMIT ? OFFSET ?').bind(owner,documentId,limit,offset).all<ReportReceipt>(),
 ]);
 return {total:count?.total??0,items:rows.results};
}
function reportProvenance(state:State,document:ReportDocument,receipts:Awaited<ReturnType<typeof reportReceiptSnapshot>>,offset:number,limit:number){
 const byId=<T extends {id:string}>(items:T[])=>items.sort((a,b)=>a.id.localeCompare(b.id));
 const page=<T,>(items:T[])=>({total:items.length,items:items.slice(offset,offset+limit)});
 const instant=(value:number)=>Number.isSafeInteger(value)&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():null;
 const rows=byId(state.transactions.filter(row=>row.bankFileProof?.documentId===document.id)),ids=new Set(rows.map(row=>row.id));
 const economic=new Set(economicTransactions(state).map(row=>row.id));
 const imports=page(byId(state.imports.filter(record=>record.documentId===document.id)).map(record=>({importId:record.id,name:record.name,createdAt:record.createdAt,paymentCount:record.count,sha256:record.hash,originalHashMatches:record.hash===document.sha256})));
 const sourceReceipts={total:receipts.total,items:receipts.items.map(row=>({receiptId:row.id,sourceId:row.source_id,reportId:row.report_id,status:row.status,attempts:row.attempts,availableAt:row.available_at,receivedAt:instant(row.created_at),updatedAt:instant(row.updated_at),importId:row.import_id,sha256:row.sha256,originalHashMatches:row.sha256===document.sha256}))};
 const observations=page(rows.map(row=>({transactionId:row.id,importId:row.importId||null,originalHashMatches:row.bankFileProof?.sha256===document.sha256,parentTransactionId:row.parentId||null,specificationStatus:row.specificationStatus||null,countedEconomically:economic.has(row.id)})));
 const allocations=page(byId(state.allocations.filter(row=>ids.has(row.transactionId))).map(row=>{const invoice=state.invoices.find(invoice=>invoice.id===row.invoiceId);return {allocationId:row.id,transactionId:row.transactionId,invoiceId:row.invoiceId,invoicePresent:!!invoice,invoiceNumber:invoice?.number??null,amountCents:row.amount,effect:row.effect,active:row.active,createdAt:row.createdAt,reversedAt:row.reversedAt||null};}));
 const sourceLinks=page(byId((state.bankgiroLinks||[]).filter(link=>link.documentId===document.id)).map(link=>({linkId:link.id,transactionId:link.transactionId,method:link.method,originalHashMatches:link.sha256===document.sha256,createdAt:link.createdAt,revokedAt:link.revokedAt||null})));
 const more=[imports,sourceReceipts,observations,allocations,sourceLinks].some(part=>offset+limit<part.total);
 return {verificationScope:'retained_history_only',bankAuthenticityVerified:false,invoiceRelationshipVerified:false,original:{sizeBytes:document.size,retainedAt:document.created_at},offset,limit,imports,sourceReceipts,observations,allocations,sourceLinks,nextOffset:more?offset+limit:null,complete:!more,snapshotCurrent:true};
}
async function snapshotStillCurrent(owner:string,revision:number){
 const row=await db().prepare('SELECT revision FROM workspaces WHERE owner=?').bind(owner).first<{revision:number}>();
 return (row?.revision??0)===revision;
}

/** Owned stored evidence only: no provider, orchestration, lock or write path. */
export async function readPaymentEvidence(input:unknown){
 const args=argumentsFor(input,'payment'),{user,state,revision,base}=await context(),ref=typeof args.reference==='string'?args.reference:'';
 const sources=state.transactions.map(t=>({t,referenceSearch:referenceSearch(state,t,ref)}));
 let rows:(typeof sources[number]&{selection:string})[]=[];
 if(typeof args.transactionId==='string'){
  const source=sources.find(row=>row.t.id===args.transactionId);if(!source)throw Error('Bankhändelsen finns inte för ditt konto.');rows=[{...source,selection:'transaction_id'}];
 }else{
  rows=sources.flatMap(source=>{
   const {t}=source,exact=source.referenceSearch.matchedValues.length>0;
   const candidate=(args.amountCents!==undefined||args.date!==undefined)&&(args.amountCents===undefined||t.amount===args.amountCents)&&(args.date===undefined||t.date===args.date);
   return exact||candidate?[{...source,selection:exact?'exact_reference':'amount_date_candidate'}]:[];
  }).sort((a,b)=>Number(b.selection==='exact_reference')-Number(a.selection==='exact_reference')||a.t.id.localeCompare(b.t.id));
 }
 const exactCount=rows.filter(row=>row.selection==='exact_reference').length,payments=[];
 for(const {t,selection,referenceSearch}of rows.slice(args.offset,args.offset+args.limit)){
  const view=bankPaymentView(state,t),assessment=bankPaymentInvoiceAssessment(state,t),verification=await readPaymentVerification(user.userId,state,t.id);
  payments.push({transactionId:t.id,countedEconomically:verification.countedEconomically,selection,selectionIsProof:false,date:t.date,amountCents:t.amount,currency:t.currency,source:t.source,bankReference:t.bankReference,payer:view.payerKnown?view.payer:'',reference:view.reference,referenceSearch,registry:registry(state,view.reference.value),bookedInvoices:assessment.bookedInvoices.slice(0,20).map(i=>invoiceFact(state,i)),bookedInvoiceCount:assessment.bookedInvoices.length,allocationConflict:assessment.allocationConflict,verification:safeVerification(verification)});
 }
 const documents=await db().prepare("SELECT s.document_id,s.status,s.extraction,j.extraction job_extraction FROM gmail_sources s LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=? AND s.status<>'rejected' ORDER BY s.created_at DESC LIMIT 1001").bind(user.userId).all<any>();
 const sourceReference=ref||(payments.length===1?payments[0].reference.value:''),scanned=documents.results.slice(0,1000);
 const sourceCandidates=matchingDocumentCandidates(scanned,sourceReference).map(candidate=>({...candidate,originalVerified:false}));
 const referenceRegistry=registry(state,ref),next=args.offset+payments.length<rows.length?args.offset+payments.length:null,sourceComplete=documents.results.length<=1000&&sourceCandidates.length<=20,snapshotCurrent=await snapshotStillCurrent(user.userId,revision),referenceSearchComplete=(ref?sources:rows).every(row=>!row.referenceSearch.incomplete);
 return response(bounded(privateProjection({...base,offset:args.offset,limit:args.limit,total:rows.length,exactReferenceCount:exactCount,ambiguous:exactCount>1||referenceRegistry.ambiguous||rows.some(row=>row.referenceSearch.conflicting),referenceSearchComplete,candidateOnlyNotice:'Alla referenssökningar väljer endast granskningsförslag. Datum och belopp bevisar aldrig betalnings-, kund- eller fakturasamband.',registry:referenceRegistry,sourceCandidates:sourceCandidates.slice(0,20),sourceCandidateCount:sourceCandidates.length,sourceSearchComplete:sourceComplete,sourceSearchLimit:1000,snapshotCurrent,payments,nextOffset:next,complete:next===null&&referenceSearchComplete&&sourceComplete&&referenceRegistry.complete&&payments.every(p=>p.registry.complete&&p.bookedInvoiceCount<=20)&&snapshotCurrent},state),'payments'));
}

export async function readRetainedReportEvidence(input:unknown){
 const args=argumentsFor(input,'report'),{user,state,revision,base}=await context(),targetId=typeof args.transactionId==='string'?args.transactionId:'';
 if(targetId&&!state.transactions.some(t=>t.id===targetId))throw Error('Bankhändelsen finns inte för ditt konto.');
 const docs=typeof args.documentId==='string'
  ?await db().prepare('SELECT id,size,sha256,created_at FROM documents WHERE owner=? AND id=? LIMIT 2').bind(user.userId,args.documentId).all<ReportDocument>()
  :await db().prepare('SELECT id,size,sha256,created_at FROM documents WHERE owner=? AND sha256=? ORDER BY id LIMIT 2').bind(user.userId,args.sha256).all<ReportDocument>();
 if(!docs.results.length)throw Error('Originalet finns inte för ditt konto.');
 if(docs.results.length>1)return response({...base,ambiguous:true,complete:false,integrity:'not_checked',documentIds:docs.results.map(d=>d.id),rows:[],outputLimited:false});
 const document=docs.results[0],historyOffset=(args.historyOffset??0) as number,historyLimit=(args.historyLimit??10) as number;
 const receipts=await reportReceiptSnapshot(user.userId,document.id,historyOffset,historyLimit);
 const fresh=await bankgiroRetainedPreview(user.userId,docs.results[0].id,targetId),rows=fresh.rows.slice(args.offset,args.offset+args.limit).map((row:any,index:number)=>({rowIndex:args.offset+index,date:row.date,amountCents:row.amount,currency:row.currency,party:row.party,payerReference:row.payerReference,bankReference:row.bankReference,parentBankReference:row.parentBankReference,referenceEvidence:row.referenceEvidence,organizationNumber:row.organizationNumber,accountIssue:row.bankgiroAccountIssue||'',accountVerified:!row.bankgiroAccountIssue,registry:registry(state,row.payerReference)})),next=args.offset+rows.length<fresh.rows.length?args.offset+rows.length:null;
 const [latestDocument,latestReceipts]=await Promise.all([
  db().prepare('SELECT id,size,sha256,created_at FROM documents WHERE owner=? AND id=?').bind(user.userId,document.id).first<ReportDocument>(),
  reportReceiptSnapshot(user.userId,document.id,historyOffset,historyLimit),
 ]);
 const snapshotCurrent=await snapshotStillCurrent(user.userId,revision);
 const provenance=reportProvenance(state,document,receipts,historyOffset,historyLimit);
 provenance.snapshotCurrent=snapshotCurrent&&document.sha256===fresh.hash&&JSON.stringify(latestDocument)===JSON.stringify(document)&&JSON.stringify(receipts)===JSON.stringify(latestReceipts);
 provenance.complete&&=provenance.snapshotCurrent;
 return response(bounded(privateProjection({...base,documentId:fresh.documentId,name:fresh.name,sha256:fresh.hash,integrity:'passed',integrityMeaning:'Det ägda originalets storlek och kontrollsumma stämmer; detta bevisar inte bankens autenticitet.',ambiguous:false,targetTransactionId:targetId||null,targetRelationProved:false,offset:args.offset,limit:args.limit,total:fresh.rows.length,rows,nextOffset:next,snapshotCurrent,provenance,complete:next===null&&rows.every((r:any)=>r.registry.complete)&&snapshotCurrent&&provenance.complete},state,fresh.rows.flatMap((r:any)=>[r.account,r.recipientAccount,r.payerAccount].filter(Boolean))),'rows'));
}
