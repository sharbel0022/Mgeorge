import {currentCompanyContext,identity,readWorkspace} from '../server';
import {assertPaymentOriginal} from '../reconciliation-evidence';
import {readOpenPaymentsAccountState} from '../banking/openpayments-account-state';
import {saasBankSnapshot,saasBankSyncConfiguration} from '../banking/saas-runtime';
import {sitesOpenPaymentsCompanySync} from '../banking/openpayments-company-sync';
import {activeConsent,parseSnapshot} from './contract';
import {projectPayments,projectSync} from './snapshot-projection';
const changed=()=>Object.assign(Error('ONBOARDING_STATE_CHANGED'),{code:'ONBOARDING_STATE_CHANGED',status:409});
/** Authoritative read composition. All status/evidence paths are stored reads;
 * opening or polling the dashboard cannot start bank work. */
export async function onboardingBankSnapshot(request:Request,companyId:string){
 const user=await identity(),context=currentCompanyContext();if(!context||context.companyId!==companyId)throw changed();
 const base=parseSnapshot(await saasBankSnapshot(request,companyId),companyId),configuration=await saasBankSyncConfiguration(request,companyId),selected=base.accounts.filter(a=>a.selected&&a.importable);
 if(!activeConsent(base)||!selected.length)return base;
 let authority:Awaited<ReturnType<typeof readOpenPaymentsAccountState>>;
 try{authority=await readOpenPaymentsAccountState(user.userId);}catch{
  return parseSnapshot({...base,actions:{...base.actions,sync:false},sync:{...base.sync,state:'blocked',errorCode:'consent_authority_unverified'},bankgiro:{state:'unknown',lastSuccessAt:null,nextAllowedAt:null,validUntil:null},payments:[],paymentsHasMore:false},companyId);
 }
 if(authority.snapshot.revision!==base.revision||selected.some(a=>!authority.selected.includes(a.id)))throw changed();
 const runtime=await sitesOpenPaymentsCompanySync(request,companyId),statuses=[];
 for(const account of selected)statuses.push({...await runtime.status(account.id),automaticEnabled:authority.automaticEnabled});
 const registration=authority.bankgiroRegistration,bankgiroRegistered=registration?.verified===true&&registration?.enabled===true&&registration.companyId===companyId&&registration.owner===user.userId&&Date.parse(registration.validUntil)>Date.now();
 let snapshot=projectSync(base,statuses,configuration.syncEnabled&&['owner','admin'].includes(context.role),bankgiroRegistered);
 if(snapshot.bankgiro.state==='available')snapshot.bankgiro.validUntil=new Date(Math.min(Date.parse(authority.snapshot.validUntil),Date.parse(registration.validUntil),Date.parse(snapshot.connection!.validUntil!))).toISOString();
 const workspace=await readWorkspace(user.userId),accounts=authority.available.filter(a=>authority.selected.includes(a.id)).map(a=>a.key);
 const payments=await projectPayments({snapshot,state:workspace.state,accounts,checkOriginal:async transaction=>{try{await assertPaymentOriginal(user.userId,workspace.state,transaction.id);return true;}catch{return false;}}});
 const final=parseSnapshot(await saasBankSnapshot(request,companyId),companyId),latest=await saasBankSyncConfiguration(request,companyId);
 if(final.revision!==base.revision||final.connection?.id!==base.connection?.id||latest.configurationHash!==configuration.configurationHash||(await readWorkspace(user.userId)).revision!==workspace.revision)throw changed();
 await identity();snapshot={...snapshot,...payments,checkedAt:final.checkedAt};return parseSnapshot(snapshot,companyId);
}
export async function runOnboardingBankSync(request:Request,companyId:string,body:Record<string,unknown>){
 if(Object.keys(body).some(key=>!['connectionId','expectedRevision'].includes(key)))throw Object.assign(Error('ONBOARDING_REQUEST_INVALID'),{status:400});
 const snapshot=parseSnapshot(await saasBankSnapshot(request,companyId),companyId),configuration=await saasBankSyncConfiguration(request,companyId);
 if(body.expectedRevision!==snapshot.revision||body.connectionId!==snapshot.connection?.id)throw changed();
 if(!configuration.syncEnabled)throw Object.assign(Error('SYNC_CONFIGURATION_REQUIRED'),{status:503});
 if(!activeConsent(snapshot))throw changed();
 const selected=snapshot.accounts.filter(a=>a.selected&&a.importable);if(!selected.length)throw changed();
 const runtime=await sitesOpenPaymentsCompanySync(request,companyId);
 // The UI's explicit first-fetch action starts real bounded work. Durable
 // admission/lease controls decide every account; no fake queued receipt.
 for(const account of selected)await runtime.run(account.id,{connectionId:snapshot.connection!.id,expectedRevision:snapshot.revision});
 return{version:1,companyId,accepted:true};
}
