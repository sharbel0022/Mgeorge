import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './security.js';

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
  addColumn('bank_transactions','excluded','INTEGER NOT NULL DEFAULT 0');
  addColumn('bank_transactions','exclusion_reason',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','is_aggregate','INTEGER NOT NULL DEFAULT 0');
  addColumn('bank_transactions','parent_bank_reference',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','review_reason',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','import_id',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_transactions','bankgiro',"TEXT NOT NULL DEFAULT ''");
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
  addColumn('bank_states','owner',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_states','renew_connection_id',"TEXT NOT NULL DEFAULT ''");
  addColumn('bank_states','bank_name',"TEXT NOT NULL DEFAULT ''");
  addColumn('gmail_connections','page_token',"TEXT NOT NULL DEFAULT ''");
  addColumn('gmail_connections','sync_started_at',"TEXT NOT NULL DEFAULT ''");
  addColumn('import_jobs','content','BLOB');
  addColumn('import_jobs','mime_type',"TEXT NOT NULL DEFAULT ''");
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
  return db.prepare(`SELECT t.*, COALESCE((SELECT SUM(a.amount_cents) FROM allocations a WHERE a.transaction_id=t.id),0) AS allocated_cents FROM bank_transactions t ORDER BY t.booked_at DESC,t.created_at DESC`).all().map(t=>{
    const available_cents=Math.abs(t.amount_cents)-t.allocated_cents;
    return {...t,available_cents,status:t.excluded?'excluded':available_cents===0?'matched':t.allocated_cents>0?'partial':t.is_aggregate||(!t.payer&&!t.reference)?'review':'unmatched'};
  });
}
export function paymentSign(invoice){return (invoice.direction==='customer'?1:-1)*(invoice.kind==='credit'?-1:1);}
function normalized(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]/gu,'');}
export function matchingSuggestions(db){
  const invoices=listInvoices(db).filter(i=>i.remaining_cents>0),out=[];
  for(const t of listTransactions(db)){
    if(t.excluded||t.is_aggregate||t.available_cents<=0)continue;
    const ref=normalized(t.reference),party=normalized(t.payer);
    for(const i of invoices){
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
export function storeTransactions(db,items,source,original=null) {
  // Legacy lookup IDs and session account UIDs cannot safely be guessed into
  // stable identities. Block the whole API batch until a reviewed migration
  // preserves the old row IDs, exclusions and allocations. Never create a fresh
  // spendable copy of an already allocated or excluded historical payment.
  if(source==='enablebanking')assertNoLegacyBankImports(db);
  const insert=db.prepare(`INSERT OR IGNORE INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,currency,payer,reference,bank_reference,description,source,needs_review,is_aggregate,parent_bank_reference,review_reason,bankgiro,provider_transaction_id,api_identity_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`);
  let imported=0,duplicate=0,enriched=0,import_id;const inserted=[],completedSpecifications=[];
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const x of items){
      // A bank's stable transaction ID survives enriched payer/text fields on later syncs.
      const bankId=String(x.bank_reference||'').trim();
      const stableId=bankId&&!/^(NOTPROVIDED|NONREF|N\/A)$/i.test(bankId);
      const f=digest((stableId?[x.account,bankId,Math.sign(x.amount_cents)]:[x.account,x.booked_at,x.amount_cents,x.currency,x.reference,x.payer,x.description]).join('\u001f'));
      // Also catches records created with the old fingerprint algorithm before migration.
      const existing=stableId&&db.prepare('SELECT * FROM bank_transactions WHERE account=? AND bank_reference=? AND (amount_cents>0)=?').get(x.account,bankId,x.amount_cents>0?1:0);
      if(existing){
        if(existing.amount_cents!==x.amount_cents||existing.currency!==x.currency)throw Object.assign(new Error('Samma bankreferens har motstridiga belopp eller valutor. Kontrollera originalunderlaget.'),{status:409,code:'conflicting_bank_record'});
        // A camt.054/053 can contain exactly one individual payment with the
        // same archive reference as a previously incomplete API collection.
        // Complete it in place: retain its identity and history, count the sum
        // once and keep later API refreshes/reimports as duplicates. Only a
        // retained XML original with individual payer AND reference may do so.
        const individualSpecification=source.startsWith('file:')&&/\.xml$/i.test(source)&&original?.mime_type==='application/xml'&&original?.content?.length&&!x.is_aggregate&&String(x.payer||'').trim()&&String(x.reference||'').trim()&&!/^(bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg)$/i.test(String(x.payer).trim());
        if(existing.is_aggregate&&!existing.excluded&&individualSpecification){
          if(existing.booked_at!==x.booked_at)throw Object.assign(new Error('Betalningsspecifikationens datum skiljer sig från bankposten med samma referens. Kontrollera originalunderlaget.'),{status:409,code:'conflicting_bank_record'});
          if(db.prepare('SELECT id FROM allocations WHERE transaction_id=? LIMIT 1').get(existing.id))throw Object.assign(new Error('Samlingsposten har en tidigare matchning. Granska och återta den innan betalningsspecifikationen importeras.'),{status:409,code:'allocated_aggregate'});
          if(db.prepare('SELECT id FROM bank_transactions WHERE account=? AND parent_bank_reference=? AND excluded=0 AND id<>? LIMIT 1').get(existing.account,bankId,existing.id))throw Object.assign(new Error('Samlingsposten har redan delbetalningar från en annan specifikation. Granska underlagen innan en specifikation med en enda betalning importeras.'),{status:409,code:'conflicting_payment_specification'});
          db.prepare("UPDATE bank_transactions SET payer=?,reference=?,description=?,is_aggregate=0,parent_bank_reference=?,review_reason='',needs_review=1,bankgiro=? WHERE id=?")
            .run(x.payer,x.reference,x.description||existing.description,x.parent_bank_reference||'',x.bankgiro||existing.bankgiro,existing.id);
          completedSpecifications.push({id:existing.id,before:existing});enriched++;
        }
        duplicate++;continue;
      }
      const id=randomUUID(),r=insert.run(id,f,x.account,x.booked_at,x.amount_cents,x.currency,x.payer||'',x.reference||'',bankId,x.description||'',source,x.is_aggregate?1:0,x.parent_bank_reference||x.aggregate_parent_reference||'',x.review_reason||'',x.bankgiro||'',x.provider_transaction_id||'',source==='enablebanking'?1:0);
      if(r.changes){imported++;inserted.push(id);}else duplicate++;
    }
    // A complete specification replaces its collective parent; never match the parent itself.
    for(const parent of db.prepare('SELECT * FROM bank_transactions WHERE is_aggregate=1 AND excluded=0 AND bank_reference<>?').all('')){
      const children=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total,COUNT(*) AS count FROM bank_transactions WHERE account=? AND parent_bank_reference=? AND is_aggregate=0 AND excluded=0 AND currency=? AND booked_at=?').get(parent.account,parent.bank_reference,parent.currency,parent.booked_at);
      if(children.count&&children.total===parent.amount_cents){
        db.prepare('UPDATE bank_transactions SET excluded=1,exclusion_reason=? WHERE id=?').run('Ersatt av enskilda betalningar i bankens betalningsspecifikation',parent.id);
        audit(db,'aggregate_replaced',{transaction_id:parent.id,children:children.count});
      }
    }
    audit(db,'bank_import',{source,imported,duplicate,enriched});
    import_id=recordImport(db,{source:source==='manual'?'manual':source.startsWith('file:')?'bank_file':source,name:source.startsWith('file:')?source.slice(5):'',found:items.length,imported,duplicate,review:imported+enriched,content:original?.content||null,mime_type:original?.mime_type||''});
    for(const id of inserted)db.prepare('UPDATE bank_transactions SET import_id=? WHERE id=?').run(import_id,id);
    for(const completed of completedSpecifications){
      db.prepare('UPDATE bank_transactions SET import_id=? WHERE id=?').run(import_id,completed.id);
      audit(db,'aggregate_replaced',{transaction_id:completed.id,children:1,specification_import_id:import_id,before:completed.before,after:db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(completed.id)});
    }
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
  return {imported,duplicate,enriched,import_id};
}
export function allocate(db,invoiceId,transactionId,amountCents) {
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('Ange ett positivt belopp');
  db.exec('BEGIN IMMEDIATE');
  try {
    const i=listInvoices(db).find(x=>x.id===invoiceId),t=listTransactions(db).find(x=>x.id===transactionId);
    if(!i||!t)throw new Error('Faktura eller bankhändelse saknas');
    if(Math.sign(t.amount_cents)!==paymentSign(i))throw new Error('Fel betalningsriktning');
    if(t.excluded)throw new Error('Bankhändelsen är undantagen från avstämning');
    if(t.is_aggregate)throw new Error('Samlad Bankgiroinsättning kräver en betalningsspecifikation före matchning');
    if(i.currency!==t.currency)throw new Error('Valutorna skiljer sig');
    if(amountCents>i.remaining_cents||amountCents>t.available_cents)throw new Error('Beloppet överskrider återstående saldo');
    if(!t.payer&&!t.reference)throw new Error('Betalare/referens saknas. Komplettera bankunderlag före matchning.');
    db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run(randomUUID(),invoiceId,transactionId,amountCents);
    db.prepare('UPDATE invoices SET reconciled_at=CURRENT_TIMESTAMP WHERE id=?').run(invoiceId);
    audit(db,'manual_match',{invoiceId,transactionId,amountCents}); db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function deleteAllocation(db,id){
  db.exec('BEGIN IMMEDIATE');
  try{
    const allocation=db.prepare('SELECT * FROM allocations WHERE id=?').get(id);
    if(!allocation){db.exec('COMMIT');return false;}
    db.prepare('DELETE FROM allocations WHERE id=?').run(id);
    // Reversing a match is a correction, not proof that the invoice is now unpaid.
    db.prepare("UPDATE invoices SET reconciled_at='',reconciliation_note='' WHERE id=?").run(allocation.invoice_id);
    audit(db,'undo_match',{...allocation});db.exec('COMMIT');return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export const defaultSettings={company_name:'M.George Vitvaror AB',organization_number:'',email:'mg.vitvaror@gmail.com',phone:'',address:'',bankgiro:'',notifications_due:true,notifications_review:true,reminders_enabled:false,sync_interval_minutes:0};
export function getSettings(db){return {...defaultSettings,...JSON.parse(db.prepare('SELECT data FROM app_settings WHERE id=1').get().data)};}
export function saveSettings(db,settings){db.prepare('UPDATE app_settings SET data=? WHERE id=1').run(JSON.stringify(settings));audit(db,'settings_updated',{fields:Object.keys(settings)});return getSettings(db);}
export function recordImport(db,{source,name='',found=0,imported=0,duplicate=0,review=0,status='completed',error='',content=null,mime_type=''}){
  const id=randomUUID();db.prepare('INSERT INTO import_jobs(id,source,name,found,imported,duplicate,review,status,error,content,mime_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,source,name,found,imported,duplicate,review,status,error,content,mime_type);return id;
}
export function listImports(db){return db.prepare('SELECT id,source,name,found,imported,duplicate,review,status,error,created_at,mime_type,(content IS NOT NULL) AS has_original FROM import_jobs ORDER BY created_at DESC,rowid DESC LIMIT 200').all();}
export function documentMetadata(d){const {content,fingerprint,...metadata}=d;const details=typeof d.metadata==='string'?JSON.parse(d.metadata):d.metadata;return {...metadata,metadata:details,direction:details?.direction,party:details?.party,email:details?.email,subject:details?.subject,size_bytes:content?.length??d.size_bytes??0};}
export function listDocuments(db){return db.prepare('SELECT id,invoice_id,name,mime_type,source,source_id,metadata,status,created_at,length(content) AS size_bytes FROM documents ORDER BY created_at DESC,rowid DESC').all().map(documentMetadata);}
export function storeDocument(db,{name,mime_type,bytes,invoice_id=null,source='upload',source_id=null,metadata={}}){
  const fingerprint=digest(bytes);
  const existing=source_id?db.prepare('SELECT * FROM documents WHERE source_id=?').get(source_id):db.prepare('SELECT * FROM documents WHERE fingerprint=?').get(fingerprint);
  if(existing){
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
  audit(db,'document_uploaded',{id,invoice_id,name,source});return {...documentMetadata(db.prepare('SELECT * FROM documents WHERE id=?').get(id)),duplicate:false};
}
