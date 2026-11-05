import {runReconciliation} from './reconciliation.js';
import {companyReconciliationGate,companyReconciliationFailure} from '../sites/lib/company-reconciliation-policy.js';
import {companySyncError} from '../sites/lib/company-bank-sync-store.js';

/** The adapter fixes db/owner and resolves authority from durable server data.
 * assertCurrent MUST run synchronously against that same SQLite transaction,
 * checking the scope, reference-policy revision and connection/lease fence. */
export function createCompanyReconciler({db,owner,resolveContext,assertCurrent,now=Date.now}){
 return async request=>{
  const identity={companyId:request?.companyId,connectionId:request?.connectionId};
  try{
   if(typeof resolveContext!=='function'||typeof assertCurrent!=='function')throw companySyncError('RECONCILIATION_GUARD_REQUIRED');
   const context=companyReconciliationGate(request,await resolveContext(request),{owner,now:now()});
   const guard=()=>{
    companyReconciliationGate(request,context,{owner,now:now()});
    const result=assertCurrent(context);
    if(result&&typeof result.then==='function'){
     // An asynchronous assertion cannot protect a synchronous SQLite commit.
     Promise.resolve(result).catch(()=>{});
     throw companySyncError('RECONCILIATION_GUARD_REQUIRED');
    }
    if(result===false)throw companySyncError('AUTHORIZATION_CHANGED');
   };
   const result=runReconciliation(db,{owner,connectionId:context.connectionId,referenceContext:context.referenceContext,assertCurrent:guard,includeSummary:true});
   return {...identity,status:'completed',applied:result.applied,review:result.findings.filter(row=>!row.safe).length,findings:result.findings};
  }catch(error){
   const status=companyReconciliationFailure(error);if(!status)throw error;
   return {...identity,status,reason:error.code,applied:0,review:0,findings:[]};
  }
 };
}
