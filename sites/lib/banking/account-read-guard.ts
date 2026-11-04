import {db} from '../server';
import {connection,assertCompanyConsent,type BankConnectionRow,type BankLease} from './store';
import {providerCooldownDiagnostic} from './enable-banking';
import {accountReadCooldown,mergeAccountReadCooldown} from './account-read-cooldown';

/** Persist uncertainty before an outbound bank read. A crash, lost lease or
 * failed result write leaves the marker blocking account-detail reads. Only
 * this attempt may resolve its marker; older unresolved waits are preserved.
 * The marker is operational state, never a claimed provider reset deadline. */
export async function guardedBankRead<T>(owner:string,expected:BankConnectionRow,lease:BankLease,read:()=>Promise<T>,onStateChange?:(changed:boolean)=>void):Promise<T>{
 await lease.assert();
 const current=await connection(owner);
 if(!current||current.owner!==owner||current.id!==expected.id||current.app_generation!==expected.app_generation||current.encrypted_session!==expected.encrypted_session)throw Error('BANK_ACCOUNT_READ_CONTEXT_CHANGED');
 await assertCompanyConsent(current);
 const authorizedRead=async()=>{
  const result=await read();
  await lease.assert();
  await assertCompanyConsent(current);
  return result;
 };
 const previous=current.account_evidence_retry;
 // Transaction reads may continue under their own schedule while an older
 // account-read wait remains unresolved. They must never clear that wait.
 const cooldown=accountReadCooldown(previous);
 if(cooldown.blocked&&cooldown.retryAdvice?.status!=='known')return authorizedRead();
 const pending=JSON.stringify({status:'pending',checkedAt:new Date().toISOString(),attemptId:crypto.randomUUID()});
 const save=(value:string,compare:string)=>lease.run(db().prepare('UPDATE bank_connections SET account_evidence_retry=? WHERE owner=? AND id=? AND app_generation=? AND encrypted_session=? AND account_evidence_retry=?').bind(value,owner,current.id,current.app_generation,current.encrypted_session,compare));
 const armed=await save(pending,previous);
 if(armed.meta.changes!==1)throw Error('BANK_ACCOUNT_READ_CONTEXT_CHANGED');
 onStateChange?.(true);
 let result:T|undefined,error:unknown,failed=false;
 try{result=await authorizedRead();}catch(caught){error=caught;failed=true;}
 const resolved=failed?mergeAccountReadCooldown(previous,providerCooldownDiagnostic(error)):previous;
 // Do not put cleanup in finally: a failed/expired finish must retain pending.
 const saved=await save(resolved,pending);
 if(saved.meta.changes!==1)throw Error('BANK_ACCOUNT_READ_CONTEXT_CHANGED');
 onStateChange?.(resolved!==previous);
 if(failed)throw error;
 return result as T;
}
