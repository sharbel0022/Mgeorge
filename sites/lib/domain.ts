export {readBankgiroSourceEvidence} from './bankgiro-source-evidence.js';
import {bankApiOriginalIssue as apiOriginalIssue,bankApiDataHash,hasBankApiOrigin,bankFileReferenceHash,BANK_API_ORIGINAL_VERSION,OPENPAYMENTS_ORIGINAL_VERSION} from './bank-api-original.js';
export {hasBankApiOrigin} from './bank-api-original.js';
export const bankApiOriginalIssue=(t:Transaction)=>apiOriginalIssue(t,suspectedBankCollection,PAYMENT_SPECIFICATION_REQUIRED);
import {exactReference,normalizeName} from './reconciliation-engine.js';
import {matchingReferenceValues} from './payment-references.js';
import {randomUuid} from './uuid.js';
import {payerEvidenceConflict} from './payer-evidence.js';
import {bankgiroDepositIdentity} from './bankgiro-deposit-identity.js';
import {resolveInvoiceReference,matchesInvoiceReference,strictInvoiceReferenceMatch,validateInvoiceReferencePolicies,type InvoiceReferencePolicy,type InvoiceReferenceInput} from './invoice-reference-policy.js';
export type Invoice = {
 id: string; direction: "receivable" | "payable"; party: string; email: string; number: string; ocr: string;
 total: number; currency: "SEK"; issued: string; due: string; reviewed: boolean; voided: boolean;
 referenceOriginal?:InvoiceReferenceInput['original'];
 organizationNumber?:string;vat?:number|null;net?:number|null;reconciledAt?:string;reconciliationNote?:string;note: string; bankgiro: string; documentId: string; source: string; createdAt: string;
};
export type Transaction = {
 bankgiroEnrichmentIssue?:string;
 enrichmentEvidence?:Record<string,unknown>;
 rawBankData?:Record<string,unknown>;
 bankgiroAccountIssue?:string;
 bankAccountIssue?:string;
 payerEvidence?:ReturnType<typeof import('./payer-evidence.js').normalizePayerEvidence>;
 automaticMatchHold?:{at:string;reason:string};
 bankOriginalIssue?:string;
 bankDataSha256?:string;bankDataVersion?:string;
 bankEvidenceConflicts?:{at:string;fields:string[];incoming:Pick<Transaction,'date'|'amount'|'currency'|'party'|'payerReference'|'bankReference'|'description'|'account'|'externalId'|'referenceEvidence'|'bankData'|'bankDataSha256'|'bankDataVersion'|'organizationNumber'|'importId'|'source'|'reportEvidence'|'bankFileProof'|'payerAccount'|'remittanceMessage'|'parentBankReference'|'payerEvidence'|'rawBankData'|'enrichmentEvidence'>}[];
 reportEvidence?:Record<string,string>;
 bankFileProof?:{version:'bank-file-original-v1';documentId:string;sha256:string;reviewedAt?:string;referenceEvidenceSha256?:string};
 bankDetails?:{payerEvidence?:ReturnType<typeof import('./payer-evidence.js').normalizePayerEvidence>;referenceEvidence?:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;status:'identified'|'missing'|'unsupported';checkedAt:string;party:string;payerReference:string;referenceSchema:string;reason:string;documentId:string;bankReferenceText:string};
 referenceEvidence?:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;bankData?:Record<string,unknown>;referenceParts?:{value:string;source:string;kind:string}[];specification?:boolean;specificationStatus?:'linked'|'review';specificationGroup?:string;specificationCount?:number;specificationTotal?:number;parentBankReference?:string;recipientBankgiro?:string;payerBankgiro?:string;payerAccount?:string;remittanceMessage?:string;settlementDate?:string;format?:string;recipientAccount?:string;
 id: string; date: string; amount: number; currency: "SEK"; party: string; payerReference: string; bankReference: string;
 description: string; source: string; externalId: string; account: string; kind: "payment" | "batch" | "unknown";
 evidence?:string;organizationNumber?:string;original?:{party:string;payerReference:string;description:string;amount:number;date:string;account:string;bankReference:string};verification?:{party:string;payerReference:string;note:string;at:string};verified: boolean; duplicateOf: string; ignored: boolean; parentId: string; importId: string; createdAt: string;
};
export type Allocation = {id:string;invoiceId:string;transactionId:string;amount:number;effect:"payment"|"refund";active:boolean;note:string;createdAt:string;reversedAt?:string};
export type Credit = {id:string;invoiceId:string;amount:number;number:string;note:string;date:string;active:boolean};
export type ImportRecord = {id:string;hash:string;account:string;name:string;count:number;createdAt:string;documentId?:string;enrichment?:Record<string,unknown>};
/** A human decision about retained sources, never a financial allocation or bank identity. */
export type BankgiroLink = {id:string;method:'manual_review';transactionId:string;specificationIds:string[];documentId:string;sha256:string;reportKey?:string;note:string;dateDifferenceNote:string;createdAt:string;transactionSnapshot:string;specificationSnapshots:Record<string,string>;revokedAt?:string;revocationNote?:string};
export type State = {schemaVersion:1;company:{id?:string;name:string;email:string;invoiceReferencePolicies?:InvoiceReferencePolicy[]};invoices:Invoice[];transactions:Transaction[];allocations:Allocation[];credits:Credit[];imports:ImportRecord[];receipts:string[];bankgiroLinks?:BankgiroLink[];bankEvidenceHold?:{at:string;auditEventId:string;fingerprint:string}};
export type Command = {type:string;[key:string]:any};
/** A rejected import may add evidence holds, never any of its attempted money. */
export class BankImportEvidenceError extends Error{
 readonly state:State;
 constructor(message:string,state:State){super(message);this.name='BankImportEvidenceError';this.state=state;}
}
export const emptyState=():State=>({schemaVersion:1,company:{name:"M.George Vitvaror AB",email:"mg.vitvaror@gmail.com"},invoices:[],transactions:[],allocations:[],credits:[],imports:[],receipts:[]});
export const uid=randomUuid;
export const now=()=>new Date().toISOString();
function bankConflictChanges(current:State,attempted:State){
 return current.transactions.flatMap(previous=>{
  const known=new Set((previous.bankEvidenceConflicts||[]).map(conflict=>JSON.stringify(conflict)));
  const conflicts=(attempted.transactions.find(t=>t.id===previous.id)?.bankEvidenceConflicts||[]).filter(conflict=>!known.has(JSON.stringify(conflict)));
  return conflicts.length?[{transactionId:previous.id,conflicts:structuredClone(conflicts)}]:[];
 });
}
/** Copy only newly observed contradictions onto the previous financial state. */
export function bankImportEvidenceError(current:State,attempted:State,message:string){
 const changes=bankConflictChanges(current,attempted);if(!changes.length)return null;
 const state=structuredClone(current);
 for(const change of changes){const t=state.transactions.find(t=>t.id===change.transactionId)!;t.bankEvidenceConflicts=[...(t.bankEvidenceConflicts||[]),...change.conflicts];}
 return new BankImportEvidenceError(message,state);
}
/** A fixed safety marker has a 256-byte reserve; arbitrary import data never does. */
export async function prepareBankImportFailure(current:State,attempted:State,auditEventId:string){
 const failure=bankImportEvidenceError(current,attempted,'Bankimporten har motstridiga underlag.');if(!failure)throw Error('Bankimporten saknar nytt konfliktunderlag.');
 const conflicts=bankConflictChanges(current,failure.state);
 const comparable=conflicts.map(entry=>({transactionId:entry.transactionId,conflicts:entry.conflicts.map(({fields,incoming})=>({fields,incoming:{...incoming,importId:undefined}}))}));
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(comparable))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 let state=failure.state,payload=JSON.stringify(state),compact=false;
 if(new TextEncoder().encode(payload).length>1_800_000){
  state=structuredClone(current);state.bankEvidenceHold={at:now(),auditEventId,fingerprint};payload=JSON.stringify(state);compact=true;
  if(new TextEncoder().encode(payload).length>1_800_256)throw Error('Registret överskrider säkerhetsreservens gräns. Konfliktunderlaget kräver administratörens granskning.');
 }
 return {state,payload,conflicts,compact,replayed:current.bankEvidenceHold?.fingerprint===fingerprint};
}
export function today(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Stockholm",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
export function money(ore:number){return new Intl.NumberFormat("sv-SE",{style:"currency",currency:"SEK",minimumFractionDigits:2,maximumFractionDigits:2}).format(ore/100);}
export function parseMoney(value:string|number):number{
 let s=String(value).trim().replace(/(?:SEK|kr)/gi,"").replace(/[\s\u00a0\u202f]/g,"").replace(/−/g,"-");
 if(/^\(.*\)$/.test(s))s="-"+s.slice(1,-1);
 if(s.includes(",")){if(!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/.test(s))throw new Error("Ogiltigt belopp. Använd till exempel 1 875,00.");s=s.replace(/\./g,"").replace(",",".");}
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))throw new Error("Ogiltigt belopp. Använd högst två decimaler.");
 const negative=s.startsWith("-"),[a,b=""]=s.replace(/^-/ ,"").split(".");
 const n=(Number(a)*100+Number(b.padEnd(2,"0")))*(negative?-1:1);
 if(!Number.isSafeInteger(n)||Math.abs(n)>100_000_000_000)throw new Error("Beloppet är för stort.");return n;
}
export function validDate(s:string,optional=false){if(optional&&!s)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+"T12:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
const str=(v:unknown,max=500)=>{if(typeof v!=="string"||v.length>max)throw new Error("Ett textfält saknas eller är för långt.");return v.trim();};
const cents=(v:unknown,positive=true)=>{if(!Number.isSafeInteger(v)||Math.abs(v as number)>100_000_000_000||(positive?(v as number)<=0:(v as number)===0))throw new Error("Beloppet måste vara giltigt och anges i hela ören.");return v as number;};
const date=(v:unknown,optional=false)=>{const s=str(v,10);if(!validDate(s,optional))throw new Error("Kontrollera datumet.");return s;};
const getInvoice=(s:State,id:string)=>{const i=s.invoices.find(i=>i.id===id);if(!i)throw new Error("Fakturan finns inte.");return i;};
const getTx=(s:State,id:string)=>{const t=s.transactions.find(t=>t.id===id);if(!t)throw new Error("Bankhändelsen finns inte.");return t;};
export function paid(s:State,id:string){return s.allocations.filter(a=>a.invoiceId===id&&a.active).reduce((n,a)=>n+a.amount*(a.effect==="refund"?-1:1),0);}
export function credited(s:State,id:string){return s.credits.filter(c=>c.invoiceId===id&&c.active).reduce((n,c)=>n+c.amount,0);}
export function balance(s:State,i:Invoice){return i.total-credited(s,i.id)-paid(s,i.id);}
export function available(s:State,t:Transaction){return Math.abs(t.amount)-s.allocations.filter(a=>a.transactionId===t.id&&a.active).reduce((n,a)=>n+a.amount,0);}
export function invoiceStatus(s:State,i:Invoice,at=today()):{key:string;label:string;tone:string}{
 if(i.voided)return{key:"voided",label:"Makulerad",tone:"neutral"};if(!i.reviewed)return{key:"review",label:"Granska faktura",tone:"amber"};
 if(s.allocations.some(a=>a.active&&a.invoiceId===i.id)&&invoicePaymentEvidenceIssue(s,i.id))return{key:"review",label:"Granska betalningsunderlag",tone:"amber"};
 const b=balance(s,i);if(b<0)return{key:"refund",label:"Återbetalning",tone:"purple"};
 if(b===0)return{key:"paid",label:credited(s,i.id)===i.total&&paid(s,i.id)===0?"Krediterad":"Betald",tone:"green"};
 if(paid(s,i.id)>0)return{key:"partial",label:i.due&&i.due<at?"Delbetald · förfallen":"Delbetald",tone:"blue"};
 if(!hasValidAbsenceCheck(s,i))return{key:"unreconciled",label:"Ej avstämd",tone:"amber"};
 if(i.due&&i.due<at)return{key:"overdue",label:paid(s,i.id)>0?"Delbetald · förfallen":"Obetald efter verifierad kontroll · förfallen",tone:"red"};
 if(paid(s,i.id)>0)return{key:"partial",label:"Delbetald",tone:"blue"};
 if(!i.due)return{key:"open",label:"Förfallodatum saknas",tone:"amber"};return{key:"open",label:i.due===at?"Förfaller idag":"Obetald efter verifierad kontroll",tone:"neutral"};
}
export const normalizeOCR=(s:string)=>s.replace(/[\s-]/g,"").toUpperCase();
export const PAYMENT_SPECIFICATION_REQUIRED='Betalardetaljer saknas – importera betalningsspecifikation.';
export const usablePaymentReference=(value:string)=>!!value.trim()&&!/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value.trim());
export const individualParty=(value:string)=>!!value.trim()&&!/^(bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg|okänd(?: betalare)?|unknown)$/i.test(value.trim());
export const hasBankFileProof=(t:Transaction)=>t.bankFileProof?.version==='bank-file-original-v1'&&typeof t.bankFileProof.documentId==='string'&&!!t.bankFileProof.documentId&&/^[a-f0-9]{64}$/.test(t.bankFileProof.sha256);
export const needsBankFileValidation=(t:Transaction)=>t.evidence==='bank_file'&&!hasBankFileProof(t);
export const needsBankFileReview=(t:Transaction)=>t.evidence==='bank_file'&&(!hasBankFileProof(t)||!t.bankFileProof?.reviewedAt);
export const hasBankEvidenceConflict=(t:Transaction)=>!!t.bankEvidenceConflicts?.length;
export function paymentLineage(s:State,t:Transaction){
 const ancestors=[t],seen=new Set([t.id]);
 while(t.parentId){
  const parent=s.transactions.find(candidate=>candidate.id===t.parentId);
  if(!parent||seen.has(parent.id))return {ancestors,issue:'Bankoriginalets ursprungskedja saknar en post eller innehåller en cirkel. Granska det fullständiga underlaget innan nya matchningar.'};
  ancestors.push(parent);seen.add(parent.id);t=parent;
 }
 return {ancestors,issue:''};
}
function paymentAncestors(s:State,t:Transaction){return paymentLineage(s,t).ancestors;}
export const paymentAccountIssue=(s:State,t:Transaction)=>paymentAncestors(s,t).map(original=>original.bankAccountIssue||'').find(Boolean)||'';
export const paymentEvidenceConflict=(s:State,t:Transaction)=>!!s.bankEvidenceHold||paymentAncestors(s,t).some(hasBankEvidenceConflict);
export function paymentOriginalIssue(s:State,t:Transaction){const lineage=paymentLineage(s,t);return lineage.issue||lineage.ancestors.map(original=>original.enrichmentEvidence?.provider==='openpayments'&&(!s.company.id||original.enrichmentEvidence.companyId!==s.company.id)?'API-underlaget tillhör inte det valda företaget.':original.bankgiroEnrichmentIssue|| (original.payerEvidence?.conflict?'Bankoriginalet innehåller motstridiga organisationsidentifierare. Granska originalet.':bankApiOriginalIssue(original)||original.bankOriginalIssue||'')).find(Boolean)||'';}
export const automaticMatchHoldReason=(t:Transaction)=>t.automaticMatchHold?'En matchning har återtagits. Automatisk matchning väntar tills betalningsuppgifterna har granskats och bekräftats på nytt.':'';
export const BANK_EVIDENCE_CONFLICT='Banken har lämnat motstridiga uppgifter för samma bank-ID. Granska bankoriginalen innan nya matchningar.';
export const paymentEvidenceIssue=(s:State,t:Transaction)=>paymentEvidenceConflict(s,t)?BANK_EVIDENCE_CONFLICT:paymentOriginalIssue(s,t);
/** Recorded allocations still determine the balance; this is their current
 * evidential status, not permission to rewrite the financial history. */
