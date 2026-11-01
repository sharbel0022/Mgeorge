'use client';
import {money,type State,type Transaction} from '@/lib/domain';
import {bankPaymentCounts,bankPaymentView} from '@/lib/payment-presentation';
type Props={state:State;transactions:Transaction[];candidates?:Record<string,{number:string;party?:string}[]>;open:(id:string)=>void};
const date=(value:string)=>new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',timeZone:'Europe/Stockholm'}).format(new Date(value+'T12:00:00Z'));
function BankReference({view}:{view:ReturnType<typeof bankPaymentView>}){
 return <span className="bank-reference">{view.reference.value?<><strong className="mono">{view.reference.value}</strong><span className="bank-reference-label">{view.referenceLabel}</span></>:<span className="cell-note">Saknas i bankunderlaget</span>}{!view.reference.ocr&&<span className="bank-reference-note">Bank-OCR saknas.</span>}</span>;
}
export function BankPaymentSummary({state,lastSynced}:{state:State;lastSynced?:string}){
 const counts=bankPaymentCounts(state),synced=lastSynced&&Number.isFinite(Date.parse(lastSynced))?new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(lastSynced)):'Inte bekräftad';
 return <dl className="bank-summary" aria-label="Översikt över bankbetalningar"><div><dt>Verifierade betalningar</dt><dd>{counts.verified}</dd></div><div><dt>Behöver betalningsspecifikation</dt><dd>{counts.specifications}</dd></div><div><dt>Behöver manuell kontroll</dt><dd>{counts.review}</dd></div><div><dt>Senaste lyckade synkronisering</dt><dd className="bank-sync-time">{synced}</dd></div></dl>;
}
export default function BankPayments({state,transactions,candidates={},open}:Props){
 if(!transactions.length)return <p className="bank-filter-empty">Inga bankhändelser matchar ditt filter.</p>;
 const rows=transactions.map(t=>{const view=bankPaymentView(state,t,candidates[t.id]);return {t,view,payerNote:view.payerKnown?'':`${t.amount<0?'Mottagare':'Betalare'} okänd – banken har inte lämnat verifierade individuella uppgifter.`,invoiceNote:!view.reference.ocr&&!view.invoiceNumbers.length&&view.possible.length?`Fakturaförslag: ${view.possible.join(', ')} – inte verifierat av bankens OCR.`:''};});
 return <>
  <div className="bank-desktop-list"><table className="bank-payments-table"><thead><tr><th>Betalare</th><th>Faktura</th><th>Referens / OCR</th><th className="numeric">Belopp</th><th>Datum</th><th>Status</th></tr></thead><tbody>{rows.map(({t,view,payerNote,invoiceNote})=><tr key={t.id}><td><button className="bank-open-payment" onClick={()=>open(t.id)} aria-label={`Visa betalning: ${view.payer}, ${money(t.amount)}, ${date(t.date)}`}><strong>{view.payer}</strong><small>{t.parentId?'Del av samlingsinsättning':view.payerKnown?'Enligt bankunderlag':t.verification?'Manuellt kompletterad':'Identitet saknas i bankunderlaget'}</small>{payerNote&&<small>{payerNote}</small>}</button></td><td><span className="mono">{view.invoice}</span>{invoiceNote&&<small>{invoiceNote}</small>}</td><td><BankReference view={view}/></td><td className="numeric bank-amount">{t.amount>0?'+':''}{money(t.amount)}</td><td>{date(t.date)}</td><td><span className={`bank-status ${view.verified?'is-verified':''}`}>{view.status}</span></td></tr>)}</tbody></table></div>
  <div className="bank-mobile-list" aria-label="Bankbetalningar">{rows.map(({t,view,payerNote,invoiceNote})=><button className="bank-payment-card" key={t.id} onClick={()=>open(t.id)}><span className="bank-card-heading"><strong>{view.payer}</strong><strong>{t.amount>0?'+':''}{money(t.amount)}</strong></span>{payerNote&&<small>{payerNote}</small>}<span className="bank-card-reference">Faktura {view.invoice}{invoiceNote&&<small>{invoiceNote}</small>}<BankReference view={view}/></span><span className="bank-payment-footer"><time dateTime={t.date}>{date(t.date)}</time><span className={`bank-status ${view.verified?'is-verified':''}`}>{view.status}</span></span></button>)}</div>
 </>;
}
