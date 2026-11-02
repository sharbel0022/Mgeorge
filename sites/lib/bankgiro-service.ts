import {readWorkspace,readBankOriginalBytes} from './server';
import {parseSpecificationBytes} from './bankgiro-parser.js';
import {applyCommand,emptyState,canonicalBankAccount,bankApiOriginalIssue,paymentEvidenceIssue,specificationPreview,type Command,type State,type Transaction} from './domain';
import {connection,accounts} from './banking/store';
import {stableAccountKey} from './banking/transactions';

async function activeAccounts(owner:string){
 const current=await connection(owner),conn=current?{...current}:null;if(!conn)throw Error('En aktiv ägarbunden bankanslutning behövs för att kontrollera mottagarkontot.');
 const {application}=await import('./banking/store'),app=await application(owner);
 if(!app||conn.owner!==owner||app.owner!==owner||conn.status!=='connected'||conn.environment!=='PRODUCTION'||app.generation!==conn.app_generation||!(Date.parse(conn.valid_until)>Date.now()))throw Error('En aktiv ägarbunden bankanslutning behövs för att kontrollera mottagarkontot.');
 const selected=JSON.parse(conn.selected_accounts);if(!Array.isArray(selected))throw Error('Bankens valda mottagarkonto behöver granskas.');
 return {conn,selected,available:await accounts(conn)};
}
type AccountContext=Awaited<ReturnType<typeof activeAccounts>>;
const reportedAccountKey=(value:unknown)=>typeof value==='string'?value.replace(/^iban:/i,'').replace(/[\s-]/g,'').toUpperCase():'';
function identifierKeys(resource:AccountContext['available'][number]){
 return [
  {scheme_name:'IBAN',identification:resource.account_id?.iban},resource.account_id?.other,...(Array.isArray(resource.all_account_ids)?resource.all_account_ids:[]),
 ].flatMap(identifier=>{
  if(typeof identifier?.scheme_name!=='string'||!['IBAN','BBAN','CPAN'].includes(identifier.scheme_name.toUpperCase())||typeof identifier.identification!=='string')return [];
  const key=identifier.identification.replace(/[\s-]/g,'').toUpperCase();return /^[A-Z0-9]{1,80}$/.test(key)?[key]:[];
 });
}
function currentAccountIssue(context:AccountContext,account:string,reportedAccount?:string){
 const {conn,selected,available}=context;
 const matches=available.filter(item=>selected.includes(item.uid)&&item.currency==='SEK'&&stableAccountKey(item,{name:conn.bank_name,country:conn.country})===canonicalBankAccount(account));
 if(matches.length!==1)return 'Bankhändelsens konto ingår inte entydigt i ägarens aktiva bankmedgivande.';
 // An omitted identifier belongs to an AIS/direct source. An empty report
 // identifier is missing evidence and must never fall back to the resolved IBAN.
 if(reportedAccount!==undefined){
  const raw=reportedAccountKey(reportedAccount);if(!raw)return 'Mottagarkonto saknas i rapportoriginalet.';
  const holders=available.filter(resource=>identifierKeys(resource).includes(raw));
  if(holders.length!==1||holders[0]!==matches[0])return 'Rapportens mottagarkonto saknar ett entydigt banklevererat kontoalias till ägarens aktuella valda konto.';
 }
 return '';
}
/** Stored consent/account resources only. This never contacts the bank provider. */
export async function bankgiroAutomaticAccountIssue(owner:string,account:string,reportedAccount?:string){
 try{return currentAccountIssue(await activeAccounts(owner),account,reportedAccount);}catch{return 'En aktiv ägarbunden bankanslutning och ett verifierat mottagarkonto krävs före nya betalningskopplingar.';}
}
/** Capture exactly the stored consent whose decoded account resource was checked.
 * The financial writer compares it again inside its atomic D1 batch. */
export async function bankAccountConsentSnapshot(owner:string,account:string,reportedAccount?:string){
 const context=await activeAccounts(owner),issue=currentAccountIssue(context,account,reportedAccount);if(issue)throw Error(issue);
 return context.conn;
}
async function resolveAccounts(owner:string,rows:any[]){
 let context:AccountContext;try{context=await activeAccounts(owner);}catch{return rows.map(row=>({...row,bankgiroAccountIssue:'En aktiv ägarbunden bankanslutning och ett verifierat mottagarkonto krävs före automatisk rapportkoppling.'}));}
 const {conn,selected,available}=context;
 return rows.map(r=>{
  const raw=reportedAccountKey(r.account);if(!raw)return {...r,bankgiroAccountIssue:'Mottagarkonto saknas i rapportoriginalet.'};
  // An alias must belong to one provider resource, including resources that
  // are unselected or use another currency. Account selection cannot erase ambiguity.
  const holders=available.filter(resource=>identifierKeys(resource).includes(raw)),match=holders.length===1?holders[0]:undefined;
  const key=match&&selected.includes(match.uid)&&match.currency==='SEK'?stableAccountKey(match,{name:conn.bank_name,country:conn.country}):null;
  return key?{...r,recipientAccount:r.account,account:key,bankgiroAccountIssue:''}:{...r,bankgiroAccountIssue:'Rapportens mottagarkonto ingår inte entydigt i ägarens aktiva bankmedgivande.'};
 });
}

