/** Node consent adapter. Runtime membership and retained consent provenance are
 * distinct from the bank-evidenced corporate/account mapping. */
import {createHash} from 'node:crypto';
import {decryptObject} from './security.js';
import {consentApplicationFingerprint} from './bank.js';
import {currentCompanyContext} from './company-runtime.js';
import {ConsentError,companyBankContext,validateReadScopes,corporateAuthorization} from '../sites/lib/bank-consent-policy.js';
import {resolveCorporateAccountEvidence} from '../sites/lib/bank-company-authority.js';
export {ConsentError,validateCallbackParameters,validateEnableConsent} from '../sites/lib/bank-consent-policy.js';

export function bankCompanyContext(actorId,companyId,action='manage'){
  return companyBankContext(currentCompanyContext(),actorId,companyId,action);
}
export function requestedBankConsent(actorId,body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['companyId','bankName','country','requiredScopes','renew_connection_id'].includes(key)))throw new ConsentError('INVALID_CONSENT_SCOPES',400);
  const context=bankCompanyContext(actorId,body.companyId),requiredScopes=validateReadScopes(body.requiredScopes);
  if(requiredScopes.includes('bankgiro:read'))throw new ConsentError('BANKGIRO_SCOPE_UNAVAILABLE',409);
  if(body.country!==undefined&&body.country!=='SE'||body.bankName!==undefined&&(typeof body.bankName!=='string'||!/^Swedbank(?:\b|\s)/i.test(body.bankName)))throw new ConsentError('BUSINESS_BANK_UNAVAILABLE',409);
  if(body.renew_connection_id!==undefined&&(typeof body.renew_connection_id!=='string'||!body.renew_connection_id||body.renew_connection_id.length>240||body.renew_connection_id!==body.renew_connection_id.trim()||/[\u0000-\u001f\u007f]/.test(body.renew_connection_id)))throw new ConsentError('INVALID_CALLBACK',400);
  return {context,requiredScopes};
}
export function consentMetadata(connection){
  if(!connection.consent_json)return null; // Pre-migration persisted connections.
  let value;try{value=JSON.parse(connection.consent_json);}catch{throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED',409);}
  if(value?.version!=='bank-consent-v1'||value.mode!=='company')throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED',409);
  return value;
}
export function assertConsentContext(metadata,actorId,companyId,action='manage'){
  const context=bankCompanyContext(actorId,companyId??metadata?.companyId,action);
  // A connection belongs to the company, rather than to the member who started
  // its consent. Current callers authorize as themselves; the recorded actor
  // remains provenance for the independent bank/company/account evidence.
  if(metadata&&(metadata.companyId!==context.companyId||metadata.storageOwnerId!==undefined&&metadata.storageOwnerId!==context.storageOwnerId||!['enablebanking','enable_banking'].includes(metadata.provider)||typeof metadata.actorId!=='string'||!metadata.actorId||!(Number.isSafeInteger(metadata.membershipVersion)&&metadata.membershipVersion>0||metadata.membershipVersion==='legacy-owner-v1')))throw new ConsentError('COMPANY_ACCESS_DENIED',403);
  if(metadata?.applicationFingerprint!==undefined&&metadata.applicationFingerprint!==consentApplicationFingerprint())throw new ConsentError('CONSENT_APPLICATION_CHANGED',409);
  return context;
}
/** Same canonical registry key contract as Sites stableAccountKey. Never use a
 * transient session UID as evidence of account ownership. */
export function corporateAccountKey(account,bankName){
  const iban=typeof account?.account_id?.iban==='string'?account.account_id.iban.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().replace(/\s/g,'').toUpperCase():'';
  if(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban))return 'iban:'+iban;
  const ids=[account.account_id?.other,...(Array.isArray(account.all_account_ids)?account.all_account_ids:[])].filter(id=>id&&typeof id.identification==='string'&&typeof id.scheme_name==='string');
  for(const id of ids){const value=id.identification.replace(/\s/g,'').toUpperCase();if(id.scheme_name.toUpperCase()==='IBAN'&&/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value))return 'iban:'+value;}
  const name=bankName.normalize('NFKC').trim().toLowerCase();
  if(!name||name.length>60||/[:\u0000-\u001f]/.test(name))return '';
  for(const id of ids.filter(id=>['BBAN','CPAN'].includes(id.scheme_name.toUpperCase())).sort((a,b)=>a.scheme_name.toUpperCase().localeCompare(b.scheme_name.toUpperCase())||a.identification.localeCompare(b.identification))){
    const value=id.identification.replace(/[\s-]/g,'').toUpperCase(),key=`SE:${name}:${id.scheme_name.toUpperCase()}:${value}`;
    if(/^[A-Z0-9]{1,40}$/.test(value)&&!/^(NOTPROVIDED|NONREF|NONE|NULL|UNKNOWN)$/i.test(value)&&key.length<=100)return key;
  }
  const hash=account.identification_hash;
  if(typeof hash==='string'&&hash.length>0&&hash.length<=4096&&!/[\s\u0000-\u001f\u007f]/.test(hash)&&!/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(hash))return 'enable-account:'+createHash('sha256').update(JSON.stringify(['SE',name,hash]),'utf8').digest('hex');
  return '';
}
/** GET /sessions exposes SessionAccount (uid + hashes), not AccountResource.
 * Validate fresh identity fields when provided and retain the original POST
 * details. The shared validator has already required the exact three UID sets. */
