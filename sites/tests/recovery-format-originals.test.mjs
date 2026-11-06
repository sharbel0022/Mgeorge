import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {loadImage} from '@napi-rs/canvas';
import {textPdf,image} from '../../test/fixtures.js';
import {makeBankgiroXLSX} from './helpers/bankgiro-xlsx-fixture.mjs';
import {serverPdfText} from '../lib/server-pdf.ts';
import {parseBankgiroCSV,parseBankgiroXML} from '../lib/bankgiro-parser.js';
import {parseBankgiroXLSX} from '../lib/bankgiro-xlsx.js';
import {BACKUP_TABLES,backupStep} from '../lib/backup-engine.ts';
import {exportBackupBundle} from '../scripts/lib/backup-recovery.mjs';
import {restoreBackupIsolated} from '../scripts/restore-backup-isolated.mjs';
import {acceptIsolatedRecovery,sortedRecoveryRows} from '../scripts/lib/recovery-acceptance.mjs';
import {createSyntheticFixture,fixtureOwner as owner,fixtureSnapshotAt as at,fixtureDocumentId as uuid} from '../scripts/lib/recovery-drill-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const boundary={version:'company-data-boundary-v1',companyId:'synthetic-company',storageOwner:owner,boundaryVersion:1};
const census=f=>BACKUP_TABLES.map(name=>({name,rows:sortedRecoveryRows(f.sql.prepare('SELECT * FROM '+name+' WHERE owner=?').all(owner))}));

