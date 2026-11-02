import {activeBankgiroLink,bankgiroLinkCandidates,hasBankApiOrigin,paymentOriginalIssue,paymentEvidenceConflict,type State} from './domain';
import type {PaymentVerification} from './payment-verification';
export type AccountEvidenceTarget={transactionId:string;documentId:string};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Select existing evidence only. Date/amount candidates confer no bank identity. */
export function accountEvidenceTarget(state:State,transactionId:string):AccountEvidenceTarget|undefined{
 const target=state.transactions.find(t=>t.id===transactionId);
 if(!target||target.parentId||target.ignored||target.duplicateOf||!hasBankApiOrigin(target)||paymentOriginalIssue(state,target)||paymentEvidenceConflict(state,target))return;
 const linked=activeBankgiroLink(state,transactionId),candidates=bankgiroLinkCandidates(state,target);
 const related=state.transactions.filter(row=>row.parentId===transactionId&&row.specification&&!row.ignored&&!row.duplicateOf);
 const rows=linked?.rows.length?linked.rows:related.length?related:candidates.length===1?candidates[0].rows:[];
 const documents=new Set(rows.map(row=>row.bankFileProof?.documentId));
 if(!rows.length||documents.size!==1||!id([...documents][0]))return;
 return {transactionId,documentId:[...documents][0]!};
}
export function storedVerification(value:unknown,transactionId:string,revision:number):value is PaymentVerification&{revision:number}{
 if(!object(value)||value.transactionId!==transactionId||value.revision!==revision||value.mode!=='preview'||value.changed!==false||typeof value.countedEconomically!=='boolean'||!Array.isArray(value.steps)||value.steps.length!==11)return false;
 if(!value.steps.every(step=>object(step)&&['id','label','statusLabel','source','checkedAt','rule','reason','next'].every(key=>typeof step[key]==='string')&&['passed','missing','blocked','review','manual','not_required'].includes(String(step.status))&&Array.isArray(step.facts)&&step.facts.every(fact=>object(fact)&&typeof fact.label==='string'&&typeof fact.value==='string')))return false;
 const hint=value.invoiceHint;
 if(hint!==undefined&&(!object(hint)||typeof hint.number!=='string'||!hint.number.trim()||hint.number.length>100||typeof hint.proposal!=='boolean'))return false;
 const target=value.accountEvidenceTarget;
 return target===undefined||object(target)&&target.transactionId===transactionId&&id(target.documentId)&&Object.keys(target).every(key=>['transactionId','documentId'].includes(key));
}
export type AccountEvidenceDisplay={verified:boolean;status:string;checkedAt:string|null;complete:boolean;reason:string;source:string;next:string};
export const unknownAccountEvidence=():AccountEvidenceDisplay=>({verified:false,status:'unknown',checkedAt:null,complete:false,reason:'Den aktuella kontokontrollen kunde inte verifieras. Sparade uppgifter har inte ändrats.',source:'Aktuell bankläsning',next:'Försök igen uttryckligen eller granska bankens original och aktuella medgivande.'});
/** Whitelist display fields. An HTTP success alone never verifies an account. */
export function accountEvidenceDisplay(value:unknown,target:AccountEvidenceTarget,revision:number):AccountEvidenceDisplay{
 if(!object(value)||value.transactionId!==target.transactionId||value.documentId!==target.documentId||value.revision!==revision||value.changed!==false||typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt))||value.sourceScope!=='current_owned_ais_consent'||!['matched','missing','blocked','stale','mismatch','incomplete','ambiguous','error'].includes(String(value.status))||typeof value.complete!=='boolean'||typeof value.accountMatch!=='boolean'||typeof value.ambiguous!=='boolean'||typeof value.providerContacted!=='boolean'||!Array.isArray(value.rows))return unknownAccountEvidence();
 const verified=value.status==='matched'&&value.snapshotCurrent===true&&value.complete===true&&value.accountMatch===true&&value.ambiguous===false&&value.providerContacted===true&&Number.isSafeInteger(value.reportRowCount)&&Number(value.reportRowCount)>=1&&Number(value.reportRowCount)<=50&&value.rows.length===value.reportRowCount&&Number.isSafeInteger(value.resourcesRead)&&Number(value.resourcesRead)>=1&&Number(value.resourcesRead)<=5&&value.resourcesRead===value.resourcesTotal&&value.rows.every((row,index)=>object(row)&&row.rowIndex===index&&row.status==='matched'&&row.matched===true&&row.ambiguous===false&&row.sourceScope==='current_owned_ais_consent'&&['IBAN','BBAN','CPAN'].includes(String(row.scheme))&&typeof row.sourcePath==='string');
 if(value.status==='matched'&&!verified)return unknownAccountEvidence();
 return {verified,status:verified?'matched':value.status==='matched'?'unknown':String(value.status),checkedAt:value.checkedAt,complete:value.complete,source:'Bankens aktuella ägda AIS-medgivande',reason:verified?'Bankens aktuella kontouppgifter motsvarar rapportens uttryckliga mottagarkonto. Detta bevisar inte samma insättning eller kundrelation.':typeof value.reason==='string'&&value.reason.length<=1000?value.reason:'Kontot har inte kunnat verifieras entydigt i denna läsning.',next:verified?'Granska samma insättning, kund och faktura separat. Resultatet sparas inte som kontoalias.':'Granska originalet och bankens aktuella kontouppgifter. Gör en ny uttrycklig kontroll vid behov.'};
}
