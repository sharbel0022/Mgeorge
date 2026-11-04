import {companySyncError,validateCompanySyncContext} from './company-bank-sync-store.js';
import {INVOICE_REFERENCE_POLICY_VERSION,strictInvoiceReferenceMatch,validateInvoiceReferencePolicies} from './invoice-reference-policy.js';
import {ocrChecksum} from './payment-references.js';

const text=value=>typeof value==='string'&&value.length>0&&value.length<=300&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>0;
const fail=code=>{throw companySyncError(code);};

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
 if(!policy||policy.companyId!==context.companyId||policy.owner!==owner||!revision(policy.revision)||!text(policy.evidenceId)||!['invoice_number','ocr'].includes(policy.mode))fail('REFERENCE_POLICY_UNVERIFIED');
 let policies;
 try{policies=validateInvoiceReferencePolicies([{
  version:INVOICE_REFERENCE_POLICY_VERSION,id:'company-reference-policy-v1',companyName:policy.companyName,
  referenceSource:policy.mode==='ocr'?'explicit_reference':'invoice_number',direction:'customer',matchMode:'exact',
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
