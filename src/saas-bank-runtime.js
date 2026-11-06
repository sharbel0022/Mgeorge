import {createSaasBankRuntime} from '../sites/lib/banking/saas-bank-runtime.js';
import {encryptObject,decryptObject} from './security.js';
import {ConsentError} from '../sites/lib/bank-consent-policy.js';
import {configuredOpenPaymentsNodeTransport} from './banking/openpayments-runtime-transport.js';
const parse=value=>{try{return value?JSON.parse(value):null;}catch{throw new ConsentError('SAAS_BANK_CONFIGURATION_INVALID',503);}};
export function nodeSaasBankRuntime({db,context,assertCurrent,sessionHash,origin,environment=process.env,providerOptions,requestKey}){
 if(!context)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
 const owner=context.storageOwner;
 const keys=['SAAS_BANK_ENABLED','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_REGISTRATIONS','SAAS_OPENPAYMENTS_MTLS_CONFIG'],pin=keys.map(key=>environment[key]);
 const config=parse(environment.SAAS_OPENPAYMENTS_CONFIG);
 assertCurrent();
 const serverTransport=providerOptions?.transport?null:configuredOpenPaymentsNodeTransport({environment,configuration:config});
 const selectedOptions=serverTransport?{...providerOptions,transport:serverTransport,tokenCacheIdentity:serverTransport.cacheIdentity}:providerOptions;
 const guard=()=>{assertCurrent();if(keys.some((key,index)=>environment[key]!==pin[index])){serverTransport?.invalidateTokenCache();throw new ConsentError('CONSENT_APPLICATION_CHANGED',409);}serverTransport?.validateCertificate();};
 const codec={async seal(o,p,v){return encryptObject({owner:o,purpose:p,value:v});},async unseal(o,p,v){const data=decryptObject(v);if(data.owner!==o||data.purpose!==p)throw new ConsentError('COMPANY_ACCESS_DENIED',403);return data.value;}};
 const store={async read(){guard();const row=db.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(owner);return row?{revision:row.revision,value:await codec.unseal(owner,'saas-bank-state',row.payload)}:{revision:0,value:null};},async compareAndSet(expected,value){const payload=await codec.seal(owner,'saas-bank-state',value);guard();const result=expected===0?db.prepare('INSERT OR IGNORE INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').run(owner,payload):db.prepare('UPDATE saas_bank_state SET revision=revision+1,payload=? WHERE owner=? AND revision=?').run(payload,owner,expected);return result.changes===1;}};
 const registration=parse(environment.SAAS_OPENPAYMENTS_REGISTRATIONS)?.find(entry=>entry.companyId===context.companyId&&entry.actorId===context.actorId);
 return createSaasBankRuntime({context,config,registration,enabled:environment.SAAS_BANK_ENABLED==='true',requestKey,store,codec,assertCurrent:async()=>{guard();},sessionHash,redirectUri:new URL(`/api/companies/${context.companyId}/bank/callback`,origin).href,providerOptions:selectedOptions});
}
