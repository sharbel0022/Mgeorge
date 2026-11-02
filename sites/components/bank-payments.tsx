'use client';
import {useMemo,useState} from 'react';
import {economicTransactions,money,validDate,type State,type Transaction} from '@/lib/domain';
import {bankPaymentCounts,bankPaymentView} from '@/lib/payment-presentation';
import ListPagination from './list-pagination';
export {BankReportAvailability} from './bankgiro-availability';

type Props={state:State;transactions:Transaction[];candidates?:Record<string,{number:string;party?:string}[]>;open:(id:string)=>void};
type PaymentView=ReturnType<typeof bankPaymentView>;
const emptyCandidates:NonNullable<Props['candidates']>={},pageSize=50;
const dateFormatter=new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'});
const date=(value:string)=>validDate(value)?dateFormatter.format(new Date(value+'T12:00:00Z')):'Datum saknas';

export function BankPaymentReferences({view}:{view:PaymentView}){
 return <span className="bank-reference-pair">
  <span className="bank-intended-reference"><span className="bank-reference-label">Avsedd betalningsreferens</span>{view.intendedReferences.length?view.intendedReferences.map(item=><span key={item.number}><strong className="mono">{item.value||'Inte angiven'}</strong>{view.intendedReferences.length>1&&<small> · faktura {item.number}</small>}<small className="bank-field-source">Källa: {item.source}</small>{item.conflict&&<small className="bank-reference-note">Avviker från bankrapporterad referens {view.reference.value} · granska originalen</small>}{item.issue&&<small className="bank-reference-note">Blockerad referens: {item.issue}</small>}{item.proposal&&<small className="bank-reference-note">Fakturaförslag · kontrollera originalet</small>}</span>):<span className="cell-note">Inte fastställd</span>}</span>
  <span className="bank-reference"><span className="bank-reference-label">Bankrapporterad referens</span>{view.reference.value?<><strong className="mono">{view.reference.value}</strong><span className="bank-reference-label">{view.reference.ocr?'Formell OCR':view.reference.kind==='ocr'?'Bankrapporterad OCR':view.referenceLabel}</span><span className="bank-field-source">Källa: {view.fieldSources.reference.label}</span></>:<span className="cell-note">Saknas i bankunderlaget</span>}{view.reference.ocrIssue?<span className="bank-reference-note">{view.reference.ocrIssue}</span>:!view.reference.ocr&&<span className="bank-reference-note">Bank-OCR saknas.</span>}</span>
 </span>;
}
function PaymentStatus({view}:{view:PaymentView}){
 return <span className="bank-status-copy"><span className={'bank-status is-'+view.decision.code.toLowerCase()} data-verification-state={view.decision.code}>{view.decision.label}</span>{view.decision.code==='VERIFIED'&&view.status!==view.decision.label&&<small>{view.status}</small>}<span className="bank-next-check"><strong>{view.decision.code==='VERIFIED'?'Kontroll: ':'Återstår: '}</strong>{view.decision.code!=='VERIFIED'&&view.decision.reason+' '}{view.decision.next}</span></span>;
}
export function BankPaymentSummary({state,lastSynced}:{state:State;lastSynced?:string}){
 const counts=useMemo(()=>bankPaymentCounts(state),[state]),synced=lastSynced&&Number.isFinite(Date.parse(lastSynced))?new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(lastSynced)):'Inte bekräftad';
 return <><dl className="bank-summary" aria-label="Översikt över bankbetalningar"><div><dt>Verifierade betalningar</dt><dd>{counts.verified}</dd></div><div><dt>Behöver betalningsspecifikation</dt><dd>{counts.specifications}</dd></div><div><dt>Behöver manuell kontroll</dt><dd>{counts.review}</dd></div><div><dt>Senaste lyckade synkronisering</dt><dd className="bank-sync-time">{synced}</dd><small>Kontohändelser · separat från rapporthämtning</small></div></dl>{counts.observations>0&&<p className="bank-observation-note">{counts.observations} underlagsobservationer visas separat. De ingår inte i antalet ekonomiska betalningar.</p>}</>;
}

