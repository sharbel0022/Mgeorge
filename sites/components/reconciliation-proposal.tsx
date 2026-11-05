'use client';
import {useEffect,useState} from 'react';

type Status='VERIFIED'|'REVIEW'|'BLOCKED';
type Allocation={invoiceId:string;amountMinor:number;currency:'SEK';invoiceRemainingBeforeMinor:number;invoiceRemainingAfterMinor:number;settlement:'full'|'partial'|'excess'|'multiple'};
type Decision={transactionId:string;status:Status;bankEvidenceStatus:Status;reasonCodes:string[];allocations:Allocation[];availableMinor:number;unallocatedMinor:number;reportedAmountMinor:number;economic:boolean;evidenceValidUntil:string|null};
type Preview={contractVersion:'mgeorge-reconciliation-v1';mode:'preview';changed:false;writesAllowed:false;approvalRequired:true;ownerId:string;companyId:string;checkedAt:string;status:Status;reasonCodes:string[];snapshot:{revision:number;sha256:string};decisions:Decision[];transactionId:string;selectedStatus:Status};
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\u0000-\u001f]/.test(value);
const instant=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const status=(value:unknown)=>typeof value==='string'&&['VERIFIED','REVIEW','BLOCKED'].includes(value);
const natural=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const codes=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=100&&value.every(code=>typeof code==='string'&&/^[A-Z][A-Z_]{1,99}$/.test(code));
/** Read only the producer's unchanged snapshot. A proposal never authorizes a write. */
export function validReconciliationProposal(value:unknown,transactionId:string,revision:number):value is Preview{
 if(!object(value)||value.contractVersion!=='mgeorge-reconciliation-v1'||value.mode!=='preview'||value.changed!==false||value.writesAllowed!==false||value.approvalRequired!==true||!text(value.ownerId)||!text(value.companyId)||!instant(value.checkedAt)||!status(value.status)||!codes(value.reasonCodes))return false;
 if(!object(value.snapshot)||value.snapshot.revision!==revision||!Number.isSafeInteger(revision)||revision<0||typeof value.snapshot.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.snapshot.sha256)||value.transactionId!==transactionId||!status(value.selectedStatus)||!Array.isArray(value.decisions)||value.decisions.length>5000)return false;
 const ids=new Set<string>();
 for(const decision of value.decisions){
  if(!object(decision)||!text(decision.transactionId)||ids.has(decision.transactionId)||!status(decision.status)||!status(decision.bankEvidenceStatus)||!codes(decision.reasonCodes)||!natural(decision.availableMinor)||!natural(decision.unallocatedMinor)||!Number.isSafeInteger(decision.reportedAmountMinor)||typeof decision.economic!=='boolean'||!(decision.evidenceValidUntil===null||instant(decision.evidenceValidUntil))||!Array.isArray(decision.allocations)||decision.allocations.length>1000)return false;
  ids.add(decision.transactionId);let allocated=0;const invoices=new Set<string>();
  for(const allocation of decision.allocations){
   if(!object(allocation)||!text(allocation.invoiceId)||invoices.has(allocation.invoiceId)||!natural(allocation.amountMinor)||allocation.amountMinor===0||allocation.currency!=='SEK'||!natural(allocation.invoiceRemainingBeforeMinor)||!natural(allocation.invoiceRemainingAfterMinor)||allocation.invoiceRemainingBeforeMinor-allocation.amountMinor!==allocation.invoiceRemainingAfterMinor||!['full','partial','excess','multiple'].includes(allocation.settlement))return false;
   invoices.add(allocation.invoiceId);allocated+=allocation.amountMinor;if(!Number.isSafeInteger(allocated))return false;
  }
  if(allocated>decision.availableMinor||decision.unallocatedMinor!==decision.availableMinor-allocated||decision.status==='BLOCKED'&&decision.allocations.length||decision.status==='VERIFIED'&&decision.bankEvidenceStatus!=='VERIFIED')return false;
  if(!decision.economic&&decision.allocations.length)return false;
  // The producer never verifies a multi-invoice, partial or excess proposal.
  // Reject contradictory transport data before it can acquire a green label.
  if(decision.status==='VERIFIED'&&(decision.allocations.length!==1||decision.allocations[0].settlement!=='full'||decision.allocations[0].invoiceRemainingAfterMinor!==0||decision.unallocatedMinor!==0))return false;
  if(decision.allocations.length>1&&(decision.status!=='REVIEW'||!decision.reasonCodes.includes('MULTIPLE_INVOICES_REQUIRE_REVIEW')||decision.unallocatedMinor!==0||decision.allocations.some((allocation:Allocation)=>allocation.settlement!=='multiple'||allocation.invoiceRemainingAfterMinor!==0)))return false;
  if(decision.allocations.length===1&&decision.allocations[0].settlement==='multiple')return false;
 }
 return value.decisions.filter((decision:Decision)=>decision.transactionId===transactionId&&decision.status===value.selectedStatus).length===1;
}

