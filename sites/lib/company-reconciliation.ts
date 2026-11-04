import {canonicalBankAccount,type State} from './domain';
import {reconcileWithOriginals} from './reconciliation-evidence';
import {companyReconciliationGate,companyReconciliationFailure,companyInvoiceReview} from './company-reconciliation-policy.js';
import {companySyncError} from './company-bank-sync-store.js';

export type CompanyReconciliationRequest={companyId:string;connectionId:string;expectedGeneration?:string;expectedRevision?:number};
type Dependencies={
 owner:string;
 resolveContext:(request:CompanyReconciliationRequest)=>Promise<any>;
 assertCurrent:(context:any)=>Promise<void|boolean>|void|boolean;
 now?:()=>number;
};

/** Called only by the owned workspace adapter. The returned projection still
 * needs its scope/policy/lease fences in the SAME writePaymentState batch as
 * workspace CAS and audit. Caller input never supplies authoritative context. */
export function createCompanyReconciler({owner,resolveContext,assertCurrent,now=Date.now}:Dependencies){
 return async(request:CompanyReconciliationRequest,initial:State)=>{
  const identity={companyId:request?.companyId,connectionId:request?.connectionId};
  try{
   if(typeof resolveContext!=='function'||typeof assertCurrent!=='function')throw companySyncError('RECONCILIATION_GUARD_REQUIRED');
   const context=companyReconciliationGate(request,await resolveContext(request),{owner,now:now()});
   if(typeof context.reconciliationAccount!=='string'||!context.reconciliationAccount.trim())throw companySyncError('AUTHORIZATION_UNVERIFIED');
   const guard=async()=>{
    companyReconciliationGate(request,context,{owner,now:now()});
    if(await assertCurrent(context)===false)throw companySyncError('AUTHORIZATION_CHANGED');
   };
   await guard();
   const scoped=structuredClone(initial);
   // Temporary calculation context; company settings are not changed or saved.
   scoped.company={...scoped.company,...context.referenceContext.company,invoiceReferencePolicies:context.referenceContext.policies};
   const result=await reconcileWithOriginals(owner,scoped,{
    account:canonicalBankAccount(context.reconciliationAccount),
    invoiceReview:invoice=>companyInvoiceReview({direction:invoice.direction==='receivable'?'customer':'supplier',reference:invoice.ocr},invoice.referenceOriginal?[invoice.referenceOriginal]:[],context.referencePolicy.mode),
   });
   await guard();
   result.state.company=structuredClone(initial.company);
   const applied=result.state.allocations.filter(row=>row.active&&!initial.allocations.some(old=>old.active&&old.id===row.id)).length;
   return {...identity,...result,context,status:'completed' as const,applied,review:result.findings.filter(row=>!row.safe).length};
  }catch(error){
   const status=companyReconciliationFailure(error);if(!status)throw error;
   return {...identity,status,reason:(error as {code:string}).code,applied:0,review:0,state:initial,decisions:[],findings:[],context:null};
  }
 };
}