export function validatedLiveAccountDetails(saved,checked,bankName){
  return checked.accounts_data.map(current=>{
    const original=saved.find(account=>account.uid===current.uid);
    if(!original||current.currency!==undefined&&current.currency!==original.currency||typeof current.identification_hash==='string'&&typeof original.identification_hash==='string'&&current.identification_hash!==original.identification_hash)throw new ConsentError('BANK_ACCOUNT_SCOPE_INVALID',409);
    if(current.account_id!==undefined||current.all_account_ids!==undefined){
      const fresh=corporateAccountKey({...current,identification_hash:undefined},bankName),previous=corporateAccountKey({...original,identification_hash:undefined},bankName);
      if(!fresh||fresh!==previous)throw new ConsentError('BANK_ACCOUNT_SCOPE_INVALID',409);
    }
    return original;
  });
}
export function companyAccountGrant(context,bankName,accounts,validUntil){
  const unverified={status:'unverified',reason:'CORPORATE_AUTHORIZATION_REQUIRED'};
  if(!Array.isArray(accounts)||!accounts.length||!Number.isFinite(Date.parse(validUntil))||Date.parse(validUntil)<=Date.now())return {authority:unverified,accounts:[]};
  const evidence=resolveCorporateAccountEvidence(process.env.BANK_COMPANY_AUTHORIZATIONS,{context,bankName,country:'SE',accounts:accounts.map(account=>({uid:account.uid,key:corporateAccountKey(account,bankName),usage:account.usage})),validUntil});
  if(!evidence)return {authority:unverified,accounts:[]};
  const scoped=accounts.filter(account=>evidence.accountUids.includes(account.uid));
  const authority=corporateAuthorization({companyId:context.companyId,actorId:context.actorId,bankName,country:'SE',accountUids:scoped.map(account=>account.uid),validUntil,evidence});
  return {authority,accounts:authority.status==='verified'?scoped:[]};
}
export function assertCorporateAccountAccess(connection,actorId=currentCompanyContext()?.actorId??connection.owner,accountUid=connection.selected_account_uid,companyId){
  const metadata=consentMetadata(connection),context=assertConsentContext(metadata,actorId,companyId);
  if(connection.owner!==context.storageOwnerId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
  if(connection.status==='revocation_pending')throw new ConsentError('BANK_DISCONNECT_PENDING',409,'Slutför frånkopplingen innan bankuppgifter kan importeras.');
  if(!metadata)return {context,validUntil:connection.valid_until};
  if(connection.status==='renewal_required')throw new ConsentError('BANK_CONSENT_EXPIRED',409);
  const scopes=validateReadScopes(metadata.requestedScopes);
  if(scopes.includes('bankgiro:read'))throw new ConsentError('BANKGIRO_SCOPE_UNAVAILABLE',409);
  const grant=companyAccountGrant({...context,actorId:metadata.actorId},connection.bank_name,decryptObject(connection.accounts_json),connection.valid_until);
  if(grant.authority.status!=='verified'||accountUid&&!grant.accounts.some(account=>account.uid===accountUid))throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED',409);
  return {...grant,context,validUntil:grant.authority.validUntil};
}
export function publicConsent(connection,actorId){
  const metadata=consentMetadata(connection),context=assertConsentContext(metadata,actorId,undefined,'read');
  if(connection.owner!==context.storageOwnerId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
  const corporate=metadata?companyAccountGrant({...context,actorId:metadata.actorId},connection.bank_name,decryptObject(connection.accounts_json),connection.valid_until).authority:{status:'unverified',reason:'LEGACY_COMPANY_AUTHORIZATION_UNVERIFIED'};
  return {version:'bank-consent-v1',mode:metadata?'company':'legacy',companyId:context.companyId,actorId:metadata?.actorId??context.actorId,membershipVersion:metadata?.membershipVersion??context.membershipVersion,provider:'enable_banking',intent:metadata?.intent??'legacy',requestedScopes:metadata?.requestedScopes??['accounts:read','transactions:read'],grantedScopes:metadata?.grantedScopes??['accounts:read','transactions:read'],missingScopes:metadata?.missingScopes??[],validUntil:connection.valid_until,corporateAuthorization:corporate};
}
