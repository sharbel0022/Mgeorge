import {env} from 'cloudflare:workers';
import {db,companyBoundaryForOwner} from '../server';
import {seal,unseal} from './security';
import {scopedResourceCodec} from './bank-data-provider.js';
import {validateOpenPaymentsConfig} from './openpayments/config.js';
import {openPaymentsAccountIdentity} from './openpayments-normalization.js';
export type OpenPaymentsConsentSnapshot={provider:'open_payments';owner:string;revision:number;payload:string;validUntil:string};
const denied=()=>Object.assign(Error('Open Payments-kontot saknar ett aktuellt företagsbundet medgivande.'),{code:'BANK_CONSENT_CHANGED',status:409,safe:true});
const alias=(v:unknown)=>typeof v==='string'?v.replace(/^(iban|bban):/i,'').replace(/[\s-]/g,'').toUpperCase():'';
const fields=['currency','iban','bban','clearingNumber','accountNumber','bankgiroNumber','plusgiroNumber'];
/** Read stored provider resources only. No provider transport, renewal or writes.
 * The foundation scope (including worker grant) is rechecked after every await. */
export async function readOpenPaymentsAccountState(owner:string){
 const boundary=await companyBoundaryForOwner(owner);if(!boundary)throw denied();
 const values=env as unknown as Record<string,string>,keys=['SAAS_BANK_ENABLED','SAAS_OPENPAYMENTS_CONFIG','SAAS_OPENPAYMENTS_REGISTRATIONS','BANK_DATA_ENCRYPTION_KEY'],pin=keys.map(k=>values[k]);
 const guard=async()=>{const live=await companyBoundaryForOwner(owner);if(!live||live.companyId!==boundary.companyId||keys.some((k,i)=>(env as unknown as Record<string,string>)[k]!==pin[i]))throw denied();};
 if(values.SAAS_BANK_ENABLED!=='true')throw denied();
 const config=validateOpenPaymentsConfig(JSON.parse(values.SAAS_OPENPAYMENTS_CONFIG||'null'));
 // Sites currently has no configured production mTLS transport.
 if(config.environment!=='SANDBOX'||!config.features.includes('accounts')||!config.features.includes('transactions'))throw denied();
 const registrations=JSON.parse(values.SAAS_OPENPAYMENTS_REGISTRATIONS||'null');if(!Array.isArray(registrations))throw denied();
 const row=await db().prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(owner).first<{revision:number;payload:string}>();await guard();if(!row)throw denied();
 const value=await unseal<Record<string,any>>(values.BANK_DATA_ENCRYPTION_KEY,owner,'saas-bank-state',row.payload);await guard();
 if(!value||!Array.isArray(value.permissions)||!['accounts:read','transactions:read'].every(p=>value.permissions.includes(p))||value.status!=='active'||value.generation!==config.credentialGeneration||!Number.isFinite(Date.parse(value.validUntil))||Date.parse(value.validUntil)<=Date.now()||!Array.isArray(value.accounts)||!value.accounts.length||value.accounts.length>1000||!Array.isArray(value.selected)||!value.selected.length||value.selected.length>100||new Set(value.selected).size!==value.selected.length||new Set(value.accounts.map((a:any)=>a.id)).size!==value.accounts.length)throw denied();
 const codec={seal:(o:string,p:string,v:unknown)=>seal(values.BANK_DATA_ENCRYPTION_KEY,o,p,v),unseal:(o:string,p:string,v:string)=>unseal(values.BANK_DATA_ENCRYPTION_KEY,o,p,v)};
 const resources=scopedResourceCodec({owner,companyId:boundary.companyId,connectionId:value.id,provider:'open_payments',environment:config.environment,generation:config.credentialGeneration},codec);
 const consent=await resources.open('consent',value.consentHandle);await guard();
 const matches=registrations.filter(r=>r.companyId===boundary.companyId&&r.verified===true&&r.corporateAccessVerified===true&&r.redirectVerified===true&&r.bankId===value.bankId&&['corporateId','psuId','bicFi','corporateIdType','affiliatedAspspId'].every(k=>r[k]===consent[k]));
 if(matches.length!==1||typeof consent.id!=='string'||!consent.id||!/^\d{4}-\d{2}-\d{2}$/.test(String(consent.validUntil))||Date.parse(consent.validUntil+'T23:59:59.999Z')<=Date.now())throw denied();
 const available:{id:string;identity:Record<string,string>;key:string;aliases:string[]}[]=[],resourceIds=new Set<string>();
 let accountExpiry=Infinity;
 for(const account of value.accounts){
  const resource=await resources.open('account',account.handle);await guard();
  const identity=resource.identity as Record<string,string>,bound=resource.consent as Record<string,unknown>;
  if(!identity||!bound||typeof resource.id!=='string'||!resource.id||['id','corporateId','psuId','bicFi','corporateIdType','affiliatedAspspId'].some(k=>bound[k]!==consent[k])||fields.some(k=>identity[k]!==account.identity?.[k]))throw denied();
  const expires=Date.parse(String(bound.validUntil)+'T23:59:59.999Z');if(resourceIds.has(resource.id)||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.parse(consent.validUntil+'T23:59:59.999Z'))throw denied();resourceIds.add(resource.id);accountExpiry=Math.min(accountExpiry,expires);
  const aliases=[identity.iban,identity.bban,identity.accountNumber].map(alias).filter(v=>/^[A-Z0-9]{1,100}$/.test(v));
  available.push({id:account.id,identity,key:identity.currency==='SEK'?openPaymentsAccountIdentity(identity):'',aliases});
 }
 if(value.selected.some((id:string)=>!available.some(a=>a.id===id&&a.identity.currency==='SEK')))throw denied();
 const current=await db().prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').bind(owner).first<{revision:number;payload:string}>();await guard();
 const validUntil=new Date(Math.min(Date.parse(value.validUntil),accountExpiry,Date.parse(consent.validUntil+'T23:59:59.999Z'),config.credentialsValidUntil?Date.parse(config.credentialsValidUntil):Infinity)).toISOString();
 if(!current||current.revision!==row.revision||current.payload!==row.payload||Date.parse(validUntil)<=Date.now())throw denied();
 return {snapshot:{provider:'open_payments',owner,revision:row.revision,payload:row.payload,validUntil} as OpenPaymentsConsentSnapshot,available,selected:value.selected as string[]};
}
export async function resolveOpenPaymentsAccount(owner:string,account:string,reportedAccount?:string){
 const context=await readOpenPaymentsAccountState(owner),matches=context.available.filter(a=>a.identity.currency==='SEK'&&a.key===account);
 if(matches.length!==1||!context.selected.includes(matches[0].id))throw denied();
 if(reportedAccount!==undefined){const raw=alias(reportedAccount),holders=context.available.filter(a=>a.aliases.includes(raw));if(!raw||holders.length!==1||holders[0]!==matches[0])throw denied();}
 return context.snapshot;
}