export async function readBankgiroOriginal(owner:string,command:Command){
 const doc=await readBankOriginalBytes(owner,command.documentId);
 const rows=await resolveAccounts(owner,parseSpecificationBytes(doc.bytes,doc.filename));
 return {...command,rows,hash:doc.sha256,name:doc.filename};
}
export async function bankgiroPreview(owner:string,file:File,targetId:string){
 const bytes=await file.arrayBuffer(),rows=await resolveAccounts(owner,parseSpecificationBytes(bytes,file.name)),{state,revision}=await readWorkspace(owner);
 const preview=specificationPreview(state,rows,targetId);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 return {rows,preview,revision,hash,duplicate:state.imports.some(i=>i.hash===hash)};
}
/** Inspect an owned retained original without importing, linking or contacting a provider. */
export async function bankgiroRetainedPreview(owner:string,documentId:string,targetId=''){
 const validId=(value:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(value);
 if(!validId(documentId)||targetId&&!validId(targetId))throw Error('Välj ett giltigt sparat bankoriginal och en giltig bankhändelse.');
 const {state,revision}=await readWorkspace(owner);
 if(targetId&&!state.transactions.some(row=>row.id===targetId))throw Error('Bankhändelsen finns inte för ditt konto.');
 const doc=await readBankOriginalBytes(owner,documentId),rawRows=parseSpecificationBytes(doc.bytes,doc.filename),rows=await resolveAccounts(owner,rawRows);
 return {documentId,name:doc.filename,rawRows,rows,preview:specificationPreview(state,rows,targetId),revision,hash:doc.sha256,duplicate:state.imports.some(i=>i.hash===doc.sha256)};
}

const bankgiroObservation=(row:Transaction)=>JSON.stringify(Object.fromEntries(['date','amount','currency','party','payerReference','bankReference','parentBankReference','recipientBankgiro','payerBankgiro','payerAccount','remittanceMessage','settlementDate','format','organizationNumber','referenceEvidence','referenceParts','payerEvidence','reportEvidence','specificationGroup','specificationCount','specificationTotal','recipientAccount','account','original','bankDetails'].map(key=>[key,row[key as keyof Transaction]??null])));
/** Accept only the exact earlier label-cell receipt derived from this freshly
 * parsed original. Other source cells and every payment fact remain exact. */
function sameBankgiroObservations(rows:Transaction[],fresh:Transaction[]){
 const unmatched=rows.map(bankgiroObservation);
 for(const row of fresh){
  const expected=[bankgiroObservation(row)],report=row.reportEvidence;
  if(row.format==='Swedbank Bankgiro XLSX'&&report?.profile==='Swedbank Bankgiro XLSX'){
   try{
    const cells=JSON.parse(report.sourceCells||'{}');
    if(cells.sequenceLabel&&cells.sequence){
     const legacy={...cells,sequence:cells.sequenceLabel};delete legacy.sequenceLabel;
     expected.push(bankgiroObservation({...row,reportEvidence:{...report,sourceCells:JSON.stringify(legacy)}}));
    }
   }catch{/* An unknown representation never receives a compatibility bypass. */}
  }
  const index=unmatched.findIndex(value=>expected.includes(value));if(index<0)return false;unmatched.splice(index,1);
 }
 return unmatched.length===0;
}
/** Reconstruct metadata commands from this owner's retained sources. No provider request. */
export async function prepareBankgiroLinkCommand(owner:string,state:State,input:Command):Promise<Command>{
 if(input.type==='bankgiro.unlink'){
  const link=state.bankgiroLinks?.find(link=>link.id===input.id);if(!link)throw Error('Underlagskopplingen finns inte för ditt konto.');
  return {type:'bankgiro.unlink',id:link.id,note:input.note,transactionId:link.transactionId,specificationIds:[...link.specificationIds]};
 }
 const target=state.transactions.find(row=>row.id===input.transactionId),specification=state.transactions.find(row=>row.id===input.specificationId&&row.specification);
 if(!target||!specification)throw Error('Bankhändelsen eller specifikationen finns inte för ditt konto.');
 const originalIssue=bankApiOriginalIssue(target)||paymentEvidenceIssue(state,target);if(originalIssue)throw Error(originalIssue);
 if(!target.bankData||!target.bankDataSha256||!target.bankDataVersion)throw Error('AIS-originalet saknar verifierbart ankomstkvitto.');
 const accountIssue=await bankgiroAutomaticAccountIssue(owner,target.account);if(accountIssue)throw Error(accountIssue);
 const rows=state.transactions.filter(row=>row.specification&&row.importId===specification.importId&&row.specificationGroup===specification.specificationGroup),proof=specification.bankFileProof;
 if(!proof||rows.some(row=>row.bankFileProof?.documentId!==proof.documentId||row.bankFileProof?.sha256!==proof.sha256))throw Error('Specifikationens originalkoppling behöver granskas.');
 const original=await readBankgiroOriginal(owner,{type:'bankgiro.import',documentId:proof.documentId});
 if(original.hash!==proof.sha256)throw Error('Specifikationens kontrollsumma stämmer inte med det bevarade originalet.');
 const fresh=applyCommand(emptyState(),original).state.transactions.filter(row=>row.specificationGroup===specification.specificationGroup);
 const freshAccountIssue=fresh.find(row=>row.bankgiroAccountIssue)?.bankgiroAccountIssue;if(freshAccountIssue)throw Error(freshAccountIssue);
 if(fresh.length!==rows.length||!sameBankgiroObservations(rows,fresh))throw Error('Specifikationens uppgifter stämmer inte med det bevarade originalet. Importera eller granska originalet på nytt.');
 return {type:'bankgiro.link',transactionId:target.id,specificationId:specification.id,specificationIds:rows.map(row=>row.id),note:input.note,confirmOriginals:input.confirmOriginals===true,confirmAccount:input.confirmAccount===true,dateDifferenceNote:input.dateDifferenceNote??''};
}
