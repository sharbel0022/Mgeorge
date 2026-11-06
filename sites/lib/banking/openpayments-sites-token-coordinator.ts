import {createHash} from 'node:crypto';
import {BankProviderError,assertServerRuntime} from './bank-data-provider.js';
import {createOpenPaymentsTokenCoordinator,type OpenPaymentsTokenBinding} from './openpayments/token-coordinator.js';
import {validateOpenPaymentsConfig} from './openpayments/config.js';
import type {OpenPaymentsConfig} from './openpayments-provider.js';
import type {OpenPaymentsWorkersRuntimeTransport} from './openpayments-workers-transport.js';
import {seal,unseal} from './security';

type Environment=Record<string,unknown>;
type Database=Parameters<typeof createOpenPaymentsTokenCoordinator>[0]['database'];
const invalid=()=>new BankProviderError('PROVIDER_CONFIGURATION_INVALID',409);

/** Server application state uses the raw primary D1 capability. It is never
 * reachable through a company SQL/backup API and never stores a company guard.
 * Each request retains its own provider/HTTP/consent/quota authorization. */
export function createSitesOpenPaymentsTokenCoordinator({configuration,mtls,environment,now=Date.now}:{
 configuration:OpenPaymentsConfig;
 mtls:OpenPaymentsWorkersRuntimeTransport;
 environment:()=>Environment;
 now?:()=>number;
}){
 assertServerRuntime();
 if(typeof environment!=='function'||configuration?.environment!=='PRODUCTION'||!mtls||typeof mtls.assertCurrent!=='function')throw invalid();
 const initial=environment(),database=initial.DB as Database,key=initial.BANK_DATA_ENCRYPTION_KEY;
 const provider=initial.SAAS_OPENPAYMENTS_CONFIG,transport=initial.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG;
 if(!database||typeof database.prepare!=='function'||typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key)||typeof provider!=='string'||typeof transport!=='string')throw invalid();
 const checked=validateOpenPaymentsConfig(configuration,now);
 try{
  const stored=validateOpenPaymentsConfig(JSON.parse(provider),now);
  // Validation deliberately makes clientSecret non-enumerable. Include that
  // private own descriptor when comparing the two validated configurations.
  const canonical=(value:typeof checked)=>JSON.stringify([value,Object.getOwnPropertyDescriptor(value,'clientSecret')?.value]);
  if(canonical(stored)!==canonical(checked))throw invalid();
 }catch{throw invalid();}
 const prepare=database.prepare,batch=database.batch;
 const assertCurrent=()=>{
  const current=environment();
  if(current.SAAS_BANK_ENABLED!=='true'||current.DB!==database||database.prepare!==prepare||database.batch!==batch||
   current.BANK_DATA_ENCRYPTION_KEY!==key||current.SAAS_OPENPAYMENTS_CONFIG!==provider||current.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG!==transport)throw invalid();
  mtls.assertCurrent();
 };
 assertCurrent();
 const purpose=(binding:OpenPaymentsTokenBinding)=>{
  if(!/^[a-f0-9]{64}$/.test(binding.familyKey)||!/^[a-f0-9]{64}$/.test(binding.configHash)||!Number.isSafeInteger(binding.epoch)||binding.epoch<1||
   !/^[A-Za-z0-9_-]{1,100}$/.test(binding.tokenVersion))throw invalid();
  return{owner:'openpayments-app:'+binding.familyKey,purpose:'app-token:'+binding.configHash+':'+binding.epoch+':'+binding.tokenVersion};
 };
 const codec={
  async seal(binding:OpenPaymentsTokenBinding,value:unknown){
   assertCurrent();const context=purpose(binding),ciphertext=await seal(key,context.owner,context.purpose,value);assertCurrent();return ciphertext;
  },
  async unseal(binding:OpenPaymentsTokenBinding,ciphertext:string){
   assertCurrent();const context=purpose(binding),value=await unseal(key,context.owner,context.purpose,ciphertext);assertCurrent();return value;
  },
 };
 // A public certificate/binding receipt is stable across isolates. The actual
 // opaque fetch binding is independently pinned by mtls.assertCurrent().
 // Operators still verify that uploaded binding and receipt describe the same
 // certificate; this hash cannot introspect Cloudflare's private binding key.
 const transportIdentity=createHash('sha256').update(JSON.stringify(['workers-mtls-v1',transport])).digest('hex');
 return createOpenPaymentsTokenCoordinator({database,codec,configuration,transportIdentity,certificateValidUntil:Date.parse(mtls.certificateValidUntil),now,assertCurrent});
}
