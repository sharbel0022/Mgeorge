import {randomUUID} from 'node:crypto';
import {listInvoices,listTransactions,audit,today} from './db.js';
import {digest} from './security.js';
import {reconciliationData} from './reconciliation.js';
import {invoiceAbsenceVerified} from './bank-evidence.js';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const paymentAssertions=new Set(['partial','possible_vat','overpayment']);
function messageEvidenceIssue(evidence,message){
  const invoice=evidence.invoices.find(i=>i.id===message.invoice_id);
  if(!invoice)return 'Fakturan saknas.';
  if(paymentAssertions.has(message.kind)&&invoice.payment_evidence_issue)return invoice.payment_evidence_issue;
  if(message.kind==='overdue'&&!invoiceAbsenceVerified(invoice))return 'Utebliven betalning är inte verifierad mot aktuella bankunderlag.';
  return '';
}
const contactIdentity=i=>digest(JSON.stringify([i.party,i.organization_number]));
export function validRecipient(email){
  if(typeof email!=='string'||email.length>240||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||/[\r\n\0]/.test(email))return false;
  const [local,domain]=email.split('@');
  return local.length<=64&&!/^\.|\.$|\.\./.test(local)&&domain.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
export function verifyContact(db,{invoice_id,email,evidence},principal){
  if(!principal||!validRecipient(email)||typeof evidence!=='string'||!evidence.trim()||evidence.length>1000||!db.prepare("SELECT id FROM invoices WHERE id=? AND direction='customer'").get(invoice_id))throw fail('Giltig kundadress och verifieringsunderlag krävs.',400);
  const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(invoice_id);
  db.prepare('INSERT INTO verified_contacts(invoice_id,email,evidence,verified_by,identity) VALUES(?,?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET email=excluded.email,evidence=excluded.evidence,verified_by=excluded.verified_by,identity=excluded.identity,verified_at=CURRENT_TIMESTAMP').run(invoice_id,email,evidence.trim(),principal,contactIdentity(invoice));
  audit(db,'customer_email_verified',{invoice_id,email,evidence,principal});
}
export function paymentSnapshot(db,id){
  // Include unallocated evidence too: a newly received payment invalidates a reminder.
  const invoice=listInvoices(db).find(i=>i.id===id);
  return digest(JSON.stringify({invoice,day:today(),transactions:listTransactions(db).sort((a,b)=>a.id.localeCompare(b.id)),allocations:db.prepare('SELECT * FROM allocations ORDER BY id').all(),contact:db.prepare('SELECT * FROM verified_contacts WHERE invoice_id=?').get(id),links:db.prepare('SELECT * FROM payer_links ORDER BY id').all()}));
}
const money=c=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(c/100);
export function generateMessage(i,kind){
  if(paymentAssertions.has(kind)&&i.payment_evidence_issue)throw fail(i.payment_evidence_issue);
  const intro=`Hej ${i.party},\n\nVi kontaktar er angående faktura ${i.invoice_number} på ${money(i.total_cents)}.`,paid=`Vi har verifierat betalningar på ${money(i.paid_cents)}. Återstående saldo är ${money(i.remaining_cents)}.`;
  const text={partial:`${paid} Vänligen kontrollera resterande belopp och återkom om ni har frågor.`,possible_vat:`${paid} Skillnaden motsvarar fakturans momsbelopp på ${money(i.vat_cents)}. Kan betalningen ha avsett beloppet exklusive moms? Hjälp oss gärna att kontrollera detta.`,missing_reference:'Betalningsunderlaget saknar fakturareferens. Kan ni bekräfta betalningsdatum, belopp och vilken faktura betalningen avser? Betalningen är ännu inte säkert kopplad.',wrong_reference:'Betalningsreferensen behöver kontrolleras. Kan ni bekräfta vilken faktura betalningen avser och ange korrekt fakturanummer?',overdue:`${paid} Förfallodatum var ${i.due_at}. Våra betalningsunderlag har kontrollerats. Vänligen kontrollera betalningen och återkom med betalningsbekräftelse om beloppet redan har betalats.`,overpayment:'En verifierad betalning överstiger det belopp som fördelats till fakturan. Kan ni hjälpa oss att kontrollera vad det överskjutande beloppet avser?',possible_duplicate:'Vi har hittat betalningsunderlag som kan avse ytterligare en betalning för fakturan. Vi behöver er hjälp att kontrollera detta innan vi drar någon slutsats.',confirmation:'Vi behöver hjälp att stämma av betalningsunderlaget. Kan ni skicka betalningsdatum, belopp och betalningsreferens? Vi har ännu inte kunnat fastställa betalningsstatus.'}[kind];
  const referenceNote=kind==='wrong_reference'&&i.payment_references?.length?`\n\nReferenser i underlaget: ${i.payment_references.join(', ')}. Fakturans referens: ${i.reference||i.invoice_number}.`:'';
  return {subject:`Avstämning av faktura ${i.invoice_number}`.replace(/[\r\n\0]/g,' '),body:`${intro}\n\n${text}${referenceNote}\n\nTack för hjälpen!\nM.George Vitvaror AB`};
}
export function prepareMessages(db){
  const evidence=reconciliationData(db);
  for(const m of db.prepare("SELECT * FROM customer_messages WHERE status='draft'").all())if(m.snapshot!==paymentSnapshot(db,m.invoice_id)||messageEvidenceIssue(evidence,m)){
    db.prepare("UPDATE customer_messages SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(m.id);audit(db,'message_invalidated',{id:m.id,version:m.version});
  }
  for(const i of evidence.invoices.filter(i=>i.direction==='customer'&&i.kind!=='credit'&&i.currency==='SEK')){
    const findings=db.prepare('SELECT * FROM reconciliation_findings WHERE invoice_id=? AND active=1').all(i.id);
    const kinds=new Set();
    if(i.paid_cents>0&&i.payment_evidence_issue)kinds.add('confirmation');
    if(i.paid_cents>0&&i.remaining_cents>0&&!i.payment_evidence_issue)kinds.add(i.vat_cents>0&&i.net_cents+i.vat_cents===i.total_cents&&i.remaining_cents===i.vat_cents&&i.net_cents===i.paid_cents?'possible_vat':'partial');
    if(!i.paid_cents&&i.is_overdue)kinds.add(invoiceAbsenceVerified(i)&&!findings.length?'overdue':'confirmation');
    if(findings.some(f=>['reference_conflict','wrong_reference'].includes(f.kind)))kinds.add('wrong_reference');
    const identity=value=>String(value||'').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
    if(findings.some(f=>f.kind==='missing_reference'))kinds.add('missing_reference');
    const allocatedReferences=db.prepare('SELECT t.reference FROM bank_transactions t JOIN allocations a ON a.transaction_id=t.id WHERE a.invoice_id=?').all(i.id).filter(t=>t.reference&&![i.reference,i.invoice_number].some(r=>identity(r)===identity(t.reference))).map(t=>t.reference);
    if(allocatedReferences.length)kinds.add('wrong_reference');
    if(findings.some(f=>f.kind==='possible_duplicate'))kinds.add('possible_duplicate');
    const excess=db.prepare('SELECT t.amount_cents,(SELECT COALESCE(SUM(amount_cents),0) FROM allocations WHERE transaction_id=t.id) AS used FROM bank_transactions t JOIN allocations a ON a.transaction_id=t.id WHERE a.invoice_id=? AND t.excluded=0 AND t.is_aggregate=0').all(i.id).filter(t=>t.amount_cents>t.used);
    if(i.remaining_cents===0&&excess.length&&!i.payment_evidence_issue)kinds.add('overpayment');
    const storedContact=db.prepare('SELECT * FROM verified_contacts WHERE invoice_id=?').get(i.id),contact=storedContact?.identity===contactIdentity(i)?storedContact:null,snapshot=paymentSnapshot(db,i.id);
    for(const kind of kinds){
      if(db.prepare("SELECT id FROM customer_messages WHERE invoice_id=? AND kind=? AND status IN ('sending','sent','unknown') LIMIT 1").get(i.id,kind))continue;
      const content=generateMessage({...i,payment_references:allocatedReferences},kind),id=randomUUID();
      const r=db.prepare('INSERT OR IGNORE INTO customer_messages(id,invoice_id,kind,recipient,subject,body,snapshot) VALUES(?,?,?,?,?,?,?)').run(id,i.id,kind,contact?.email||'',content.subject,content.body,snapshot);
      if(r.changes)audit(db,'message_prepared',{id,invoice_id:i.id,kind,snapshot});
    }
  }
}
export function listMessages(db){
  const evidence=reconciliationData(db);
  return db.prepare('SELECT * FROM customer_messages ORDER BY created_at DESC,rowid DESC').all().map(m=>({...m,status:m.status==='draft'&&(m.snapshot!==paymentSnapshot(db,m.invoice_id)||messageEvidenceIssue(evidence,m))?'stale':m.status,invoice:evidence.invoices.find(i=>i.id===m.invoice_id),contact:db.prepare('SELECT * FROM verified_contacts WHERE invoice_id=?').get(m.invoice_id),findings:db.prepare('SELECT * FROM reconciliation_findings WHERE invoice_id=? AND active=1').all(m.invoice_id).map(f=>({...f,details:JSON.parse(f.details)})),payments:db.prepare('SELECT t.*,a.amount_cents AS verified_cents,(SELECT content IS NOT NULL FROM import_jobs j WHERE j.id=t.import_id) AS has_original FROM allocations a JOIN bank_transactions t ON t.id=a.transaction_id WHERE a.invoice_id=?').all(m.invoice_id),delivery:db.prepare('SELECT * FROM message_deliveries WHERE message_id=?').get(m.id)}));
}
function currentMessage(db,id,version){
  const m=db.prepare('SELECT * FROM customer_messages WHERE id=?').get(id);
  if(!m)throw fail('Meddelandet saknas.',404);
  if(m.status!=='draft'||m.version!==version||m.snapshot!==paymentSnapshot(db,m.invoice_id))throw fail('Utkastet eller betalningsunderlaget har ändrats. Hämta och granska den aktuella versionen.');
  const issue=messageEvidenceIssue(reconciliationData(db),m);if(issue)throw fail('Betalningsunderlaget behöver granskas. '+issue);
  return m;
}
export function editMessage(db,id,{version,subject,body},principal){
  const m=currentMessage(db,id,version);
  if(!principal||typeof subject!=='string'||!subject.trim()||subject.length>240||/[\r\n\0]/.test(subject)||typeof body!=='string'||!body.trim()||body.length>20000||body.includes('\0'))throw fail('Ange giltig ämnesrad och mejltext.',400);
  db.prepare('UPDATE customer_messages SET subject=?,body=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(subject,body,id);
  audit(db,'message_edited',{id,principal,before:{subject:m.subject,body:m.body,version:m.version},after:{subject,body,version:m.version+1}});
}
export function rejectMessage(db,id,version,principal){
  const m=db.prepare('SELECT * FROM customer_messages WHERE id=?').get(id);
  if(!principal||!m||m.version!==version||!['draft','stale'].includes(m.status))throw fail('Meddelandet kan inte avvisas.');
  db.prepare("UPDATE customer_messages SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);audit(db,'message_rejected',{id,principal,version});
}
export function reviewMessage(db,id,version,principal,sessionHash){
  const m=currentMessage(db,id,version);
  if(!principal||!sessionHash)throw fail('Administratörssession krävs.',403);
  const review_id=randomUUID();
  db.prepare('INSERT INTO message_reviews(id,message_id,version,snapshot,principal,session_hash,expires_at) VALUES(?,?,?,?,?,?,?)').run(review_id,id,version,m.snapshot,principal,sessionHash,Date.now()+15*60000);
  audit(db,'message_review_opened',{id,version,principal,review_id});
  return {...m,review_id};
}
export async function approveAndSend(db,id,{version,review_id,approve},principal,sessionHash,{prepare,authorize}){
  if(approve!==true||!principal||!sessionHash)throw fail('Uttryckligt administratörsgodkännande krävs.',403);
  currentMessage(db,id,version);
  // All provider reads/token refreshes happen BEFORE consuming approval.
  const deliver=await prepare();
  authorize();
  let m,deliveryId;
  db.exec('BEGIN IMMEDIATE');
  try{
    m=currentMessage(db,id,version);
    if(db.prepare("SELECT id FROM customer_messages WHERE invoice_id=? AND id<>? AND status IN ('sending','unknown') LIMIT 1").get(m.invoice_id,m.id))throw fail('Ett annat utskick för fakturan har oklar eller pågående leverans. Kontrollera Gmail först.');
    const r=db.prepare('SELECT * FROM message_reviews WHERE id=?').get(review_id||'');
    if(!r||r.message_id!==id||r.version!==version||r.snapshot!==m.snapshot||r.principal!==principal||r.session_hash!==sessionHash||r.consumed||r.expires_at<=Date.now())throw fail('Öppna och läs aktuell mejlversion före godkännandet.',403);
    const contact=db.prepare('SELECT * FROM verified_contacts WHERE invoice_id=?').get(m.invoice_id);
    const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(m.invoice_id);
    if(!validRecipient(m.recipient)||contact?.email!==m.recipient||contact.identity!==contactIdentity(invoice))throw fail('Verifiera kundens mejladress före utskick.');
    const approval=randomUUID();deliveryId=randomUUID();
    db.prepare('UPDATE message_reviews SET consumed=1 WHERE id=?').run(review_id);
    db.prepare('INSERT INTO message_approvals(id,message_id,review_id,principal,version,snapshot) VALUES(?,?,?,?,?,?)').run(approval,id,review_id,principal,version,m.snapshot);
    db.prepare("INSERT INTO message_deliveries(id,message_id,approval_id,status,rfc_message_id) VALUES(?,?,?,'sending',?)").run(deliveryId,id,approval,`<${deliveryId}@mg-fakturakoll.local>`);
    db.prepare("UPDATE customer_messages SET status='sending' WHERE id=?").run(id);
    audit(db,'message_approved',{id,approval,version,principal,recipient:m.recipient,subject:m.subject,body:m.body,snapshot:m.snapshot});db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  try{
    const result=await deliver({...m,rfc_message_id:`<${deliveryId}@mg-fakturakoll.local>`});
    if(typeof result?.id!=='string'||!result.id)throw Error('Missing Gmail message ID');
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("UPDATE message_deliveries SET status='sent',gmail_message_id=?,sent_at=? WHERE id=?").run(result.id,new Date().toISOString(),deliveryId);
      db.prepare("UPDATE customer_messages SET status='sent' WHERE id=?").run(id);audit(db,'message_sent',{id,deliveryId,gmail_message_id:result.id});db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return {status:'sent',gmail_message_id:result.id};
  }catch{
    // Includes HTTP errors and crashes after Gmail accepted: NEVER automatically retry.
    db.prepare("UPDATE message_deliveries SET status='unknown' WHERE id=?").run(deliveryId);
    db.prepare("UPDATE customer_messages SET status='unknown' WHERE id=?").run(id);audit(db,'message_delivery_unknown',{id,deliveryId});
    throw fail('Utskicksstatus är oklar. Kontrollera Skickat i Gmail; systemet skickar inte om meddelandet.',502);
  }
}
