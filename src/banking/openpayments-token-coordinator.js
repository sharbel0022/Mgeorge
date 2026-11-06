import {createCompanySyncDatabase} from '../company-sync-database.js';
import {encryptObject,decryptObject,cipherKey,digest} from '../security.js';
import {BankProviderError} from '../../sites/lib/banking/bank-data-provider.js';
import {createOpenPaymentsTokenCoordinator} from '../../sites/lib/banking/openpayments/token-coordinator.js';
import {openPaymentsTokenFenceStatement} from '../../sites/lib/banking/openpayments/token-coordinator-fence.js';

const unavailable=()=>new BankProviderError('APPLICATION_TOKEN_STORAGE_UNAVAILABLE',503);
const changed=()=>new BankProviderError('APPLICATION_TOKEN_CONFIGURATION_CHANGED',409);
/** Only raw server controlDb is accepted. Never substitute the company proxy.
 * Startup owns DDL; every request fails closed on missing/invalid schema. */
export function createNodeOpenPaymentsTokenCoordinator({controlDb,environment=process.env,configuration,transport}={}){
 if(typeof controlDb?.prepare!=='function'||typeof controlDb?.exec!=='function')throw unavailable();
 const keys=['SAAS_BANK_ENABLED','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_MTLS_CONFIG'],pin=keys.map(key=>environment[key]);
 let encryption;try{encryption=digest(cipherKey());}catch{throw unavailable();}
 const configGuard=()=>{
  if(keys.some((key,index)=>environment[key]!==pin[index]))throw changed();
  try{if(digest(cipherKey())!==encryption)throw unavailable();}catch{throw unavailable();}
  if(transport?.kind!=='mtls'||typeof transport.validateCertificate!=='function')throw new BankProviderError('INVALID_CLIENT_CERTIFICATE',409);
  const result=transport.validateCertificate();if(result?.then){Promise.resolve(result).catch(()=>{});throw new BankProviderError('INVALID_CLIENT_CERTIFICATE',409);}
 };
 configGuard();
 const database=createCompanySyncDatabase(controlDb);
 const codec={
  async seal(binding,value){configGuard();const result=encryptObject({binding,value});configGuard();return result;},
  async unseal(binding,ciphertext){configGuard();const decoded=decryptObject(ciphertext);configGuard();if(JSON.stringify(decoded?.binding)!==JSON.stringify(binding))throw unavailable();return decoded.value;},
 };
 const coordinator=createOpenPaymentsTokenCoordinator({database,codec,configuration,transportIdentity:transport.transportIdentity,certificateValidUntil:transport.certificateValidUntil,assertCurrent:configGuard});
 function assertCurrentSync(){
  configGuard();let gate,row;
  try{gate=controlDb.prepare('SELECT *, (SELECT count(*) FROM company_application_token_control) AS rows FROM company_application_token_control WHERE id=1').get();row=controlDb.prepare('SELECT config_hash,epoch FROM company_application_tokens WHERE family_key=?').get(coordinator.binding.familyKey);}catch{throw unavailable();}
  if(!gate||gate.rows!==1||!Number.isSafeInteger(gate.revision)||gate.revision<1||![0,1].includes(gate.recovery_required))throw unavailable();
  if(gate.recovery_required)throw new BankProviderError('APPLICATION_TOKEN_RECOVERY_REQUIRED',409);
  if(row&&(row.config_hash!==coordinator.binding.configHash||!Number.isSafeInteger(row.epoch)||row.epoch<1))throw changed();
 }
 return Object.freeze({coordinator,assertCurrentSync,async captureGuard(){
  const fence=await coordinator.captureFence(),statement=openPaymentsTokenFenceStatement(fence,database);
  return()=>{assertCurrentSync();try{database.assert(statement);}catch{throw changed();}};
 }});
}
