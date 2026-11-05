import {
  activeBankgiroLink, automaticMatchHoldReason, bankPaymentReview,
  canonicalBankAccount, credited, economicTransactions, hasBankApiOrigin,
  paymentEvidenceConflict, paymentLineage, paymentOriginalIssue,
  type State, type Transaction,
} from './domain';
import {
  adaptInvoiceReferenceEvidence, buildReconciliationPreview, invoiceReferencePolicyFromContext, RECONCILIATION_CONTRACT_VERSION,
  type BankAccountEvidence, type BankTransaction, type InvoiceReferencePolicy,
  type OriginalEvidence, type ReconciliationInput, type ReportDepositRelationship,
} from './reconciliation-contract.js';
import {readPaymentVerification, type PaymentVerification} from './payment-verification';
import {invoiceFacts} from './reconciliation';
import {bankPaymentFieldSources} from './payment-presentation';
import {bankAccountConsentSnapshot,bankgiroRetainedPreview} from './bankgiro-service';
import {apiPayerEvidence} from './payer-evidence.js';
import {db,readBankOriginalBytes} from './server';
import {readBankgiroSourceEvidence} from './bankgiro-source-evidence.js';
import {readCamtDocument,decodeCamtBytes,xmlChildren,xmlPath,xmlValue,camtReportEvidence,camtDate} from './camt-xml.js';

type PreviewOptions = {referencePolicy?: InvoiceReferencePolicy | null};
const missingOriginal = 'Originalet är inte verifierat i denna avgränsade kontroll.';
const missingAccount = 'Aktuellt ägarbundet konto har inte verifierats i denna kontroll.';
const consentFields = ['id','owner','status','environment','app_generation','valid_until','selected_accounts','encrypted_accounts','encrypted_session','bank_name','country'] as const;
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const reportId = (row: Transaction) => row.specification ? 'report:' + JSON.stringify([row.importId,row.specificationGroup || row.id]) : '';
const sha256 = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map(byte => byte.toString(16).padStart(2,'0')).join('');
const declaredInteger = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : NaN;
type ReportDeclaration = {paymentCount:number;totalMinor:number};
type CamtDeclaration = ReportDeclaration & {evidence:string;account:string;bookedDate:string};

function camtDeclarations(bytes: ArrayBuffer): CamtDeclaration[] {
  const document = readCamtDocument(decodeCamtBytes(bytes)), statement = document.namespace.includes('camt.053.');
  return xmlChildren(xmlPath(document,statement?'BkToCstmrStmt':'BkToCstmrDbtCdtNtfctn'),statement?'Stmt':'Ntfctn').flatMap((report:Record<string,any>) => xmlChildren(report,'Ntry').map((entry:Record<string,any>) => {
    const counts:number[] = xmlChildren(entry,'NtryDtls').map((detail:Record<string,any>) => declaredInteger(xmlValue(detail,'Btch','NbOfTxs')));
    const count = counts.length ? counts.reduce((total,value) => total+value,0) : NaN;
    const amount = xmlPath(entry,'Amt'), raw = amount?.text.trim() || '', [units,fraction=''] = raw.split('.');
    const total = /^\d+(?:\.\d{1,2})?$/.test(raw) ? Number(units)*100+Number(fraction.padEnd(2,'0')) : NaN;
    const direction = xmlValue(entry,'CdtDbtInd');
    return {
      evidence:JSON.stringify(camtReportEvidence(document,report,entry)),
      account:canonicalBankAccount(xmlValue(report,'Acct','Id','IBAN') || xmlValue(report,'Acct','Id','Othr','Id')),
      bookedDate:camtDate(entry,'BookgDt',true),
      paymentCount:Number.isSafeInteger(count) && count>0 ? count : NaN,
      totalMinor:amount?.attributes.Ccy==='SEK' && Number.isSafeInteger(total) && ['CRDT','DBIT'].includes(direction) ? total*(direction==='DBIT'?-1:1) : NaN,
    };
  }));
}

