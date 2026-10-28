const paymentSign=i=>(i.direction==='customer'?1:-1)*(i.kind==='credit'?-1:1);
// Shared conservative rules ported from MG Node main d029679. No I/O.
import {matchingReferenceValues} from './payment-references.js';
export function normalizeName(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
export const RECONCILIATION_RULE_VERSION='verified-reference-2026-10-28.2';
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

function samePayer(i,t,links){
  const org=value=>String(value||'').replace(/[- ]/g,'');
  const ownOrg=org(i.organization_number),payerOrg=org(t.payer_organization_number);
  if(ownOrg&&payerOrg)return ownOrg===payerOrg;
  const name=normalizeName(t.payer);
  return !!name&&(name===normalizeName(i.party)||links.some(l=>{
    const identity=i.organization_number&&l.organization_number?org(i.organization_number)===org(l.organization_number):normalizeName(l.party)===normalizeName(i.party);
    return identity&&normalizeName(l.payer)===name&&l.account===t.account;
  }));
}
/** @param {{invoices:any[],transactions:any[],links?:any[],allocations?:any[]}} data */
export function analyzeReconciliation({invoices,transactions,links=[],allocations=[]}){
  const out=[];
  for(const t of transactions){
    if(t.excluded||!Number.isSafeInteger(t.amount_cents)||t.amount_cents===0||!Number.isSafeInteger(t.available_cents)||t.available_cents<=0)continue;
    const direction=t.amount_cents>0?'customer':'supplier';
    if(t.is_aggregate){out.push({transaction_id:t.id,invoice_id:'',kind:'aggregate',safe:false,reason:'Samlad insättning kräver individuella betalningsspecifikationer.',score:0});continue;}
    const reference=ref(t.reference);
    // Manual verification is separate evidence; preserved bank candidates still remain visible.
    const evidence=t.reference_evidence;
    const references=matchingReferenceValues(evidence,t.reference);
    const invalidReference=!!evidence?.incomplete||!!evidence?.candidates?.some(c=>c.validity==='checksum_invalid');
    // Include closed invoices: a mistyped OCR may belong to an already paid invoice.
    const owners=references.length?invoices.filter(i=>[i.reference,i.invoice_number].some(x=>references.some(r=>exactReference(r,x)))):[];
    const dateOK=i=>!i.issued_at||t.booked_at>=i.issued_at;
    const eligible=invoices.filter(i=>i.direction===direction&&i.kind!=='credit'&&i.currency===t.currency&&paymentSign(i)===Math.sign(t.amount_cents)&&dateOK(i));
    const names=eligible.filter(i=>samePayer(i,t,links));
    const tokens=String(t.reference||'').split(/[\s,;+/]+/).map(ref).filter(Boolean);
    const grouped=eligible.filter(i=>i.remaining_cents>0&&samePayer(i,t,links)&&tokens.some(r=>[i.reference,i.invoice_number].some(x=>ref(x)===r)));
    if(owners.length===0&&grouped.length>1&&grouped.reduce((s,i)=>s+i.remaining_cents,0)===t.available_cents){
      for(const i of grouped)out.push({transaction_id:t.id,invoice_id:i.id,kind:'multiple_invoices',safe:false,score:85,amount_cents:i.remaining_cents,reason:'En överföring hänvisar till flera fakturor. Bekräfta fördelningen manuellt.'});
      continue;
    }
    for(const i of eligible){
      const exact=owners.some(x=>x.id===i.id),payer=samePayer(i,t,links);
      if(!exact&&!payer&&t.available_cents!==i.remaining_cents)continue; // Amount alone may be shown, but never accepted.
      const conflict=invalidReference||references.some(r=>!([i.reference,i.invoice_number].some(x=>exactReference(r,x))))&&references.length>1||reference&&owners.some(x=>x.id!==i.id);
      const duplicateEvidence=transactions.some(x=>x.id!==t.id&&!x.excluded&&!x.is_aggregate&&x.amount_cents===t.amount_cents&&x.currency===t.currency&&x.booked_at===t.booked_at&&(x.bank_reference&&x.bank_reference===t.bank_reference||x.account!==t.account&&ref(x.reference)===reference&&normalizeName(x.payer)===normalizeName(t.payer)));
      const incomplete=t.parent_bank_reference&&transactions.some(x=>x.account===t.account&&x.bank_reference===t.parent_bank_reference&&x.is_aggregate&&!x.excluded);
      const ambiguous=owners.length>1||names.filter(x=>x.remaining_cents>0).length>1&&!exact||exact&&t.available_cents!==i.remaining_cents&&names.some(x=>x.id!==i.id&&x.remaining_cents===t.available_cents);
      const kind=i.remaining_cents===0?(allocations.some(a=>a.invoice_id===i.id&&a.transaction_id===t.id)?'overpayment':'possible_duplicate'):conflict?'reference_conflict':!exact&&!payer?'unknown_payer':!exact&&reference?'wrong_reference':!reference?'missing_reference':!payer?'different_payer':t.available_cents<i.remaining_cents?'partial':t.available_cents>i.remaining_cents?'overpayment':'correct';
      const safe=Number.isSafeInteger(i.remaining_cents)&&!!t.verified&&exact&&payer&&!conflict&&!ambiguous&&!duplicateEvidence&&!incomplete&&i.remaining_cents>0;
      out.push({transaction_id:t.id,invoice_id:i.id,kind,safe,reference_values:references,reference_sources:evidence?.candidates||[],verified:!!t.verified,score:safe?100:exact?80:payer?60:10,amount_cents:Math.min(t.available_cents,Math.max(0,i.remaining_cents)),reason:!t.verified?'Bokfört originalunderlag saknas för automatisk matchning.':incomplete?'Bankgiro-specifikationen är ofullständig.':duplicateEvidence?'Möjlig dubblett mellan bankunderlag; måste granskas.':invalidReference?'OCR-kontrollsiffran är felaktig eller referensanalysen ofullständig. Granska bankoriginalet.':conflict?'Betalningsreferenserna är motstridiga. Ingen automatisk korrigering.':!exact&&!payer?'Endast beloppet stämmer. Okänd betalare måste verifieras; detta är inget betalningsbevis.':ambiguous?'Flera fakturor kan passa.':safe?'Unik fakturareferens, verifierad betalare och bokfört bankunderlag.':'Betalare eller referens behöver verifieras manuellt.'});
    }
  }
  // Multiple payments for the same invoice must be reviewed together, never auto-consumed.
  for(const s of out)if(s.invoice_id&&out.some(x=>x.invoice_id===s.invoice_id&&x.transaction_id!==s.transaction_id)){
    s.safe=false;s.reason='Flera betalningar kan avse fakturan; kontrollera möjlig dubbelbetalning.';
    if(s.kind==='correct')s.kind='possible_duplicate';
  }
  return out.map(f=>({...f,rule_version:RECONCILIATION_RULE_VERSION})).sort((a,b)=>b.score-a.score);
}
