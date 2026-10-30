import {db,identity,readWorkspace,response} from './server';
import {uid,now,today,applyCommand,balance,hasValidAbsenceCheck,invoicePaymentEvidenceIssue,paymentEvidenceIssue,type State} from './domain';
import {analyze,invoiceFacts,contactIdentity} from './reconciliation';
import {reconcileWithOriginals} from './reconciliation-evidence';
import {generateMessage,validRecipient} from './customer-message-text.js';
import {digest,randomToken,cookieValue} from './banking/security';
import {encrypt,decrypt} from './banking/store';
import {prepareGmailSend,gmailAccount,hasGmailSendScope} from './gmail-adapter.js';

type Row=Record<string,any>;
const error=(text:string,status=409)=>Object.assign(Error(text),{safe:true,status});
async function audit(owner:string,action:string,detail:unknown){
  const {revision}=await readWorkspace(owner);
  await db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),owner,revision,action,JSON.stringify(detail),now()).run();
}
export async function evidenceSnapshot(state:State,contact:Row|null){return digest(JSON.stringify({state,contact,day:today()}));}
async function contactFor(owner:string,id:string){return db().prepare('SELECT * FROM customer_contacts WHERE owner=? AND invoice_id=?').bind(owner,id).first<Row>();}
async function getMessage(owner:string,id:string){const m=await db().prepare('SELECT * FROM customer_messages WHERE owner=? AND id=?').bind(owner,id).first<Row>();if(!m)throw error('Meddelandet saknas.',404);return m;}
function validMessageEvidence(state:State,m:Row){
 const invoice=state.invoices.find(i=>i.id===m.invoice_id);if(!invoice)return false;
 if(['partial','possible_vat','overpayment','overdue'].includes(m.kind)&&invoicePaymentEvidenceIssue(state,invoice.id))return false;
 return m.kind!=='overdue'||hasValidAbsenceCheck(state,invoice);
}
async function current(owner:string,id:string,version:number){
  const m=await getMessage(owner,id),workspace=await readWorkspace(owner),contact=await contactFor(owner,m.invoice_id);
  if(m.status!=='draft'||m.version!==version||!validMessageEvidence(workspace.state,m)||m.snapshot!==await evidenceSnapshot(workspace.state,contact))throw error('Utkastet eller betalningsunderlaget har ändrats. Uppdatera och granska den nya versionen.');
  const invoice=workspace.state.invoices.find(i=>i.id===m.invoice_id);
  if(!invoice||invoice.voided||!invoice.reviewed)throw error('Fakturan behöver kontrolleras.');
  return {m,workspace,contact,invoice};
}
export async function reconcileAndPrepare(owner:string){
  let workspace=await readWorkspace(owner);const result=await reconcileWithOriginals(owner,workspace.state);
  if(result.decisions.length){
    if(new TextEncoder().encode(JSON.stringify(result.state)).length>1800000)throw error('Registret behöver utökad lagring innan fler automatiska matchningar sparas.');
    const at=now(),eventId=uid();
    const batch=await db().batch([
      db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(eventId,owner,workspace.revision+1,'automatic.reconciliation',JSON.stringify({decisions:result.decisions}),at,owner,workspace.revision),
      db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(result.state),at,owner,workspace.revision),
    ]);
    if(batch[1].meta.changes!==1)throw error('Nya uppgifter sparades samtidigt. Kör kontrollen igen.');
    workspace={state:result.state,revision:workspace.revision+1};
  }
  const findings=analyze(workspace.state);
  const statements=[db().prepare('UPDATE reconciliation_findings SET active=0 WHERE owner=?').bind(owner)];
  for(const f of findings.filter(f=>f.invoice_id))statements.push(db().prepare('INSERT INTO reconciliation_findings(id,owner,invoice_id,transaction_id,kind,details,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=1').bind(await digest(owner+JSON.stringify(f)),owner,f.invoice_id,f.transaction_id,f.kind,JSON.stringify(f),now()));
  // D1 caps statements per batch. Findings are derived; financial CAS above is authoritative.
  for(let n=0;n<statements.length;n+=50)await db().batch(statements.slice(n,n+50));
  const existing=await db().prepare('SELECT * FROM customer_messages WHERE owner=?').bind(owner).all<Row>();
  for(const m of existing.results.filter(m=>m.status==='draft')){
    if(validMessageEvidence(workspace.state,m)&&m.snapshot===await evidenceSnapshot(workspace.state,await contactFor(owner,m.invoice_id)))continue;
    await db().batch([
      db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?, 'message.invalidated',?,? WHERE EXISTS(SELECT 1 FROM customer_messages WHERE id=? AND owner=? AND status='draft')").bind(uid(),owner,workspace.revision,JSON.stringify({id:m.id,version:m.version}),now(),m.id,owner),
      db().prepare("UPDATE customer_messages SET status='stale',updated_at=? WHERE owner=? AND id=? AND status='draft'").bind(now(),owner,m.id),
    ]);m.status='stale';
  }
  for(const i of workspace.state.invoices.filter(i=>i.direction==='receivable'&&i.reviewed&&!i.voided)){
    const contact=await contactFor(owner,i.id),snapshot=await evidenceSnapshot(workspace.state,contact),facts=invoiceFacts(workspace.state,i),related=findings.filter(f=>f.invoice_id===i.id);
    for(const m of existing.results.filter(m=>m.invoice_id===i.id&&m.status==='draft'&&m.snapshot!==snapshot)){
      await db().batch([
        db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?, 'message.invalidated',?,? WHERE EXISTS(SELECT 1 FROM customer_messages WHERE id=? AND owner=? AND status='draft')").bind(uid(),owner,workspace.revision,JSON.stringify({id:m.id,version:m.version}),now(),m.id,owner),
        db().prepare("UPDATE customer_messages SET status='stale',updated_at=? WHERE owner=? AND id=? AND status='draft'").bind(now(),owner,m.id),
      ]);
    }
    const kinds=new Set<string>(),paymentReferences:string[]=[];
    if(facts.payment_evidence_issue)kinds.add('confirmation');
    if(facts.paid_cents>0&&facts.remaining_cents>0)kinds.add(i.vat&&i.net!=null&&i.net+i.vat===i.total&&facts.remaining_cents===i.vat&&i.net===facts.paid_cents?'possible_vat':'partial');
    if(!facts.paid_cents&&facts.remaining_cents>0&&i.due&&i.due<today())kinds.add(hasValidAbsenceCheck(workspace.state,i)&&!related.length?'overdue':'confirmation');
    if(related.some(f=>['wrong_reference','reference_conflict'].includes(f.kind)))kinds.add('wrong_reference');
    if(related.some(f=>f.kind==='missing_reference'))kinds.add('missing_reference');
    if(related.some(f=>f.kind==='possible_duplicate'))kinds.add('possible_duplicate');
    for(const a of workspace.state.allocations.filter(a=>a.active&&a.invoiceId===i.id&&a.effect==='payment')){
      const t=workspace.state.transactions.find(t=>t.id===a.transactionId);if(!t)continue;
      if(t.payerReference&&![i.ocr,i.number].some(r=>r.replace(/\W/g,'')===t.payerReference.replace(/\W/g,'')))paymentReferences.push(t.payerReference);
      const used=workspace.state.allocations.filter(a=>a.active&&a.transactionId===t.id).reduce((n,a)=>n+a.amount,0);
      if(balance(workspace.state,i)===0&&t.amount>used)kinds.add('overpayment');
    }
    if(paymentReferences.length)kinds.add('wrong_reference');
    const recipient=contact?.identity===contactIdentity(i)?contact.email:'';
    for(const kind of kinds){
      if(!validMessageEvidence(workspace.state,{kind,invoice_id:i.id}))continue;
      if(existing.results.some(m=>m.invoice_id===i.id&&m.kind===kind&&['sent','sending','unknown'].includes(m.status)))continue;
      const text=generateMessage({...facts,payment_references:paymentReferences},kind),id=uid(),at=now();
      const r=await db().prepare('INSERT OR IGNORE INTO customer_messages(id,owner,invoice_id,kind,recipient,subject,body,snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,owner,i.id,kind,recipient,text.subject,text.body,snapshot,at,at).run();
      if(r.meta.changes)await audit(owner,'message.prepared',{id,kind,snapshot});
    }
  }
  return {findings,automatic:result.decisions.filter(d=>d.safe===true&&d.invoice_id&&d.transaction_id&&d.amount_cents>0).length};
}
export async function messageList(owner:string){
  const workspace=await readWorkspace(owner),rows=await db().prepare('SELECT * FROM customer_messages WHERE owner=? ORDER BY created_at DESC').bind(owner).all<Row>();
  const findings=analyze(workspace.state),items=[];
  for(const m of rows.results){
    const invoice=workspace.state.invoices.find(i=>i.id===m.invoice_id);if(!invoice)continue;
    const contact=await contactFor(owner,m.invoice_id),snapshot=await evidenceSnapshot(workspace.state,contact);
    const payments=workspace.state.allocations.filter(a=>a.active&&a.invoiceId===invoice.id).map(a=>{const t=workspace.state.transactions.find(t=>t.id===a.transactionId);return {...t,allocated:a.amount,effect:a.effect,evidence_issue:t?paymentEvidenceIssue(workspace.state,t):'Betalningsunderlaget saknas.',documentId:workspace.state.imports.find(j=>j.id===t?.importId)?.documentId||''};});
    const related=findings.filter(f=>f.invoice_id===invoice.id).map(f=>({...f,transaction:workspace.state.transactions.find(t=>t.id===f.transaction_id)}));
    const delivery=await db().prepare('SELECT id,status,gmail_message_id,rfc_message_id,approved_at,sent_at FROM customer_deliveries WHERE owner=? AND message_id=?').bind(owner,m.id).first();
    items.push({...m,status:m.status==='draft'&&(!validMessageEvidence(workspace.state,m)||m.snapshot!==snapshot)?'stale':m.status,invoice,facts:invoiceFacts(workspace.state,invoice),contact,payments,findings:related,delivery});
  }
  return {items};
}
async function verifyContact(owner:string,body:Row){
  const w=await readWorkspace(owner),i=w.state.invoices.find(i=>i.id===body.invoice_id&&i.direction==='receivable');
  if(!i||!validRecipient(body.email)||typeof body.evidence!=='string'||!body.evidence.trim()||body.evidence.length>1000||body.confirm!==true)throw error('Kontrollera kundadress och ange verifieringsunderlaget.',400);
  await db().batch([
    db().prepare('INSERT INTO customer_contacts(owner,invoice_id,email,identity,evidence,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,invoice_id) DO UPDATE SET email=excluded.email,identity=excluded.identity,evidence=excluded.evidence,version=customer_contacts.version+1,updated_at=excluded.updated_at').bind(owner,i.id,body.email,contactIdentity(i),body.evidence,now()),
    db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),owner,w.revision,'customer.address.verified',JSON.stringify(body),now()),
  ]);
  await reconcileAndPrepare(owner);return response({ok:true});
}
export async function messagesAction(req:Request,action:string){
  const user=await identity(req),owner=user.userId;
  if(req.method==='GET')return action==='list'?response(await messageList(owner)):response({error:'Metoden är inte tillåten.'},405);
  if(req.method!=='POST')return response({error:'Metoden är inte tillåten.'},405);
  const raw=await req.text();if(raw.length>30000)throw error('För stor förfrågan.',413);const body:Row=JSON.parse(raw||'{}');
  if(action==='reconcile')return response(await reconcileAndPrepare(owner));
  if(action==='contact')return verifyContact(owner,body);
  if(action==='absence'){
    const old=await readWorkspace(owner),result=applyCommand(old.state,{type:'invoice.reconcile',id:body.invoice_id,confirm:body.confirm,note:body.note}),at=now();
    const batch=await db().batch([
      db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,'invoice.absence.checked',?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)").bind(uid(),owner,old.revision+1,JSON.stringify(body),at,owner,old.revision),
      db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(result.state),at,owner,old.revision),
    ]);if(batch[1].meta.changes!==1)throw error('Bankunderlaget ändrades. Kontrollera igen.');
    await reconcileAndPrepare(owner);return response({ok:true});
  }
  const id=typeof body.id==='string'?body.id:'',version=body.version;
  if(action==='reject'){
    const m=await getMessage(owner,id);if(m.version!==version||!['draft','stale'].includes(m.status))throw error('Meddelandet kan inte avvisas.');
    await db().batch([
      db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,0,'message.rejected',?,? WHERE EXISTS(SELECT 1 FROM customer_messages WHERE owner=? AND id=? AND version=? AND status IN ('draft','stale'))").bind(uid(),owner,JSON.stringify({id,version}),now(),owner,id,version),
      db().prepare("UPDATE customer_messages SET status='rejected',updated_at=? WHERE owner=? AND id=? AND version=? AND status IN ('draft','stale')").bind(now(),owner,id,version),
    ]);return response({ok:true});
  }
  if(action==='send'&&body.approve!==true)throw error('Uttryckligt administratörsgodkännande krävs.',403);
  const c=await current(owner,id,version);
  if(action==='edit'){
    if(typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>240||/[\r\n\0]/.test(body.subject)||typeof body.body!=='string'||!body.body.trim()||body.body.length>20000||body.body.includes('\0'))throw error('Ange giltigt ämne och mejltext.',400);
    const filter="owner=? AND id=? AND version=? AND status='draft'";
    const batch=await db().batch([
      db().prepare(`INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?, 'message.edited',?,? WHERE EXISTS(SELECT 1 FROM customer_messages WHERE ${filter})`).bind(uid(),owner,c.workspace.revision,JSON.stringify({id,before:{subject:c.m.subject,body:c.m.body,version},after:{subject:body.subject,body:body.body,version:version+1}}),now(),owner,id,version),
      db().prepare(`UPDATE customer_messages SET subject=?,body=?,version=version+1,updated_at=? WHERE ${filter}`).bind(body.subject,body.body,now(),owner,id,version),
    ]);if(batch[1].meta.changes!==1)throw error('Texten har ändrats i ett annat fönster.');return response({ok:true});
  }
  if(action==='review'){
    let cookie=cookieValue(req,'mg_message_review');if(!/^[A-Za-z0-9_-]{43}$/.test(cookie))cookie=randomToken();
    const review=uid();
    await db().prepare('INSERT INTO customer_reviews(id,owner,message_id,version,snapshot,cookie_hash,expires_at) VALUES(?,?,?,?,?,?,?)').bind(review,owner,id,version,c.m.snapshot,await digest(cookie),new Date(Date.now()+900000).toISOString()).run();
    await audit(owner,'message.reviewed',{id,version,review});
    return Response.json({...c.m,review_id:review},{headers:{'Cache-Control':'private, no-store','Set-Cookie':`mg_message_review=${cookie}; Path=/api/customer-messages; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`}});
  }
  if(action==='send')return sendMessage(req,owner,body);
  throw error('Okänd meddelandeåtgärd.',404);
}
async function sendMessage(req:Request,owner:string,body:Row){
  const connection=await db().prepare("SELECT * FROM gmail_connections WHERE owner=? AND status='connected'").bind(owner).first<Row>();
  if(!connection||connection.email.toLowerCase()!==gmailAccount())throw error('Koppla företagets Gmail-konto först.');
  const tokens=await decrypt<any>(owner,'gmail-tokens',connection.tokens),deliver=await prepareGmailSend(tokens);
  // Persist refresh only if the same connection still exists. Never resurrect a disconnect.
  const sealed=await encrypt(owner,'gmail-tokens',tokens);
  const updated=await db().prepare("UPDATE gmail_connections SET tokens=? WHERE owner=? AND tokens=? AND status='connected'").bind(sealed,owner,connection.tokens).run();
  if(updated.meta.changes!==1)throw error('Gmail-anslutningen ändrades. Granska och försök igen.');
  const user=await identity(req);if(user.userId!==owner)throw error('Administratörens identitet ändrades.',403);
  const c=await current(owner,body.id,body.version);
  if(!c.contact||!validRecipient(c.m.recipient)||c.contact.email!==c.m.recipient||c.contact.identity!==contactIdentity(c.invoice))throw error('Verifiera kundens mejladress före utskick.');
  const cookie=cookieValue(req,'mg_message_review');if(!cookie)throw error('Öppna och läs aktuell mejlversion.',403);
  const deliveryId=uid(),at=now(),messageId=`<${deliveryId}@mg-fakturakoll.local>`;
  // All conditions are checked in the same transactional D1 batch. The unique
  // delivery per message is a durable single-use approval across Worker isolates.
  const reservation=db().prepare(`INSERT OR IGNORE INTO customer_deliveries(id,owner,message_id,review_id,version,snapshot,recipient,subject,body,status,rfc_message_id,approved_at)
    SELECT ?,m.owner,m.id,r.id,m.version,m.snapshot,m.recipient,m.subject,m.body,'sending',?,?
    FROM customer_messages m JOIN customer_reviews r ON r.message_id=m.id AND r.owner=m.owner
    JOIN workspaces w ON w.owner=m.owner JOIN customer_contacts c ON c.owner=m.owner AND c.invoice_id=m.invoice_id
    WHERE m.owner=? AND m.id=? AND m.version=? AND m.status='draft' AND m.snapshot=?
      AND r.id=? AND r.version=m.version AND r.snapshot=m.snapshot AND r.consumed=0 AND r.expires_at>? AND r.cookie_hash=?
      AND w.revision=? AND c.version=? AND c.email=m.recipient AND c.identity=?
      AND EXISTS(SELECT 1 FROM gmail_connections g WHERE g.owner=m.owner AND g.tokens=? AND g.status='connected')
      AND NOT EXISTS(SELECT 1 FROM customer_deliveries d JOIN customer_messages other ON other.id=d.message_id WHERE d.owner=m.owner AND other.invoice_id=m.invoice_id AND d.status IN ('sending','unknown'))`)
    .bind(deliveryId,messageId,at,owner,c.m.id,c.m.version,c.m.snapshot,typeof body.review_id==='string'?body.review_id:'',at,await digest(cookie),c.workspace.revision,c.contact.version,contactIdentity(c.invoice),sealed);
  const batch=await db().batch([
    reservation,
    db().prepare('UPDATE customer_reviews SET consumed=1 WHERE owner=? AND id=? AND EXISTS(SELECT 1 FROM customer_deliveries WHERE id=? AND owner=?)').bind(owner,body.review_id||'',deliveryId,owner),
    db().prepare("UPDATE customer_messages SET status='sending',updated_at=? WHERE owner=? AND id=? AND EXISTS(SELECT 1 FROM customer_deliveries WHERE id=? AND owner=?)").bind(at,owner,c.m.id,deliveryId,owner),
    db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,'message.approved',?,? WHERE EXISTS(SELECT 1 FROM customer_deliveries WHERE id=? AND owner=?)").bind(uid(),owner,c.workspace.revision,JSON.stringify({id:c.m.id,deliveryId,review:body.review_id,version:c.m.version,snapshot:c.m.snapshot,recipient:c.m.recipient,subject:c.m.subject,body:c.m.body}),at,deliveryId,owner),
  ]);
  if(batch[0].meta.changes!==1)throw error('Godkännandet är ogiltigt, redan använt eller underlaget har ändrats. Granska på nytt.',409);
  try{
    const result=await deliver({...c.m,rfc_message_id:messageId});
    if(typeof result?.id!=='string'||!result.id)throw Error('Missing Gmail ID');
    const sentAt=now();await db().batch([
      db().prepare("UPDATE customer_deliveries SET status='sent',gmail_message_id=?,sent_at=? WHERE owner=? AND id=?").bind(result.id,sentAt,owner,deliveryId),
      db().prepare("UPDATE customer_messages SET status='sent',updated_at=? WHERE owner=? AND id=?").bind(sentAt,owner,c.m.id),
      db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,'message.sent',?,?)").bind(uid(),owner,c.workspace.revision,JSON.stringify({id:c.m.id,deliveryId,gmail_message_id:result.id,sentAt}),sentAt),
    ]);return response({status:'sent',gmail_message_id:result.id});
  }catch{
    await db().batch([
      db().prepare("UPDATE customer_deliveries SET status='unknown' WHERE owner=? AND id=?").bind(owner,deliveryId),
      db().prepare("UPDATE customer_messages SET status='unknown',updated_at=? WHERE owner=? AND id=?").bind(now(),owner,c.m.id),
      db().prepare("INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,'message.delivery.unknown',?,?)").bind(uid(),owner,c.workspace.revision,JSON.stringify({id:c.m.id,deliveryId}),now()),
    ]);throw error('Utskicksstatus är oklar. Kontrollera Skickat i Gmail; systemet skickar inte om meddelandet.',502);
  }
}
