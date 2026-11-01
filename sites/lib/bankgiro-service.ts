import {readWorkspace,readBankOriginalBytes} from './server';
import {parseSpecificationBytes} from './bankgiro-parser.js';
import {applyCommand,emptyState,canonicalBankAccount,bankApiOriginalIssue,paymentEvidenceIssue,specificationPreview,type Command,type State,type Transaction} from './domain';
import {connection,accounts} from './banking/store';
import {stableAccountKey} from './banking/transactions';

async function activeAccounts(owner:string){
 const conn=await connection(owner);if(!conn)throw Error('En aktiv ägarbunden bankanslutning behövs för att kontrollera mottagarkontot.');
 const {application}=await import('./banking/store'),app=await application(owner);
 if(!app||conn.owner!==owner||app.owner!==owner||conn.status!=='connected'||conn.environment!=='PRODUCTION'||app.generation!==conn.app_generation||!(Date.parse(conn.valid_until)>Date.now()))throw Error('En aktiv ägarbunden bankanslutning behövs för att kontrollera mottagarkontot.');
 const selected=JSON.parse(conn.selected_accounts);if(!Array.isArray(selected))throw Error('Bankens valda mottagarkonto behöver granskas.');
 return {conn,selected,available:await accounts(conn)};
}
/** Stored consent/account resources only. This never contacts the bank provider. */
export async function bankgiroAutomaticAccountIssue(owner:string,account:string){
 try{const {conn,selected,available}=await activeAccounts(owner);return available.filter(item=>selected.includes(item.uid)&&item.currency==='SEK'&&stableAccountKey(item,{name:conn.bank_name,country:conn.country})===canonicalBankAccount(account)).length===1?'':'Bankhändelsens konto ingår inte entydigt i ägarens aktiva bankmedgivande.';}catch{return 'En aktiv ägarbunden bankanslutning och ett verifierat mottagarkonto krävs före automatisk rapportkoppling.';}
}
async function resolveAccounts(owner:string,rows:any[]){
 let context:Awaited<ReturnType<typeof activeAccounts>>;try{context=await activeAccounts(owner);}catch{return rows.map(row=>({...row,bankgiroAccountIssue:'En aktiv ägarbunden bankanslutning och ett verifierat mottagarkonto krävs före automatisk rapportkoppling.'}));}
 const {conn,selected,available}=context;
 return rows.map(r=>{
  const raw=String(r.account||'').replace(/^iban:/i,'').replace(/[\s-]/g,'').toUpperCase();if(!raw)return {...r,bankgiroAccountIssue:'Mottagarkonto saknas i rapportoriginalet.'};
  const matches=available.filter(a=>selected.includes(a.uid)&&a.currency==='SEK'&&[a.account_id?.iban,a.account_id?.other?.identification,...(a.all_account_ids||[]).filter(i=>['IBAN','BBAN','CPAN'].includes(i.scheme_name?.toUpperCase())).map(i=>i.identification)].some(x=>x&&x.replace(/[\s-]/g,'').toUpperCase()===raw));
  const key=matches.length===1?stableAccountKey(matches[0],{name:conn.bank_name,country:conn.country}):null;
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
 if(fresh.length!==rows.length||JSON.stringify(fresh.map(bankgiroObservation).sort())!==JSON.stringify(rows.map(bankgiroObservation).sort()))throw Error('Specifikationens uppgifter stämmer inte med det bevarade originalet. Importera eller granska originalet på nytt.');
 return {type:'bankgiro.link',transactionId:target.id,specificationId:specification.id,specificationIds:rows.map(row=>row.id),note:input.note,confirmOriginals:input.confirmOriginals===true,confirmAccount:input.confirmAccount===true,dateDifferenceNote:input.dateDifferenceNote??''};
}