test('encrypted isolated recovery retains parseable synthetic PDF, PNG, CSV, XML and XLSX originals byte for byte',async t=>{
 // All bytes come from existing explicit synthetic fixtures or their generators.
 // This is separate from the large generated-byte volume drill; it does not
 // certify OCR accuracy, bank entitlement or a real customer corpus.
 const formats=[
  {format:'PDF',filename:'synthetic-invoice.pdf',mime:'application/pdf',bytes:textPdf(),
   async validate(bytes){const result=await serverPdfText(Uint8Array.from(bytes));assert.match(result.text,/0606/);assert.match(result.text,/000018/);assert.equal(result.method,'pdf');}},
  {format:'PNG',filename:'synthetic-invoice.png',mime:'image/png',bytes:image().toBuffer('image/png'),
   async validate(bytes){const decoded=await loadImage(bytes);assert.equal(decoded.width,1400);assert.equal(decoded.height,1400);}},
  {format:'CSV',filename:'synthetic-bankgiro-0599.csv',mime:'text/csv',bytes:readFileSync(new URL('./fixtures/bankgiro-0599.csv',import.meta.url)),
   async validate(bytes){const rows=parseBankgiroCSV(bytes.toString('utf8'),'synthetic.csv');assert.equal(rows.length,1);assert.equal(rows[0].amount,62500);assert.equal(rows[0].payerReference,'0599');}},
  {format:'XML',filename:'synthetic-camt054.xml',mime:'application/xml',bytes:readFileSync(new URL('./fixtures/synthetic-ui-camt054.xml',import.meta.url)),
   async validate(bytes){const rows=parseBankgiroXML(bytes.toString('utf8'),'synthetic.xml');assert.equal(rows.length,1);assert.equal(rows[0].amount,717916);assert.equal(rows[0].payerReference,'000018');}},
  {format:'XLSX',filename:'synthetic-bankgiro.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:Buffer.from(makeBankgiroXLSX({currency:'SEK'})),
   async validate(bytes){const rows=parseBankgiroXLSX(Uint8Array.from(bytes),'synthetic.xlsx');assert.equal(rows.length,1);assert.equal(rows[0].amount,12345);assert.equal(rows[0].payerReference,'0017');}},
 ];
 for(const original of formats)await original.validate(original.bytes);
 const folder=mkdtempSync(join(tmpdir(),'mg-recovery-formats-')),f=createSyntheticFixture(formats.length,formats.length*4096),key=randomBytes(32).toString('hex');
 t.after(()=>{f.sql.close();rmSync(folder,{recursive:true,force:true});});
 for(const [index,original]of formats.entries()){
  const id=uuid(index),checksum=sha(original.bytes);
  f.documents[index].bytes=original.bytes;
  f.objects.set(owner+'/'+id,Uint8Array.from(original.bytes));
  f.sql.prepare('UPDATE documents SET filename=?,mime=?,size=?,sha256=? WHERE owner=? AND id=?').run(original.filename,original.mime,original.bytes.length,checksum,owner,id);
 }
 // Preserve typed original references, including a historical revoked link.
 // The fixture's financial amounts remain unchanged: parsing here never posts
 // new transactions, invoices or allocations.
 const bankFileHash=sha(formats[2].bytes);
 f.state.imports[0].hash=bankFileHash;f.state.bankgiroLinks[0].sha256=bankFileHash;
 f.sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(f.state),owner);
 f.sql.prepare('UPDATE document_extractions SET result=? WHERE owner=?').run(JSON.stringify({processing:{sha256:sha(formats[0].bytes)}}),owner);
 f.sql.prepare('UPDATE bankgiro_ingest_jobs SET sha256=?,filename=? WHERE owner=?').run(bankFileHash,formats[2].filename,owner);
 const expectedTables=census(f),originals=formats.map((original,index)=>({id:uuid(index),size:original.bytes.length,sha256:sha(original.bytes)}));
 let completed;
 for(let step=0;step<8;step++){
  completed=await backupStep(f.db,f.bucket,owner,key,at,5,{companyBoundary:boundary});
  assert.notEqual(completed.status,'failed',completed.error);
  if(completed.status==='complete')break;
 }
 assert.equal(completed.status,'complete');
 const sourceHashes=()=>[...f.objects].map(([path,bytes])=>[path,sha(bytes)]).sort(([a],[b])=>a.localeCompare(b));
 const before=sourceHashes(),bundleDirectory=join(folder,'bundle'),outputParent=join(folder,'restore'),sourceFiles={};
 mkdirSync(bundleDirectory,{mode:0o700});mkdirSync(outputParent,{mode:0o700});
 await exportBackupBundle(f.bucket,f.row(),key,owner,async(path,bytes)=>{
  const destination=join(bundleDirectory,path);mkdirSync(dirname(destination),{recursive:true,mode:0o700});writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
  if(path==='bundle.json'||path==='manifest.bin'||path==='objects/snapshot.bin')sourceFiles[path==='objects/snapshot.bin'?'snapshot.bin':path]=sha(bytes);
 },{expectedCompanyBoundary:boundary});
 const provenance={backupId:f.row().id,companyBoundary:structuredClone(boundary),snapshotSha256:f.row().snapshot_hash,sourceFiles};
 const restored=await restoreBackupIsolated({bundleDirectory,outputParent,key,expectedOwner:owner,expectedBackupId:provenance.backupId,expectedCompanyBoundary:boundary});
 const accepted=acceptIsolatedRecovery({directory:restored.directory,owner,tables:expectedTables,originals,incidentAt:'2026-11-05T12:15:00.000Z',recoveryPointAt:at.toISOString(),provenance});
 assert.deepEqual(accepted.originals,{count:5,bytes:originals.reduce((sum,original)=>sum+original.size,0),hashesChecked:5});
 assert.deepEqual(accepted.ledger,{invoices:2,invoiceCents:75000,transactions:2,transactionCents:75000,allocations:1,allocatedCents:62500,revokedCredits:1,revokedBankgiroLinks:1});
 assert.equal(accepted.sourceProvenanceVerified,true);
 for(const [index,original]of formats.entries()){
  const bytes=readFileSync(join(restored.directory,'originals',uuid(index)+'.bin'));
  assert.deepEqual(bytes,original.bytes);assert.equal(sha(bytes),originals[index].sha256);
  await original.validate(bytes);
 }
 assert.deepEqual(census(f),expectedTables);assert.deepEqual(sourceHashes(),before);
 t.diagnostic(JSON.stringify({kind:'synthetic_recovery_format_fidelity',productionRestoreTested:false,formats:formats.map((original,index)=>({format:original.format,bytes:originals[index].size,sha256:originals[index].sha256,parserAcceptedBeforeAndAfter:true})),sourceUnchanged:true,financialReferencesPreserved:true}));
});