export function invoicePaymentEvidenceIssue(s:State,invoiceId:string){
 if(s.bankEvidenceHold)return BANK_EVIDENCE_CONFLICT;
 for(const allocation of s.allocations.filter(a=>a.active&&a.invoiceId===invoiceId)){
  const payment=s.transactions.find(t=>t.id===allocation.transactionId);if(!payment)return 'Betalningsunderlaget för en registrerad koppling saknas.';
  const issue=allocationPaymentEvidenceIssue(s,payment,allocation.effect);if(issue)return issue;
 }
 return '';
}
/** Contradictory bank facts can change the payer or period. Prior absence notes
 * remain history, but cannot prove absence anywhere until the conflict is resolved. */
export const absenceCheckIssue=(s:State)=>s.bankEvidenceHold||s.transactions.some(hasBankEvidenceConflict)?'Bankunderlagen innehåller motstridiga uppgifter. Utebliven betalning kan inte bekräftas innan bankoriginalen har retts ut.':s.transactions.some(t=>!!paymentOriginalIssue(s,t))?'Bankoriginalen kan inte verifieras. Utebliven betalning kan inte bekräftas innan bankuppgifterna har kontrollerats.':'';
export const hasValidAbsenceCheck=(s:State,i:Invoice)=>!!i.reconciledAt&&!!i.reconciliationNote?.trim()&&!absenceCheckIssue(s);
/** Explicit transaction types are review evidence, even when name and OCR match. */
export function bankPaymentReview(t:Transaction,state?:State):{kind:'reversal'|'refund'|'other';reason:string}|null{
 if(state){const reviews=paymentAncestors(state,t).map(original=>bankPaymentReview(original));return reviews.find(review=>review?.kind==='reversal')||reviews.find(review=>review?.kind==='refund')||reviews.find(Boolean)||null;}
 const code=t.bankData?.bank_transaction_code;
 const description=code&&typeof code==='object'&&'description' in code?String(code.description||''):'';
 const text=[t.description,t.original?.description,t.payerReference,t.original?.payerReference,description,t.bankData?.note,...(Array.isArray(t.bankData?.remittance_information)?t.bankData.remittance_information:[])].filter(value=>typeof value==='string').join(' ').normalize('NFKC');
 const returnReason='Bankunderlaget anger återbetalning eller återföring. Kontrollera den ursprungliga betalningen före avstämning.';
 if(/(?:^|[^\p{L}\p{N}])(?:reversal|reversed|chargeback|returned payment|payment return|återföring(?:ar)?|återförd(?:a)?|returbetalning(?:ar)?)(?=$|[^\p{L}\p{N}])/iu.test(text))return {kind:'reversal',reason:returnReason};
 if(/(?:^|[^\p{L}\p{N}])(?:refund(?:ed|s)?|återbetalning(?:ar)?)(?=$|[^\p{L}\p{N}])/iu.test(text))return {kind:'refund',reason:returnReason};
 if(/(?:^|[^\p{L}\p{N}])(?:kortköp|card purchase|löneutbetalning)(?=$|[^\p{L}\p{N}])/iu.test(text))return {kind:'other',reason:'Betalningstypen anger kortköp eller lön och behöver kontrolleras separat före avstämning.'};
 if(/(?:^|[^\p{L}\p{N}])(?:salary|payroll|card withdrawal|cash withdrawal|kontantuttag|bankomatuttag|kortuttag|internal transfer|own (?:account )?transfer|överföring\s+(?:(?:till|från|mellan)\s+)?(?:eget|egna)\s+konton?|egen\s+överföring)(?=$|[^\p{L}\p{N}])/iu.test(text))return {kind:'other',reason:'Betalningstypen anger lön, kontantuttag eller överföring mellan egna konton och behöver granskas separat.'};
 if(t.payerEvidence?.conflict)return {kind:'other',reason:'Bankoriginalet innehåller motstridiga organisationsidentifierare. Granska originalet.'};
 return null;
}
export const bankPaymentReviewReason=(t:Transaction,state?:State):string=>bankPaymentReview(t,state)?.reason||'';
/** Current evidence can hold a booked allocation without changing its balance.
 * An explicit refund allocation already records the reviewed refund direction. */
