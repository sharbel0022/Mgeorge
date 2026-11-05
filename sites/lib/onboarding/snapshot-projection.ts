import {canonicalBankAccount,hasBankApiOrigin,needsPaymentSpecification,paymentEvidenceIssue,type State,type Transaction} from '../domain';
import {bankPaymentFieldSources} from '../payment-presentation';
import {activeConsent,type Snapshot} from './contract';
type SyncStatus={state:string;lastSuccessAt:string|null;nextAllowedAt:string|null;automaticEnabled:boolean;errorCode:string|null;coverage?:{ais:string;bankgiro:string;paymentDataComplete:boolean}};
export function projectSync(snapshot:Snapshot,statuses:SyncStatus[],canSync:boolean,bankgiroRegistered:boolean):Snapshot {
 const result=structuredClone(snapshot),selected=result.accounts.filter(a=>a.selected&&a.importable),active=activeConsent(result);
 const times=statuses.map(s=>s.lastSuccessAt),complete=selected.length>0&&statuses.length===selected.length;
 const lastSuccessAt=complete&&times.every((v):v is string=>!!v)?times.sort()[0]:null;
 const blocked=statuses.find(s=>s.state==='blocked'),failed=statuses.find(s=>s.state==='failed'),next=statuses.map(s=>s.nextAllowedAt).filter((v):v is string=>!!v).sort().at(-1)??null;
 if(complete)result.sync={state:!active?'blocked':statuses.some(s=>s.state==='running')?'running':blocked?'blocked':failed?'failed':statuses.every(s=>s.state==='succeeded')?'succeeded':'never',lastSuccessAt,nextAllowedAt:next,automaticEnabled:statuses.every(s=>s.automaticEnabled),errorCode:!active?'consent_expired':blocked?.errorCode??failed?.errorCode??null};
 result.actions.sync=canSync&&active&&complete&&!['running','queued','blocked'].includes(result.sync.state)&&(!next||Date.parse(next)<=Date.now());
 const available=active&&complete&&bankgiroRegistered&&statuses.every(s=>s.coverage?.bankgiro==='verified');
 result.bankgiro={state:!active?(result.connection?'expired':'unknown'):available?'available':bankgiroRegistered?(statuses.some(s=>s.coverage?.bankgiro==='partial')?'pending':'unknown'):result.banks.find(b=>b.id===result.connection?.bankId)?.bankgiro==='unsupported'?'unsupported':'separate_agreement',lastSuccessAt:available?lastSuccessAt:null,nextAllowedAt:available?next:null,validUntil:available?result.connection!.validUntil:null};
 return result;
}
/** Projects retained observations; neither an import nor a familiar reference
 * is permission to present a payment as verified. Current original/account
 * checks are supplied by the existing evidence service. */
export async function projectPayments({snapshot,state,accounts,checkOriginal}:{snapshot:Snapshot;state:State;accounts:string[];checkOriginal(transaction:Transaction):Promise<boolean>}):Promise<Pick<Snapshot,'payments'|'paymentsHasMore'>>{
 const selected=new Set(accounts.map(canonicalBankAccount));
 const candidates=state.transactions.filter(t=>!t.ignored&&!t.duplicateOf&&(hasBankApiOrigin(t)||t.specification||t.bankFileProof)&&selected.has(canonicalBankAccount(t.account))).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 // A linked aggregate is represented by its children, so the overview cannot
 // imply that the deposit and its underlying payments are separate money.
 const parents=new Set(candidates.map(t=>t.parentId).filter(Boolean));
 const rows=candidates.filter(t=>!parents.has(t.id)).slice(0,101),payments:Snapshot['payments']=[];
 for(const t of rows.slice(0,100)){
  const originalValid=await checkOriginal(t),conflict=!!paymentEvidenceIssue(state,t)||!originalValid;
  // Manual verification is a separate decision; it does not rewrite the
  // payer, reference or classification observed in the selected original.
  const fields=bankPaymentFieldSources(state,t),payer=fields.payer.value||null,reference=fields.reference.value.value||null;
  const importRecord=state.imports.find(item=>item.id===t.importId),candidate=t.bankFileProof?.documentId||importRecord?.documentId||t.importId;
  const evidenceId=candidate&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(candidate)?candidate:null;
  const reason=conflict?'conflict':needsPaymentSpecification(t)?'missing_bankgiro':!payer?'missing_payer':!reference?'missing_reference':t.verified&&t.kind==='payment'&&evidenceId?null:'pending_review';
  payments.push({id:t.id,companyId:snapshot.companyId,date:t.date,amountMinor:t.amount,currency:t.currency,payerName:payer,reference:reference?{value:reference,kind:fields.reference.value.kind==='ocr'?'ocr':fields.reference.value.kind==='invoice'?'invoice':'payment',source:fields.reference.kind==='report'||fields.reference.kind==='transaction'&&fields.reference.row.specification?'bankgiro_report':'bank_account'}:null,verification:{status:reason===null?'verified':conflict||t.kind==='batch'||t.specification?'review':'unverified',evidenceId:reason===null?evidenceId:null,reason}});
 }
 return{payments,paymentsHasMore:rows.length>100};
}