export default function BankPayments({state,transactions,candidates=emptyCandidates,open}:Props){
 const [pagination,setPagination]=useState({transactions,page:1});
 // Reset during render so changed filters never briefly show an old page.
 if(pagination.transactions!==transactions)setPagination({transactions,page:1});
 const total=transactions.length,pageCount=Math.max(1,Math.ceil(total/pageSize)),page=pagination.transactions===transactions?Math.min(pagination.page,pageCount):1;
 const start=(page-1)*pageSize,end=Math.min(start+pageSize,total);
 const economicIds=useMemo(()=>new Set(economicTransactions(state).map(t=>t.id)),[state]);
 const rows=useMemo(()=>transactions.slice(start,end).map(t=>{
  const view=bankPaymentView(state,t,candidates[t.id]),economic=economicIds.has(t.id);
  return {t,view,economic,payerNote:view.payerKnown?'':`${t.amount<0?'Mottagare':'Betalare'} okänd – banken har inte lämnat verifierade individuella uppgifter.`,invoiceNote:!view.reference.ocr&&!view.invoiceNumbers.length&&view.possible.length?`Fakturaförslag: ${view.possible.join(', ')} – inte verifierat av bankens OCR.`:''};
 }),[state,transactions,candidates,start,end,economicIds]);
 const observations=rows.filter(row=>!row.economic),payments=rows.filter(row=>row.economic);
 const amount=(t:Transaction,economic:boolean)=><>{!economic&&<small className="bank-evidence-amount-label">Underlagsbelopp</small>}{economic&&t.amount>0?'+':''}{money(t.amount)}</>;
 const payerSource=(view:PaymentView)=>view.payerKnown?view.fieldSources.payer.label:'Identitet saknas i bankunderlaget';
 const desktopRows=(items:typeof rows)=>items.map(({t,view,economic,payerNote,invoiceNote})=><tr key={t.id} data-economic={economic}>
  <td><button type="button" className="bank-open-payment" onClick={()=>open(t.id)} aria-label={`Visa ${economic?'betalning':'underlag'}: ${view.payer}, faktura ${view.invoice}, ${money(t.amount)}, ${date(t.date)}`}><strong>{view.payer}</strong><small>{payerSource(view)}</small>{view.sources&&<small>Källor: {view.sources}</small>}{view.sourceLabel&&<small>{view.sourceLabel}</small>}{view.candidateNote&&<small>{view.candidateNote}</small>}{payerNote&&<small>{payerNote}</small>}</button></td>
  <td><strong className="mono bank-invoice-number">{view.invoice}</strong>{invoiceNote&&<small>{invoiceNote}</small>}</td>
  <td><BankPaymentReferences view={view}/></td>
  <td className="numeric bank-amount">{amount(t,economic)}</td><td><time dateTime={validDate(t.date)?t.date:undefined}>{date(t.date)}</time></td><td><PaymentStatus view={view}/></td>
 </tr>);
 const mobileRows=(items:typeof rows)=>items.map(({t,view,economic,payerNote,invoiceNote})=><button type="button" className="bank-payment-card" key={t.id} data-economic={economic} onClick={()=>open(t.id)}>
  <span className="bank-card-heading"><strong>{view.payer}</strong><strong>{amount(t,economic)}</strong></span><small className="bank-field-source">Källa: {payerSource(view)}</small>{view.sources&&<small>Källor: {view.sources}</small>}{view.candidateNote&&<small>{view.candidateNote}</small>}{payerNote&&<small>{payerNote}</small>}{view.sourceLabel&&<small>{view.sourceLabel}</small>}
  <span className="bank-card-reference"><strong className="bank-invoice-number">Faktura {view.invoice}</strong>{invoiceNote&&<small>{invoiceNote}</small>}<BankPaymentReferences view={view}/></span>
  <span className="bank-payment-footer"><time dateTime={validDate(t.date)?t.date:undefined}>{date(t.date)}</time><PaymentStatus view={view}/></span>
 </button>);
 return <>
  {!total?<p className="bank-filter-empty">Inga bankhändelser matchar ditt filter.</p>:<>
   <div className="bank-desktop-list"><table className="bank-payments-table"><caption className="sr-only">Bankbetalningar och separata underlagsobservationer</caption><thead><tr><th scope="col">Betalare</th><th scope="col">Fakturanummer</th><th scope="col">Referenser</th><th scope="col" className="numeric">Belopp</th><th scope="col">Betalningsdatum</th><th scope="col">Status & nästa kontroll</th></tr></thead>{payments.length>0&&<tbody>{desktopRows(payments)}</tbody>}{observations.length>0&&<tbody className="bank-observation-group"><tr><th scope="rowgroup" colSpan={6}>Underlag · räknas inte som pengar</th></tr>{desktopRows(observations)}</tbody>}</table></div>
   <div className="bank-mobile-list" aria-label="Bankbetalningar">{mobileRows(payments)}{observations.length>0&&<div className="bank-observation-group"><h3>Underlag · räknas inte som pengar</h3>{mobileRows(observations)}</div>}</div>
  </>}
  <ListPagination page={page} pageCount={pageCount} total={total} start={total?start+1:0} end={end} onPageChange={next=>setPagination({transactions,page:next})} label="Bankbetalningar"/>
 </>;
}
