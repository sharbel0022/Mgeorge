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
// Only the bounded diagnostic contract is displayable. Reading descriptors
// avoids invoking getters on malformed client values; raw fields are never copied.
function retryNext(value:Record<string,unknown>):string|undefined{
 if(value.status!=='error'||value.errorCode!=='BANK_RATE_LIMIT'||value.providerContacted!==true||!['session','account_details'].includes(String(value.stage))||value.complete!==false||value.accountMatch!==false||value.ambiguous!==false||!Array.isArray(value.rows)||value.rows.length!==0)return;
 const unknown='Bankens uttryckliga väntetid är okänd. Kontrollera väntetiden med banken innan du begär en ny kontokontroll. Ingen automatisk omhämtning görs.';
 try{
  const property=Object.getOwnPropertyDescriptor(value,'retryAdvice'),advice=property&&'value'in property?property.value:undefined;
  if(!object(advice)||![Object.prototype,null].includes(Object.getPrototypeOf(advice)))return unknown;
  const fields=Object.getOwnPropertyDescriptors(advice),keys=Reflect.ownKeys(fields);
  if(keys.some(key=>typeof key!=='string')||Object.values(fields).some(field=>!('value'in field)))return unknown;
  const status=fields.status?.value,provenance=fields.provenance?.value,checkedAt=fields.checkedAt?.value,notBefore=fields.notBefore?.value;
  const expected=status==='known'?['status','checkedAt','notBefore','provenance']:['status','checkedAt','provenance'];
  if(keys.length!==expected.length||keys.some(key=>!expected.includes(String(key))))return unknown;
  const timestamp=(input:unknown):number|null=>{if(typeof input!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input))return null;const parsed=Date.parse(input);return Number.isFinite(parsed)&&new Date(parsed).toISOString()===input?parsed:null;};
  const checked=timestamp(checkedAt),responseAt=timestamp(value.checkedAt);
  // A diagnostic from an older response cannot be attached to a current result.
  if(checked===null||responseAt===null||checked>responseAt||responseAt-checked>60_000)return unknown;
  if(status==='manual_block'&&provenance==='retry_after_exceeds_limit')return 'Bankens väntetid kräver manuell kontroll. Kontrollera väntetiden med banken innan en ny kontokontroll begärs. Ingen automatisk omhämtning görs.';
  if(status==='unknown'&&['retry_after_missing','retry_after_invalid'].includes(provenance))return unknown;
  if(status!=='known'||!['retry_after_seconds','retry_after_http_date'].includes(provenance))return unknown;
  const deadline=timestamp(notBefore);
  if(deadline===null||deadline<checked||deadline-checked>365*86400*1000)return unknown;
  const format=(time:number)=>new Date(time).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'}),source=provenance==='retry_after_seconds'?'sekunder':'HTTP-datum';
  if(deadline<=Date.now())return `Bankens tidigare Retry-After-gräns (${source}), kontrollerad av servern ${format(checked)} svensk tid, har passerat. Kontrollera aktuell väntetid och medgivande innan du begär en ny uttrycklig kontokontroll. Ingen automatisk omhämtning görs.`;
  return `Vänta minst till ${format(deadline)} svensk tid enligt bankens Retry-After (${source}), kontrollerad av servern ${format(checked)} svensk tid. Kontrollera aktuellt medgivande och begär därefter en ny uttrycklig kontokontroll vid behov. Ingen automatisk omhämtning görs.`;
 }catch{return unknown;}
}
/** Whitelist display fields. An HTTP success alone never verifies an account. */
export function accountEvidenceDisplay(value:unknown,target:AccountEvidenceTarget,revision:number):AccountEvidenceDisplay{
 if(!object(value)||value.transactionId!==target.transactionId||value.documentId!==target.documentId||value.revision!==revision||value.changed!==false||typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt))||value.sourceScope!=='current_owned_ais_consent'||!['matched','missing','blocked','stale','mismatch','incomplete','ambiguous','error'].includes(String(value.status))||typeof value.complete!=='boolean'||typeof value.accountMatch!=='boolean'||typeof value.ambiguous!=='boolean'||typeof value.providerContacted!=='boolean'||!Array.isArray(value.rows))return unknownAccountEvidence();
 const verified=value.status==='matched'&&value.snapshotCurrent===true&&value.complete===true&&value.accountMatch===true&&value.ambiguous===false&&value.providerContacted===true&&Number.isSafeInteger(value.reportRowCount)&&Number(value.reportRowCount)>=1&&Number(value.reportRowCount)<=50&&value.rows.length===value.reportRowCount&&Number.isSafeInteger(value.resourcesRead)&&Number(value.resourcesRead)>=1&&Number(value.resourcesRead)<=5&&value.resourcesRead===value.resourcesTotal&&value.rows.every((row,index)=>object(row)&&row.rowIndex===index&&row.status==='matched'&&row.matched===true&&row.ambiguous===false&&row.sourceScope==='current_owned_ais_consent'&&['IBAN','BBAN','CPAN'].includes(String(row.scheme))&&typeof row.sourcePath==='string');
 if(value.status==='matched'&&!verified)return unknownAccountEvidence();
 return {verified,status:verified?'matched':value.status==='matched'?'unknown':String(value.status),checkedAt:value.checkedAt,complete:value.complete,source:'Bankens aktuella ägda AIS-medgivande',reason:verified?'Bankens aktuella kontouppgifter motsvarar rapportens uttryckliga mottagarkonto. Detta bevisar inte samma insättning eller kundrelation.':typeof value.reason==='string'&&value.reason.length<=1000?value.reason:'Kontot har inte kunnat verifieras entydigt i denna läsning.',next:verified?'Granska samma insättning, kund och faktura separat. Resultatet sparas inte som kontoalias.':retryNext(value)||'Granska originalet och bankens aktuella kontouppgifter. Gör en ny uttrycklig kontroll vid behov.'};
}