function reportObservation(row: Record<string,any>, retained = false) {
  const original = retained ? row.original : row;
  return JSON.stringify([
    original?.party,original?.payerReference,original?.amount,original?.date,
    canonicalBankAccount(original?.account || ''),original?.bankReference,
    row.amount,row.date,canonicalBankAccount(row.account || ''),row.bankReference,row.currency,
    row.parentBankReference || '',row.recipientAccount || row.account || '',
    row.payerBankgiro || '',row.recipientBankgiro || '',row.payerAccount || '',
    row.referenceEvidence,row.payerEvidence,row.reportEvidence,
  ]);
}

function referencePolicy(supplied: PreviewOptions, owner: string, state: State) {
  // Use the same owned, cloned workspace and configuration selector as C1.
  // Explicit null holds the preview; clients cannot supply this option.
  const policy = supplied.referencePolicy === undefined ? invoiceReferencePolicyFromContext({company:state.company,policies:state.company.invoiceReferencePolicies},'workspace:' + owner) : supplied.referencePolicy;
  return {policy, companyId: policy?.companyId || 'workspace:' + owner};
}

/** Bounded stored-evidence read. The complete workspace still participates in
 * uniqueness, balances and the snapshot; unrelated sources remain unverified. */
export async function readReconciliationPreview(owner: string, initial: State, revision: number, transactionId: string, options: PreviewOptions = {}) {
  if (!owner) throw Error('AUTH_REQUIRED');
  if (!validId(transactionId)) throw Error('Välj en giltig bankhändelse.');
  const state = structuredClone(initial), target = state.transactions.find(row => row.id === transactionId);
  if (!target) throw Error('Bankhändelsen finns inte för ditt konto.');
  const checkedAt = new Date().toISOString(), {policy,companyId} = referencePolicy(options,owner,state);
  const sourceOriginals=state.imports.filter(record=>record.documentId&&record.hash).map(record=>({documentId:record.documentId,importId:record.id,sha256:record.hash}));
  const sourceEvidence=await readBankgiroSourceEvidence(db(),owner,sourceOriginals);
  const sourceIssues=new Map(sourceEvidence.reports.map(report=>[report.documentId,report.issue]));
  const groups = new Map<string,Transaction[]>();
  for (const row of state.transactions) if (row.specification) {
    const id = reportId(row); groups.set(id,[...(groups.get(id) || []),row]);
  }
  const lineage = paymentLineage(state,target), covered = new Set(lineage.ancestors.map(row => row.id));
  const selectedLink = activeBankgiroLink(state,target.id);
  const coveredReports = new Set([
    ...(target.specification ? [reportId(target)] : []),
    ...state.transactions.filter(row => row.parentId === target.id && row.specification).map(reportId),
    ...(selectedLink?.rows || []).map(reportId),
  ]);
  for (const id of coveredReports) for (const row of groups.get(id) || []) covered.add(row.id);
  let verification: PaymentVerification | undefined;
  try { verification = await readPaymentVerification(owner,state,target.id); }
  catch { /* A failed source check cannot turn stored verification flags into evidence. */ }
  const step = (id: string) => verification?.steps.find(item => item.id === id);
  const originalChecked = step('original')?.status === 'passed';
  const reportIssues = new Map<string,string>();
  const freshReports = new Map<string,Awaited<ReturnType<typeof bankgiroRetainedPreview>>>();
  const freshCamtDeclarations = new Map<string,ReturnType<typeof camtDeclarations>>();
  const declarations = new Map<string,ReportDeclaration>();
  for (const id of coveredReports) {
    const rows = groups.get(id) || [], first = rows[0], proof = first?.bankFileProof;
    try {
      if (!proof || rows.some(row => row.bankFileProof?.documentId !== proof.documentId || row.bankFileProof?.sha256 !== proof.sha256)) throw Error();
      if (!freshReports.has(proof.documentId)) {
        if (freshReports.size >= 32) throw Error();
        const fresh = await bankgiroRetainedPreview(owner,proof.documentId);
        freshReports.set(proof.documentId,fresh);
        if (/\.xml$/i.test(fresh.name)) {
          const original = await readBankOriginalBytes(owner,proof.documentId);
          if (original.sha256 !== fresh.hash || original.filename !== fresh.name) throw Error();
          freshCamtDeclarations.set(proof.documentId,camtDeclarations(original.bytes));
        }
      }
      const fresh = freshReports.get(proof.documentId)!;
      const freshRows = fresh.rows.filter((row: Record<string,any>) => (row.parentKey || row.parentBankReference || row.bankReference || row.key || 'csv') === first.specificationGroup);
      if (fresh.hash !== proof.sha256 || !freshRows.length || freshRows.length !== rows.length) throw Error();
      const unmatched = freshRows.map((row: Record<string,any>) => reportObservation(row));
      for (const row of rows) {
        const index = unmatched.indexOf(reportObservation(row,true));
        if (index < 0) throw Error();
        unmatched.splice(index,1);
      }
      if (unmatched.length) throw Error();
      if (/\.xml$/i.test(fresh.name)) {
        const originalRow = freshRows[0];
        const matched = (freshCamtDeclarations.get(proof.documentId) || []).filter(declaration => declaration.evidence === JSON.stringify(originalRow.reportEvidence) && declaration.account === canonicalBankAccount(originalRow.recipientAccount || originalRow.account) && declaration.bookedDate === originalRow.date);
        if (matched.length !== 1) throw Error();
        declarations.set(id,matched[0]);
      } else {
        // XLSX carries explicit source totals. CSV has no supported report-count
        // declaration, so its imported row count must not become bank proof.
        const report = freshRows[0].reportEvidence;
        declarations.set(id,{paymentCount:declaredInteger(report?.paymentCount),totalMinor:declaredInteger(report?.totalCents)});
      }
      reportIssues.set(id,'');
    } catch { reportIssues.set(id,'Rapportuppgifterna kan inte återskapas exakt från det bevarade bankoriginalet.'); }
  }
  const consent = new Map<string,BankAccountEvidence>();
  const consentContext: {accountId:string;reportedAccount:string|null;sha256:string;status:string}[] = [];
  for (const row of state.transactions.filter(row => covered.has(row.id))) {
    const accountId = canonicalBankAccount(row.account);
    const reported = row.evidence === 'bankgiro_file' ? row.recipientAccount || '' : undefined;
    const provider=row.bankDataVersion==='openpayments-response-v1'||row.enrichmentEvidence?.provider==='openpayments'?'open_payments':'enable_banking';
    const key = JSON.stringify([provider,accountId,reported ?? null]);
    if (consent.has(key)) continue;
    const absent: BankAccountEvidence = {status:'BLOCKED',ownerId:owner,accountId,currency:row.currency,source:'missing',proofId:'',reason:missingAccount};
    if (consent.size >= 32) { consent.set(key,absent); continue; }
    try {
      const current = await bankAccountConsentSnapshot(owner,accountId,reported,provider);
      const op='provider' in current&&current.provider==='open_payments'?current:null;
      const fingerprint = await sha256(op?[op.provider,op.owner,op.revision,op.payload,op.validUntil]:consentFields.map(field => (current as Record<string,unknown>)[field]));
      consent.set(key,{status:'VERIFIED',ownerId:owner,accountId,currency:row.currency,source:'bank_account_resource',proofId:fingerprint,validUntil:op?op.validUntil:(current as {valid_until:string}).valid_until});
      consentContext.push({accountId,reportedAccount:reported ?? null,sha256:fingerprint,status:'VERIFIED'});
    } catch {
      consent.set(key,absent);
      consentContext.push({accountId,reportedAccount:reported ?? null,sha256:'',status:'BLOCKED'});
    }
  }
  const originals = new Map<string,OriginalEvidence>();
  for (const row of state.transactions) {
    const record = state.imports.find(item => item.id === row.importId);
    const api = hasBankApiOrigin(row), source: OriginalEvidence['source'] = api ? 'bank_api' : row.evidence === 'bank_file' || row.evidence === 'bankgiro_file' ? row.evidence : 'unknown';
    const id = api ? row.externalId || row.bankReference : row.bankFileProof?.documentId || record?.documentId || '';
    const hash = api ? row.bankDataSha256 || '' : row.bankFileProof?.sha256 || record?.hash || '';
    const issue = sourceIssues.get(id) || paymentOriginalIssue(state,row) || (row.specification ? reportIssues.get(reportId(row)) || '' : '');
    // A generic bank-file receipt alone does not replay its payer/financial
    // projection. Until that adapter supplies a complete replay, keep it held.
    const replayed = source === 'bank_api' || source === 'bankgiro_file' && reportIssues.get(reportId(row)) === '';
    const valid = covered.has(row.id) && originalChecked && !issue && replayed && !!id && /^[a-f0-9]{64}$/.test(hash);
    originals.set(row.id,{status:valid?'VERIFIED':'BLOCKED',source,id,sha256:hash,...(!valid?{reason:issue || missingOriginal}:{})});
  }
  const economicIds = new Set(economicTransactions(state).map(row => row.id));
  // Manual report associations and separate detail records remain separate
  // observations. They cannot replace the original payer/reference of an AIS row.
  const bankOnlyState = {...state,bankgiroLinks:[]};
  const transactions: BankTransaction[] = state.transactions.map(row => {
    const fields = bankPaymentFieldSources(bankOnlyState,{...row,bankDetails:undefined});
    const evidence = fields.reference.evidence;
    const accountId = canonicalBankAccount(row.account);
    const provider=row.bankDataVersion==='openpayments-response-v1'||row.enrichmentEvidence?.provider==='openpayments'?'open_payments':'enable_banking';
    const key = JSON.stringify([provider,accountId,row.evidence === 'bankgiro_file' ? row.recipientAccount || '' : null]);
    const review = bankPaymentReview(row,state);
    return {
      id:row.id,bankId:row.bankReference,accountId,amountMinor:row.amount,currency:row.currency,bookedDate:row.date,
      kind:row.kind === 'batch' ? 'aggregate' : 'payment',economic:economicIds.has(row.id),ignored:row.ignored,duplicateOf:row.duplicateOf,
      original:originals.get(row.id)!,
      accountEvidence:covered.has(row.id) && consent.has(key) ? consent.get(key)! : {status:'BLOCKED',ownerId:owner,accountId,currency:row.currency,source:'missing',proofId:'',reason:missingAccount},
      payerEvidence:fields.payer.evidence || (hasBankApiOrigin(row) && row.bankData ? apiPayerEvidence(row.bankData,row.amount>0,{collective:row.kind==='batch'}) : null),
      references:(evidence?.candidates || []).map(candidate => ({value:candidate.value,rawValue:candidate.rawValue,source:candidate.source,kind:candidate.kind,validity:candidate.validity,...(candidate.schema?{schema:candidate.schema}:{})})),
      referenceIncomplete:!!evidence?.incomplete,parentId:row.parentId,reportId:reportId(row),
      reversal:review?.kind === 'reversal',holdReason:automaticMatchHoldReason(row) || review?.reason || '',conflict:paymentEvidenceConflict(state,row),
    };
  });
  const byId = new Map(transactions.map(row => [row.id,row]));
  const reports = [...groups].map(([id,rows]) => {
    const first = rows[0],proof = originals.get(first.id)!;
    const declared = declarations.get(id), paymentCount = declared?.paymentCount ?? first.specificationCount, totalMinor = declared?.totalMinor ?? first.specificationTotal;
    const countConsistent = rows.every(row => row.specificationCount === paymentCount);
    const totalConsistent = rows.every(row => row.specificationTotal === totalMinor);
    const originalConsistent = rows.every(row => originals.get(row.id)?.id === proof.id && originals.get(row.id)?.sha256 === proof.sha256 && originals.get(row.id)?.status === 'VERIFIED');
    return {
      id,bankDepositId:first.parentBankReference || '',accountId:canonicalBankAccount(first.account),currency:first.currency,bookedDate:first.date,
      totalMinor:totalConsistent && Number.isSafeInteger(totalMinor) ? totalMinor! : NaN,
      paymentCount:countConsistent && Number.isSafeInteger(paymentCount) ? paymentCount! : NaN,
      paymentIds:rows.map(row => row.id),original:originalConsistent ? proof : {...proof,status:'BLOCKED' as const,reason:'Rapportens original behöver verifieras.'},
    };
  });
  const relationships: ReportDepositRelationship[] = [];
  for (const [id,rows] of groups) {
    const parentId = rows[0].parentId;
    if (parentId && rows.every(row => row.parentId === parentId && row.specificationStatus === 'linked')) {
      const checked = [parentId,...rows.map(row => row.id)].every(id => byId.get(id)?.original.status === 'VERIFIED' && byId.get(id)?.accountEvidence.status === 'VERIFIED');
      relationships.push({id:'bank-identity:'+id,reportId:id,transactionId:parentId,method:'bank_identity',status:checked?'VERIFIED':'BLOCKED',active:true});
    }
  }
  for (const link of state.bankgiroLinks || []) {
    const ids = new Set(link.specificationIds.flatMap(id => { const row = state.transactions.find(item => item.id === id); return row?.specification ? [reportId(row)] : []; }));
    const active = !link.revokedAt && activeBankgiroLink(state,link.transactionId)?.id === link.id;
    for (const id of ids) relationships.push({id:'manual:'+link.id+':'+id,reportId:id,transactionId:link.transactionId,method:'manual_review',status:active?'REVIEW':'BLOCKED',active});
  }
  const invoiceProof = verification?.invoiceOriginal;
  const input: ReconciliationInput = {
    contractVersion:RECONCILIATION_CONTRACT_VERSION,ownerId:owner,companyId,revision,checkedAt,complete:true,referencePolicy:policy,
    transactions,reports,relationships,customerRelationships:[],
    invoices:state.invoices.map(invoice => {
      const reference = adaptInvoiceReferenceEvidence(invoiceFacts(state,invoice));
      const originalIssue = invoiceProof?.integrity === 'passed' && invoice.documentId === invoiceProof.documentId && step('invoice')?.status === 'passed' ? '' : 'Fakturaoriginalet har inte verifierats entydigt i denna kontroll.';
      return {
        id:invoice.id,companyId,number:invoice.number,explicitReference:invoice.ocr ?? '',referenceClaims:reference.referenceClaims,referenceClaimsComplete:reference.complete,customerName:invoice.party,customerOrganizationNumber:invoice.organizationNumber || '',direction:invoice.direction,currency:invoice.currency,
        totalMinor:invoice.total,creditMinor:credited(state,invoice.id),reviewed:invoice.reviewed,voided:invoice.voided,issuedDate:invoice.issued,
        evidenceIssue:[reference.issue,originalIssue].filter(Boolean).join(' '),
      };
    }),
    allocations:state.allocations.map(allocation => ({id:allocation.id,invoiceId:allocation.invoiceId,transactionId:allocation.transactionId,amountMinor:allocation.amount,active:allocation.active,effect:allocation.effect})),
    // These are committed import receipts, not provider jobs or evidence that a
    // pending report has acquired a deposit relationship.
    importJobs:state.imports.map(record => ({id:record.id,status:'complete',complete:Number.isSafeInteger(record.count) && record.count>=0})),
    evidenceContext:{
      workspaceSha256:await sha256(state),consent:consentContext,bankgiroSource:sourceEvidence.snapshot,
      selectedTransactionId:target.id,
      verification:verification ? {invoiceOriginal:verification.invoiceOriginal,steps:verification.steps.map(({id,status,rule,facts}) => ({id,status,rule,facts}))} : null,
    },
  };
  const preview = await buildReconciliationPreview(input);
  const currentSource=await readBankgiroSourceEvidence(db(),owner,sourceOriginals);
  if(JSON.stringify(currentSource.snapshot)!==JSON.stringify(sourceEvidence.snapshot))throw Object.assign(Error('Rapportkällans uppgifter ändrades under kontrollen. Läs en ny förhandsgranskning.'),{status:409});
  return {...preview,transactionId:target.id,selectedStatus:preview.decisions.find(decision => decision.transactionId === target.id)?.status || 'BLOCKED'};
}
