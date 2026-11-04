import {createHttpsBankgiroSource} from './bankgiro-http-source.js';
/** Trusted server configuration only. Browser/request fields and AIS credentials
 * cannot register a report source. Synthetic sources are test-injected elsewhere. */
const text=value=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\u0000-\u001f\u007f]/.test(value);
const blocked=revocation=>{
 const fail=async()=>{throw Object.assign(new Error('AUTHORIZATION_BLOCKED'),{code:'AUTHORIZATION_BLOCKED'});};
 return Object.freeze({id:'bankgiro-configuration-blocked',mode:'production',configurationValid:false,registration:null,intervalMinutes:15,...(revocation?{revocation:Object.freeze({...revocation})}:{}),authorize:fail,listReports:fail,fetchReport:fail});
};
export function createBankgiroSourceRegistry({configuration,secrets={},fetchImpl,now=Date.now,runtime}={}){
 if(configuration===undefined||configuration===null||configuration==='')return Object.freeze({resolve:()=>null});
 let config,invalid=false;
 try{
  if(typeof configuration==='string'&&configuration.length>65536)throw new Error();
  config=typeof configuration==='string'?JSON.parse(configuration):structuredClone(configuration);
  if(!config||config.version!==1||!Number.isSafeInteger(config.revision)||config.revision<1||!Array.isArray(config.registrations)||config.registrations.length>100||config.registrations.some(r=>!r||!text(r.owner))||new Set(config.registrations.map(r=>r.owner)).size!==config.registrations.length)invalid=true;
 }catch{invalid=true;}
 const sources=new Map();
 if(!invalid){
  for(const registration of config.registrations){
   try{
    if(!Object.hasOwn(secrets,registration.tokenSecret))throw new Error();
    const source=createHttpsBankgiroSource({registration:{...registration,configurationRevision:config.revision},token:secrets[registration.tokenSecret],fetchImpl,now});sources.set(registration.owner,source);
   }catch{sources.set(registration.owner,blocked(registration.enabled===false?{owner:registration.owner,companyId:registration.companyId,configurationRevision:config.revision}:undefined));}
  }
 }
 return Object.freeze({resolve(owner){if(invalid||!text(owner))return blocked();return sources.get(owner)??blocked({owner,configurationRevision:config.revision});}});
}
/** Absent configuration deliberately stays disabled in every runtime. */
export async function resolveBankgiroSource(owner,options={}){return createBankgiroSourceRegistry(options).resolve(owner);}
