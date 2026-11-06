import test from 'node:test';
import assert from 'node:assert/strict';

test('the synthetic drill measures a resumed, authenticated full recovery against independently retained expectations',async()=>{
 const {runSyntheticRecoveryDrill}=await import('../scripts/recovery-drill.mjs');
 const result=await runSyntheticRecoveryDrill();
 assert.equal(result.format,'MG-Sites-synthetic-recovery-drill-1');
 assert.equal(result.scope,'synthetic-isolated-evidence-only');
 assert.equal(result.productionRestoreTested,false);
 assert.equal(result.accepted,true);
 assert.equal(result.tables.length,27);
 assert.ok(result.tables.every(table=>table.rows>0));
 assert.deepEqual(result.originals,{count:7,bytes:28672,hashesChecked:7});
 assert.deepEqual(result.ledger,{invoices:2,invoiceCents:75000,transactions:2,transactionCents:75000,allocations:1,allocatedCents:62500,revokedCredits:1,revokedBankgiroLinks:1});
 assert.equal(result.simulatedRecovery.rpoMilliseconds,900000);
 assert.equal(result.simulatedRecovery.postSnapshotWritesExcluded,1);
 assert.ok(result.timing.restoreAndAcceptanceMilliseconds>0);
 assert.ok(result.timing.restoreAndAcceptanceMilliseconds<=result.objectives.isolatedRtoMilliseconds);
 assert.equal(result.resume.interruptionObserved,true);
 assert.equal(result.resume.snapshotPreserved,true);
 assert.equal(result.sourceUnchanged,true);
 assert.equal(result.otherOwnerExcluded,true);
 assert.equal(result.authorizationAndTransientRowsAbsent,true);
 assert.equal(result.applicationTokenRecoveryBlocked,true);
 assert.equal(result.workerLeasesInvalidated,true);
 assert.equal(result.sourceProvenanceVerified,true);
 assert.match(result.provenance.backupId,/^[a-f0-9-]{36}$/);
 for(const field of ['snapshotSha256','tableCensusSha256','originalCensusSha256'])assert.match(result.provenance[field],/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(result.provenance.sourceFiles).sort(),['bundle.json','manifest.bin','snapshot.bin']);
 for(const checksum of Object.values(result.provenance.sourceFiles))assert.match(checksum,/^[a-f0-9]{64}$/);
 assert.deepEqual(result.rejectionChecks.map(check=>check.case),['wrong_key','wrong_owner','wrong_company','corrupt_original','missing_original','altered_ledger','altered_plaintext_original','foreign_owner_row','reactivated_application_issuer','retained_application_token','altered_receipt_backup_id','altered_receipt_company','altered_receipt_snapshot_hash','altered_receipt_format','altered_receipt_transforms','altered_source_header','altered_source_manifest','altered_source_snapshot','missing_source_snapshot','extra_source_file','altered_financial_reference','altered_revoked_bankgiro_reference']);
 assert.ok(result.rejectionChecks.every(check=>check.rejected));
 assert.ok(result.rejectionChecks.filter(check=>check.stage==='restore').every(check=>check.outputCreated===false));
});

test('the drill refuses unbounded or non-synthetic configuration before any recovery work',async()=>{
 const {runSyntheticRecoveryDrill}=await import('../scripts/recovery-drill.mjs');
 for(const options of [null,[],{documentCount:2},{documentCount:5001},{totalOriginalBytes:1},{totalOriginalBytes:600000000},{incidentAt:'not-a-time'},{incidentAt:'2026-11-05T11:59:59.000Z'},{key:'production-key'}]){
  await assert.rejects(()=>runSyntheticRecoveryDrill(options),/recovery_drill_configuration_invalid/);
 }
});
