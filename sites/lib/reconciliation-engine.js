const paymentSign=i=>(i.direction==='customer'?1:-1)*(i.kind==='credit'?-1:1);
// Shared conservative rules ported from MG Node main d029679. No I/O.
import {matchingReferenceValues} from './payment-references.js';
import {matchesInvoiceReference,strictInvoiceReferenceMatch} from './invoice-reference-policy.js';
import {finalizeReconciliationFindings} from './reconciliation-decisions.js';
export function normalizeName(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
export const RECONCILIATION_RULE_VERSION='evidence-reconciliation-2026-11-05.1';
// Keep invoice-number punctuation: AB/12 and AB12 are not interchangeable IDs.
const ref=value=>String(value||'').normalize('NFKC').trim().toUpperCase().replace(/[ \t]+/g,' ');
export function exactReference(reference, candidate){
  const a=ref(reference),b=ref(candidate);
  if(!a||!b||/^(?:NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/.test(a))return false;
  if(a===b)return true;
  if(/^\d[\d -]*$/.test(a)&&/^\d[\d -]*$/.test(b))return a.replace(/[ -]/g,'')===b.replace(/[ -]/g,'');
  const labelled=a.match(/^(?:FAKTURA(?:NUMMER|\s*NR)?|INVOICE(?:\s*(?:NO|NUMBER))?|OCR(?:[- ]?(?:NUMMER|REFERENS))?)\s*[:#]?\s*([\p{L}\p{N}][\p{L}\p{N}/_-]*)$/u);
  return !!labelled&&labelled[1]===b;
}

function samePayer(i,t,links,nameOf){
  const org=value=>String(value||'').replace(/[- ]/g,'');
  const ownOrg=org(i.organization_number),payerOrg=org(t.payer_organization_number);
  if(ownOrg&&payerOrg)return ownOrg===payerOrg;
  const name=nameOf(t.payer);
  return !!name&&(name===nameOf(i.party)||links.some(l=>{
    const identity=i.organization_number&&l.organization_number?org(i.organization_number)===org(l.organization_number):nameOf(l.party)===nameOf(i.party);
    return identity&&nameOf(l.payer)===name&&l.account===t.account;
  }));
}
/** @param {{invoices:any[],transactions:any[],links?:any[],allocations?:any[]}} data */
export function analyzeReconciliation({invoices,transactions,links=[],allocations=[]}){
  const referenceMatch=(i,value,ownership=false)=>{
    const policy=i.referencePolicy;
    if(!policy?.applies)return [i.reference,i.invoice_number].some(candidate=>exactReference(value,candidate));
    if(ownership)return [policy.intendedPaymentReference,i.invoice_number,i.reference,...(i.referencePolicyIdentifiers||[])].some(candidate=>strictInvoiceReferenceMatch(value,candidate));
    return matchesInvoiceReference(policy,value);
  };
  // Repeated invoice/link comparisons share normalization only for this call.
  // A later analysis must read changed names and relations afresh.
  const namesByValue=new Map(),nameOf=value=>{const raw=String(value||'');let name=namesByValue.get(raw);if(name===undefined){name=normalizeName(raw);namesByValue.set(raw,name);}return name;};
  // Retain every identity in a payer/account bucket. samePayer still applies
  // the original strict account predicate (including NaN !== NaN).
  const linksByAccount=new Map();
  for(const link of links){
    let payers=linksByAccount.get(link.account);if(!payers){payers=new Map();linksByAccount.set(link.account,payers);}
    const name=nameOf(link.payer),bucket=payers.get(name);if(bucket)bucket.push(link);else payers.set(name,[link]);
  }
  const out=[];
  for(const t of transactions){
    if((t.evidence_conflict||t.original_issue)&&!t.excluded){
      const linked=allocations.filter(a=>a.transaction_id===t.id).map(a=>a.invoice_id);
      const references=matchingReferenceValues(t.reference_evidence,t.reference);
      const candidates=invoices.filter(i=>references.some(reference=>referenceMatch(i,reference,true))).map(i=>i.id);
      const ids=[...new Set(linked.length?linked:candidates)];
      for(const id of ids.length?ids:[''])out.push({transaction_id:t.id,invoice_id:id,kind:t.evidence_conflict?'bank_evidence_conflict':'bank_original_review',safe:false,score:100,amount_cents:Math.max(0,t.available_cents||0),reason:t.review_reason||'Bankunderlagen för samma bank-ID är motstridiga och behöver granskas.'});
      continue;
    }
    if(t.excluded||!Number.isSafeInteger(t.amount_cents)||t.amount_cents===0||!Number.isSafeInteger(t.available_cents)||t.available_cents<=0)continue;
    const direction=t.amount_cents>0?'customer':'supplier';
    if(t.is_aggregate){out.push({transaction_id:t.id,invoice_id:'',kind:'aggregate',safe:false,reason:'Samlad insättning kräver individuella betalningsspecifikationer.',score:0});continue;}
    const reference=ref(t.reference);
    // Manual verification is separate evidence; preserved bank candidates still remain visible.
    const evidence=t.reference_evidence;
    const scoped=invoices.some(i=>i.referencePolicy?.applies&&(i.referencePolicyDirection||i.direction)===direction);
    const references=[...new Set([...matchingReferenceValues(evidence,t.reference),...(scoped?t.reference_policy_values||[]:[])])];
    const ownBankgiros=invoices.filter(i=>i.direction==='customer').map(i=>String(i.bankgiro||'').replace(/[\s-]/g,'')).filter(Boolean);
    const ownBankgiro=references.some(r=>ownBankgiros.includes(String(r).replace(/[\s-]/g,'')));
    const invalidReference=ownBankgiro||!!evidence?.incomplete||!!evidence?.candidates?.some(c=>c.validity==='checksum_invalid')||scoped&&!!t.reference_policy_invalid;
    // Include closed invoices: a mistyped OCR may belong to an already paid invoice.
    const owners=references.length?invoices.filter(i=>(!scoped||(i.referencePolicyDirection||i.direction)===direction)&&references.some(r=>referenceMatch(i,r,true))):[];
    const dateOK=i=>!i.issued_at||t.booked_at>=i.issued_at;
    const eligible=invoices.filter(i=>i.direction===direction&&i.kind!=='credit'&&i.currency===t.currency&&paymentSign(i)===Math.sign(t.amount_cents)&&dateOK(i));
    const payerLinks=linksByAccount.get(t.account)?.get(nameOf(t.payer))||[];
    const names=eligible.filter(i=>samePayer(i,t,payerLinks,nameOf)),namedInvoices=new Set(names);
    const tokens=String(t.reference||'').split(/[\s,;+/]+/).map(ref).filter(Boolean);
    const grouped=names.filter(i=>i.remaining_cents>0&&tokens.some(r=>referenceMatch(i,r)));
    if(owners.length===0&&grouped.length>1&&grouped.reduce((s,i)=>s+i.remaining_cents,0)===t.available_cents){
      for(const i of grouped)out.push({transaction_id:t.id,invoice_id:i.id,kind:'multiple_invoices',safe:false,score:85,amount_cents:i.remaining_cents,reason:'En överföring hänvisar till flera fakturor. Bekräfta fördelningen manuellt.'});
      continue;
    }
    for(const i of eligible){
      const exact=owners.some(x=>x.id===i.id)&&(!i.referencePolicy?.applies||references.some(r=>referenceMatch(i,r))),payer=namedInvoices.has(i);
      if(!exact&&!payer&&t.available_cents!==i.remaining_cents)continue; // Amount alone may be shown, but never accepted.
      const policyConflict=i.referencePolicy?.applies&&i.referencePolicy.status==='BLOCKED';
      const conflict=policyConflict||invalidReference||references.some(r=>!referenceMatch(i,r))&&references.length>1||reference&&owners.some(x=>x.id!==i.id);
      const duplicateEvidence=transactions.some(x=>x.id!==t.id&&!x.excluded&&!x.is_aggregate&&x.amount_cents===t.amount_cents&&x.currency===t.currency&&x.booked_at===t.booked_at&&(x.bank_reference&&x.bank_reference===t.bank_reference||x.account!==t.account&&ref(x.reference)===reference&&normalizeName(x.payer)===normalizeName(t.payer)));
      const incomplete=t.parent_bank_reference&&transactions.some(x=>x.account===t.account&&x.bank_reference===t.parent_bank_reference&&x.is_aggregate&&!x.excluded);
      const ambiguous=owners.length>1||names.filter(x=>x.remaining_cents>0).length>1&&!exact||exact&&t.available_cents!==i.remaining_cents&&names.some(x=>x.id!==i.id&&x.remaining_cents===t.available_cents);
      const kind=t.review_reason?'payment_type_review':i.remaining_cents===0?(allocations.some(a=>a.invoice_id===i.id&&a.transaction_id===t.id)?'overpayment':'possible_duplicate'):conflict?'reference_conflict':!exact&&!payer?'unknown_payer':!exact&&reference?'wrong_reference':!reference?'missing_reference':!payer?'different_payer':t.available_cents<i.remaining_cents?'partial':t.available_cents>i.remaining_cents?'overpayment':'correct';
      const invoiceOriginalIssue=i.referencePolicy?.applies&&!i.invoice_original_verified?'Originalfakturan saknas eller har inte kunnat integritetskontrolleras.':'';
      const amountIssue=t.available_cents!==i.remaining_cents?'Delbetalning eller överskott kräver manuell granskning.':'';
      const safe=Number.isSafeInteger(i.remaining_cents)&&!invoiceOriginalIssue&&!amountIssue&&!!t.verified&&exact&&payer&&!t.review_reason&&!conflict&&!ambiguous&&!duplicateEvidence&&!incomplete&&i.remaining_cents>0;
      out.push({transaction_id:t.id,invoice_id:i.id,kind,safe,reference_values:references,reference_sources:evidence?.candidates||[],verified:!!t.verified,score:safe?100:exact?80:payer?60:10,amount_cents:Math.min(t.available_cents,Math.max(0,i.remaining_cents)),reason:t.review_reason||invoiceOriginalIssue||amountIssue||(!t.verified?'Bokfört originalunderlag saknas för automatisk matchning.':incomplete?'Bankgiro-specifikationen är ofullständig.':duplicateEvidence?'Möjlig dubblett mellan bankunderlag; måste granskas.':ownBankgiro?'Referensen är företagets eget Bankgironummer. Granska bankoriginalet.':invalidReference?'OCR-kontrollsiffran är felaktig eller referensanalysen ofullständig. Granska bankoriginalet.':conflict?'Betalningsreferenserna är motstridiga. Ingen automatisk korrigering.':!exact&&!payer?'Endast beloppet stämmer. Okänd betalare måste verifieras; detta är inget betalningsbevis.':ambiguous?'Flera fakturor kan passa.':safe?'Unik fakturareferens, verifierad betalare och bokfört bankunderlag.':'Betalare eller referens behöver verifieras manuellt.')});
    }
  }
  return finalizeReconciliationFindings(out,RECONCILIATION_RULE_VERSION);
}
