'use client';
import {usePaymentVerification} from './use-payment-verification';
import type {AccountEvidenceDisplay} from '@/lib/account-evidence-presentation';
import type {PaymentVerification,PaymentVerificationStep} from '@/lib/payment-verification';

const requiredChecks=['received','report','original','account','deposit','payer','reference','invoice','customer','amount','reconciliation'];
type VerificationSummary={state:'verified'|'review'|'blocked';label:string;pending?:Pick<PaymentVerificationStep,'label'|'reason'|'next'>};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function displayableStep(value:unknown):value is PaymentVerificationStep{
 return object(value)&&['id','label','statusLabel','source','checkedAt','rule','reason','next'].every(key=>{const field=value[key];return typeof field==='string'&&field.trim().length>0;})
  &&typeof value.checkedAt==='string'&&Number.isFinite(Date.parse(value.checkedAt))
  &&typeof value.status==='string'&&['passed','missing','blocked','review','manual','not_required'].includes(value.status)
  &&Array.isArray(value.facts)&&value.facts.every(fact=>object(fact)&&typeof fact.label==='string'&&typeof fact.value==='string');
}
function verificationSummary(report:PaymentVerification,steps:PaymentVerificationStep[]):VerificationSummary{
 // The hook validates owner/revision scope. The public renderer also fails
 // closed on incomplete checks, so a missing integrity step cannot look green.
 const complete=report?.mode==='preview'&&report.changed===false&&typeof report.countedEconomically==='boolean'
  &&typeof report.checkedAt==='string'&&Number.isFinite(Date.parse(report.checkedAt))
  &&Number.isSafeInteger(report.bookedAllocationCount)&&report.bookedAllocationCount>=0
  &&Array.isArray(report.steps)&&report.steps.length===requiredChecks.length&&steps.length===requiredChecks.length
  &&requiredChecks.every(id=>steps.filter(step=>step.id===id).length===1)
  &&steps.every(step=>step.status!=='not_required'||step.id==='report'||step.id==='deposit');
 if(!complete)return {state:'blocked',label:'Blockerad',pending:{label:'Kontrollresultatet',reason:'Kontrollresultatet är ofullständigt eller kan inte verifieras.',next:'Läs in betalningskontrollen igen och granska originalen.'}};
 const blocked=steps.find(step=>step.status==='blocked'||step.status==='missing');
 if(blocked)return {state:'blocked',label:'Blockerad',pending:blocked};
 const review=steps.find(step=>step.status==='review'||step.status==='manual');
 if(review)return {state:'review',label:'Behöver granskas',pending:review};
 if(!report.countedEconomically)return {state:'review',label:'Behöver granskas',pending:{label:'Ekonomisk bankpost',reason:'Detta underlag räknas inte som en separat ekonomisk insättning.',next:'Granska den ekonomiska bankposten och underlagets relation till den.'}};
 if(!report.bookedAllocationCount)return {state:'review',label:'Behöver granskas',pending:{label:'Avstämning',reason:'Kontrollen har inte bekräftat någon registrerad betalningskoppling.',next:'Granska underlagen och fatta ett separat beslut om betalningskoppling.'}};
 return {state:'verified',label:'Verifierad'};
}

