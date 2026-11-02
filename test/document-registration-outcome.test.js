import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeDocument} from '../src/db.js';
import {approveDocument} from '../src/invoice-review.js';

const values={invoice_number:'SYN-001',party:'Synthetic supplier AB',organization_number:'5560160680',issued_at:'2026-10-01',due_at:'2026-11-01',total_cents:12500,vat_cents:2500,net_cents:10000,currency:'SEK',reference:'',bankgiro:'123-4567',direction:'supplier',kind:'invoice'};
function fixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-registration-outcome-')),path=join(folder,'test.sqlite'),f={folder,path,db:openDatabase(path)};
  t.after(()=>{f.db.close();rmSync(folder,{recursive:true,force:true});});
  f.document=storeDocument(f.db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-synthetic-retained-original')});
  return f;
}

test('document registration reports its committed invoice when the later suggestions read fails',t=>{
  const f=fixture(t),prepare=f.db.prepare.bind(f.db);
  const failingRead=t.mock.method(f.db,'prepare',query=>{
    if(query.includes('FROM bank_transactions'))throw Error('synthetic private suggestion read failure');
    return prepare(query);
  });
  const result=approveDocument(f.db,f.document.id,{confirm:true,values});
  assert.ok(result.id);
  assert.equal(result.suggestions_unavailable,true);
  assert.match(result.warning,/Fakturan är registrerad.*[Mm]atchningsförslag/s);
  assert.doesNotMatch(JSON.stringify(result),/synthetic private/);
  assert.equal('suggestions' in result,false,'a failed read must not claim there are no suggestions');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='invoice_review_approved'").get().n,1);
  assert.equal(f.db.prepare('SELECT invoice_id FROM documents WHERE id=?').get(f.document.id).invoice_id,result.id);
  failingRead.mock.restore();
  f.db.close();f.db=openDatabase(f.path);
  assert.deepEqual(approveDocument(f.db,f.document.id,{confirm:true,values}),{id:result.id,duplicate:true});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
});

test('a document approval write failure rolls back the invoice and remains an error',t=>{
  const f=fixture(t);
  f.db.exec("CREATE TRIGGER reject_registration BEFORE UPDATE ON documents WHEN NEW.status='registered' BEGIN SELECT RAISE(ABORT,'synthetic approval write failure'); END;");
  assert.throws(()=>approveDocument(f.db,f.document.id,{confirm:true,values}),/synthetic approval write failure/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='invoice_review_approved'").get().n,0);
  assert.equal(f.db.prepare('SELECT status FROM documents WHERE id=?').get(f.document.id).status,'needs_review');
});
