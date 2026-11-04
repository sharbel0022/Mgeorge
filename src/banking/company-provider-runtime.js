import {currentCompanyContext} from '../company-runtime.js';
import {assertCompanyContext,companyCacheKey} from '../../sites/lib/company-contract.js';
import {createCompanyProviderRuntime} from '../../sites/lib/banking/company-provider-runtime.js';
import {createNodeCompanyProviderRepository} from './company-provider-repository.js';
import {createOpenPaymentsNodeTransport} from './openpayments-node-transport.js';
import {digest,encryptObject,decryptObject} from '../security.js';

const denied=()=>Object.assign(Error('RESOURCE_SCOPE_MISMATCH'),{code:'RESOURCE_SCOPE_MISMATCH',status:403});
// Activation is checked live by the shared manager. It is not a credential
// generation: disabling onboarding must still allow an owned grant to stop.
const fields=['MG_OPENPAYMENTS_CONFIG','MG_COMPANY_BANK_REGISTRATIONS','MG_OPENPAYMENTS_CLIENT_CERTIFICATE_PEM','MG_OPENPAYMENTS_CLIENT_PRIVATE_KEY_PEM'];
/** Real Node wiring: physical company DB, purpose/owner-bound codec and the
 * existing synchronous integration lease writer. Never accepts browser proof. */
export async function createNodeCompanyProviderRuntime({runtime,integrationJobs,sessionHash,callbackUri,settings=()=>process.env,transport,now=Date.now}={}){
 if(!runtime?.db||typeof integrationJobs?.claim!=='function'||typeof sessionHash!=='function'||typeof settings!=='function')throw TypeError('Trusted Node provider runtime adapters required');
 const read=()=>{const value=settings();if(value&&typeof value.then==='function')throw TypeError('Synchronous Node settings getter required');return value??{};};
 const fingerprint=()=>{const value=read();return digest(JSON.stringify(fields.map(key=>value[key]??null)));},initial=fingerprint();
 const currentContext=()=>assertCompanyContext(currentCompanyContext());
 if(!transport){
  const values=read();let production=false;try{production=JSON.parse(values.MG_OPENPAYMENTS_CONFIG||'null')?.environment==='PRODUCTION';}catch{}
  if(production)try{transport=createOpenPaymentsNodeTransport({certificatePem:values.MG_OPENPAYMENTS_CLIENT_CERTIFICATE_PEM,privateKeyPem:values.MG_OPENPAYMENTS_CLIENT_PRIVATE_KEY_PEM,now});}catch{/* Unavailable without a real valid native mTLS transport. */}
 }
 const assertCurrent=(context,action)=>{
  if(companyCacheKey(currentContext())!==companyCacheKey(context))throw denied();runtime.assert(action);
  // This synchronous fence also runs inside the repository's SQLite commit,
  // after any awaited encryption/provider work. No async hash inside a txn.
  if(action==='manage_integrations'&&fingerprint()!==initial)throw denied();
 };
 const owner=expected=>{const context=currentContext();runtime.assert('read');if(context.storageOwner!==expected)throw denied();};
 const codec={async seal(storageOwner,purpose,value){owner(storageOwner);return encryptObject({version:1,owner:storageOwner,purpose,value});},async unseal(storageOwner,purpose,sealed){owner(storageOwner);const value=decryptObject(sealed);if(value?.version!==1||value.owner!==storageOwner||value.purpose!==purpose)throw denied();owner(storageOwner);return value.value;}};
 const repository=createNodeCompanyProviderRepository({db:runtime.db,codec,currentContext,assertCurrent,sessionHash,retainedProviderGrantInUse:(fp,id)=>runtime.retainedProviderGrantInUse(fp,id),now});
 return createCompanyProviderRuntime({settings:read,repository,codec,currentContext,assertCurrent,callbackUri,transport,now,hash:digest,
  async withBankLock(storageOwner,run){
   const context=currentContext();assertCurrent(context,'manage_integrations');if(context.storageOwner!==storageOwner)throw denied();
   const lease=integrationJobs.claim('bank:open_payments',{recordAttempt:false});
   try{return await run(lease);}finally{lease.release();}
  },
 });
}