export function PaymentVerificationReport({report}:{report:PaymentVerification}){
 const steps=Array.isArray(report?.steps)?report.steps.filter(displayableStep):[],summary=verificationSummary(report,steps);
 return <>
  <section className={'payment-verification-summary is-'+summary.state} aria-label="Samlad betalningskontroll">
   <p className="payment-verification-overall" role="status" aria-live="polite" aria-atomic="true"><span>Samlad status</span><strong>{summary.label}</strong></p>
   {summary.pending?<div className="payment-verification-next"><h4>Kontroll som återstår: {summary.pending.label}</h4><p>{summary.pending.reason}</p><p><strong>Nästa steg:</strong> {summary.pending.next}</p></div>:<p>Alla obligatoriska kontroller har godkänts. En betalningskoppling finns registrerad; kontrollen ändrar inget saldo.</p>}
  </section>
  <p className="payment-verification-note">{report?.countedEconomically===true?'Ekonomisk bankpost · räknas som pengar.':report?.countedEconomically===false?'Evidensrad · räknas inte som en separat ekonomisk insättning.':'Ekonomisk omfattning kunde inte verifieras.'}</p><p className="payment-verification-note">Läsande kontroll · inga saldon ändras. Öppna ett steg för källa, regel och nästa åtgärd.</p><ol className="payment-verification-steps">{steps.map((step,index)=><li key={step.id+'-'+index}><details><summary><span className="payment-verification-number" aria-hidden="true">{index+1}</span><span>{step.label}</span><strong className={'payment-verification-status is-'+step.status}>{step.statusLabel}</strong></summary><div className="payment-verification-body"><p>{step.reason}</p><dl><div><dt>Källa</dt><dd>{step.source}</dd></div><div><dt>Kontrollerad</dt><dd>{new Date(step.checkedAt).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'})}</dd></div>{step.facts.map((fact,n)=><div key={n}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}<div><dt>Kontrollregel</dt><dd>{step.rule}</dd></div><div><dt>Nästa steg</dt><dd>{step.next}</dd></div></dl></div></details></li>)}</ol>
 </>;
}

const accountResultLabels:Record<string,string>={matched:'Kontot stämmer',missing:'Uppgift saknas',blocked:'Blockerat',stale:'Inaktuell kontroll',mismatch:'Kontouppgifterna avviker',incomplete:'Ofullständig kontroll',ambiguous:'Tvetydigt resultat',error:'Kontrollen misslyckades',unknown:'Okänt resultat'};
export function AccountEvidenceResult({result}:{result:AccountEvidenceDisplay}){
 return <div role="status" className="payment-verification-body"><strong>{result.verified?'Aktuellt mottagarkonto stämmer':'Mottagarkonto okänt / blockerat'}</strong><p>{result.reason}</p><dl><div><dt>Källa</dt><dd>{result.source}</dd></div><div><dt>Kontrollerad</dt><dd>{result.checkedAt?new Date(result.checkedAt).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'}):'Ingen verifierad aktuell läsning'}</dd></div><div><dt>Fullständighet</dt><dd>{result.complete?'Fullständig läsning':'Ofullständig / okänd'}</dd></div><div><dt>Resultat</dt><dd>{accountResultLabels[result.status]||accountResultLabels.unknown}</dd></div><div><dt>Nästa steg</dt><dd>{result.next}</dd></div></dl></div>;
}
export default function PaymentVerificationPanel({transactionId,revision,demo=false}:{transactionId:string;revision:number;demo?:boolean}){
 const {report,error,loading,retry,account,accountLoading,checkAccount}=usePaymentVerification({transactionId,revision,demo});
 const hint=report?.invoiceHint,title='Betalningskontroll'+(hint?' · '+(hint.proposal?'Fakturaförslag ':'Faktura ')+hint.number:'');
 return <section className="payment-verification" aria-labelledby={'verification-heading-'+transactionId}><h3 id={'verification-heading-'+transactionId}>{title}</h3>{demo?<p>Demoläget har inga åtkomliga bank- eller fakturaoriginal. Verifieringsstegen visas vid läsning av en sparad betalning.</p>:<div aria-busy={loading}>{loading&&<p role="status">Kontrollerar bevarade underlag…</p>}{error&&<p role="alert">{error} <button type="button" className="text-button" onClick={retry}>Försök igen</button></p>}{report&&<><PaymentVerificationReport report={report}/>{report.accountEvidenceTarget&&<section aria-labelledby={'account-check-'+transactionId}><h4 id={'account-check-'+transactionId}>Aktuell kontokontroll · separat läsning</h4><p>Knappen läser bankens aktuella kontouppgifter. Sparat medgivande, original, underlagsrelation och fakturasaldo ändras inte.</p><button type="button" className="btn" disabled={accountLoading} onClick={()=>void checkAccount()}>{accountLoading?'Läser aktuella kontouppgifter…':'Kontrollera mottagarkonto hos banken'}</button>{accountLoading&&<p role="status">Kontrollerar bankens aktuella konto…</p>}{account&&<AccountEvidenceResult result={account}/>}</section>}</>}</div>}</section>;
}