type Read={scope:string;result:Preview|null;loading:boolean;error:string};
export function useReconciliationProposal(transactionId:string,revision:number,demo=false){
 const [attempt,setAttempt]=useState(0),scope=JSON.stringify([transactionId,revision,attempt]);
 const [read,setRead]=useState<Read>({scope,result:null,loading:!demo,error:''});
 useEffect(()=>{
  if(demo)return;
  const controller=new AbortController();let active=true;
  setRead({scope,result:null,loading:true,error:''});
  void(async()=>{try{
   const response=await fetch('/api/reconciliation/preview?transactionId='+encodeURIComponent(transactionId),{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(response.status===404){if(active&&!controller.signal.aborted)setRead({scope,result:null,loading:false,error:'Avstämningsförslaget är inte tillgängligt i denna version.'});return;}
   const value:unknown=await response.json();if(!response.ok||!validReconciliationProposal(value,transactionId,revision))throw Error('invalid_preview');
   if(active&&!controller.signal.aborted)setRead({scope,result:value,loading:false,error:''});
  }catch{if(active&&!controller.signal.aborted)setRead({scope,result:null,loading:false,error:'Avstämningsförslaget kunde inte verifieras. Läs ett nytt förslag.'});}})();
  return()=>{active=false;controller.abort();};
 },[transactionId,revision,demo,attempt,scope]);
 const current=!demo&&read.scope===scope?read:{result:null,loading:!demo,error:''};
 return {...current,retry:()=>setAttempt(value=>value+1)};
}
const reasons:Record<string,string>={
 REFERENCE_POLICY_REQUIRED:'En verifierad företagsregel för betalningsreferensen saknas.',INVOICE_REFERENCE_POLICY_CONFLICT:'Fakturan och företagets referensregel är motstridiga.',
 MANUAL_REPORT_RELATION:'En manuell underlagsrelation behöver granskas separat.',MANUAL_CUSTOMER_RELATION:'En manuellt styrkt kundrelation behöver granskas separat.',
 CUSTOMER_RELATION_REQUIRED:'Betalarens relation till kunden behöver styrkas.',INDIVIDUAL_BANK_PAYER_REQUIRED:'En individuell betalare behöver styrkas i bankoriginalet.',
 INDIVIDUAL_PAYMENT_REPORT_REQUIRED:'Individuella betalningsdetaljer behöver hämtas.',ACCOUNT_EVIDENCE_REQUIRED:'Mottagarkontot behöver styrkas.',
 ORIGINAL_MISSING_OR_INVALID:'Bankoriginalet saknas eller behöver verifieras.',REPORT_ORIGINAL_MISSING_OR_INVALID:'Rapportoriginalet behöver verifieras.',
 PAYMENT_REFERENCE_REQUIRED:'En bankrapporterad betalningsreferens saknas.',CONFLICTING_PAYMENT_REFERENCES:'Bankens betalningsreferenser är motstridiga.',INVALID_OR_CONFLICTING_REFERENCE:'Referensens giltighet eller överensstämmelse behöver kontrolleras.',
 REPORT_DEPOSIT_RELATION_REQUIRED:'Rapportens relation till insättningen behöver styrkas.',REPORT_INCOMPLETE_OR_CONFLICTING:'Rapporten är ofullständig eller motstridig.',
 INVOICE_NOT_FOUND:'Ingen entydig faktura har identifierats.',AMBIGUOUS_INVOICE_REFERENCE:'Flera fakturor har samma referens.',INVOICE_REVIEW_OR_DIRECTION_REQUIRED:'Fakturans granskning eller riktning behöver kontrolleras.',
 PARTIAL_PAYMENT_REQUIRES_REVIEW:'Förslaget gäller en delbetalning och behöver granskas.',OVERPAYMENT_REQUIRES_REVIEW:'Förslaget lämnar ett överskjutande belopp som behöver granskas.',MULTIPLE_INVOICES_REQUIRE_REVIEW:'Fördelning mot flera fakturor behöver granskas.',
 MULTIPLE_INVOICE_AMOUNT_CONFLICT:'Summan av fakturornas återstående belopp stämmer inte exakt med betalningen.',MULTIPLE_INVOICE_CUSTOMER_CONFLICT:'Fakturorna avser olika kunder och kan inte fördelas tillsammans.',COMPETING_PAYMENTS_REQUIRE_REVIEW:'Flera betalningar kan avse samma faktura. Kontrollera dem tillsammans.',
 PAYMENT_ALREADY_ALLOCATED:'Betalningen har redan en registrerad fördelning.',NON_ECONOMIC_REPORT_OBSERVATION:'Underlaget är ingen separat ekonomisk betalning.',BANK_EVIDENCE_CONFLICT:'Bankunderlagen är motstridiga.',
 EXACT_REFERENCE_AND_BANK_EVIDENCE:'Exakt referens och bankunderlag stöder förslaget; separat godkännande krävs.',
};
const money=(value:number)=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(value/100);
type Props={transactionId:string;revision:number;invoices?:{id:string;number:string}[];demo?:boolean};
type ViewProps=Props&{result:Preview|null;loading?:boolean;error?:string;retry?:()=>void};
export function ReconciliationProposalView({transactionId,revision,invoices=[],demo=false,result,loading=false,error='',retry}:ViewProps){
 const valid=result&&validReconciliationProposal(result,transactionId,revision),selected=valid?result.decisions.find(decision=>decision.transactionId===transactionId):undefined;
 const expired=!!selected?.evidenceValidUntil&&Date.parse(selected.evidenceValidUntil)<=Date.now();
 // Overall status includes unrelated decisions; only top-level reason codes
 // describe errors in the shared snapshot that block this selected proposal.
 const snapshotBlocked=valid&&result.reasonCodes.length>0;
 const combined=expired||snapshotBlocked?'BLOCKED':selected?.status,reasonCodes=valid?[...new Set([...result.reasonCodes,...(selected?.reasonCodes||[])])]:[];
 return <section className="payment-verification" aria-label="Separat avstämningsförslag"><h3>Avstämningsförslag · separat godkännande krävs</h3>
  <p>Läsande förhandsgranskning · inga saldon ändras. Förslaget är inte ett godkännande eller en registrerad betalning.</p>
  {demo?<p>Demoläget läser inga avstämningsförslag från sparade bankunderlag.</p>:error?<p role="alert">{error}</p>:loading?<p role="status" aria-busy="true">Läser avstämningsförslaget…</p>:!valid||!selected?<p role="alert">Avstämningsförslaget kunde inte verifieras.</p>:<>
   <p role="status"><strong>{combined==='BLOCKED'?'Blockerat förslag':combined==='REVIEW'?'Behöver granskas':'Underlaget stöder ett förslag'}</strong></p>
   {expired&&<p>Kontoevidensens giltighet har gått ut. Läs ett nytt förslag innan underlaget granskas.</p>}
   {reasonCodes.length>0&&<ul>{reasonCodes.map(code=><li key={code}>{reasons[code]||'Underlaget behöver kontrolleras innan förslaget kan godkännas.'}</li>)}</ul>}
   {combined!=='BLOCKED'&&selected.allocations.length>0&&<dl aria-label="Fördelningens belopp"><div><dt>Tillgängligt i betalningen</dt><dd>{money(selected.availableMinor)}</dd></div><div><dt>Fördelat i förslaget</dt><dd>{money(selected.availableMinor-selected.unallocatedMinor)}</dd></div><div><dt>Kvar att fördela</dt><dd>{money(selected.unallocatedMinor)}</dd></div></dl>}
   {combined!=='BLOCKED'&&selected.allocations.length>0&&<ul aria-label="Föreslagna fakturakopplingar">{selected.allocations.map(allocation=><li key={allocation.invoiceId}>Faktura {invoices.find(invoice=>invoice.id===allocation.invoiceId)?.number||'som behöver identifieras'} · föreslaget belopp {money(allocation.amountMinor)}</li>)}</ul>}
   <p>Kontrollerad {new Date(result.checkedAt).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'})}. Ett nytt förslag behövs om underlaget ändras.</p>
  </>}
  {!demo&&retry&&<button type="button" className="text-button" onClick={retry} disabled={loading}>Läs förslaget igen</button>}
 </section>;
}
export default function ReconciliationProposalPanel(props:Props){
 const read=useReconciliationProposal(props.transactionId,props.revision,props.demo);
 return <ReconciliationProposalView {...props} {...read}/>;
}