export function allocationPaymentEvidenceIssue(s:State,t:Transaction,effect:Allocation['effect']){
 const issue=paymentEvidenceIssue(s,t)||paymentAccountIssue(s,t);if(issue)return issue;
 const review=bankPaymentReview(t,s);return review&&!(review.kind==='refund'&&effect==='refund')?review.reason:'';
}
export function suspectedBankCollection(amount:number,description:string,party:string,structuredReference:string){
 const collective=/\bbatch\b|samlings|samlad|buntbetal|sammandrag/i.test(description);
 return collective||amount>0&&/bankgiro|bg\s*inbetalning/i.test(`${description} ${party}`)&&(!individualParty(party)||!usablePaymentReference(structuredReference));
}
export function needsPaymentSpecification(t:Transaction){return !t.parentId&&(t.kind==='batch'||suspectedBankCollection(t.amount,t.description,t.party,t.payerReference));}
const sameParty=(a:string,b:string)=>individualParty(a)&&a.normalize('NFKC').trim().toLocaleLowerCase('sv-SE')===b.normalize('NFKC').trim().toLocaleLowerCase('sv-SE');
/** A derived business intention, never a replacement for the invoice or bank original. */
export function invoiceReferenceDecision(s:State,i:Pick<Invoice,'number'|'ocr'|'direction'|'referenceOriginal'>,original=i.referenceOriginal){
 return resolveInvoiceReference({invoice_number:i.number,reference:i.ocr,direction:i.direction==='receivable'?'customer':'supplier',...(original?{original}:{})},{company:s.company,policies:s.company.invoiceReferencePolicies});
}
/** All scoped identifiers reserve ownership; only the intended reference authorizes matching. */
export function invoiceReferenceMatches(s:State,i:Pick<Invoice,'number'|'ocr'|'direction'|'referenceOriginal'>,value:string,ownership=false){
 const decision=invoiceReferenceDecision(s,i);
 if(!decision.applies)return [i.ocr,i.number].some(candidate=>!!candidate&&exactReference(value,candidate));
 if(ownership)return [decision.intendedPaymentReference,i.number,i.ocr,i.referenceOriginal?.invoice_number,i.referenceOriginal?.reference].some(candidate=>strictInvoiceReferenceMatch(value,candidate));
 return matchesInvoiceReference(decision,value);
}
const exactPaymentReference=(s:State,t:Transaction,i:Invoice)=>usablePaymentReference(t.payerReference)&&invoiceReferenceMatches(s,i,t.payerReference);
/** Manual corrections never erase reference observations from retained bank sources. */
export function invoicePolicyPaymentReferences(t:Transaction){
 const evidence=[t.referenceEvidence,t.bankDetails?.referenceEvidence].filter(Boolean);
 const values=[...new Set([...matchingReferenceValues(t.referenceEvidence,t.payerReference),...matchingReferenceValues(t.bankDetails?.referenceEvidence,t.bankDetails?.payerReference||''),...(t.original?.payerReference?[t.original.payerReference]:[])])];
 return {values,invalid:evidence.some(item=>item?.incomplete||item?.candidates?.some(candidate=>candidate.validity==='checksum_invalid'))};
}
/** Validate every reference candidate and every invoice owner before creating new money. */
export function invoiceReferenceMatchIssue(s:State,i:Invoice,t:Transaction){
 const decision=invoiceReferenceDecision(s,i);if(!decision.applies)return '';
 if(decision.status==='BLOCKED')return decision.reason;
 const {values,invalid}=invoicePolicyPaymentReferences(t);
 if(!values.length||values.some(value=>!matchesInvoiceReference(decision,value)))return 'Betalningsreferensen stämmer inte exakt med fakturans avsedda betalningsreferens. Granska originalen.';
 if(invalid)return 'Bankens referensunderlag är ofullständigt eller innehåller ogiltig OCR. Granska originalet.';
 const owners=s.invoices.filter(other=>!other.voided&&other.direction===i.direction&&values.some(value=>invoiceReferenceMatches(s,other,value,true)));
 return owners.length!==1||owners[0].id!==i.id?'Flera fakturor äger betalningsreferensen. Granska dubbletterna innan någon ny matchning.':'';
}
export function suggestions(s:State,t:Transaction){
 if(t.ignored||t.duplicateOf||!t.verified||t.kind!=="payment"||needsPaymentSpecification(t)||needsBankFileReview(t)||paymentEvidenceConflict(s,t)||paymentOriginalIssue(s,t)||available(s,t)<=0)return[];
 const direction=t.amount>0?"receivable":"payable",all=s.invoices.filter(i=>i.reviewed&&!i.voided&&i.direction===direction&&(!i.issued||t.date>=i.issued));
 const references=all.filter(i=>exactPaymentReference(s,t,i)&&!invoiceReferenceMatchIssue(s,i,t));
 if(references.length)return references.map(i=>({invoice:i,amount:Math.min(Math.max(0,balance(s,i)),available(s,t)),strength:references.length===1?"strong":"ambiguous",reason:balance(s,i)<=0?"Referensen tillhör en reglerad faktura – möjlig dubbelbetalning":references.length>1?"Referensen stämmer med flera fakturor":invoiceReferenceDecision(s,i).applies?"Avsedd betalningsreferens stämmer exakt":i.ocr&&exactReference(t.payerReference,i.ocr)?"OCR stämmer":"Fakturanumret finns i betalningsreferensen"}));
 return all.filter(i=>balance(s,i)>0&&balance(s,i)===available(s,t)&&sameParty(t.party,i.party)).map(i=>({invoice:i,amount:Math.min(balance(s,i),available(s,t)),strength:"weak",reason:"Betalare och belopp stämmer – kontrollera underlaget"}));
}
export function canonicalBankAccount(value:string){
 const account=value.trim(),iban=account.replace(/^iban:/i,'').replace(/\s/g,'').toUpperCase();
 return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)?`iban:${iban}`:account;
}
const sameAccount=(a:string,b:string)=>canonicalBankAccount(a)===canonicalBankAccount(b);
const fromBankApi=(t:Transaction)=>t.source.startsWith('Enable Banking');
export function txFingerprint(t:Transaction){return[canonicalBankAccount(t.account),t.date,t.amount,t.currency,t.bankReference,t.payerReference,t.party,t.description].join("|");}
function possibleDuplicate(a:Transaction,b:Transaction){
 if(a.date!==b.date||a.amount!==b.amount||a.currency!==b.currency)return false;
 const apiA=fromBankApi(a),apiB=fromBankApi(b);
 // File imports may use a free-text account label. Keep overlapping API/file
 // entries for explicit duplicate review, never silently merge or discard them.
 if(apiA!==apiB)return true;
 if(!sameAccount(a.account,b.account))return false;
 // Review edits change descriptions and payer fields. Missing provider IDs must
 // therefore not make a previously reviewed API payment appear fresh next sync.
 if((apiA||apiB)&&(!a.externalId||!b.externalId))return true;
 return txFingerprint(a)===txFingerprint(b)||!!(a.bankReference&&a.bankReference===b.bankReference);
}
function conflictingBankFacts(previous:Transaction,incoming:Transaction){
 const original={...previous,...previous.original},fields:string[]=[];
 if(openPaymentsIdentity(previous)&&openPaymentsIdentity(previous)===openPaymentsIdentity(incoming)&&canonicalProviderData(previous.rawBankData)!==canonicalProviderData(incoming.rawBankData))fields.push('rawBankData');
 if(payerEvidenceConflict(previous.payerEvidence,incoming.payerEvidence))fields.push('payerEvidence');
 const payer=(t:Transaction)=>{const party=t.bankData?.[t.amount>0?'debtor':'creditor'];return party&&typeof party==='object'&&'name' in party&&typeof party.name==='string'?party.name:t.original?.party||t.party;};
 const different=(a:string,b:string,compare=(x:string,y:string)=>x===y)=>!!a&&!!b&&!compare(a,b);
 const equivalentReference=(a:string,b:string)=>exactReference(a,b)||exactReference(b,a);
 if(different(payer(previous),payer(incoming),(a,b)=>normalizeName(a)===normalizeName(b)))fields.push('party');
 if(different(original.payerReference,incoming.payerReference,equivalentReference))fields.push('payerReference');
 if(different(original.bankReference,incoming.bankReference))fields.push('bankReference');
 if(different(previous.parentBankReference||'',incoming.parentBankReference||''))fields.push('parentBankReference');
 if(different(previous.organizationNumber||'',incoming.organizationNumber||'',(a,b)=>a.replace(/[ -]/g,'')===b.replace(/[ -]/g,'')))fields.push('organizationNumber');
 const oldReferences=matchingReferenceValues(previous.referenceEvidence,original.payerReference),newReferences=matchingReferenceValues(incoming.referenceEvidence,incoming.payerReference);
 if(oldReferences.length&&newReferences.some(value=>!oldReferences.some(old=>equivalentReference(value,old)))||incoming.referenceEvidence?.incomplete&&!previous.referenceEvidence?.incomplete||incoming.referenceEvidence?.candidates?.some(c=>c.validity==='checksum_invalid')&&!previous.referenceEvidence?.candidates?.some(c=>c.validity==='checksum_invalid'))fields.push('referenceEvidence');
 if(bankPaymentReviewReason(incoming)&&bankPaymentReviewReason(incoming)!==bankPaymentReviewReason(previous))fields.push('paymentType');
 return fields;
}
function retainBankConflict(previous:Transaction,incoming:Transaction,fields:string[]){
 const evidence:NonNullable<Transaction['bankEvidenceConflicts']>[number]['incoming']={date:incoming.date,amount:incoming.amount,currency:incoming.currency,party:incoming.party,payerReference:incoming.payerReference,bankReference:incoming.bankReference,description:incoming.description,account:incoming.account,externalId:incoming.externalId,payerEvidence:incoming.payerEvidence,referenceEvidence:incoming.referenceEvidence,bankData:incoming.bankData,bankDataSha256:incoming.bankDataSha256,bankDataVersion:incoming.bankDataVersion,organizationNumber:incoming.organizationNumber,importId:incoming.importId,source:incoming.source,reportEvidence:incoming.reportEvidence,bankFileProof:incoming.bankFileProof,payerAccount:incoming.payerAccount,remittanceMessage:incoming.remittanceMessage,parentBankReference:incoming.parentBankReference,...(incoming.enrichmentEvidence?{enrichmentEvidence:incoming.enrichmentEvidence,rawBankData:incoming.rawBankData}:{})};
 const signature=(value:typeof evidence)=>JSON.stringify([value.date,value.amount,value.currency,value.party,value.payerReference,value.bankReference,value.description,value.organizationNumber,value.payerEvidence,matchingReferenceValues(value.referenceEvidence,value.payerReference),!!value.referenceEvidence?.incomplete,value.referenceEvidence?.candidates?.filter(c=>c.validity==='checksum_invalid').map(c=>c.value),value.bankData?.specification,value.parentBankReference,...(value.enrichmentEvidence?[value.enrichmentEvidence,canonicalProviderData(value.rawBankData)]:[])]);
 previous.bankEvidenceConflicts??=[];
 if(!previous.bankEvidenceConflicts.some(conflict=>signature(conflict.incoming)===signature(evidence)))previous.bankEvidenceConflicts.push({at:now(),fields,incoming:structuredClone(evidence)});
}
function cleanInvoice(raw:any,existing?:Invoice,company?:State['company']):Invoice{
 if(!raw||!['receivable','payable'].includes(raw.direction))throw new Error("Välj fakturatyp.");if(raw.currency&&raw.currency!=="SEK"||raw.foreignCurrency&&!raw.currencyConfirmed)throw new Error("Endast SEK stöds. Importera inte andra valutor som kronor.");
 const i:Invoice={id:existing?.id??uid(),direction:raw.direction,party:str(raw.party,200),email:str(raw.email??"",200),number:str(raw.number,100),ocr:str(raw.ocr??"",100),total:cents(raw.total),currency:"SEK",issued:date(raw.issued),due:date(raw.due??"",true),reviewed:raw.reviewed===true,voided:existing?.voided??false,note:str(raw.note??"",3000),bankgiro:str(raw.bankgiro??"",100),documentId:str(raw.documentId??"",100),source:str(raw.source??"Manuellt registrerad",300),createdAt:existing?.createdAt??now()};
 i.organizationNumber=str(raw.organizationNumber??existing?.organizationNumber??'',40);i.vat=raw.vat??existing?.vat??null;i.net=raw.net??existing?.net??null;i.reconciledAt=existing?.reconciledAt||'';i.reconciliationNote=existing?.reconciliationNote||'';
 if(existing?.referenceOriginal&&existing.documentId!==i.documentId&&resolveInvoiceReference({invoice_number:i.number,reference:i.ocr,direction:i.direction==='receivable'?'customer':'supplier'},{company,policies:company?.invoiceReferencePolicies}).applies)throw Error('Originalunderlaget kan inte bytas när fakturans ursprungliga referensuppgifter har sparats. Granska den befintliga fakturan.');
 const original=existing?.referenceOriginal??raw.referenceOriginal;
 if(original!=null){
  if(typeof original!=='object'||Array.isArray(original))throw Error('Originalets referensuppgifter måste granskas.');
  i.referenceOriginal={};
  for(const key of ['invoice_number','reference','issuer_name'] as const)if(original[key]!=null){str(original[key],key==='issuer_name'?200:100);i.referenceOriginal[key]=original[key];}
 }
 if([i.vat,i.net].some(n=>n!=null&&(!Number.isSafeInteger(n)||n<0))||i.vat!=null&&i.net!=null&&i.vat+i.net!==i.total)throw new Error('Netto och moms måste stämma med fakturabeloppet.');
 if(!i.party||!i.number)throw new Error("Namn och fakturanummer behövs.");if(i.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email))throw new Error("Kontrollera e-postadressen.");if(i.due&&i.due<i.issued)throw new Error("Förfallodatum får inte vara före fakturadatum.");return i;
}
function cleanReportEvidence(raw:any):Record<string,string>|undefined{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
 const fields=['profile','namespace','messageId','reportId','createdAt','accountServicer','entryReference','valueDate',...['recipientBankgiro','sequence','paymentCount','totalCents','sheet','reportDate','dateKind','currencySource'].filter(key=>Object.hasOwn(raw,key))];
 return Object.fromEntries([...fields.map(key=>[key,str(raw[key]??'',300)]),...(raw.sourceCells?[['sourceCells',str(raw.sourceCells,12000)]]:[])]);
}
function cleanTransaction(raw:any):Transaction{
 if(!raw||raw.currency&&raw.currency!=="SEK")throw new Error("Endast bankhändelser i SEK stöds.");let kind=['payment','batch','unknown'].includes(raw.kind)?raw.kind:'unknown';
 const amount=cents(raw.amount,false),party=str(raw.party??"",200),payerReference=str(raw.payerReference??"",300),description=str(raw.description??"",1000);
 if(!raw.parentKey&&suspectedBankCollection(amount,description,party,payerReference))kind='batch';
 return{...(raw.payerEvidence?{payerEvidence:structuredClone(raw.payerEvidence)}:{}),id:uid(),date:date(raw.date),amount,currency:"SEK",party,payerReference,bankReference:str(raw.bankReference??"",300),description,source:str(raw.source??"Manuellt registrerad",300),externalId:str(raw.externalId??"",300),account:canonicalBankAccount(str(raw.account??"Swedbank",100)),kind,verified:raw.verified===true&&kind==='payment',duplicateOf:"",ignored:false,parentId:"",importId:"",createdAt:now()};
}
function canonicalProviderData(value:unknown):string{
 const ordered=(input:unknown):unknown=>Array.isArray(input)?input.map(ordered):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):input;
 return JSON.stringify(ordered(value))??'';
}
function openPaymentsIdentity(row:any){
 const evidence=row.enrichmentEvidence;
 return evidence?.provider==='openpayments'&&row.externalId&&['companyId','sourceId','accountId','transactionId'].every(key=>typeof evidence[key]==='string'&&evidence[key])?JSON.stringify([evidence.companyId,evidence.sourceId,evidence.accountId,evidence.transactionId,row.externalId]):'';
}
function sameOpenPaymentsScope(a:any,b:any){
 const first=a.enrichmentEvidence,second=b.enrichmentEvidence;
 return first?.provider==='openpayments'&&second?.provider==='openpayments'&&['owner','companyId','sourceId','scopeId','accountId'].every(key=>typeof first[key]==='string'&&!!first[key]&&first[key]===second[key]);
}
function distinctOpenPaymentsPayments(a:any,b:any){
 return !!openPaymentsIdentity(a)&&!!openPaymentsIdentity(b)&&sameOpenPaymentsScope(a,b)&&a.enrichmentEvidence.transactionId!==b.enrichmentEvidence.transactionId;
}
function sameOpenPaymentsParent(a:any,b:any){
 return sameOpenPaymentsScope(a,b)&&typeof a.enrichmentEvidence.parentTransactionId==='string'&&!!a.enrichmentEvidence.parentTransactionId&&a.enrichmentEvidence.parentTransactionId===b.enrichmentEvidence.parentTransactionId;
}
/** A specification is never money a second time. Only exact bank evidence releases it. */
export function specificationPreview(s:State,rows:any[],targetId=''){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('Välj 1–1 000 betalningsrader.');
 if(rows.some(row=>row.enrichmentEvidence?.provider==='openpayments'&&(!s.company.id||row.enrichmentEvidence.companyId!==s.company.id)))throw Error('API-underlaget måste tillhöra det uttryckligen valda företaget.');
 const payments=rows.filter(r=>r.kind!=='batch'),groups=new Map<string,any[]>();
 for(const r of payments){const key=r.parentKey||r.parentBankReference||r.bankReference||r.key||'csv';groups.set(key,[...(groups.get(key)||[]),r]);}
 const plans=[...groups.values()].map(group=>{
  const first=group[0],total=group.reduce((n,r)=>n+cents(r.amount,false),0),ref=first.parentBankReference||first.bankReference;
  const candidates=s.transactions.filter(t=>!t.ignored&&!t.parentId&&needsPaymentSpecification(t)&&t.bankReference&&ref===t.bankReference&&first.account&&sameAccount(first.account,t.account)&&group.every(r=>r.date===t.date&&r.currency===t.currency&&sameAccount(r.account||'',t.account))&&t.amount===total);
  const parent=candidates.length===1?candidates[0]:undefined;
  let reason=group.find(row=>row.bankgiroEnrichmentIssue)?.bankgiroEnrichmentIssue||group.find(row=>row.bankgiroAccountIssue)?.bankgiroAccountIssue||(!first.account?'Mottagarkonto saknas i filen.':!ref?'Insättningens bankidentifierare saknas.':!parent?'Konto, datum, bankidentifierare och totalsumma kan inte kopplas entydigt till en samlingspost.':targetId&&parent.id!==targetId?'Filen tillhör en annan bankhändelse.':hasBankEvidenceConflict(parent)?BANK_EVIDENCE_CONFLICT:paymentOriginalIssue(s,parent)?paymentOriginalIssue(s,parent):parent.duplicateOf||s.allocations.some(a=>a.transactionId===parent.id&&a.active)?'Samlingsposten har en tidigare matchning eller dubblettspärr.':'');
  if(group.some(r=>!individualParty(r.party||'')))reason='En eller flera betalare saknas i specifikationen.';
  const existing=parent?s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored):[];
  const signature=(raw:any)=>{const r={...raw,...raw.original};return JSON.stringify([r.date,r.amount,r.currency,r.party,r.payerReference,r.bankReference,...(r.enrichmentEvidence?.provider==='openpayments'?[openPaymentsIdentity(r),canonicalProviderData(r.rawBankData),r.bankgiroEnrichmentIssue||'']:[])]);};
  if(new Set(group.map(signature)).size!==group.length||group.some((r,n)=>r.externalId&&group.some((other,m)=>m!==n&&other.externalId===r.externalId)))reason='Specifikationen innehåller möjliga dubbla betalningar. Granska bankoriginalets individuella identifierare.';
  const duplicate=existing.length===group.length&&existing.map(signature).sort().join('|')===group.map(signature).sort().join('|');
  if(existing.length&&!duplicate)reason='Samlingsposten har redan en annan betalningsspecifikation. Granska konflikten.';
  // Whole retained reports can contradict each other before their booked
  // aggregate arrives. Keep that knowledge when either source later disappears.
  const previousGroups=new Map<string,Transaction[]>();
  if(ref&&first.account)for(const row of s.transactions.filter(t=>t.specification&&t.parentBankReference===ref&&sameAccount(t.account,first.account)&&(t.enrichmentEvidence?.provider!=='openpayments'||first.enrichmentEvidence?.provider!=='openpayments'||t.date===first.date&&t.currency===first.currency||sameOpenPaymentsParent(t,first)))){const key=JSON.stringify([row.importId,row.specificationGroup]);previousGroups.set(key,[...(previousGroups.get(key)||[]),row]);}
  const sameRetainedGroup=group.every(openPaymentsIdentity)&&[...previousGroups.values()].some(previous=>previous.length===group.length&&JSON.stringify(previous.map(signature).sort())===JSON.stringify(group.map(signature).sort()));
  const contradicted=[...previousGroups.values()].filter(previous=>!previous.some(row=>row.bankgiroEnrichmentIssue)&&!group.some(row=>row.bankgiroEnrichmentIssue)&&previous[0].specificationCount===previous.length&&previous.every(row=>row.specificationCount===previous.length&&row.specificationTotal===previous[0].specificationTotal)&&previous.reduce((sum,row)=>sum+row.amount,0)===previous[0].specificationTotal&&JSON.stringify(previous.map(signature).sort())!==JSON.stringify(group.map(signature).sort()));
  const conflictIds=[...new Set([...(existing.length&&!duplicate&&parent?[parent.id]:[]),...contradicted.flatMap(previous=>previous.flatMap(row=>[row.id,...(row.parentId?[row.parentId]:[])]))])];
  if(conflictIds.length)reason='Bankoriginalen innehåller olika individuella betalningar för samma samlingspost. Granska originalen tillsammans.';
  const overlap=parent&&s.transactions.some(t=>t.id!==parent.id&&!t.ignored&&!t.duplicateOf&&t.specificationStatus!=='review'&&!existing.some(e=>e.id===t.id)&&group.some(r=>t.date===r.date&&t.amount===r.amount&&t.currency===r.currency&&(r.externalId&&t.externalId===r.externalId||r.bankReference&&r.bankReference!==ref&&t.bankReference===r.bankReference||t.party===r.party&&t.payerReference===r.payerReference&&!distinctOpenPaymentsPayments(t,r))));
  if(overlap)reason='Betalningen kan redan finnas via ett annat bankunderlag. Granska dubbletten.';
  return {rows:group,parentId:!reason?parent?.id:'',conflictIds,duplicate:!reason&&duplicate,sameRetainedGroup,total,status:reason?'review':'linked',reason:reason||'Konto, datum, bankidentifierare och totalsumma stämmer. Insättningen räknas en gång.'};
 });
 return {plans,payments:payments.length,total:payments.reduce((n,r)=>n+r.amount,0),linked:plans.filter(p=>p.status==='linked').length,review:plans.filter(p=>p.status==='review').length};
}
export function paymentInvoiceAssessment(s:State,t:Transaction){
 const view={...t,party:t.bankDetails?.party||t.party,payerReference:t.bankDetails?.payerReference||(needsPaymentSpecification(t)?'':t.payerReference)};
 const exact=s.invoices.filter(i=>!i.voided&&i.direction===(t.amount>0?'receivable':'payable')&&exactPaymentReference(s,view,i));
 const allocations=s.allocations.filter(a=>a.active&&a.transactionId===t.id),allocated=allocations[0],invoice=allocated?s.invoices.find(i=>i.id===allocated.invoiceId):exact.length===1?exact[0]:undefined;
 const policyIssue=invoice?invoiceReferenceMatchIssue(s,invoice,view):'';
 const issue=(allocated?allocations.map(a=>allocationPaymentEvidenceIssue(s,t,a.effect)).find(Boolean)||'':paymentEvidenceIssue(s,t)||paymentAccountIssue(s,t)||bankPaymentReviewReason(t,s))||policyIssue;
 return {invoice,status:issue?'review':allocated?'verified':exact.length>1?'ambiguous':invoice?'possible':'missing',message:issue|| (allocated?'Betalningen är verifierad mot fakturan.':exact.length>1?'Flera fakturor kan passa. Granska kundidentiteten.':invoice?'Referensen finns. Kund och betalningsunderlag behöver stämma.':individualParty(view.party)?usablePaymentReference(view.payerReference)?`Betalare identifierad – ingen faktura med betalningsreferensen ${view.payerReference} hittades i registret.`:'Betalare identifierad – fakturakoppling saknas.':'Betalaren behöver identifieras.')};
}
export function economicTransactions(s:State){return s.transactions.filter(t=>!t.ignored&&!t.duplicateOf&&t.specificationStatus!=='review'&&!s.transactions.some(c=>c.parentId===t.id&&!c.ignored));}
const linkSnapshot=(t:Transaction)=>{const {bankOriginalIssue:derivedAvailability,bankgiroAccountIssue:derivedConsent,...original}=t;return bankApiDataHash({transaction:original});};
function specificationGroup(s:State,t:Transaction){return s.transactions.filter(row=>row.specification&&row.importId===t.importId&&row.specificationGroup===t.specificationGroup);}
/** Report identity survives a new file hash, layout, filename or cell address.
 * It reserves a manually reviewed source; it never proves an AIS identity. */
