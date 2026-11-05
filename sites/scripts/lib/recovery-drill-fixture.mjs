// Synthetic-only fixture for the local recovery drill. No production bindings or keys.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
export const fixtureOwner='synthetic-isolated-recovery-owner';
export const fixtureSnapshotAt=new Date('2026-11-05T12:00:00.000Z');
export const fixtureDocumentId=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const owner=fixtureOwner,at=fixtureSnapshotAt,uuid=fixtureDocumentId;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../../drizzle/'+name,import.meta.url),'utf8'));
 return sql;
}
function insert(sql,name,row){const keys=Object.keys(row);sql.prepare(`INSERT INTO ${name} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
export function createSyntheticFixture(count,totalOriginalBytes){
 const sql=database();const objects=new Map(),puts=[],gets=[];
 const bucket={async get(path){gets.push(path);const bytes=objects.get(path);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,bytes){puts.push(path);objects.set(path,new Uint8Array(bytes));}};
 const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:sql.prepare(query).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.all());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const documents=Array.from({length:count},(_,n)=>{const bytes=Buffer.alloc(Math.floor(totalOriginalBytes/count)+(n<totalOriginalBytes%count?1:0),n%251);bytes.write('%PDF-Synthetic recovery original '+n+'\n');return{id:uuid(n),bytes};});
 const state={schemaVersion:1,invoices:[{id:'invoice',number:'SYNTHETIC-01',party:'Synthetic recovery customer',total:62500,documentId:uuid(0)},{id:'unpaid',number:'SYNTHETIC-02',party:'Synthetic unpaid customer',total:12500,documentId:uuid(2)}],transactions:[{id:'payment',amount:62500,currency:'SEK',bankDetails:{documentId:uuid(1)}},{id:'unallocated',amount:12500,currency:'SEK',bankDetails:{documentId:uuid(2)}}],allocations:[{id:'allocation',invoiceId:'invoice',transactionId:'payment',amount:62500}],credits:[{id:'historical-credit',amount:500,revokedAt:at.toISOString()}],imports:[{id:'report',documentId:uuid(2),hash:sha(documents[2].bytes)}],receipts:[],bankgiroLinks:[{id:'revoked-link',documentId:uuid(2),sha256:sha(documents[2].bytes),revokedAt:at.toISOString()}]};
 insert(sql,'workspaces',{owner,revision:42,payload:JSON.stringify(state),updated_at:at.toISOString()});
 insert(sql,'workspaces',{owner:'another-synthetic-owner',revision:1,payload:JSON.stringify({...state,private:'OTHER_OWNER_PRIVATE'}),updated_at:at.toISOString()});
 for(const document of documents){insert(sql,'documents',{id:document.id,owner,filename:'synthetic.pdf',mime:'application/pdf',size:document.bytes.length,sha256:sha(document.bytes),created_at:at.toISOString()});objects.set(owner+'/'+document.id,new Uint8Array(document.bytes));}
 const foreign=Buffer.from('OTHER_OWNER_PRIVATE_ORIGINAL');insert(sql,'documents',{id:uuid(4999),owner:'another-synthetic-owner',filename:'foreign-synthetic.pdf',mime:'application/pdf',size:foreign.length,sha256:sha(foreign),created_at:at.toISOString()});objects.set('another-synthetic-owner/'+uuid(4999),new Uint8Array(foreign));
 const rows={
  audit_events:{id:'audit',revision:41,action:'invoice.save',detail:JSON.stringify({command:{type:'invoice.save',invoice:{documentId:uuid(2)}},automatic:[]}),created_at:at.toISOString()},
  bank_applications:{application_id:'synthetic-app',encrypted_key:'synthetic-encrypted-key',metadata:'{}',generation:'generation',created_at:at.toISOString(),updated_at:at.toISOString()},
  bank_connections:{id:'connection',app_generation:'generation',environment:'test',bank_name:'Synthetic bank',country:'SE',encrypted_session:'synthetic-encrypted-session',encrypted_accounts:'synthetic-encrypted-accounts',selected_accounts:'[]',valid_until:at.toISOString(),date_from:'2026-01-01',status:'connected',account_evidence_retry:JSON.stringify({status:'unknown',checkedAt:at.toISOString(),provenance:'retry_after_missing'}),auto_sync_enabled:1,created_at:at.toISOString(),updated_at:at.toISOString()},
  bank_sync_runs:{id:'bank-run',connection_id:'connection',imported:1,skipped:0,warnings:'[]',test:1,created_at:at.toISOString()},
  gmail_connections:{email:'synthetic@example.invalid',tokens:'synthetic-encrypted-tokens'},
  customer_contacts:{invoice_id:'invoice',email:'synthetic@example.invalid',identity:'identity',evidence:'{}',updated_at:at.toISOString()},
  customer_messages:{id:'message',invoice_id:'invoice',kind:'receipt',recipient:'synthetic@example.invalid',subject:'Synthetic',body:'Synthetic',snapshot:'synthetic-snapshot',created_at:at.toISOString(),updated_at:at.toISOString()},
  reconciliation_findings:{id:'finding',invoice_id:'invoice',transaction_id:'payment',kind:'manual',details:'{}',created_at:at.toISOString()},
  customer_deliveries:{id:'delivery',message_id:'message',review_id:'review',version:1,snapshot:'synthetic-snapshot',recipient:'synthetic@example.invalid',subject:'Synthetic',body:'Synthetic',status:'sent',rfc_message_id:'synthetic-rfc-id',approved_at:at.toISOString(),sent_at:at.toISOString()},
  gmail_sources:{source_id:'source',document_id:uuid(0),metadata:'{}',status:'registered',created_at:at.toISOString()},
  gmail_runs:{id:'gmail-run',found:1,imported:1,duplicates:0,status:'complete',created_at:at.toISOString()},
  document_automation:{email:'synthetic@example.invalid',enabled:1,auto_register:1,updated_at:at.toISOString()},
  document_jobs:{document_id:uuid(0),state:'completed',available_at:at.toISOString(),invoice_id:'invoice',automatic:1,updated_at:at.toISOString()},
  document_extractions:{id:'extraction',document_id:uuid(0),result:JSON.stringify({processing:{sha256:sha(documents[0].bytes)}}),created_at:at.toISOString()},
  invoice_counterparties:{identity:'identity',email:'synthetic@example.invalid',evidence:'{}',verified_at:at.toISOString()},
  document_registrations:{document_id:uuid(0),identity:'identity',invoice_id:'invoice',attempt:'attempt',total:62500,created_at:at.toISOString()},
  payment_control_runs:{id:'control',status:'complete',steps:'[]',started_at:at.toISOString(),finished_at:at.toISOString(),updated_at:at.toISOString()},
  payment_control_requests:{request_id:'request',run_id:'control',created_at:at.toISOString()},
  saas_bank_state:{revision:1,payload:'synthetic-encrypted-consent-state'},
  bankgiro_ingest_sources:{source_id:'synthetic-source',scope_id:'synthetic-scope',authorization_generation:'synthetic-generation',cursor:'delivery-2',updated_at:at.getTime()},
  bankgiro_ingest_jobs:{id:'synthetic-report-job',source_id:'synthetic-source',scope_id:'synthetic-scope',report_id:'0000599',sha256:sha(documents[2].bytes),filename:'synthetic.xml',authorization_generation:'synthetic-generation',document_id:uuid(2),status:'REVIEW',created_at:at.getTime(),updated_at:at.getTime()},
  company_bank_sync_scopes:{company_id:'synthetic-company',evidence_id:'synthetic-company-binding',reference_policy:JSON.stringify({companyId:'synthetic-company',owner,revision:1,companyName:'Synthetic recovery AB',mode:'invoice_number',evidenceId:'synthetic-policy'}),created_at:at.getTime()},
  company_bank_sync_jobs:{company_id:'synthetic-company',account_key:'synthetic-account',provider:'synthetic-bank',connection_id:'connection',authority_hash:'a'.repeat(64),generation_hash:'b'.repeat(64),authority_revision:1,valid_until:at.getTime()+86400000,lease_token:'synthetic-former-worker',lease_until:at.getTime()+60000,lease_deadline:at.getTime()+90000,fence_version:4,status:'retry',next_attempt_at:at.getTime()+60000,error_code:'PROVIDER_429',checkpoint:'{"cursor":"synthetic-page"}'},
  company_bank_sync_requests:{id:'synthetic-company-request',company_id:'synthetic-company',account_key:'synthetic-account',connection_id:'connection',provider:'synthetic-bank',reserved_at:at.getTime()},
  company_bank_sync_receipts:{company_id:'synthetic-company',account_key:'synthetic-account',receipt_key:'synthetic-page',sha256:'c'.repeat(64),result:'{"imported":1}',committed_at:at.getTime()},
 };
 for(const [name,row]of Object.entries(rows))insert(sql,name,{owner,...row});
 insert(sql,'bank_locks',{owner,token:'synthetic-live-lock',expires_at:at.toISOString()});
 return{sql,db,bucket,objects,puts,gets,documents,state,row:()=>sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner)};
}
