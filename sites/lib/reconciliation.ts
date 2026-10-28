import {applyCommand,available,balance,paid,uid,now,needsPaymentSpecification,type State,type Invoice} from './domain';
import {analyzeReconciliation,normalizeName} from './reconciliation-engine.js';

export function invoiceFacts(state:State,i:Invoice){return {...i,invoice_number:i.number,reference:i.ocr,total_cents:i.total,paid_cents:paid(state,i.id),remaining_cents:balance(state,i),vat_cents:i.vat??null,net_cents:i.net??null,due_at:i.due};}
export function analyze(state:State){
  const links=state.allocations.filter(a=>a.active&&a.effect==='payment').flatMap(a=>{
    const i=state.invoices.find(i=>i.id===a.invoiceId),t=state.transactions.find(t=>t.id===a.transactionId);
    return i&&t&&i.direction==='receivable'&&t.amount>0?[{invoice_id:i.id,party:i.party,organization_number:i.organizationNumber||'',payer:t.party,account:t.account}]:[];
  });
  const data={invoices:state.invoices.map(i=>({...invoiceFacts(state,i),organization_number:i.organizationNumber||'',direction:i.reviewed&&!i.voided?(i.direction==='receivable'?'customer':'supplier'):'held',kind:'invoice',issued_at:i.issued})),transactions:state.transactions.map(t=>({id:t.id,account:t.account,booked_at:t.date,amount_cents:t.amount,currency:t.currency,payer:t.party,reference:t.payerReference,bank_reference:t.bankReference,payer_organization_number:t.organizationNumber||'',excluded:t.ignored||!!t.duplicateOf,is_aggregate:needsPaymentSpecification(t),available_cents:available(state,t),verified:t.verified&&!!t.evidence,parent_bank_reference:t.parentId?state.transactions.find(p=>p.id===t.parentId)?.bankReference||'':''})),links,allocations:state.allocations.filter(a=>a.active).map(a=>({invoice_id:a.invoiceId,transaction_id:a.transactionId}))};
  // An actual specification's parent remains as immutable evidence, but its
  // complete child set replaces it economically. Do not treat it as incomplete.
  for(const t of data.transactions)if(t.is_aggregate){const children=state.transactions.filter(c=>c.parentId===t.id&&!c.ignored);if(children.length&&children.reduce((n,c)=>n+c.amount,0)===t.amount_cents)t.excluded=true;}
  for(const t of data.transactions)if(state.transactions.find(x=>x.id===t.id)?.specificationStatus==='review')t.excluded=true;
  return analyzeReconciliation(data);
}
export function reconcileState(initial:State){
  let state=initial;const decisions:any[]=[];
  for(const suggestion of analyze(state).filter(s=>s.safe&&s.amount_cents>0)){
    const result=applyCommand(state,{type:'match.create',invoiceId:suggestion.invoice_id,transactionId:suggestion.transaction_id,amount:suggestion.amount_cents,note:'Automatisk avstämning: '+suggestion.reason});
    state=result.state;decisions.push({...suggestion,id:uid(),at:now()});
  }
  return {state,decisions,findings:analyze(state)};
}
export function contactIdentity(i:Invoice){return JSON.stringify([normalizeName(i.party),String(i.organizationNumber||'').replace(/[- ]/g,'')]);}