export function bankgiroReportKey(rows:Transaction[]){
 const first=rows[0];if(!first)return '';
 const giro=(value?:string)=>String(value||'').replace(/[\s-]/g,'');
 const payments=rows.map(row=>[row.party,row.payerReference,giro(row.payerBankgiro),row.amount]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return bankApiDataHash({identity:[canonicalBankAccount(first.account),first.date,first.currency,giro(first.recipientBankgiro),first.reportEvidence?.sequence||first.reportEvidence?.reportId||first.parentBankReference||'',rows.length,rows.reduce((sum,row)=>sum+row.amount,0),payments]});
}
function linkedReportKey(s:State,link:BankgiroLink){return link.reportKey||bankgiroReportKey(link.specificationIds.flatMap(id=>{const row=s.transactions.find(row=>row.id===id);return row?[row]:[];}));}
function bankgiroDepositKey(rows:Transaction[]){
 const first=rows[0],key=first?bankgiroDepositIdentity(first.reportEvidence,first.date):'';
 return key&&rows.every(row=>bankgiroDepositIdentity(row.reportEvidence,row.date)===key)?key:'';
}
function bankgiroLinkIssue(s:State,target:Transaction,rows:Transaction[]){
 if(!hasBankApiOrigin(target)||!target.bankData||!target.bankDataSha256||!target.bankDataVersion)return 'Bankoriginalet behöver ett verifierbart ankomstkvitto från AIS.';
 const issue=paymentEvidenceIssue(s,target);if(issue)return issue;
 if(target.amount<=0||target.currency!=='SEK'||target.ignored||target.duplicateOf||target.parentId||target.specification||s.transactions.some(row=>row.parentId===target.id&&!row.ignored))return 'Välj en aktiv, bokförd AIS-insättning utan befintlig uppdelning.';
 const first=rows[0];if(!first||!first.specificationGroup||!first.importId||!Number.isSafeInteger(first.specificationCount)||first.specificationCount!==rows.length||rows.some(row=>row.specificationCount!==rows.length||row.specificationTotal!==first.specificationTotal)||rows.reduce((sum,row)=>sum+row.amount,0)!==first.specificationTotal)return 'Specifikationen saknar fullständigt antal eller korrekt totalsumma.';
 if(rows.some(row=>row.enrichmentEvidence?.provider==='openpayments'&&(!row.parentBankReference||row.parentBankReference!==target.bankReference)))return 'API-underlaget saknar en gemensam bankidentifierare med AIS-insättningen. Datum och belopp räcker inte.';
 if(rows.some(row=>row.evidence!=='bankgiro_file'||!row.original||row.bankDetails||(['party','payerReference','description','amount','date','account','bankReference'] as const).some(key=>row.original![key]!==row[key])))return 'Specifikationens ursprungliga uppgifter stämmer inte med originalobservationerna.';
 if(rows.some(row=>row.specificationStatus!=='review'||row.parentId||row.ignored||row.duplicateOf||row.amount<=0||!hasBankFileProof(row)||paymentEvidenceIssue(s,row)))return 'Specifikationens bevarade original behöver kontrolleras innan underlagen kopplas.';
 if(rows.some(row=>row.bankFileProof!.documentId!==first.bankFileProof!.documentId||row.bankFileProof!.sha256!==first.bankFileProof!.sha256))return 'Specifikationen innehåller motstridiga originalfiler.';
 if(rows.some(row=>row.format==='Swedbank Bankgiro XLSX'&&row.reportEvidence?.currencySource!=='cell'))return 'Rapportoriginalet saknar uttrycklig valuta. Antagen SEK är inte verifierad valuta; komplettera bankunderlaget.';
 if(first.specificationTotal!==target.amount||rows.some(row=>row.currency!==target.currency))return 'Rapportens totalsumma eller valuta stämmer inte med insättningen.';
 if(rows.some(row=>!row.recipientAccount||!sameAccount(row.account,target.account)))return 'Rapportens uttryckliga mottagarkonto måste stämma med AIS-insättningens konto.';
 if(rows.some(row=>row.date!==first.date)||!validDate(first.date)||!validDate(target.date)||Math.abs(Date.parse(first.date+'T12:00:00Z')-Date.parse(target.date+'T12:00:00Z'))>3*86400_000)return 'Datumskillnaden får vara högst tre dagar och behöver förklaras.';
 const active=(s.bankgiroLinks||[]).filter(link=>!link.revokedAt),ids=new Set(rows.map(row=>row.id));
 if(active.some(link=>link.transactionId!==target.id&&link.specificationIds.some(id=>ids.has(id))))return 'Specifikationen är redan kopplad till en annan bankhändelse.';
 const reportKey=bankgiroReportKey(rows);
 if(active.some(link=>link.transactionId!==target.id&&linkedReportKey(s,link)===reportKey))return 'Samma rapport är redan manuellt kopplad till en annan bankhändelse, även om originalfilen har annan layout eller kontrollsumma.';
 const depositKey=bankgiroDepositKey(rows);
 if(depositKey&&active.some(link=>link.transactionId!==target.id&&bankgiroDepositKey(link.specificationIds.flatMap(id=>{const row=s.transactions.find(row=>row.id===id);return row?[row]:[];}))===depositKey))return 'Samma insättning i Bankgirorapporten är redan kopplad till en annan bankhändelse. Granska och återta den relationen först.';
 if(active.some(link=>link.transactionId===target.id&&(!link.specificationIds.every(id=>ids.has(id))||link.specificationIds.length!==ids.size)))return 'Bankhändelsen är redan kopplad till en annan specifikation. Återta den relationen först.';
 return '';
}
/** Candidate fields are read-only hints; date and amount never establish identity. */
export function bankgiroLinkCandidates(s:State,target:Transaction){
 if(!hasBankApiOrigin(target)||target.specification||target.amount<=0||!validDate(target.date))return [];
 const seen=new Set<string>();return s.transactions.filter(row=>row.specification&&row.specificationStatus==='review').flatMap(row=>{
  const key=JSON.stringify([row.importId,row.specificationGroup]);if(seen.has(key))return [];seen.add(key);
  const rows=specificationGroup(s,row),reason=bankgiroLinkIssue(s,target,rows),dateDifference=validDate(row.date)&&validDate(target.date)?Math.round((Date.parse(row.date+'T12:00:00Z')-Date.parse(target.date+'T12:00:00Z'))/86400_000):NaN;
  if(rows.reduce((sum,row)=>sum+row.amount,0)!==target.amount||rows.some(row=>row.currency!==target.currency)||!Number.isFinite(dateDifference)||Math.abs(dateDifference)>3)return [];
  return [{specificationId:row.id,rows,dateDifference,canLink:!reason,reason:reason||'Möjlig tillhörande Bankgirospecifikation – kontrollera båda originalen. Datum och belopp bevisar inte sambandet.'}];
 });
}
/** A stale or revoked decision must never hide a source or enrich a bank row. */
export function activeBankgiroLink(s:State,targetId:string):(BankgiroLink&{rows:Transaction[]})|undefined{
 const target=s.transactions.find(row=>row.id===targetId);if(!target)return;
 for(const link of s.bankgiroLinks||[]){
  if(link.revokedAt||link.transactionId!==targetId||link.transactionSnapshot!==linkSnapshot(target))continue;
  const rows=link.specificationIds.map(id=>s.transactions.find(row=>row.id===id));
  if(rows.some(row=>!row||link.specificationSnapshots[row.id]!==linkSnapshot(row)))continue;
  const retained=rows as Transaction[];if(!retained.length||bankgiroLinkIssue(s,target,retained)||retained[0].bankFileProof?.documentId!==link.documentId||retained[0].bankFileProof?.sha256!==link.sha256)continue;
  return {...link,rows:retained};
 }
}
export function applyCommand(current:State,command:Command):{state:State;message:string}{
 const s=structuredClone(current);let message="Sparat";
 try{
 switch(command.type){
 case'bankgiro.link':{
  const target=getTx(s,command.transactionId),specification=getTx(s,command.specificationId),rows=specificationGroup(s,specification),note=str(command.note??'',1500),dateDifferenceNote=str(command.dateDifferenceNote??'',1000);
  if(command.confirmOriginals!==true||command.confirmAccount!==true||!note)throw Error('Bekräfta att båda originalen och mottagarkontot är kontrollerade och beskriv kontrollen i en anteckning.');
  const issue=bankgiroLinkIssue(s,target,rows);if(issue)throw Error(issue);
  if(rows[0].date!==target.date&&!dateDifferenceNote)throw Error('Datumskillnaden behöver en separat förklaring från originalen.');
  const previous=(s.bankgiroLinks||[]).find(link=>!link.revokedAt&&link.transactionId===target.id&&link.specificationIds.length===rows.length&&link.specificationIds.every(id=>rows.some(row=>row.id===id)));
  if(previous){if(!activeBankgiroLink(s,target.id))throw Error('Den tidigare kopplingens original har ändrats. Återta relationen och granska originalen på nytt.');message='Underlagen är redan manuellt kopplade. Inga betalningar ändrades.';break;}
  (s.bankgiroLinks??=[]).push({id:uid(),method:'manual_review',transactionId:target.id,specificationIds:rows.map(row=>row.id),documentId:rows[0].bankFileProof!.documentId,sha256:rows[0].bankFileProof!.sha256,reportKey:bankgiroReportKey(rows),note,dateDifferenceNote,createdAt:now(),transactionSnapshot:linkSnapshot(target),specificationSnapshots:Object.fromEntries(rows.map(row=>[row.id,linkSnapshot(row)]))});
  message='Underlagen är manuellt kopplade. Fakturor, saldon och bankoriginal är oförändrade.';break;
 }
 case'bankgiro.unlink':{
  const link=(s.bankgiroLinks||[]).find(link=>link.id===command.id);if(!link)throw Error('Underlagskopplingen finns inte för ditt konto.');const note=str(command.note??'',1500);if(!note)throw Error('Beskriv varför underlagskopplingen återtas i en anteckning.');
  if(!link.revokedAt){link.revokedAt=now();link.revocationNote=note;}message='Underlagskopplingen är återtagen. Alla original och betalningskopplingar är bevarade.';break;
 }
 case'bankgiro.import':{
  if(!command.documentId||!command.hash)throw Error('Originalfilen måste sparas före import.');
  if(s.imports.some(i=>i.hash===command.hash)&&!s.transactions.some(t=>t.specificationStatus==='review'&&s.imports.find(i=>i.id===t.importId)?.hash===command.hash)){message='Filen har redan importerats. Inga nya betalningar skapades.';break;}
  const preview=specificationPreview(s,command.rows,command.targetId),record:ImportRecord={id:uid(),hash:str(command.hash,128),account:'Bankgiro',name:str(command.name,300),count:0,createdAt:now(),documentId:str(command.documentId,100)};
  // Rechecking a held original may later link it to a verified bank entry.
  // Until that changes, a new request receipt is not another import record.
  if(s.imports.some(i=>i.hash===command.hash)&&preview.plans.every(p=>p.status==='review'&&!p.conflictIds.length)){message='Filen har redan importerats och väntar på verifierad bankkoppling. Inga nya betalningar skapades.';break;}
  for(const plan of preview.plans){
   if(plan.conflictIds.length){
    const first=plan.rows[0],incoming=cleanTransaction({...first,amount:plan.total,party:'',payerReference:'',bankReference:first.parentBankReference||first.bankReference,externalId:'',kind:'batch',verified:false});
    incoming.importId=record.id;incoming.bankFileProof={version:'bank-file-original-v1',documentId:record.documentId!,sha256:record.hash};
    incoming.bankData={specification:plan.rows.map(row=>[row.date,row.amount,row.currency,row.account,row.externalId,row.bankReference,row.party,row.payerReference]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
    for(const id of plan.conflictIds)retainBankConflict(getTx(s,id),incoming,['specification']);
   }
   for(const raw of plan.rows){
    const t=cleanTransaction({...raw,kind:'payment',verified:false});
    if(Array.isArray(raw.referenceParts))t.referenceParts=raw.referenceParts.slice(0,20).map((p:any)=>({value:str(p.value,300),source:str(p.source,200),kind:str(p.kind,60)}));t.specification=true;t.specificationStatus=plan.status as 'linked'|'review';t.parentBankReference=str(raw.parentBankReference||'',300);t.recipientBankgiro=str(raw.recipientBankgiro||'',100);t.payerBankgiro=str(raw.payerBankgiro||'',100);t.settlementDate=str(raw.settlementDate||'',10);t.format=str(raw.format||'',100);t.organizationNumber=str(raw.organizationNumber||'',40);
    t.referenceEvidence=structuredClone(raw.referenceEvidence);t.payerAccount=str(raw.payerAccount||'',100);t.remittanceMessage=str(raw.remittanceMessage||'',1000);t.reportEvidence=cleanReportEvidence(raw.reportEvidence);
    if(Object.hasOwn(raw,'bankgiroAccountIssue'))t.bankgiroAccountIssue=str(raw.bankgiroAccountIssue,1000);
    if(Object.hasOwn(raw,'bankgiroEnrichmentIssue'))t.bankgiroEnrichmentIssue=str(raw.bankgiroEnrichmentIssue,1000);
    if(raw.enrichmentEvidence?.provider==='openpayments'){t.enrichmentEvidence=structuredClone(raw.enrichmentEvidence);t.rawBankData=structuredClone(raw.rawBankData);}
    t.specificationGroup=str(plan.rows[0].parentKey||plan.rows[0].parentBankReference||plan.rows[0].bankReference||plan.rows[0].key||'csv',300);t.specificationCount=plan.rows.length;t.specificationTotal=plan.total;
    t.recipientAccount=str(raw.recipientAccount||raw.account||'',100);t.original={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};
    t.parentId=plan.parentId||'';t.importId=record.id;t.evidence='bankgiro_file';t.kind='payment';t.verified=plan.status==='linked'&&individualParty(t.party);
    if(t.parentId&&getTx(s,t.parentId).automaticMatchHold)t.automaticMatchHold=structuredClone(getTx(s,t.parentId).automaticMatchHold);
    t.bankFileProof={version:'bank-file-original-v1',documentId:record.documentId!,sha256:record.hash};
    const giro=(value?:string)=>String(value||'').replace(/[ -]/g,'');
    const duplicate=s.transactions.find(x=>x.specification&&x.date===t.date&&x.amount===t.amount&&x.party===t.party&&x.payerReference===t.payerReference&&x.bankReference===t.bankReference&&sameAccount(x.account,t.account)&&giro(x.recipientBankgiro)===giro(t.recipientBankgiro)&&giro(x.payerBankgiro)===giro(t.payerBankgiro)&&(t.enrichmentEvidence?.provider==='openpayments'?!!openPaymentsIdentity(t)&&openPaymentsIdentity(x)===openPaymentsIdentity(t)&&canonicalProviderData(x.rawBankData)===canonicalProviderData(t.rawBankData):x.enrichmentEvidence?.provider!=='openpayments'));
    const previous=(t.externalId?s.transactions.find(x=>sameAccount(x.account,t.account)&&x.externalId===t.externalId):undefined)||duplicate;
    if(previous){
     const fields=conflictingBankFacts(previous,t);if(previous.amount!==t.amount||previous.date!==t.date||previous.currency!==t.currency)fields.push('amountDateCurrency');
     if(fields.length){
      retainBankConflict(previous,t,fields);retainBankConflict(t,{...previous,...previous.original},fields);
      if(previous.parentId)retainBankConflict(getTx(s,previous.parentId),t,['specification',...fields]);
      if(t.parentId)retainBankConflict(getTx(s,t.parentId),{...previous,...previous.original},['specification',...fields]);
     }
    }
    if(plan.duplicate)continue;
    // Review observations belong to their complete retained report. Reusing a
    // shared row from an older partial report would silently truncate this one.
    const separateReviewOriginal=duplicate&&duplicate.specificationStatus==='review'&&duplicate.bankFileProof?.documentId!==t.bankFileProof.documentId&&(t.enrichmentEvidence?.provider==='openpayments'?!plan.sameRetainedGroup:plan.status==='review');
    if(duplicate&&!separateReviewOriginal){if(!paymentEvidenceConflict(s,duplicate)&&!hasBankEvidenceConflict(t)&&duplicate.specificationStatus==='review'&&plan.status==='linked'){duplicate.parentId=t.parentId;duplicate.verified=t.verified;duplicate.specificationStatus='linked';duplicate.specificationGroup=t.specificationGroup;duplicate.specificationCount=t.specificationCount;duplicate.specificationTotal=t.specificationTotal;if(Object.hasOwn(t,'bankgiroAccountIssue'))duplicate.bankgiroAccountIssue=t.bankgiroAccountIssue;if(t.automaticMatchHold)duplicate.automaticMatchHold??=structuredClone(t.automaticMatchHold);}continue;}
    s.transactions.push(t);record.count++;
   }
  }
  for(const plan of preview.plans.filter(p=>p.status==='linked'&&p.parentId)){
   const parent=getTx(s,plan.parentId!),children=s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored);
   if(children.reduce((sum,t)=>sum+t.amount,0)!==parent.amount)throw Error('Betalningsspecifikationen kan inte räknas fullständigt utan dubbletter. Ingen import gjordes.');
  }
  s.imports.push(record);message=`${record.count} betalningar importerade. ${preview.review} specifikationer behöver granskning.`;break;
 }
 case'invoice.save':{
  const old=command.invoice.id?getInvoice(s,command.invoice.id):undefined,item=cleanInvoice(command.invoice,old,s.company);
  const duplicate=s.invoices.find(i=>i.id!==item.id&&!i.voided&&i.direction===item.direction&&i.party.toLowerCase()===item.party.toLowerCase()&&i.number.toUpperCase()===item.number.toUpperCase());
  if(duplicate)throw new Error("Fakturanumret finns redan för den här kunden/leverantören. Öppna den befintliga fakturan.");
  if(old&&(s.allocations.some(a=>a.active&&a.invoiceId===old.id)||credited(s,old.id)>0)&&(item.total!==old.total||item.direction!==old.direction||item.party!==old.party||item.number!==old.number||item.reviewed!==old.reviewed||(item.organizationNumber||'').replace(/[- ]/g,'')!==(old.organizationNumber||'').replace(/[- ]/g,'')))throw new Error("Fakturan har betalningar eller krediter. Ångra dessa först, eller registrera en kreditfaktura.");
  if(old)s.invoices[s.invoices.indexOf(old)]=item;else s.invoices.push(item);message=item.reviewed?"Fakturan är sparad och granskad":"Fakturan är sparad för granskning";break;
 }
 case'invoice.reconcile':{const i=getInvoice(s,command.id);const note=str(command.note??'',1500);if(command.confirm!==true||!note)throw new Error('Bekräfta kontrollen och ange bankunderlaget.');const issue=absenceCheckIssue(s);if(issue)throw new Error(issue);i.reconciledAt=now();i.reconciliationNote=note;message='Betalningsunderlaget är kontrollerat';break;}
 case'invoice.void':{const i=getInvoice(s,command.id);if(s.allocations.some(a=>a.invoiceId===i.id&&a.active)||credited(s,i.id)>0)throw new Error("Ångra betalningar och krediter innan makulering.");i.voided=!i.voided;message=i.voided?"Fakturan är makulerad":"Fakturan är återställd";break;}
 case'credit.add':{
  const i=getInvoice(s,command.invoiceId);if(!i.reviewed||i.voided)throw new Error("Granska fakturan först.");const amount=cents(command.amount);
  if(credited(s,i.id)+amount>i.total)throw new Error("Krediten är större än fakturans återstående krediterbara belopp.");const number=str(command.number,100);if(!number)throw new Error("Ange kreditfakturans nummer.");if(s.credits.some(c=>c.invoiceId===i.id&&c.number===number&&c.active))throw new Error("Kreditfakturan finns redan.");
  s.credits.push({id:uid(),invoiceId:i.id,amount,number,note:str(command.note??"",1000),date:date(command.date),active:true});message="Krediten är registrerad";break;
 }
 case'credit.undo':{const c=s.credits.find(c=>c.id===command.id&&c.active);if(!c)throw new Error("Krediten finns inte.");c.active=false;message="Krediten är återtagen";break;}
 case'transactions.import':{
  if(!Array.isArray(command.rows)||!command.rows.length||command.rows.length>1000)throw new Error("Importera 1–1 000 bankhändelser åt gången.");const hash=str(command.hash??"",128),account=canonicalBankAccount(str(command.account??"Swedbank",100));
  const trustedFile=command.trustedBankFileImport===true&&!!command.documentId&&/^[a-f0-9]{64}$/.test(hash),previous=trustedFile?s.imports.filter(i=>i.hash===hash||i.documentId===command.documentId):[];
  if(previous.length){
   // A repeat original can prove existing facts; it must never create more money.
   if(previous.length!==1)throw Error('Originalfilen har flera äldre importer. Granska dem tillsammans innan verifiering.');
   const existing=s.transactions.filter(t=>t.importId===previous[0].id),matched:Transaction[]=[],keys=new Map<string,string>();
   const parsed=command.rows.map((raw:any)=>cleanTransaction({...raw,account:typeof raw.account==='string'&&raw.account.trim()?raw.account:account}));
   if(existing.length!==parsed.length)throw Error('Originalet stämmer inte med alla äldre bankrader. Bevara posterna och granska originalet.');
   for(let n=0;n<parsed.length;n++){
    const row=parsed[n],found=existing.filter(t=>!matched.includes(t)&&t.externalId===row.externalId&&txFingerprint({...t,...t.original})===txFingerprint(row)&&!(row.kind==='batch'&&t.kind!=='batch'));
    if(found.length!==1)throw Error('Originalet stämmer inte entydigt med äldre betalar-, referens- eller beloppsuppgifter. Granska originalet.');
    matched.push(found[0]);if(command.rows[n].key)keys.set(command.rows[n].key,found[0].id);
   }
   if(matched.some((t,n)=>t.parentId!==(command.rows[n].parentKey?keys.get(command.rows[n].parentKey)||'missing':'')))throw Error('Originalets uppdelning stämmer inte med äldre bankrader. Granska originalet.');
   for(let n=0;n<matched.length;n++){const t=matched[n],reviewedAt=hasBankFileProof(t)&&t.bankFileProof?.sha256===hash?t.bankFileProof.reviewedAt:undefined;t.evidence='bank_file';t.referenceEvidence=structuredClone(command.rows[n].referenceEvidence);t.reportEvidence=cleanReportEvidence(command.rows[n].reportEvidence);t.bankFileProof={version:'bank-file-original-v1',documentId:str(command.documentId,100),sha256:hash,...(reviewedAt?{reviewedAt}:{})};if(hasBankApiOrigin(t))t.bankFileProof.referenceEvidenceSha256=bankFileReferenceHash(t.bankFileProof,t.referenceEvidence);}
   message='Bankoriginalet är kontrolläst igen. Befintliga betalningar och belopp är bevarade.';break;
  }
  if(hash&&s.imports.some(i=>i.hash===hash&&sameAccount(i.account,account)))throw new Error("Den här filen har redan importerats för kontot.");
  const record:ImportRecord={id:uid(),hash,account,name:str(command.name??"Manuell registrering",300),count:0,createdAt:now(),documentId:str(command.documentId??'',100)},keys=new Map<string,string>();let skipped=0,conflicts=0;
  for(const raw of command.rows){
   const t=cleanTransaction({...raw,account:typeof raw.account==='string'&&raw.account.trim()?raw.account:account});t.importId=record.id;if(Array.isArray(raw.referenceParts))t.referenceParts=raw.referenceParts.slice(0,20).map((p:any)=>({value:str(p.value,300),source:str(p.source,200),kind:str(p.kind,60)}));t.organizationNumber=str(raw.organizationNumber??'',40);t.payerAccount=str(raw.payerAccount||'',100);t.remittanceMessage=str(raw.remittanceMessage||'',1000);
   t.original={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};
   if(command.trustedBankImport===true){t.referenceEvidence=structuredClone(raw.referenceEvidence);t.bankData=structuredClone(raw.bankData);t.bankDataSha256=raw.bankDataSha256;t.bankDataVersion=raw.bankDataVersion;t.evidence='bank_api';if(t.bankDataVersion===OPENPAYMENTS_ORIGINAL_VERSION)t.verified=false;else if(t.externalId&&t.kind!=='batch'&&individualParty(t.party)&&usablePaymentReference(t.payerReference)){t.kind='payment';t.verified=true;}}
   else if(trustedFile){t.evidence='bank_file';t.referenceEvidence=structuredClone(raw.referenceEvidence);t.reportEvidence=cleanReportEvidence(raw.reportEvidence);t.bankFileProof={version:'bank-file-original-v1',documentId:record.documentId!,sha256:hash};}
   if(raw.parentKey){const parentId=keys.get(raw.parentKey);if(!parentId)throw new Error("Betalningsspecifikationen saknar sin samlingspost.");if(!individualParty(t.party)||!usablePaymentReference(t.payerReference))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);t.parentId=parentId;}
   const stable=t.externalId?s.transactions.find(x=>sameAccount(x.account,t.account)&&x.externalId===t.externalId):undefined;
   if(stable){
    if(stable.ignored)throw new Error('Bankhändelsen finns redan som undantagen. Återställ den befintliga posten om den ska användas.');
    const financialConflict=stable.amount!==t.amount||stable.date!==t.date||stable.currency!==t.currency;
    const fields=conflictingBankFacts(stable,t);if(financialConflict)fields.push('amountDateCurrency');
    if(t.parentId&&stable.parentId!==t.parentId)fields.push('parentId');
    if(fields.length)retainBankConflict(stable,t,fields);
    if(t.parentId&&stable.parentId!==t.parentId||financialConflict&&command.trustedBankImport!==true)throw new Error("Samma bank-ID har olika uppgifter eller tillhör en annan samlingspost. Kontrollera filerna före import.");
    if(fields.length){conflicts++;skipped++;if(raw.key)keys.set(raw.key,stable.id);continue;}
    if(command.trustedBankImport===true&&stable.bankDataSha256===undefined&&stable.bankDataVersion===undefined&&!bankApiOriginalIssue(t)&&(!stable.bankData||JSON.stringify(stable.bankData)===JSON.stringify(t.bankData))){if(!stable.bankData){stable.bankData=t.bankData;stable.referenceEvidence=t.referenceEvidence;}stable.bankDataSha256=t.bankDataSha256;stable.bankDataVersion=t.bankDataVersion;}
    if(t.kind==='batch'&&stable.kind!=='batch'){if(stable.parentId||stable.duplicateOf||s.allocations.some(a=>a.active&&a.transactionId===stable.id))throw new Error('Samlingsposten är redan matchad eller behöver dubblettkontroll. Ångra matchningen och kontrollera underlaget först.');stable.kind='batch';stable.verified=false;}
    skipped++;if(raw.key)keys.set(raw.key,stable.id);continue;
   }
   const similar=s.transactions.find(x=>x.id!==t.parentId&&x.specificationStatus!=='review'&&possibleDuplicate(x,t));
   if(similar){if(t.kind==='batch')throw new Error('En samlingspost liknar en tidigare bankhändelse. Granska den befintliga posten och dela vid behov upp den där. Ingen ny import gjordes.');t.duplicateOf=similar.id;t.verified=false;}
   if(raw.key)keys.set(raw.key,t.id);s.transactions.push(t);record.count++;
  }
  for(const parent of s.transactions.filter(t=>!t.parentId&&t.bankReference&&needsPaymentSpecification(t))){
   for(const specification of s.transactions.filter(t=>t.specification&&t.parentBankReference===parent.bankReference&&sameAccount(t.account,parent.account))){
    for(const conflict of specification.bankEvidenceConflicts||[])retainBankConflict(parent,{...specification,...conflict.incoming},[...new Set(['specification',...conflict.fields])]);
   }
  }
  for(const parent of s.transactions.filter(t=>t.kind==='batch'&&!t.ignored)){const children=s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored);if(children.length&&(parent.duplicateOf||children.reduce((n,t)=>n+t.amount,0)!==parent.amount))throw new Error("Delbetalningarna stämmer inte med bankens samlingsbelopp eller samlingsposten är en möjlig dubblett. Ingen rad importerades.");}
  for(const i of s.invoices)if(!paid(s,i.id)&&record.count){i.reconciledAt='';i.reconciliationNote='';}
  s.imports.push(record);message=`${record.count} bankhändelser importerade${skipped?`, ${skipped} kända bank-ID:n hoppades över`:''}${conflicts?`. ${conflicts} bankhändelser har motstridiga originaluppgifter och behöver granskas`:''}`;break;
 }
 case'transaction.verify':{
  if(paymentEvidenceConflict(s,getTx(s,command.id)))throw Error(BANK_EVIDENCE_CONFLICT);
  if(paymentOriginalIssue(s,getTx(s,command.id)))throw Error(paymentOriginalIssue(s,getTx(s,command.id)));
  const t=getTx(s,command.id);if(needsBankFileValidation(t))throw Error('Bankoriginalet behöver kontrolläsas igen. Importera samma originalfil för verifiering.');if(t.specificationStatus==='review')throw Error('Specifikationen behöver kopplas till bankens insättning före verifiering.');if(t.ignored)throw new Error("Den här posten kan inte bekräftas som en enskild betalning.");if(needsPaymentSpecification(t))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);if(t.duplicateOf&&!command.confirmDistinct)throw new Error("Kontrollera först om raden är en dubblett.");
  t.original??={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};
  const party=str(command.party??t.party,200),payerReference=str(command.payerReference??t.payerReference,300);
  if((party!==t.party||payerReference!==t.payerReference)&&s.allocations.some(a=>a.active&&a.transactionId===t.id))throw Error('Ångra matchningarna innan betalare eller betalningsreferens ändras.');
  t.party=party;t.payerReference=payerReference;if(!individualParty(t.party)&&!usablePaymentReference(t.payerReference))throw new Error('Betalare eller fakturareferens saknas. Komplettera från bankunderlaget före bekräftelse.');const note=str(command.note??"",1000);if(!note)throw new Error("Beskriv hur du har kontrollerat betalningsuppgifterna.");t.verification={party:t.party,payerReference:t.payerReference,note,at:now()};if(t.evidence==='bank_file'&&t.bankFileProof)t.bankFileProof.reviewedAt=t.verification.at;t.evidence||='manual_verified';t.verified=true;t.kind='payment';t.duplicateOf='';delete t.automaticMatchHold;message="Betalningsuppgifterna är bekräftade";break;
 }
 case'transaction.ignore':{const t=getTx(s,command.id);if(s.allocations.some(a=>a.transactionId===t.id&&a.active))throw new Error("Ångra matchningar först.");if(t.parentId||s.transactions.some(c=>c.parentId===t.id&&!c.ignored))throw new Error("Poster i en samlingsbetalning behöver hanteras tillsammans.");t.ignored=!t.ignored;message=t.ignored?"Bankhändelsen är undantagen":"Bankhändelsen är återställd";break;}
 case'transaction.unverify':{const t=getTx(s,command.id);if(t.kind==='batch'||s.allocations.some(a=>a.active&&a.transactionId===t.id))throw new Error('Ångra matchningar innan du korrigerar betalningsuppgifterna.');t.verified=false;message='Bankhändelsen är öppnad för ny granskning';break;}
 case'transaction.unsplit':{
  const parent=getTx(s,command.id),children=s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored);if(!children.length)throw new Error('Ingen aktiv uppdelning finns.');
  if(children.some(t=>s.allocations.some(a=>a.active&&a.transactionId===t.id)))throw new Error('Ångra delbetalningarnas matchningar innan uppdelningen återtas.');
  for(const t of children)t.ignored=true;parent.kind='batch';parent.verified=false;message='Uppdelningen är återtagen. Importera eller registrera en korrekt betalningsspecifikation.';break;
 }
 case'transaction.split':{
  if(paymentEvidenceConflict(s,getTx(s,command.id)))throw Error(BANK_EVIDENCE_CONFLICT);
  if(paymentOriginalIssue(s,getTx(s,command.id)))throw Error(paymentOriginalIssue(s,getTx(s,command.id)));
  if(getTx(s,command.id).specificationStatus==='review')throw Error('Specifikationen behöver först kopplas till en verifierad bankinsättning.');
  const parent=getTx(s,command.id);if(parent.ignored||parent.parentId||parent.duplicateOf||s.allocations.some(a=>a.transactionId===parent.id&&a.active)||s.transactions.some(t=>t.parentId===parent.id&&!t.ignored))throw new Error("Posten är redan matchad, uppdelad eller behöver dubblettkontroll.");if(!Array.isArray(command.rows)||command.rows.length<1||command.rows.length>100)throw new Error("Lägg till betalningsrader från specifikationen.");
  const children=command.rows.map((raw:any)=>cleanTransaction({...raw,account:parent.account,date:parent.date,source:"Betalningsspecifikation: "+parent.bankReference,kind:"payment",verified:true}));
  if(children.some((t:Transaction)=>!individualParty(t.party)||!usablePaymentReference(t.payerReference)))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);
  if(children.some((t:Transaction)=>Math.sign(t.amount)!==Math.sign(parent.amount))||children.reduce((n:number,t:Transaction)=>n+t.amount,0)!==parent.amount)throw new Error("Summan av betalningsraderna måste stämma exakt med bankposten.");parent.kind='batch';parent.verified=false;for(const t of children){t.parentId=parent.id;t.evidence='verified_specification';if(parent.automaticMatchHold)t.automaticMatchHold=structuredClone(parent.automaticMatchHold);t.original={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};const duplicate=s.transactions.find(x=>!x.ignored&&x.id!==parent.id&&possibleDuplicate(x,t));if(duplicate){t.duplicateOf=duplicate.id;t.verified=false;}s.transactions.push(t);}message="Samlingsbetalningen är uppdelad";break;
 }
 case'match.create':{
  const i=getInvoice(s,command.invoiceId),t=getTx(s,command.transactionId),amount=cents(command.amount),effect=command.effect==='refund'?'refund':'payment';
  if(paymentEvidenceConflict(s,t))throw Error(BANK_EVIDENCE_CONFLICT);
  if(paymentOriginalIssue(s,t))throw Error(paymentOriginalIssue(s,t));
  const review=bankPaymentReview(t,s);if(review&&(review.kind==='reversal'||review.kind==='refund'&&effect!=='refund'))throw Error(review.reason);
  if(needsBankFileReview(t))throw Error('Bankoriginalet behöver kontrolläsas och kontot bekräftas före matchning. Importera samma originalfil och granska bankuppgifterna.');
  if(!i.reviewed||i.voided||!t.verified||t.kind!=='payment'||t.ignored||t.duplicateOf)throw new Error("Granska fakturan och bankhändelsen innan matchning.");if(needsPaymentSpecification(t))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);const expected=(i.direction==='receivable'?1:-1)*(effect==='refund'?-1:1);if(Math.sign(t.amount)!==expected)throw new Error("Betalningens riktning stämmer inte med fakturan.");
  const referenceIssue=invoiceReferenceMatchIssue(s,i,t);if(referenceIssue)throw Error(referenceIssue);
  if(!exactPaymentReference(s,t,i)&&!(sameParty(t.party,i.party)&&Math.abs(balance(s,i))===available(s,t))&&command.referenceCorrection!==true)throw new Error('Matchningen kräver exakt OCR/fakturareferens eller samma betalare och belopp. Beloppet ensamt styrker inte betalningen.');
  if(amount>available(s,t)||amount>balance(s,i)*(effect==='refund'?-1:1))throw new Error("Beloppet överstiger det som återstår. Uppdatera sidan och kontrollera beloppen.");const note=str(command.note??"",1000);if(!note)throw new Error("Ange vilket underlag som bekräftar matchningen.");
  i.reconciledAt=now();s.allocations.push({id:uid(),invoiceId:i.id,transactionId:t.id,amount,effect,active:true,note,createdAt:now()});message=effect==='refund'?"Återbetalningen är avstämd":"Betalningen är matchad";break;
 }
 case'match.undo':{const a=s.allocations.find(a=>a.id===command.id&&a.active);if(!a)throw new Error("Matchningen finns inte längre.");const note=str(command.note??"",1000);if(!note)throw new Error("Ange varför matchningen ångras.");a.active=false;a.reversedAt=now();getTx(s,a.transactionId).automaticMatchHold={at:a.reversedAt,reason:note};const i=getInvoice(s,a.invoiceId);i.reconciledAt='';i.reconciliationNote='';message="Matchningen är ångrad. Automatisk matchning väntar på en ny granskning av betalningsuppgifterna.";break;}
 case'settings.save':{s.company={...s.company,name:str(command.name,200),email:str(command.email,200)};if(Object.hasOwn(command,'invoiceReferencePolicies'))s.company.invoiceReferencePolicies=validateInvoiceReferencePolicies(command.invoiceReferencePolicies);if(!s.company.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.company.email))throw new Error("Ange företagsnamn och en giltig e-postadress.");break;}
 default:throw new Error("Okänd åtgärd.");
 }
 for(const i of s.invoices){if(paid(s,i.id)<0)throw new Error('Ångra kopplade återbetalningar innan den ursprungliga betalningen återtas.');if(credited(s,i.id)>i.total)throw new Error('Kreditbeloppet överstiger fakturans totalbelopp.');}
 for(const a of s.allocations.filter(a=>a.active)){const i=getInvoice(s,a.invoiceId),t=getTx(s,a.transactionId);if(i.voided||!i.reviewed||t.ignored||t.duplicateOf||!t.verified||t.kind!=='payment'||s.transactions.some(c=>c.parentId===t.id&&!c.ignored))throw new Error('En betalningsmatchning saknar giltigt underlag. Ångra matchningen först.');}
 for(const t of s.transactions){if(available(s,t)<0)throw new Error('Bankhändelsen skulle bli överfördelad.');const children=s.transactions.filter(c=>c.parentId===t.id&&!c.ignored);if(children.length&&(t.kind!=='batch'||t.ignored||t.duplicateOf||available(s,t)!==Math.abs(t.amount)||children.reduce((n,c)=>n+c.amount,0)!==t.amount||children.some(c=>Math.sign(c.amount)!==Math.sign(t.amount))))throw new Error('Samlingspostens underlag och delbetalningar är inte avstämda.');}
 if(s.invoices.length>5000||s.transactions.length>15000)throw new Error("Registret är fullt. Exportera underlaget och kontakta systemadministratören.");return{state:s,message};
 }catch(error){
  if(['transactions.import','bankgiro.import'].includes(command.type)){
   const retained=bankImportEvidenceError(current,s,error instanceof Error?error.message:'Bankimporten avbröts.');if(retained)throw retained;
  }
  throw error;
 }
}
export function demoState():State{
 let s=emptyState();s.company.name="M.George Vitvaror AB · demo";const day=today(),offset=(n:number)=>{let d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const rows=[['receivable','Exempelkund Andersson','1001',187500,-8],['receivable','Exempelkund Berg','1002',649500,5],['receivable','Exempelkund Lind','1003',320000,-3],['payable','Exempelleverantör Service','L-2026-10',420000,2],['payable','Exempelleverantör Transport','L-421',98000,-2]];
 for(const[direction,party,number,total,due]of rows)s=applyCommand(s,{type:'invoice.save',invoice:{direction,party,number,total,issued:offset(-25),due:offset(due as number),ocr:direction==='receivable'?String(number)+'9':'',reviewed:true,email:'',source:'Fiktivt exempel'}}).state;
 s=applyCommand(s,{type:'transactions.import',name:'Fiktiva exempel',rows:[{date:offset(-2),amount:187500,party:'Exempelkund Andersson',payerReference:'10019',kind:'payment',verified:true},{date:offset(-1),amount:100000,party:'Exempelkund Lind',payerReference:'10039',kind:'payment',verified:true},{date:offset(-5),amount:717916,description:'Bankgiro inbetalning',bankReference:'EXEMPEL-BG',kind:'unknown'}]}).state;
 s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:s.transactions[0].id,amount:187500,note:'Fiktivt exempel: OCR och belopp'}).state;
 s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[2].id,transactionId:s.transactions[1].id,amount:100000,note:'Fiktivt exempel: delbetalning'}).state;return s;
}
