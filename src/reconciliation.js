// Suggestions never constitute payment evidence. All amounts are integer öre.
import {randomUUID} from 'node:crypto';
import {listInvoices,listTransactions,allocate,audit,paymentSign} from './db.js';
import {digest,decryptObject} from './security.js';
import {normalizeBankApiTransaction,parseBankFile} from './importers.js';
import {bankFinancialReview,hasBankEvidenceConflict,bankEvidenceReviewReason,sameBankPaymentIdentity} from './bank-evidence.js';

import {matchingReferenceValues} from './payment-references.js';
export function normalizeName(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
export const RECONCILIATION_RULE_VERSION='verified-reference-2026-10-30.3';
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

export function reconciliationData(db){
  const retained=db.prepare('SELECT id,name,mime_type,content,content_sha256 FROM import_jobs WHERE content IS NOT NULL').all();
  const originals=new Set(retained.filter(x=>x.content_sha256&&digest(x.content)===x.content_sha256).map(x=>x.id));
  const alteredOriginals=new Set(retained.filter(x=>!originals.has(x.id)).map(x=>x.id));
  const transactions=listTransactions(db),allocations=db.prepare('SELECT * FROM allocations').all();
  const canonical=value=>String(value||'').replace(/^iban:/i,'').replace(/\s/g,'').toUpperCase();
  const approvedAccounts=new Set();
  for(const connection of db.prepare("SELECT accounts_json,selected_account_uid,valid_until FROM bank_connections WHERE owner<>'' AND selected_account_uid<>'' AND status IN ('connected','error')").all()){
    if(!(Date.parse(connection.valid_until)>Date.now()))continue;
    try{const selected=decryptObject(connection.accounts_json).find(a=>a.uid===connection.selected_account_uid),account=canonical(selected?.account_id?.iban);if(selected?.currency==='SEK'&&/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(account))approvedAccounts.add(account);}catch{}
  }
  const retainedById=new Map(retained.map(original=>[original.id,original])),parsedFiles=new Map();
  const sameDerivedFacts=(original,t)=>{
    const organization=value=>String(value||'').replace(/[- ]/g,'');
    return ['amount_cents','currency','booked_at','payer','reference','bank_reference'].every(field=>original[field]===t[field])
      &&organization(original.payer_organization_number)===organization(t.payer_organization_number)
      &&String(original.bankgiro||'')===String(t.bankgiro||'')&&String(original.payer_bankgiro||'')===String(t.payer_bankgiro||'')
      &&(original.parent_bank_reference||original.aggregate_parent_reference||'')===t.parent_bank_reference
      &&bankFinancialReview(original,{ancestors:false})?.kind===bankFinancialReview(t,{ancestors:false})?.kind
      &&!!original.is_aggregate===!!t.is_aggregate&&JSON.stringify(original.reference_evidence||{})===JSON.stringify(t.reference_evidence||{});
  };
  const verifiedFileOriginal=t=>{
    if(!t.bank_reference||!originals.has(t.import_id)||!approvedAccounts.has(canonical(t.account)))return false;
    const original=retainedById.get(t.import_id),key=JSON.stringify([t.import_id,t.account]);
    if(!parsedFiles.has(key)){
      try{
        const mediaType=String(original.mime_type||'').split(';',1)[0].trim().toLowerCase();
        if(!(/\.xml$/i.test(original.name)&&mediaType==='application/xml'||/\.csv$/i.test(original.name)&&mediaType==='text/csv'))throw new Error('Unsupported bank original');
        parsedFiles.set(key,parseBankFile(original.name,Buffer.from(original.content).toString('base64'),t.account));
      }catch{parsedFiles.set(key,[]);}
    }
    const matching=parsedFiles.get(key).filter(record=>record.account_evidence?.exact_match&&record.account_evidence.explicit_currency&&canonical(record.account_evidence.reported_account)===canonical(t.account)&&sameDerivedFacts(record,t));
    return matching.length===1;
  };
  const verifiedApiOriginal=t=>{
    if(!t.bank_reference||!t.raw_bank_data_sha256||!t.raw_bank_data||typeof t.raw_bank_data!=='object'||Array.isArray(t.raw_bank_data)||digest(JSON.stringify(t.raw_bank_data))!==t.raw_bank_data_sha256)return false;
    try{const original=normalizeBankApiTransaction(t.raw_bank_data,t.account);return !!original&&sameDerivedFacts(original,t);}catch{return false;}
  };
  const originalVerifiedTransactions=transactions.map(t=>({...t,verified:!hasBankEvidenceConflict(t)&&!alteredOriginals.has(t.import_id)&&(t.source==='enablebanking'&&t.api_identity_version===1&&(verifiedApiOriginal(t)||verifiedFileOriginal(t))||t.source.startsWith('file:')&&verifiedFileOriginal(t))}));
  const originalVerifiedById=new Map(originalVerifiedTransactions.map(t=>[t.id,t.verified]));
  const verifiedTransactions=originalVerifiedTransactions.map(t=>({...t,verified:t.verified&&t.ancestor_bank_transaction_ids.every(id=>originalVerifiedById.get(id)===true)}));
  const transactionsById=new Map(verifiedTransactions.map(transaction=>[transaction.id,transaction]));
  const usablePayerEvidence=new Set(allocations.flatMap(allocation=>{
    const transaction=transactionsById.get(allocation.transaction_id);
    return transaction?.verified&&!transaction.automatic_match_hold?.reason&&!bankFinancialReview(transaction)?[JSON.stringify([allocation.invoice_id,transaction.payer,transaction.account])]:[];
  }));
  const links=db.prepare('SELECT * FROM payer_links').all().filter(link=>link.verified_by!=='allocation'||usablePayerEvidence.has(JSON.stringify([link.invoice_id,link.payer,link.account])));
  return {invoices:listInvoices(db),transactions:verifiedTransactions,links,allocations};
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
export function analyzeReconciliation({invoices,transactions,links=[],allocations=[]}){
  const out=[];
  for(const t of transactions){
    if(t.excluded||!Number.isSafeInteger(t.amount_cents)||t.amount_cents===0||!Number.isSafeInteger(t.available_cents)||t.available_cents<=0)continue;
    const bankConflict=hasBankEvidenceConflict(t),financialReview=bankFinancialReview(t),automaticReview=t.automatic_match_hold?.reason;
    const direction=t.amount_cents>0?'customer':'supplier';
    if(t.is_aggregate){out.push({transaction_id:t.id,invoice_id:'',kind:'aggregate',safe:false,reason:'Samlad insättning kräver individuella betalningsspecifikationer.',score:0});continue;}
    const reference=ref(t.reference);
    // Manual verification is separate evidence; preserved bank candidates still remain visible.
    const evidence=t.reference_evidence;
    const references=matchingReferenceValues(evidence,t.reference);
    const ownBankgiros=invoices.filter(i=>i.direction==='customer').map(i=>String(i.bankgiro||'').replace(/[\s-]/g,'')).filter(Boolean);
    const ownBankgiro=references.some(r=>ownBankgiros.includes(String(r).replace(/[\s-]/g,'')));
    const invalidReference=ownBankgiro||!!evidence?.incomplete||!!evidence?.candidates?.some(c=>c.validity==='checksum_invalid');
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
      const duplicateEvidence=transactions.some(x=>x.id!==t.id&&!x.excluded&&!x.is_aggregate&&x.amount_cents===t.amount_cents&&x.currency===t.currency&&x.booked_at===t.booked_at&&(x.account===t.account&&x.bank_reference&&x.bank_reference===t.bank_reference||x.account!==t.account&&sameBankPaymentIdentity(x,t)));
      const incomplete=t.parent_bank_reference&&transactions.some(x=>x.account===t.account&&x.bank_reference===t.parent_bank_reference&&x.is_aggregate&&!x.excluded);
      const ambiguous=owners.length>1||names.filter(x=>x.remaining_cents>0).length>1&&!exact||exact&&t.available_cents!==i.remaining_cents&&names.some(x=>x.id!==i.id&&x.remaining_cents===t.available_cents);
      const kind=bankConflict?'bank_evidence_conflict':financialReview?'financial_review':automaticReview?'manual_review':i.remaining_cents===0?(allocations.some(a=>a.invoice_id===i.id&&a.transaction_id===t.id)?'overpayment':'possible_duplicate'):conflict?'reference_conflict':!exact&&!payer?'unknown_payer':!exact&&reference?'wrong_reference':!reference?'missing_reference':!payer?'different_payer':t.available_cents<i.remaining_cents?'partial':t.available_cents>i.remaining_cents?'overpayment':'correct';
      const safe=!bankConflict&&!financialReview&&!automaticReview&&Number.isSafeInteger(i.remaining_cents)&&!!t.verified&&exact&&payer&&!conflict&&!ambiguous&&!duplicateEvidence&&!incomplete&&i.remaining_cents>0;
      out.push({transaction_id:t.id,invoice_id:i.id,kind,safe,reference_values:references,reference_sources:evidence?.candidates||[],verified:!!t.verified,score:safe?100:exact?80:payer?60:10,amount_cents:Math.min(t.available_cents,Math.max(0,i.remaining_cents)),reason:bankConflict?bankEvidenceReviewReason(t):financialReview?financialReview.reason:automaticReview||(!t.verified?'Bokfört originalunderlag saknas för automatisk matchning.':incomplete?'Bankgiro-specifikationen är ofullständig.':duplicateEvidence?'Möjlig dubblett mellan bankunderlag; måste granskas.':ownBankgiro?'Referensen är företagets eget Bankgironummer. Granska bankoriginalet.':invalidReference?'OCR-kontrollsiffran är felaktig eller referensanalysen ofullständig. Granska bankoriginalet.':conflict?'Betalningsreferenserna är motstridiga. Ingen automatisk korrigering.':!exact&&!payer?'Endast beloppet stämmer. Okänd betalare måste verifieras; detta är inget betalningsbevis.':ambiguous?'Flera fakturor kan passa.':safe?'Unik fakturareferens, verifierad betalare och bokfört bankunderlag.':'Betalare eller referens behöver verifieras manuellt.')});
    }
  }
  // Multiple payments for the same invoice must be reviewed together, never auto-consumed.
  for(const s of out)if(s.invoice_id&&out.some(x=>x.invoice_id===s.invoice_id&&x.transaction_id!==s.transaction_id)){
    s.safe=false;if(!['financial_review','bank_evidence_conflict','manual_review'].includes(s.kind))s.reason='Flera betalningar kan avse fakturan; kontrollera möjlig dubbelbetalning.';
    if(s.kind==='correct')s.kind='possible_duplicate';
  }
  return out.map(f=>({...f,rule_version:RECONCILIATION_RULE_VERSION})).sort((a,b)=>b.score-a.score);
}
export function runReconciliation(db){
  // Acquire the writer lock before reading any evidence. Imports and other
  // reconciliation processes cannot invalidate the decision before its commit.
  db.exec('BEGIN IMMEDIATE');
  try{
    let suggestions=analyzeReconciliation(reconciliationData(db));
    for(const s of suggestions.filter(s=>s.safe&&s.amount_cents>0)){
      allocate(db,s.invoice_id,s.transaction_id,s.amount_cents,{automatic:true,transactionOpen:true});
      audit(db,'automatic_verified_match',s);
    }
    suggestions=analyzeReconciliation(reconciliationData(db));
    db.prepare('UPDATE reconciliation_findings SET active=0').run();
    for(const s of suggestions.filter(s=>s.invoice_id)){
      const id=digest(JSON.stringify(s));
      db.prepare('INSERT INTO reconciliation_findings(id,invoice_id,transaction_id,kind,details) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=1').run(id,s.invoice_id,s.transaction_id,s.kind,JSON.stringify(s));
    }
    db.exec('COMMIT');
    return suggestions;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function verifyPayer(db,{invoice_id,payer,account,evidence},principal){
  if(!principal||!payer?.trim()||!account?.trim()||!evidence?.trim()||!db.prepare('SELECT id FROM invoices WHERE id=?').get(invoice_id))throw Object.assign(new Error('Kund, betalare, konto och verifieringsunderlag krävs.'),{status:400});
  const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(invoice_id);
  db.prepare('INSERT INTO payer_links(id,invoice_id,payer,account,evidence,verified_by,party,organization_number) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(invoice_id,payer,account) DO UPDATE SET evidence=excluded.evidence,verified_by=excluded.verified_by,party=excluded.party,organization_number=excluded.organization_number').run(randomUUID(),invoice_id,payer.trim(),account.trim(),evidence.trim(),principal,invoice.party,invoice.organization_number);
  audit(db,'payer_verified',{invoice_id,payer,account,evidence,principal});
}
