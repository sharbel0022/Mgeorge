import {companySyncError,validateCompanySyncContext} from './company-bank-sync-store.js';
import {INVOICE_REFERENCE_POLICY_VERSION,strictInvoiceReferenceMatch,validateInvoiceReferencePolicies,canonicalInvoiceReference,resolveInvoiceReferenceConfiguration} from './invoice-reference-policy.js';
import {ocrChecksum} from './payment-references.js';
import {assertCompanyContext} from './company-contract.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

const text=value=>typeof value==='string'&&value.length>0&&value.length<=300&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>0;
const fail=code=>{throw companySyncError(code);};

/** Call only after resolving the live tenant and reading its owned settings.
 * Editable company IDs never supply authority. An explicit reference remains
 * distinct from formal OCR, and an absent rule never adopts legacy defaults. */
export function companyReferencePolicyFromWorkspace(input,state,previous=null){
 const context=assertCompanyContext(input),companyId=context.companyId,owner=context.storageOwner;
 if(previous&&(previous.companyId!==companyId||previous.owner!==owner))fail('COMPANY_SCOPE_MISMATCH');
 const selected=resolveInvoiceReferenceConfiguration({company:state?.company,policies:state?.company?.invoiceReferencePolicies??[]});
 if(selected.issue)fail('REFERENCE_POLICY_UNVERIFIED');
 if(!selected.policy)return null;
 const companyName=state.company.name,mode=selected.policy.referenceSource==='invoice_number'?'invoice_number':'explicit_only';
 const evidenceId='workspace-reference:'+bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([companyId,owner,companyName,selected.policy]))));
 const same=previous&&previous.companyName===companyName&&previous.mode===mode&&previous.evidenceId===evidenceId;
 return {companyId,owner,revision:same?previous.revision:(previous?.revision??0)+1,companyName,mode,evidenceId};
}

/** This validates facts returned by a trusted storage resolver. It cannot bind
 * a caller's company label to an existing ledger or authenticate arbitrary JSON.
 * @param {any} request
 * @param {any} current
 * @param {{owner?:string,now?:number}} options
 */
export function companyReconciliationGate(request,current,{owner,now=Date.now()}={}){
 if(!request||!text(request.companyId)||!text(owner)||!current||current.companyId!==request.companyId||current.owner!==owner)fail('COMPANY_SCOPE_MISMATCH');
 const scope=current.scope;
 if(!scope||scope.companyId!==current.companyId||scope.owner!==owner||!text(scope.evidenceId)||!revision(scope.revision))fail('COMPANY_SCOPE_MISMATCH');
 const context=validateCompanySyncContext(current,now);
 if(!text(request.connectionId)||request.connectionId!==context.connectionId||request.expectedGeneration!==undefined&&request.expectedGeneration!==context.generation||request.expectedRevision!==undefined&&request.expectedRevision!==context.revision)fail('AUTHORIZATION_CHANGED');
 const policy=context.referencePolicy;
 if(!policy||policy.companyId!==context.companyId||policy.owner!==owner||!revision(policy.revision)||!text(policy.evidenceId)||!['invoice_number','explicit_only','ocr'].includes(policy.mode))fail('REFERENCE_POLICY_UNVERIFIED');
 let policies;
 try{policies=validateInvoiceReferencePolicies([{
  version:INVOICE_REFERENCE_POLICY_VERSION,id:'company-reference-policy-v1',companyName:policy.companyName,
  referenceSource:policy.mode==='invoice_number'?'invoice_number':'explicit_reference',direction:'customer',matchMode:'exact',
 }]);}catch{fail('REFERENCE_POLICY_UNVERIFIED');}
 return {
  ...structuredClone(context),dataScopeId:owner,scopeBindingRevision:scope.revision,
  referenceContext:{company:{name:policy.companyName},policies,companyReferenceMode:policy.mode},
 };
}

/** Additional company rules only withhold candidates. Existing engines retain
 * responsibility for originals, payer, account, currency and integer balances. */
export function companyInvoiceReview(invoice,originals,mode){
 if(!mode)return '';
 if(invoice.direction!=='customer')return 'Företagets referensregel gäller enbart egna kundfakturor.';
 if(mode==='invoice_number')return '';
 if(mode==='explicit_only'){
  if(!canonicalInvoiceReference(invoice.reference))return 'Fakturan saknar en uttrycklig betalningsreferens.';
  if(!Array.isArray(originals)||!originals.some(original=>strictInvoiceReferenceMatch(original?.reference,invoice.reference)))return 'Fakturans betalningsreferens måste finnas oförändrad i originaluppgifterna.';
  return '';
 }
 if(mode!=='ocr')return 'Företagets referensregel saknas eller kan inte verifieras.';
 if(typeof invoice.reference!=='string'||!/^\d{2,25}$/.test(invoice.reference)||!ocrChecksum(invoice.reference))return 'Fakturan saknar en uttrycklig giltig OCR-referens. Fakturanumret ersätter inte OCR.';
 if(!Array.isArray(originals)||!originals.some(original=>strictInvoiceReferenceMatch(original?.reference,invoice.reference)))return 'Fakturans OCR-referens måste finnas oförändrad i originaluppgifterna.';
 return '';
}

/** Safe outcomes are explicit; unexpected engine/database failures still throw. */
export function companyReconciliationFailure(error){
 const stale=new Set(['AUTHORIZATION_CHANGED','REFERENCE_POLICY_CHANGED','LEASE_LOST','BANK_CONSENT_CHANGED','BANKGIRO_SOURCE_CHANGED']);
 const held=new Set(['COMPANY_SCOPE_MISMATCH','REFERENCE_POLICY_UNVERIFIED','AUTHORIZATION_UNVERIFIED','CONSENT_EXPIRED','BACKGROUND_POLICY_UNVERIFIED','RECONCILIATION_GUARD_REQUIRED']);
 return stale.has(error?.code)?'stale':held.has(error?.code)?'held':null;
}
