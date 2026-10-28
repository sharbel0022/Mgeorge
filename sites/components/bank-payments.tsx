'use client';
import {money,type State,type Transaction} from '@/lib/domain';
import {bankPaymentCounts,bankPaymentView} from '@/lib/payment-presentation';
type Props={state:State;transactions:Transaction[];candidates?:Record<string,{number:string;party?:string}[]>;open:(id:string)=>void};
const date=(value:string)=>new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',timeZone:'Europe/Stockholm'}).format(new Date(value+'T12:00:00Z'));
export function BankPaymentSummary({state,lastSynced}:{state:State;lastSynced?:string}){
 const counts=bankPaymentCounts(state),synced=lastSynced&&Number.isFinite(Date.parse(lastSynced))?new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(lastSynced)):'Inte bekräftad';
 return <dl className="bank-summary" aria-label="Översikt över bankbetalningar"><div><dt>Verifierade betalningar</dt><dd>{counts.verified}</dd></div><div><dt>Behöver betalningsspecifikation</dt><dd>{counts.specifications}</dd></div><div><dt>Behöver manuell kontroll</dt><dd>{counts.review}</dd></div><div><dt>Senaste lyckade synkronisering</dt><dd className="bank-sync-time">{synced}</dd></div></dl>;
}
export default function BankPayments({state,transactions,candidates={},open}:Props){
 if(!transactions.length)return <p className="bank-filter-empty">Inga bankhändelser matchar ditt filter.</p>;
 const rows=transactions.map(t=>({t,view:bankPaymentView(state,t,candidates[t.id])}));
 return <>
  <div className="bank-desktop-list"><table className="bank-payments-table"><thead><tr><th>Betalare</th><th>Faktura</th><th>OCR</th><th className="numeric">Belopp</th><th>Datum</th><th>Status</th></tr></thead><tbody>{rows.map(({t,view})=><tr key={t.id}><td><button className="bank-open-payment" onClick={()=>open(t.id)} aria-label={`Visa betalning: ${view.payer}, ${money(t.amount)}, ${date(t.date)}`}><strong>{view.payer}</strong><small>{t.parentId?'Del av samlingsinsättning':view.payerKnown?'Enligt bankunderlag':t.verification?'Manuellt kompletterad':'Identitet saknas i bankunderlaget'}</small></button></td><td><span className="mono">{view.invoice}</span></td><td><span className={view.reference.ocr?'mono':'cell-note'}>{view.reference.ocr||'Saknas i bankunderlaget'}</span></td><td className="numeric bank-amount">{t.amount>0?'+':''}{money(t.amount)}</td><td>{date(t.date)}</td><td><span className={`bank-status ${view.verified?'is-verified':''}`}>{view.status}</span></td></tr>)}</tbody></table></div>
  <div className="bank-mobile-list" aria-label="Bankbetalningar">{rows.map(({t,view})=><button className="bank-payment-card" key={t.id} onClick={()=>open(t.id)}><span className="bank-card-heading"><strong>{view.payer}</strong><strong>{t.amount>0?'+':''}{money(t.amount)}</strong></span><span className="bank-card-reference">Faktura {view.invoice}<small>OCR {view.reference.ocr||'Saknas i bankunderlaget'}</small></span><span className="bank-card-footer"><time dateTime={t.date}>{date(t.date)}</time><span className={`bank-status ${view.verified?'is-verified':''}`}>{view.status}</span></span></button>)}</div>
 </>;
}
