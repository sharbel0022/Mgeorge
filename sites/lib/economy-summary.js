import {individualParty,needsBankFileReview,needsBankFileValidation,paymentEvidenceConflict,paymentOriginalIssue,usablePaymentReference} from './domain.ts';

/** Read-only projection of confirmed allocations. All values are integer öre. */
export const ECONOMY_RULE_VERSION = 'economy-2026-10-30.1';
export function economySummary(state, at = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || !Number.isFinite(Date.parse(at+'T12:00:00Z')) || new Date(at+'T12:00:00Z').toISOString().slice(0,10)!==at) throw Error('Ogiltigt sammanställningsdatum.');
  const end = new Date(at+'T12:00:00Z'); end.setUTCDate(end.getUTCDate()+7);
  const through = end.toISOString().slice(0,10), month = at.slice(0,7);
  const invoices = state.invoices || [], transactions = state.transactions || [], allocations = state.allocations || [], credits = state.credits || [];
  const byInvoice = new Map(invoices.map(i=>[i.id,i])), byTransaction = new Map(transactions.map(t=>[t.id,t]));
  const issues = [], recentMap = new Map(), used = new Map(), settled = new Map(), credited = new Map(), seen = new Set();
  let received = 0, refunded = 0, unverifiedAllocations = 0;
  const amount = n => Number.isSafeInteger(n) && n>=0;
  if (byInvoice.size!==invoices.length || byTransaction.size!==transactions.length || invoices.some(i=>!i.id) || transactions.some(t=>!t.id)) issues.push('Registret innehåller saknade eller dubbla identifierare.');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const needsSpecification = t => !t.parentId && (t.kind==='batch' || /\bbatch\b|samlings|samlad|buntbetal|sammandrag/i.test(t.description||'') || t.amount>0 && /bankgiro|bg\s*inbetalning/i.test(`${t.description} ${t.party}`) && (!String(t.party||'').trim() || /^(?:bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg|okänd(?: betalare)?|unknown)$/i.test(String(t.party).trim()) || !String(t.payerReference||'').trim() || /^(?:NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(String(t.payerReference).trim())));
  const originalBankFacts = t => {
    // A legacy snapshot may contain typed values. Its name alone proves no bank origin.
    const bankSource=['bank_api','bank_file','bankgiro_file'].includes(t.evidence||'')&&!needsBankFileValidation(t);
    const original=bankSource&&!needsSpecification(t)?t.original||(t.verification?{}:t):{};
    const party=String(t.bankDetails?.party||original.party||'').trim(),reference=String(t.bankDetails?.payerReference||original.payerReference||'').trim();
    const payer=individualParty(party)&&party.length<=200&&!/betalardetaljer|betalningsspecifikation|betalare\s+(?:saknas|okänd)|mottagare\s+okänd|inbetalning\s*[–-]|utbetalning\s*[–-]|^bankgiro\s+inbetalning/iu.test(party)?party:'';
    return {payer,reference:usablePaymentReference(reference)?reference:''};
  };

  for (const a of allocations.filter(a=>a.active)) {
    const i = byInvoice.get(a.invoiceId), t = byTransaction.get(a.transactionId);
    if (!a.id || seen.has(a.id) || !i || !t || !amount(a.amount) || a.amount===0 || !['payment','refund'].includes(a.effect)) { issues.push('En betalningskoppling behöver kontrolleras.'); continue; }
    seen.add(a.id);
    used.set(t.id, (used.get(t.id)||0)+a.amount);
    settled.set(i.id, (settled.get(i.id)||0)+a.amount*(a.effect==='refund'?-1:1));
    const sign = (i.direction==='receivable'?1:-1)*(a.effect==='refund'?-1:1);
    if (!validDate(t.date) || !Number.isSafeInteger(t.amount) || t.currency!=='SEK' || i.currency!=='SEK') {issues.push('En betalningskoppling har ogiltigt datum, belopp eller valuta.');continue;}
    const evidence=t.bankDetails?.referenceEvidence||t.referenceEvidence;
    const referenceConflict=!!evidence?.incomplete||!!evidence?.candidates?.some(c=>c.validity==='checksum_invalid');
    const verified = !needsSpecification(t) && t.verified && t.kind==='payment' && !t.ignored && !t.duplicateOf && t.specificationStatus!=='review' && !needsBankFileReview(t) && !paymentEvidenceConflict(state,t) && !paymentOriginalIssue(state,t) && !referenceConflict && Math.sign(t.amount)===sign;
    if (!verified) { unverifiedAllocations++; continue; }
    if (i.direction!=='receivable' || !i.reviewed || i.voided || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || t.date>at) continue;
    if (t.date.slice(0,7)===month) { if (a.effect==='refund') refunded+=a.amount; else received+=a.amount; }
    if (a.effect==='payment') {
      const key=t.id+'|'+i.id, old=recentMap.get(key);
      recentMap.set(key,{invoice_id:i.id,transaction_id:t.id,number:i.number,customer:i.party,...originalBankFacts(t),manually_completed:!!t.verification,date:t.date,amount_cents:(old?.amount_cents||0)+a.amount});
    }
  }
  for (const [id,n] of used) if (n>Math.abs(byTransaction.get(id)?.amount||0)) issues.push('En bankhändelse har fördelats med ett för stort belopp.');
  const seenCredits=new Set();
  for (const c of credits.filter(c=>c.active)) {
    if (!c.id || seenCredits.has(c.id) || !byInvoice.has(c.invoiceId) || !amount(c.amount)) { issues.push('En kreditkoppling behöver kontrolleras.'); continue; }
    seenCredits.add(c.id); credited.set(c.invoiceId,(credited.get(c.invoiceId)||0)+c.amount);
  }
  let remaining=0,overdue=0,payable=0,payableOverdue=0,unreconciled=0,unreviewed=0,payableCount=0,payableMissingDue=0;
  for (const i of invoices.filter(i=>!i.voided)) {
    if (!i.reviewed) { unreviewed++; continue; }
    if (!amount(i.total) || i.currency!=='SEK' || !['receivable','payable'].includes(i.direction) || i.due&&!validDate(i.due)) {issues.push('En faktura har ogiltigt belopp, valuta, riktning eller förfallodatum.');continue;}
    const left=Math.max(0,i.total-(settled.get(i.id)||0)-(credited.get(i.id)||0));
    if (i.direction==='receivable') {
      remaining+=left;
      if (i.due&&i.due<at) overdue+=left;
      if (left&&(!i.reconciledAt||!i.reconciliationNote?.trim())) unreconciled+=left;
    } else if (left && i.direction==='payable') {
      if (!i.due) payableMissingDue++;
      if (!i.due||i.due<=through) {payable+=left;payableCount++;if(i.due&&i.due<at)payableOverdue+=left;}
    }
  }
  const completeParent = t => {
    const children=transactions.filter(c=>c.parentId===t.id);
    return children.length>0 && children.every(c=>!c.ignored&&!c.duplicateOf&&c.kind==='payment'&&c.specificationStatus!=='review'&&c.account===t.account&&c.currency===t.currency&&Math.sign(c.amount)===Math.sign(t.amount)) && children.reduce((n,c)=>n+c.amount,0)===t.amount;
  };
  const missing=transactions.filter(t=>!t.ignored&&!t.duplicateOf&&!t.parentId&&needsSpecification(t)&&!completeParent(t));
  const unsupported=transactions.filter(t=>!t.ignored&&!t.duplicateOf&&t.specificationStatus==='review');
  const missingAmount=missing.reduce((n,t)=>n+Math.abs(t.amount),0);
  const totals=[received,refunded,remaining,overdue,payable,payableOverdue,unreconciled,missingAmount];
  if (totals.some(n=>!Number.isSafeInteger(n))) issues.push('Sammanställningens belopp överskrider säker precision.');
  return {version:ECONOMY_RULE_VERSION,as_of:at,month,through,valid:issues.length===0,issues:[...new Set(issues)],
    received_month_cents:received,refunded_month_cents:refunded,net_received_month_cents:received-refunded,
    remaining_cents:remaining,overdue_cents:overdue,payable_due_cents:payable,payable_overdue_cents:payableOverdue,payable_due_count:payableCount,payable_missing_due_count:payableMissingDue,
    unreconciled_cents:unreconciled,unreviewed_count:unreviewed,unverified_allocation_count:unverifiedAllocations,
    missing_specification_count:missing.length,missing_specification_cents:missingAmount,unlinked_specification_count:unsupported.length,
    recent_payments:[...recentMap.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.number.localeCompare(b.number)).slice(0,8)};
}
