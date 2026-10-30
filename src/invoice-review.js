import {randomUUID} from 'node:crypto';
import {audit,getSettings,matchingSuggestions} from './db.js';
import {extractInvoice,interpretInvoice,fieldNames,validateInvoiceValues} from './invoice-extraction.js';
import {digest} from './security.js';

const failure=(message,status=409)=>Object.assign(new Error(message),{status});
const identity=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const invoiceNumber=s=>String(s||'').normalize('NFKC').trim().toUpperCase();
const intactOriginal=doc=>!!doc?.content&&/^[a-f0-9]{64}$/.test(doc.fingerprint||'')&&digest(doc.content)===doc.fingerprint;
function automaticRegistrationIssues(db,v){
  const issues=[],candidates=v.organization_number?db.prepare('SELECT * FROM invoices WHERE direction=? AND organization_number=? AND party=?').all(v.direction,v.organization_number,v.party):[];
  const trusted=[];
  // Presence in the invoice table alone is not a verification. Reuse only a
  // human-approved identity/account whose original and approved values remain.
  for(const row of candidates.length?db.prepare("SELECT details FROM audit_events WHERE action='invoice_review_approved' ORDER BY rowid DESC").all():[]){
    let review;try{review=JSON.parse(row.details);}catch{continue;}
    const i=candidates.find(candidate=>candidate.id===review.invoice_id),approved=review.values;
    if(!i||!approved||['direction','party','bankgiro','currency'].some(key=>String(approved[key]||'').trim()!==String(i[key]||''))||identity(approved.organization_number)!==identity(i.organization_number))continue;
    const original=db.prepare("SELECT content,fingerprint FROM documents WHERE id=? AND invoice_id=? AND status='registered'").get(review.id,i.id);
    if(intactOriginal(original))trusted.push(i);
  }
  if(!trusted.length)issues.push('Ny eller okänd motpart behöver granskas.');
  else if(!v.bankgiro||new Set(trusted.map(i=>i.bankgiro)).size!==1||trusted.some(i=>i.bankgiro!==v.bankgiro||i.currency!==v.currency))issues.push('Bankgiro eller valuta avviker från den verifierade motparten. Kontrollera betalningskontot.');
  if(v.vat_cents==null||v.net_cents==null)issues.push('Moms och nettobelopp behöver kontrolleras före automatisk registrering.');
  if(v.kind!=='invoice')issues.push('Dokumenttypen behöver granskas före registrering.');
  return issues;
}
export function duplicateCandidates(db,v){
  return db.prepare('SELECT * FROM invoices WHERE direction=? AND kind=?').all(v.direction,v.kind).filter(i=>invoiceNumber(v.invoice_number)===invoiceNumber(i.invoice_number)&&(v.organization_number&&i.organization_number?identity(v.organization_number)===identity(i.organization_number):identity(v.party)===identity(i.party)));
}
export async function analyzeDocument(db,id,{extract=extractInvoice,authorize=()=>{}}={}){
  const doc=db.prepare('SELECT * FROM documents WHERE id=?').get(id);
  if(!doc)throw failure('Underlaget saknas',404);
  if(doc.invoice_id||doc.status==='dismissed')return JSON.parse(doc.extraction);
  const metadata=JSON.parse(doc.metadata);
  let extraction=intactOriginal(doc)?await extract(Buffer.from(doc.content),doc.mime_type,metadata):interpretInvoice('',metadata);
  authorize();
  // The source may have been registered or dismissed while OCR ran.
  const current=db.prepare('SELECT * FROM documents WHERE id=?').get(id);
  if(!current||current.invoice_id||current.status==='dismissed')return extraction;
  if(!intactOriginal(doc)||!intactOriginal(current)||current.fingerprint!==doc.fingerprint){
    extraction={...interpretInvoice('',metadata),level:'red',issues:['Originalunderlaget kunde inte integritetskontrolleras. Kontrollera originalet före ny tolkning.']};
  }else extraction.processing={...extraction.processing,sha256:doc.fingerprint};
  const v=Object.fromEntries(fieldNames.map(k=>[k,extraction.fields[k].value]));
  const duplicates=duplicateCandidates(db,v);extraction.duplicate_invoice_ids=duplicates.map(i=>i.id);
  if(duplicates.length){extraction.level='yellow';extraction.issues.push('Fakturan verkar redan registrerad. Kontrollera och komplettera originalposten.');}
  const registrationIssues=automaticRegistrationIssues(db,v);
  if(registrationIssues.length){extraction.level=extraction.level==='red'?'red':'yellow';extraction.issues.push(...registrationIssues);}
  db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify(extraction),id);
  audit(db,'document_extracted',{id,level:extraction.level,method:extraction.method,extraction});
  if(extraction.level==='green'&&getSettings(db).auto_register_known===true)approveDocument(db,id,{},true);
  return extraction;
}
export function approveDocument(db,id,body={},automatic=false){
  if(!automatic&&body.confirm!==true)throw failure('Kontrollera originalet och bekräfta fakturauppgifterna.',400);
  db.exec('BEGIN IMMEDIATE');
  try{
    const doc=db.prepare('SELECT * FROM documents WHERE id=?').get(id);
    if(!doc)throw failure('Underlaget saknas',404);
    if(doc.invoice_id){db.exec('COMMIT');return {id:doc.invoice_id,duplicate:true};}
    if(doc.status==='dismissed')throw failure('Återställ underlaget före registrering.');
    if(!intactOriginal(doc))throw failure('Originalunderlaget kunde inte integritetskontrolleras. Kontrollera originalet före registrering.');
    const extraction=JSON.parse(doc.extraction),original=extraction.fields||{};
    if(automatic&&extraction.level!=='green')throw failure('Underlaget kräver granskning.');
    const values={};
    for(const k of fieldNames){const value=body.values&&Object.hasOwn(body.values,k)?body.values[k]:original[k]?.value??null;values[k]=value===''?null:value;}
    for(const k of ['invoice_number','party','organization_number','issued_at','due_at','reference','bankgiro','direction','kind','currency'])if(values[k]!=null&&(typeof values[k]!=='string'||values[k].length>240))throw failure('Ogiltigt fakturafält: '+k,400);
    const issues=validateInvoiceValues(values);
    if(automatic){
      if(getSettings(db).auto_register_known!==true||extraction.processing?.sha256!==doc.fingerprint)issues.push('Automatisk registrering saknar aktuellt godkännande eller verifierat original.');
      issues.push(...automaticRegistrationIssues(db,values));
    }
    for(const k of ['invoice_number','party','issued_at','due_at','total_cents','direction','kind','currency'])if(values[k]==null||typeof values[k]==='string'&&!values[k].trim())issues.push('En nödvändig fakturauppgift saknas.');
    if(!['customer','supplier'].includes(values.direction))issues.push('Välj kund- eller leverantörsfaktura.');
    if(!['invoice','credit'].includes(values.kind))issues.push('Kvitton och andra dokument registreras inte som fakturor.');
    if(issues.length)throw failure(issues.join(' '),400);
    const duplicates=duplicateCandidates(db,values);
    if(duplicates.length){
      // Complement an existing record only after explicit confirmation and an
      // exact semantic identity. A conflicting amount never creates a new debt.
      const target=duplicates.find(i=>i.id===body.link_invoice_id);
      if(!target||target.total_cents!==values.total_cents)throw failure('Fakturan finns redan eller har motstridigt belopp. Öppna originalposten och granska underlaget.');
      db.prepare("UPDATE documents SET invoice_id=?,status='registered' WHERE id=?").run(target.id,id);
      audit(db,'document_duplicate_linked',{id,invoice_id:target.id});db.exec('COMMIT');return {id:target.id,duplicate:true};
    }
    const invoiceId=randomUUID();
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,organization_number,issued_at,due_at,total_cents,vat_cents,net_cents,currency,reference,bankgiro,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(invoiceId,values.direction,values.invoice_number.trim(),values.party.trim(),values.organization_number?.replace(/[- ]/g,'')||'',values.issued_at,values.due_at,values.total_cents,values.vat_cents,values.net_cents,'SEK',values.reference||'',values.bankgiro||'',values.kind);
    db.prepare("UPDATE documents SET invoice_id=?,status='registered' WHERE id=?").run(invoiceId,id);
    const changes={};for(const k of fieldNames)if((original[k]?.value??null)!==values[k])changes[k]={before:original[k]?.value??null,after:values[k]};
    audit(db,automatic?'invoice_auto_registered':'invoice_review_approved',{id,invoice_id:invoiceId,changes,values,extraction_version:extraction.version});
    db.exec('COMMIT');
    return {id:invoiceId,suggestions:matchingSuggestions(db).filter(s=>s.invoice_id===invoiceId)};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
