/**
 * MG FAKTURAKOLL – DATABAS / AFFÄRSREGLER
 * ANSVAR: Lagrar fakturor, bankhändelser, dokument och kopplingar i SQLite. Beräknar fakturastatus från verifierade allokeringar och hindrar dubbel fördelning.
 * FLÖDE: server.js → db.js → SQLite. matchingSuggestions föreslår; allocate registrerar först efter godkännande.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './security.js';
import { bankFinancialReview, bankEvidenceConflictFields, hasBankEvidenceConflict, bankEvidenceReviewReason, BANK_EVIDENCE_CONFLICT_REASON } from './bank-evidence.js';
import { parseBankFile } from './importers.js';

/** Öppnar SQLite och förbereder databasschemat. Här bevaras företagets fakturor och historik mellan serverstarter. */
export function openDatabase(filename=process.env.DB_PATH || './data/mgeorge.sqlite') {
  const path=resolve(filename); mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices(
      id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('customer','supplier')),
      invoice_number TEXT NOT NULL, party TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
      issued_at TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL CHECK(total_cents>0), currency TEXT NOT NULL DEFAULT 'SEK',
      reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bank_transactions(
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, account TEXT NOT NULL,
      booked_at TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents!=0),
      currency TEXT NOT NULL DEFAULT 'SEK', payer TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '', bank_reference TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      needs_review INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS allocations(
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
      confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(invoice_id,transaction_id)
    );
    CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS bank_states(state_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS bank_connections(
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, bank_name TEXT NOT NULL,
      encrypted_session TEXT NOT NULL, accounts_json TEXT NOT NULL,
      valid_until TEXT NOT NULL, last_synced TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'connected',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mail_candidates(
      id TEXT PRIMARY KEY, provider_message_id TEXT NOT NULL UNIQUE, mailbox TEXT NOT NULL,
      sender TEXT NOT NULL, subject TEXT NOT NULL, snippet TEXT NOT NULL,
      received_at TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'needs_review',
      status TEXT NOT NULL DEFAULT 'needs_review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS import_jobs(
      id TEXT PRIMARY KEY,source TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',found INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0,duplicate INTEGER NOT NULL DEFAULT 0,review INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS documents(
      id TEXT PRIMARY KEY,invoice_id TEXT REFERENCES invoices(id),name TEXT NOT NULL,mime_type TEXT NOT NULL,
      content BLOB NOT NULL,fingerprint TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'upload',source_id TEXT UNIQUE,
      metadata TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'needs_review',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS gmail_states(state_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,session_hash TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS gmail_connections(
      id TEXT PRIMARY KEY,email TEXT NOT NULL,encrypted_tokens TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'connected',
      last_synced TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS gmail_rejected_sources(
      source_id TEXT PRIMARY KEY,reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Additive migrations keep existing self-hosted databases and their audit history intact.
  const addColumn=(table,name,definition)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);};
  addColumn('invoices','reconciled_at',"TEXT NOT NULL DEFAULT ''");
  addColumn('invoices','reconciliation_note',"TEXT NOT NULL DEFAULT ''");
  addColumn('invoices','bankgiro',"TEXT NOT NULL DEFAULT ''");
  addColumn('invoices','vat_cents','INTEGER');
  addColumn('invoices','kind',"TEXT NOT NULL DEFAULT 'invoice'");
  addColumn('invoices','organization_number',"TEXT NOT NULL DEFAULT ''");
  addColumn('invoices','net_cents','INTEGER');
  db.exec(`
    CREATE TABLE IF NOT EXISTS verified_contacts(invoice_id TEXT PRIMARY KEY REFERENCES invoices(id),email TEXT NOT NULL,evidence TEXT NOT NULL,verified_by TEXT NOT NULL,verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS payer_links(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),payer TEXT NOT NULL,account TEXT NOT NULL,evidence TEXT NOT NULL,verified_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(invoice_id,payer,account));
    CREATE TABLE IF NOT EXISTS reconciliation_findings(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),transaction_id TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,details TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS customer_messages(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),kind TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,snapshot TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(invoice_id,kind,snapshot));
    CREATE TABLE IF NOT EXISTS message_reviews(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES customer_messages(id),version INTEGER NOT NULL,snapshot TEXT NOT NULL,principal TEXT NOT NULL,session_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS message_approvals(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES customer_messages(id),review_id TEXT NOT NULL UNIQUE REFERENCES message_reviews(id),principal TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS message_deliveries(id TEXT PRIMARY KEY,message_id TEXT NOT NULL UNIQUE REFERENCES customer_messages(id),approval_id TEXT NOT NULL UNIQUE REFERENCES message_approvals(id),status TEXT NOT NULL,gmail_message_id TEXT NOT NULL DEFAULT '',rfc_message_id TEXT NOT NULL,sent_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  addColumn('documents','extraction',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('verified_contacts','identity',"TEXT NOT NULL DEFAULT ''");
  addColumn('payer_links','party',"TEXT NOT NULL DEFAULT ''");
  addColumn('payer_links','organization_number',"TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE INDEX IF NOT EXISTS documents_fingerprint ON documents(fingerprint);
    CREATE TABLE IF NOT EXISTS document_sources(source_id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT OR IGNORE INTO document_sources(source_id,document_id,metadata) SELECT source_id,id,metadata FROM documents WHERE source_id IS NOT NULL;`);
  addColumn('bank_transactions','excluded','INTEGER NOT NULL DEFAULT 0');
  addColumn('bank_transactions','exclusion_reason',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','is_aggregate','INTEGER NOT NULL DEFAULT 0');
  addColumn('bank_transactions','parent_bank_reference',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','review_reason',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','import_id',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','bankgiro',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','payer_bankgiro',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','payer_organization_number',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','reference_evidence',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('bank_transactions','account_evidence',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('bank_transactions','raw_bank_data',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('bank_transactions','bank_evidence_conflicts',"TEXT NOT NULL DEFAULT '[]'");
  const rawHashUpgrade=!db.prepare('PRAGMA table_info(bank_transactions)').all().some(column=>column.name==='raw_bank_data_sha256');
  if(rawHashUpgrade){
    db.exec('BEGIN IMMEDIATE');
    try{addColumn('bank_transactions','raw_bank_data_sha256',"TEXT NOT NULL DEFAULT ''");for(const original of db.prepare("SELECT id,raw_bank_data FROM bank_transactions WHERE raw_bank_data<>'{}'").all())db.prepare('UPDATE bank_transactions SET raw_bank_data_sha256=? WHERE id=?').run(digest(original.raw_bank_data),original.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  addColumn('bank_transactions','provider_transaction_id',"TEXT NOT NULL DEFAULT ''");
  const identityUpgrade=!db.prepare('PRAGMA table_info(bank_transactions)').all().some(column=>column.name==='api_identity_version');
  addColumn('bank_transactions','api_identity_version','INTEGER NOT NULL DEFAULT 0');
  if(identityUpgrade)db.prepare("UPDATE bank_transactions SET api_identity_version=1 WHERE source='enablebanking' AND provider_transaction_id<>''").run();
  addColumn('bank_states','session_hash',"TEXT NOT NULL DEFAULT ''");
  addColumn('sessions','principal',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_connections','owner',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_connections','selected_account_uid',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_connections','last_error',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_connections','retry_after','INTEGER NOT NULL DEFAULT 0');
  addColumn('bank_connections','control_attempt_at','INTEGER NOT NULL DEFAULT 0');
  addColumn('bank_states','owner',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_states','renew_connection_id',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_states','bank_name',"TEXT NOT NULL DEFAULT ''");
  addColumn('gmail_connections','page_token',"TEXT NOT NULL DEFAULT ''");
  addColumn('gmail_states','request_send','INTEGER NOT NULL DEFAULT 0');
  addColumn('gmail_connections','sync_started_at',"TEXT NOT NULL DEFAULT ''");
  addColumn('import_jobs','content','BLOB');
  addColumn('import_jobs','mime_type',"TEXT NOT NULL DEFAULT ''");
  const originalHashUpgrade=!db.prepare('PRAGMA table_info(import_jobs)').all().some(column=>column.name==='content_sha256');
  if(originalHashUpgrade){
    db.exec('BEGIN IMMEDIATE');
    try{addColumn('import_jobs','content_sha256',"TEXT NOT NULL DEFAULT ''");for(const original of db.prepare('SELECT id,content FROM import_jobs WHERE content IS NOT NULL').all())db.prepare('UPDATE import_jobs SET content_sha256=? WHERE id=?').run(digest(original.content),original.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  db.prepare("INSERT OR IGNORE INTO app_settings(id,data) VALUES(1,'{}')").run();
  return db;
}
export function audit(db,action,details={}) {
  db.prepare('INSERT INTO audit_events(id,action,details) VALUES(?,?,?)').run(randomUUID(),action,JSON.stringify(details));
}
export function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function listInvoices(db) {
  return db.prepare(`SELECT i.*, COALESCE((SELECT SUM(a.amount_cents) FROM allocations a WHERE a.invoice_id=i.id),0) AS paid_cents,(SELECT d.id FROM documents d WHERE d.invoice_id=i.id ORDER BY d.created_at DESC LIMIT 1) AS document_id FROM invoices i ORDER BY i.due_at ASC, i.created_at DESC`).all().map(i=>{
    const remaining_cents=i.total_cents-i.paid_cents,is_overdue=remaining_cents>0&&!!i.due_at&&i.due_at<today();
    const reconciliation_state=i.reconciled_at?'verified':'unreconciled';
    return {...i,remaining_cents,is_overdue,reconciliation_state,status:remaining_cents===0?'paid':i.paid_cents>0?'partial':!i.reconciled_at?'unreconciled':is_overdue?'overdue':'unpaid'};
  });
}
export function listTransactions(db) {
  const records=db.prepare(`SELECT t.*, COALESCE((SELECT SUM(a.amount_cents) FROM allocations a WHERE a.transaction_id=t.id),0) AS allocated_cents FROM bank_transactions t ORDER BY t.booked_at DESC,t.created_at DESC`).all().map(t=>{
    const available_cents=Math.abs(t.amount_cents)-t.allocated_cents;
    return {...t,reference_evidence:JSON.parse(t.reference_evidence),account_evidence:JSON.parse(t.account_evidence),raw_bank_data:JSON.parse(t.raw_bank_data),bank_evidence_conflicts:JSON.parse(t.bank_evidence_conflicts),available_cents};
  });
  const byReference=new Map();
  for(const record of records){
    const key=JSON.stringify([record.account,record.bank_reference]);
    if(record.bank_reference)byReference.set(key,[...(byReference.get(key)||[]),record]);
  }
  return records.map(record=>{
    // A replaced/excluded parent remains part of the child's evidence chain.
    // Project its hold without changing either bank original or any allocation.
    const ancestors=[],visited=new Set([record.id]),pending=[];
    const addParents=child=>{if(child.parent_bank_reference)pending.push(...(byReference.get(JSON.stringify([child.account,child.parent_bank_reference]))||[]));};
    addParents(record);
    while(pending.length){
      const parent=pending.pop();if(visited.has(parent.id))continue;visited.add(parent.id);
      if(parent.bank_evidence_conflicts.length)ancestors.push({transaction_id:parent.id,bank_reference:parent.bank_reference});
      addParents(parent);
    }
    const transaction={...record,ancestor_bank_evidence_conflicts:ancestors};
    const financialReview=bankFinancialReview(transaction),conflict=hasBankEvidenceConflict(transaction);
    return {...transaction,review_reason:bankEvidenceReviewReason(transaction)||financialReview?.reason||record.review_reason,status:record.excluded?'excluded':conflict?'review':record.available_cents===0?'matched':financialReview?'review':record.allocated_cents>0?'partial':record.is_aggregate||(!record.payer&&!record.reference)?'review':'unmatched'};
  });
}
export function paymentSign(invoice){return (invoice.direction==='customer'?1:-1)*(invoice.kind==='credit'?-1:1);}
function normalized(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]/gu,'');}
/** Föreslår fakturamatchningar när betalningsriktning, referens eller betalare och belopp uppfyller reglerna; förslag är inte bekräftade betalningar. */
export function matchingSuggestions(db){
  const invoices=listInvoices(db).filter(i=>i.remaining_cents>0),out=[];
  for(const t of listTransactions(db)){
    if(t.excluded||t.is_aggregate||t.available_cents<=0)continue;
    const ref=normalized(t.reference),party=normalized(t.payer);
    for(const i of invoices){
      if(hasBankEvidenceConflict(t)||bankFinancialReview(t)&&(i.kind!=='credit'||bankFinancialReview(t).kind==='reversal'))continue;
      if(Math.sign(t.amount_cents)!==paymentSign(i)||i.currency!==t.currency)continue;
      if(i.issued_at&&t.booked_at<i.issued_at)continue;
      const exactReference=!!ref&&[i.reference,i.invoice_number].some(r=>normalized(r)&&normalized(r)===ref);
      const sameParty=!!party&&party===normalized(i.party),sameAmount=t.available_cents===i.remaining_cents;
      if(!exactReference&&!(sameParty&&sameAmount))continue;
      out.push({transaction_id:t.id,invoice_id:i.id,confidence:exactReference?'high':'medium',reason:exactReference?'Exakt OCR eller fakturareferens':'Samma belopp och betalare – kontrollera referensen',amount_cents:Math.min(t.available_cents,i.remaining_cents)});
    }
  }
  return out.sort((a,b)=>(a.confidence==='high'?0:1)-(b.confidence==='high'?0:1));
}
/** Beräknar aktuell fakturastatus från godkända betalningsallokeringar och avstämningsinformation. */
export function invoiceStatus(db) {
  const invoices=listInvoices(db);
  return {
    customer_open_cents: invoices.filter(i=>i.direction==='customer').reduce((s,i)=>s+i.remaining_cents*(i.kind==='credit'?-1:1),0),
    supplier_open_cents: invoices.filter(i=>i.direction==='supplier').reduce((s,i)=>s+i.remaining_cents*(i.kind==='credit'?-1:1),0),
    customer_open_count: invoices.filter(i=>i.direction==='customer'&&i.remaining_cents>0).length,
    supplier_open_count: invoices.filter(i=>i.direction==='supplier'&&i.remaining_cents>0).length,
    customer_overdue_cents: invoices.filter(i=>i.direction==='customer'&&i.is_overdue).reduce((s,i)=>s+i.remaining_cents,0),
    customer_paid_cents: invoices.filter(i=>i.direction==='customer').reduce((s,i)=>s+i.paid_cents,0),
    invoice_count: invoices.length,
    unmatched_count: listTransactions(db).filter(t=>!t.excluded&&t.available_cents>0).length,
    new_transactions_count:listTransactions(db).filter(t=>t.created_at.slice(0,10)>=new Date(Date.now()-7*86400000).toISOString().slice(0,10)).length,
    matched_count:listTransactions(db).filter(t=>t.status==='matched').length,
    review_count:listTransactions(db).filter(t=>!t.excluded&&t.available_cents>0).length+invoices.filter(i=>i.status==='unreconciled').length+db.prepare("SELECT COUNT(*) AS n FROM documents WHERE invoice_id IS NULL AND status='needs_review'").get().n
  };
}
export function assertNoLegacyBankImports(db) {
  if(db.prepare("SELECT id FROM bank_transactions WHERE source='enablebanking' AND api_identity_version=0 LIMIT 1").get())throw Object.assign(new Error('Tidigare bankimport använder äldre konto- eller transaktions-ID:n. Granska och migrera de posterna innan nya bankhändelser hämtas. Inga nya bankhändelser har sparats.'),{status:409,code:'legacy_bank_identity'});
}

/** A replaced/excluded collection still bounds all of its individual payments. */
function validatePaymentSpecifications(db,items,source,original) {
  const groups=new Map(),parsed=new Map();
  const add=(account,parent)=>{if(parent)groups.set(JSON.stringify([account,parent]),{account,parent});};
  for(const item of items){
    add(item.account,item.parent_bank_reference||item.aggregate_parent_reference);
    if(item.bank_reference&&db.prepare('SELECT id FROM bank_transactions WHERE account=? AND parent_bank_reference=? AND is_aggregate=0 LIMIT 1').get(item.account,item.bank_reference))add(item.account,item.bank_reference);
  }
  const reject=()=>{throw Object.assign(new Error('Betalningsspecifikationen strider mot samlingsposten eller en tidigare specifikation. Inga nya betalningar har sparats; granska originalunderlagen.'),{status:409,code:'conflicting_payment_specification'});};
  const originalRows=(key,name,mime,content,hash,account)=>{
    if(!/\.xml$/i.test(name)||mime!=='application/xml'||!content)return [];
    if(hash&&digest(content)!==hash)reject();
    const cache=JSON.stringify([key,account]);
    if(!parsed.has(cache)){
      try{parsed.set(cache,parseBankFile(name,Buffer.from(content).toString('base64'),account));}catch{reject();}
    }
    return parsed.get(cache);
  };
  for(const {account,parent} of groups.values()){
    const children=db.prepare('SELECT * FROM bank_transactions WHERE account=? AND parent_bank_reference=? AND is_aggregate=0 AND bank_reference<>?').all(account,parent,parent);
    if(!children.length)continue;
    const expected=[];
    for(const collection of db.prepare('SELECT * FROM bank_transactions WHERE account=? AND bank_reference=?').all(account,parent)){
      // A formerly completed single-payment row is already the whole deposit.
      if(!collection.is_aggregate)reject();
      expected.push(collection);
    }
    const collect=rows=>{
      const members=rows.filter(row=>row.account===account&&row.parent_bank_reference===parent&&!row.is_aggregate&&row.bank_reference!==parent);
      if(members.length)expected.push({...members[0],amount_cents:members.reduce((sum,row)=>sum+row.amount_cents,0)});
    };
    if(source.startsWith('file:'))collect(originalRows('incoming',source.slice(5),original?.mime_type,original?.content,'',account));
    for(const id of new Set(children.map(child=>child.import_id).filter(Boolean))){
      const retained=db.prepare('SELECT name,mime_type,content,content_sha256 FROM import_jobs WHERE id=?').get(id);
      if(retained)collect(originalRows(id,retained.name,retained.mime_type,retained.content,retained.content_sha256,account));
    }
    const anchor=expected[0]||children[0];
    if(children.some(child=>child.booked_at!==anchor.booked_at||child.currency!==anchor.currency||Math.sign(child.amount_cents)!==Math.sign(anchor.amount_cents)))reject();
    const total=children.reduce((sum,child)=>sum+Math.abs(child.amount_cents),0);
    if(!Number.isSafeInteger(total)||expected.some(bound=>bound.booked_at!==anchor.booked_at||bound.currency!==anchor.currency||bound.amount_cents!==anchor.amount_cents||total>Math.abs(bound.amount_cents)))reject();
  }
}

function recordBankEvidenceConflict(db,transactionId,source,incoming,fields) {
  const saved=db.prepare('SELECT bank_evidence_conflicts FROM bank_transactions WHERE id=?').get(transactionId);
  if(!saved)return; // A contradictory row from the same rolled-back import never existed.
  const evidence=JSON.parse(saved.bank_evidence_conflicts);
  const key=digest(JSON.stringify([fields,incoming.amount_cents,incoming.currency,incoming.booked_at,incoming.payer,incoming.reference,incoming.reference_evidence,incoming.payer_organization_number,incoming.bankgiro,incoming.payer_bankgiro,incoming.parent_bank_reference,bankFinancialReview(incoming)?.kind]));
  if(evidence.some(item=>item.id===key))return;
  const conflict={id:key,source,recorded_at:new Date().toISOString(),fields,incoming};
  evidence.push(conflict);
  db.prepare('UPDATE bank_transactions SET bank_evidence_conflicts=?,review_reason=?,needs_review=1 WHERE id=?').run(JSON.stringify(evidence),BANK_EVIDENCE_CONFLICT_REASON,transactionId);
  audit(db,'bank_evidence_conflict',{transaction_id:transactionId,...conflict});
}
/** Lagrar importerade bankhändelser och använder identiteter/fingeravtryck för att minska risken för dubletter. */
export function storeTransactions(db,items,source,original=null,guard=null) {
  // Legacy lookup IDs and session account UIDs cannot safely be guessed into
  // stable identities. Block the whole API batch until a reviewed migration
  // preserves the old row IDs, exclusions and allocations. Never create a fresh
  // spendable copy of an already allocated or excluded historical payment.
  if(source==='enablebanking')assertNoLegacyBankImports(db);
  const insert=db.prepare(`INSERT OR IGNORE INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,currency,payer,reference,bank_reference,description,source,needs_review,is_aggregate,parent_bank_reference,review_reason,bankgiro,provider_transaction_id,api_identity_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`);
  let imported=0,duplicate=0,enriched=0,conflicts=0,import_id;const inserted=[],completedSpecifications=[],pendingConflicts=[];
  db.exec('BEGIN IMMEDIATE');
  try {
    guard?.();
    for(const x of items){
      // A bank's stable transaction ID survives enriched payer/text fields on later syncs.
      const bankId=String(x.bank_reference||'').trim();
      const stableId=bankId&&!/^(NOTPROVIDED|NONREF|N\/A)$/i.test(bankId);
      const f=digest((stableId?[x.account,bankId,Math.sign(x.amount_cents)]:[x.account,x.booked_at,x.amount_cents,x.currency,x.reference,x.payer,x.description]).join('\u001f'));
      // Also catches records created with the old fingerprint algorithm before migration.
      const existing=stableId&&db.prepare('SELECT * FROM bank_transactions WHERE account=? AND bank_reference=?').get(x.account,bankId);
      if(existing){
        const financialConflicts=['amount_cents','currency','booked_at'].filter(field=>existing[field]!==x[field]);
        if(financialConflicts.length){
          pendingConflicts.push({transactionId:existing.id,incoming:x,fields:financialConflicts});
          throw Object.assign(new Error('Samma bankreferens har motstridiga belopp, datum eller valutor. Kontrollera originalunderlaget.'),{status:409,code:'conflicting_bank_record'});
        }
        if(source==='enablebanking'&&existing.raw_bank_data==='{}'&&x.raw_bank_data){
          const raw=JSON.stringify(x.raw_bank_data);
          const references=existing.reference_evidence==='{}'?JSON.stringify(x.reference_evidence||{}):existing.reference_evidence;
          db.prepare('UPDATE bank_transactions SET reference_evidence=?,raw_bank_data=?,raw_bank_data_sha256=? WHERE id=?').run(references,raw,digest(raw),existing.id);
          audit(db,'bank_original_attached',{transaction_id:existing.id,reference_version:x.reference_evidence?.version||''});
        }
        // A camt.054/053 can contain exactly one individual payment with the
        // same archive reference as a previously incomplete API collection.
        // Complete it in place: retain its identity and history, count the sum
        // once and keep later API refreshes/reimports as duplicates. Only a
        // retained XML original with individual payer AND reference may do so.
        const individualSpecification=source.startsWith('file:')&&/\.xml$/i.test(source)&&original?.mime_type==='application/xml'&&original?.content?.length&&!x.is_aggregate&&String(x.payer||'').trim()&&String(x.reference||'').trim()&&!/^(bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg)$/i.test(String(x.payer).trim());
        const before={...existing,reference_evidence:JSON.parse(existing.reference_evidence),raw_bank_data:JSON.parse(existing.raw_bank_data)};
        const completedCollectionReplay=x.is_aggregate&&!existing.is_aggregate&&db.prepare("SELECT id FROM import_jobs WHERE id=? AND mime_type='application/xml' AND content IS NOT NULL").get(existing.import_id);
        const conflictFields=existing.is_aggregate&&individualSpecification?[]:bankEvidenceConflictFields(before,x).filter(field=>!completedCollectionReplay||!['payer','reference','reference_evidence','is_aggregate'].includes(field));
        if(conflictFields.length){
          pendingConflicts.push({transactionId:existing.id,incoming:x,fields:conflictFields});
          recordBankEvidenceConflict(db,existing.id,source,x,conflictFields);
          conflicts++;duplicate++;continue;
        }
        if(existing.is_aggregate&&!existing.excluded&&individualSpecification){
          if(existing.booked_at!==x.booked_at)throw Object.assign(new Error('Betalningsspecifikationens datum skiljer sig från bankposten med samma referens. Kontrollera originalunderlaget.'),{status:409,code:'conflicting_bank_record'});
          if(db.prepare('SELECT id FROM allocations WHERE transaction_id=? LIMIT 1').get(existing.id))throw Object.assign(new Error('Samlingsposten har en tidigare matchning. Granska och återta den innan betalningsspecifikationen importeras.'),{status:409,code:'allocated_aggregate'});
          if(db.prepare('SELECT id FROM bank_transactions WHERE account=? AND parent_bank_reference=? AND excluded=0 AND id<>? LIMIT 1').get(existing.account,bankId,existing.id))throw Object.assign(new Error('Samlingsposten har redan delbetalningar från en annan specifikation. Granska underlagen innan en specifikation med en enda betalning importeras.'),{status:409,code:'conflicting_payment_specification'});
          db.prepare("UPDATE bank_transactions SET payer=?,reference=?,description=?,is_aggregate=0,parent_bank_reference=?,review_reason='',needs_review=1,bankgiro=? WHERE id=?")
            .run(x.payer,x.reference,x.description||existing.description,x.parent_bank_reference||'',x.bankgiro||existing.bankgiro,existing.id);
          if(x.reference_evidence)db.prepare('UPDATE bank_transactions SET reference_evidence=? WHERE id=?').run(JSON.stringify(x.reference_evidence),existing.id);
          if(x.account_evidence)db.prepare('UPDATE bank_transactions SET account_evidence=? WHERE id=?').run(JSON.stringify(x.account_evidence),existing.id);
          completedSpecifications.push({id:existing.id,before:existing});enriched++;
        }
        duplicate++;continue;
      }
      const id=randomUUID(),r=insert.run(id,f,x.account,x.booked_at,x.amount_cents,x.currency,x.payer||'',x.reference||'',bankId,x.description||'',source,x.is_aggregate?1:0,x.parent_bank_reference||x.aggregate_parent_reference||'',x.review_reason||'',x.bankgiro||'',x.provider_transaction_id||'',source==='enablebanking'?1:0);
      if(r.changes){
        if(x.account_evidence)db.prepare('UPDATE bank_transactions SET account_evidence=? WHERE id=?').run(JSON.stringify(x.account_evidence),id);
        if(x.reference_evidence||x.raw_bank_data){const raw=JSON.stringify(x.raw_bank_data||{});db.prepare('UPDATE bank_transactions SET reference_evidence=?,raw_bank_data=?,raw_bank_data_sha256=? WHERE id=?').run(JSON.stringify(x.reference_evidence||{}),raw,x.raw_bank_data?digest(raw):'',id);}
        if(x.payer_bankgiro)db.prepare('UPDATE bank_transactions SET payer_bankgiro=? WHERE id=?').run(String(x.payer_bankgiro),id);
        const organization=String(x.payer_organization_number||'').replace(/[- ]/g,'');
        if(/^\d{10}$/.test(organization))db.prepare('UPDATE bank_transactions SET payer_organization_number=? WHERE id=?').run(organization,id);
        imported++;inserted.push(id);
      }else duplicate++;
    }
    validatePaymentSpecifications(db,items,source,original);
    // A complete specification replaces its collective parent; never match the parent itself.
    for(const parent of db.prepare('SELECT * FROM bank_transactions WHERE is_aggregate=1 AND excluded=0 AND bank_reference<>?').all('')){
      const children=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total,COUNT(*) AS count FROM bank_transactions WHERE account=? AND parent_bank_reference=? AND is_aggregate=0 AND excluded=0 AND currency=? AND booked_at=?').get(parent.account,parent.bank_reference,parent.currency,parent.booked_at);
      if(children.count&&children.total===parent.amount_cents){
        db.prepare('UPDATE bank_transactions SET excluded=1,exclusion_reason=? WHERE id=?').run('Ersatt av enskilda betalningar i bankens betalningsspecifikation',parent.id);
        audit(db,'aggregate_replaced',{transaction_id:parent.id,children:children.count});
      }
    }
    audit(db,'bank_import',{source,imported,duplicate,enriched,conflicts});
    import_id=recordImport(db,{source:source==='manual'?'manual':source.startsWith('file:')?'bank_file':source,name:source.startsWith('file:')?source.slice(5):'',found:items.length,imported,duplicate,review:imported+enriched+conflicts,content:original?.content||null,mime_type:original?.mime_type||''});
    for(const id of inserted)db.prepare('UPDATE bank_transactions SET import_id=? WHERE id=?').run(import_id,id);
    for(const completed of completedSpecifications){
      db.prepare('UPDATE bank_transactions SET import_id=? WHERE id=?').run(import_id,completed.id);
      audit(db,'aggregate_replaced',{transaction_id:completed.id,children:1,specification_import_id:import_id,before:completed.before,after:db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(completed.id)});
    }
    if(imported||enriched){
      const checks=db.prepare("SELECT id,reconciled_at,reconciliation_note FROM invoices WHERE reconciled_at<>'' AND NOT EXISTS(SELECT 1 FROM allocations a WHERE a.invoice_id=invoices.id)").all();
      for(const check of checks){
        db.prepare("UPDATE invoices SET reconciled_at='',reconciliation_note='' WHERE id=?").run(check.id);
        audit(db,'absence_check_invalidated',{before:check,import_id,reason:'Nytt bankunderlag kräver ny kontroll av utebliven betalning'});
      }
    }
    db.exec('COMMIT');
  } catch(e) {
    db.exec('ROLLBACK');
    // Reject the financial batch while retaining every conflict already seen,
    // including earlier identity warnings when a later row/specification fails.
    if(pendingConflicts.length){
      db.exec('BEGIN IMMEDIATE');
      try{guard?.();for(const conflict of pendingConflicts)recordBankEvidenceConflict(db,conflict.transactionId,source,conflict.incoming,conflict.fields);db.exec('COMMIT');}
      catch(error){db.exec('ROLLBACK');throw error;}
    }
    throw e;
  }
  return {imported,duplicate,enriched,conflicts,import_id};
}
/** Bekräftar kopplingen mellan bankhändelse och faktura, med belopps- och riktningskontroller inom en databastransaktion. */
export function allocate(db,invoiceId,transactionId,amountCents,{automatic=false,transactionOpen=false}={}) {
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('Ange ett positivt belopp');
  if(!transactionOpen)db.exec('BEGIN IMMEDIATE');
  try {
    const i=listInvoices(db).find(x=>x.id===invoiceId),t=listTransactions(db).find(x=>x.id===transactionId);
    if(!i||!t)throw new Error('Faktura eller bankhändelse saknas');
    if(hasBankEvidenceConflict(t))throw new Error(bankEvidenceReviewReason(t));
    const financialReview=bankFinancialReview(t);
    if(financialReview&&(automatic||financialReview.kind==='reversal'||financialReview.kind==='refund'&&i.kind!=='credit'))throw new Error(financialReview.reason);
    if(Math.sign(t.amount_cents)!==paymentSign(i))throw new Error('Fel betalningsriktning');
    if(t.excluded)throw new Error('Bankhändelsen är undantagen från avstämning');
    if(t.is_aggregate)throw new Error('Samlad Bankgiroinsättning kräver en betalningsspecifikation före matchning');
    if(t.parent_bank_reference&&db.prepare('SELECT id FROM bank_transactions WHERE account=? AND bank_reference=? AND is_aggregate=1 AND excluded=0').get(t.account,t.parent_bank_reference))throw new Error('Bankgiro-specifikationen är ofullständig. Kontrollera samlingsposten före matchning.');
    if(t.parent_bank_reference&&db.prepare('SELECT a.id FROM allocations a JOIN bank_transactions b ON b.id=a.transaction_id WHERE b.account=? AND b.bank_reference=? LIMIT 1').get(t.account,t.parent_bank_reference))throw new Error('Samlingsposten har redan fördelats. Rätta den gamla kopplingen innan specifikationen används.');
    if(t.bank_reference&&db.prepare('SELECT a.id FROM allocations a JOIN bank_transactions b ON b.id=a.transaction_id WHERE b.id<>? AND b.bank_reference=? AND b.amount_cents=? AND b.currency=? AND b.booked_at=? LIMIT 1').get(t.id,t.bank_reference,t.amount_cents,t.currency,t.booked_at))throw new Error('Bankreferensen har redan fördelats genom ett annat underlag. Kontrollera möjlig dubblett.');
    if(t.payer&&t.reference&&db.prepare('SELECT a.id FROM allocations a JOIN bank_transactions b ON b.id=a.transaction_id WHERE b.id<>? AND b.account<>? AND b.payer=? AND b.reference=? AND b.amount_cents=? AND b.currency=? AND b.booked_at=? LIMIT 1').get(t.id,t.account,t.payer,t.reference,t.amount_cents,t.currency,t.booked_at))throw new Error('En motsvarande betalning från ett annat bankunderlag har redan fördelats. Kontrollera dubbletten.');
    if(i.currency!==t.currency)throw new Error('Valutorna skiljer sig');
    if(amountCents>i.remaining_cents||amountCents>t.available_cents)throw new Error('Beloppet överskrider återstående saldo');
    if(!t.payer&&!t.reference)throw new Error('Betalare/referens saknas. Komplettera bankunderlag före matchning.');
    db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run(randomUUID(),invoiceId,transactionId,amountCents);
    db.prepare('UPDATE invoices SET reconciled_at=CURRENT_TIMESTAMP WHERE id=?').run(invoiceId);
    if(t.payer)db.prepare('INSERT OR IGNORE INTO payer_links(id,invoice_id,payer,account,evidence,verified_by,party,organization_number) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),i.id,t.payer,t.account,`Verifierad betalningskoppling ${transactionId}`,'allocation',i.party,i.organization_number);
    audit(db,automatic?'automatic_match':'manual_match',{invoiceId,transactionId,amountCents});if(!transactionOpen)db.exec('COMMIT');
  }catch(e){if(!transactionOpen)db.exec('ROLLBACK');throw e;}
}
/** Ångrar en tidigare matchning och låter saldot beräknas om; åtgärden ska vara spårbar. */
export function deleteAllocation(db,id){
  db.exec('BEGIN IMMEDIATE');
  try{
    const allocation=db.prepare('SELECT * FROM allocations WHERE id=?').get(id);
    if(!allocation){db.exec('COMMIT');return false;}
    db.prepare('DELETE FROM allocations WHERE id=?').run(id);
    const transaction=db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(allocation.transaction_id);
    if(!db.prepare('SELECT a.id FROM allocations a JOIN bank_transactions t ON t.id=a.transaction_id WHERE a.invoice_id=? AND t.payer=? AND t.account=? LIMIT 1').get(allocation.invoice_id,transaction.payer,transaction.account)){
      db.prepare("DELETE FROM payer_links WHERE invoice_id=? AND payer=? AND account=? AND verified_by='allocation'").run(allocation.invoice_id,transaction.payer,transaction.account);
    }
    // Reversing a match is a correction, not proof that the invoice is now unpaid.
    db.prepare("UPDATE invoices SET reconciled_at='',reconciliation_note='' WHERE id=?").run(allocation.invoice_id);
    audit(db,'undo_match',{...allocation});db.exec('COMMIT');return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export const defaultSettings={company_name:'M.George Vitvaror AB',organization_number:'',email:'mg.vitvaror@gmail.com',phone:'',address:'',bankgiro:'',notifications_due:true,notifications_review:true,reminders_enabled:false,sync_interval_minutes:0,gmail_sync_interval_minutes:15,auto_register_known:false};
export function getSettings(db){return {...defaultSettings,...JSON.parse(db.prepare('SELECT data FROM app_settings WHERE id=1').get().data)};}
export function saveSettings(db,settings){db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify(settings));audit(db,'settings_updated',{fields:Object.keys(settings)});return getSettings(db);}
export function recordImport(db,{source,name='',found=0,imported=0,duplicate=0,review=0,status='completed',error='',content=null,mime_type=''}){
  const id=randomUUID();db.prepare('INSERT INTO import_jobs(id,source,name,found,imported,duplicate,review,status,error,content,mime_type,content_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,source,name,found,imported,duplicate,review,status,error,content,mime_type,content===null?'':digest(content));return id;
}
export function listImports(db){return db.prepare('SELECT id,source,name,found,imported,duplicate,review,status,error,created_at,mime_type,content_sha256,(content IS NOT NULL) AS has_original FROM import_jobs ORDER BY created_at DESC,rowid DESC LIMIT 200').all();}
export function documentMetadata(d){const {content,fingerprint,...metadata}=d;const details=typeof d.metadata==='string'?JSON.parse(d.metadata):d.metadata;return {...metadata,content_hash:fingerprint,extraction:typeof d.extraction==='string'?JSON.parse(d.extraction):d.extraction,metadata:details,direction:details?.direction,party:details?.party,email:details?.email,subject:details?.subject,size_bytes:content?.length??d.size_bytes??0};}
export function listDocuments(db){return db.prepare('SELECT id,invoice_id,name,mime_type,source,source_id,metadata,status,extraction,fingerprint,created_at,length(content) AS size_bytes FROM documents ORDER BY created_at DESC,rowid DESC').all().map(d=>({...documentMetadata(d),sources:db.prepare('SELECT source_id,metadata,created_at FROM document_sources WHERE document_id=?').all(d.id).map(s=>({...s,metadata:JSON.parse(s.metadata)}))}));}
export function storeDocument(db,{name,mime_type,bytes,invoice_id=null,source='upload',source_id=null,metadata={}}){
  const fingerprint=digest(bytes);
  const existing=(source_id?db.prepare('SELECT d.* FROM documents d LEFT JOIN document_sources s ON s.document_id=d.id WHERE d.source_id=? OR s.source_id=? LIMIT 1').get(source_id,source_id):null)||db.prepare('SELECT * FROM documents WHERE fingerprint=?').get(fingerprint);
  if(existing){
    if(source_id)db.prepare('INSERT OR IGNORE INTO document_sources(source_id,document_id,metadata) VALUES(?,?,?)').run(source_id,existing.id,JSON.stringify(metadata));
    if(invoice_id&&existing.invoice_id&&existing.invoice_id!==invoice_id)throw Object.assign(new Error('Originalunderlaget är redan kopplat till en annan faktura'),{status:409});
    if(invoice_id&&!existing.invoice_id){
      db.exec('SAVEPOINT attach_original');
      try{db.prepare("UPDATE documents SET invoice_id=?,status='registered' WHERE id=?").run(invoice_id,existing.id);audit(db,'document_attached',{id:existing.id,invoice_id});db.exec('RELEASE attach_original');}
      catch(e){db.exec('ROLLBACK TO attach_original');db.exec('RELEASE attach_original');throw e;}
      return {...documentMetadata(db.prepare('SELECT * FROM documents WHERE id=?').get(existing.id)),duplicate:true};
    }
    return {...documentMetadata(existing),duplicate:true};
  }
  const id=randomUUID();db.prepare('INSERT INTO documents(id,invoice_id,name,mime_type,content,fingerprint,source,source_id,metadata,status) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,invoice_id,name,mime_type,bytes,fingerprint,source,source_id,JSON.stringify(metadata),invoice_id?'registered':'needs_review');
  if(source_id)db.prepare('INSERT INTO document_sources(source_id,document_id,metadata) VALUES(?,?,?)').run(source_id,id,JSON.stringify(metadata));
  audit(db,'document_uploaded',{id,invoice_id,name,source});return {...documentMetadata(db.prepare('SELECT * FROM documents WHERE id=?').get(id)),duplicate:false};
}
