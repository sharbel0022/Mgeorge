import {applyCommand,available,balance,paid,uid,now,needsPaymentSpecification,needsBankFileReview,specificationPreview,individualParty,paymentEvidenceConflict,paymentOriginalIssue,bankPaymentReviewReason,BANK_EVIDENCE_CONFLICT,type State,type Invoice} from './domain';
import {analyzeReconciliation,normalizeName,RECONCILIATION_RULE_VERSION} from './reconciliation-engine.js';

export function invoiceFacts(state:State,i:Invoice){return {...i,invoice_number:i.number,reference:i.ocr,total_cents:i.total,paid_cents:paid(state,i.id),remaining_cents:balance(state,i),vat_cents:i.vat??null,net_cents:i.net??null,due_at:i.due};}
export function analyze(state:State){
  const links=state.allocations.filter(a=>a.active&&a.effect==='payment').flatMap(a=>{
    const i=state.invoices.find(i=>i.id===a.invoiceId),t=state.transactions.find(t=>t.id===a.transactionId);
    return i&&t&&!needsBankFileReview(t)&&!paymentEvidenceConflict(state,t)&&!paymentOriginalIssue(state,t)&&!bankPaymentReviewReason(t)&&i.direction==='receivable'&&t.amount>0?[{invoice_id:i.id,party:i.party,organization_number:i.organizationNumber||'',payer:t.party,account:t.account}]:[];
  });
  const data={invoices:state.invoices.map(i=>({...invoiceFacts(state,i),organization_number:i.organizationNumber||'',direction:i.reviewed&&!i.voided?(i.direction==='receivable'?'customer':'supplier'):'held',kind:'invoice',issued_at:i.issued})),transactions:state.transactions.map(t=>({id:t.id,account:t.account,booked_at:t.date,amount_cents:t.amount,currency:t.currency,payer:t.party,reference:t.payerReference,reference_evidence:t.verification?undefined:t.referenceEvidence,bank_reference:t.bankReference,payer_organization_number:t.organizationNumber||'',excluded:t.ignored||!!t.duplicateOf,is_aggregate:needsPaymentSpecification(t),available_cents:available(state,t),verified:t.verified&&!!t.evidence&&!needsBankFileReview(t),evidence_conflict:paymentEvidenceConflict(state,t),original_issue:paymentOriginalIssue(state,t),review_reason:paymentEvidenceConflict(state,t)?BANK_EVIDENCE_CONFLICT:paymentOriginalIssue(state,t)||bankPaymentReviewReason(t),parent_bank_reference:t.parentId?state.transactions.find(p=>p.id===t.parentId)?.bankReference||'':''})),links,allocations:state.allocations.filter(a=>a.active).map(a=>({invoice_id:a.invoiceId,transaction_id:a.transactionId}))};
  // An actual specification's parent remains as immutable evidence, but its
  // complete child set replaces it economically. Do not treat it as incomplete.
  for(const t of data.transactions)if(t.is_aggregate){const children=state.transactions.filter(c=>c.parentId===t.id&&!c.ignored);if(children.length&&children.every(c=>!c.duplicateOf&&c.specificationStatus!=='review'&&c.account===t.account)&&children.reduce((n,c)=>n+c.amount,0)===t.amount_cents)t.excluded=true;}
  for(const t of data.transactions)if(state.transactions.find(x=>x.id===t.id)?.specificationStatus==='review')t.excluded=true;
  return analyzeReconciliation(data);
}
export function reconcileState(initial:State){
  let state=initial;const decisions:any[]=[];
  // A file may precede its booked aggregate. Reuse its retained original and
  // exact linking controls when the bank subsequently supplies that aggregate.
  for(const record of initial.imports.filter(r=>r.documentId&&r.hash)){
    const original=state.transactions.filter(t=>t.importId===record.id&&t.specification&&t.evidence==='bankgiro_file');
    // Never derive a new entry total from a filtered subset. Missing metadata
    // on older imports requires re-reading the original through explicit import.
    const groups=new Map<string,typeof original>();
    for(const item of original)if(item.specificationGroup)groups.set(item.specificationGroup,[...(groups.get(item.specificationGroup)||[]),item]);
    for(const group of groups.values()){
    const first=group[0],count=first.specificationCount,total=first.specificationTotal;
    if(!Number.isSafeInteger(count)||count!==group.length||!Number.isSafeInteger(total)||group.reduce((sum,t)=>sum+t.amount,0)!==total||group.some(t=>t.specificationCount!==count||t.specificationTotal!==total||t.specificationStatus!=='review'||t.ignored||t.duplicateOf||t.parentId||paymentOriginalIssue(state,t)))continue;
    const preview=specificationPreview(state,group);
    for(const plan of preview.plans.filter(p=>p.status==='linked'&&!p.duplicate&&p.parentId)){
      if(state===initial)state=structuredClone(initial);
      for(const row of plan.rows){const item=state.transactions.find(t=>t.id===row.id)!;item.parentId=plan.parentId!;item.specificationStatus='linked';item.verified=individualParty(item.party);}
      decisions.push({id:uid(),at:now(),kind:'specification_linked',safe:true,transaction_id:plan.parentId,document_id:record.documentId,document_hash:record.hash,child_ids:plan.rows.map(r=>r.id),amount_cents:plan.total,rule_version:RECONCILIATION_RULE_VERSION,reason:plan.reason});
    }
    }
  }
  for(const proposed of analyze(state).filter(s=>s.safe&&s.amount_cents>0)){
    const suggestion=analyze(state).find(s=>s.safe&&s.invoice_id===proposed.invoice_id&&s.transaction_id===proposed.transaction_id&&s.amount_cents>0);
    if(!suggestion)continue;
    const result=applyCommand(state,{type:'match.create',invoiceId:suggestion.invoice_id,transactionId:suggestion.transaction_id,amount:suggestion.amount_cents,note:'Automatisk avstämning ['+suggestion.rule_version+']: '+suggestion.reason});
    state=result.state;decisions.push({...suggestion,id:uid(),at:now()});
  }
  return {state,decisions,findings:analyze(state)};
}
export function contactIdentity(i:Invoice){return JSON.stringify([normalizeName(i.party),String(i.organizationNumber||'').replace(/[- ]/g,'')]);}

/** Read-only comparison mode: no allocations, drafts, imports, or audit writes. */
export function reconciliationPreview(state:State){
 const findings=analyze(state);
 return {mode:'preview' as const,changed:false,automatic_candidates:findings.filter(f=>f.safe).length,review_candidates:findings.filter(f=>!f.safe).length,findings};
}
