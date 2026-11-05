import {createHash} from 'node:crypto';

const valid=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

/** Opaque job identity derived from an authoritative, stable bank account.
 * Callers must supply the account's canonical, typed identity, never a session
 * UID, a consent ID, or an arbitrary selector. Bank/provider namespaces prevent
 * unrelated local account numbers from sharing a quota or import receipt.
 * An identity representation change requires an explicit reviewed migration.
 */
export function companyBankAccountKey({provider,bank,country,accountIdentity}={}){
 if(!valid(provider,100)||!valid(bank,300)||!valid(country,2)||!valid(accountIdentity,8192))throw TypeError('A verified stable bank account identity is required');
 const providerName=provider.trim().toLowerCase(),bankName=bank.normalize('NFKC').trim().toLowerCase(),countryCode=country.toUpperCase();
 if(!providerName||!bankName||!/^[A-Z]{2}$/.test(countryCode)||accountIdentity.trim()!==accountIdentity)throw TypeError('A verified stable bank account identity is required');
 const providerKey=['enablebanking','enable-banking'].includes(providerName)?'enablebanking':providerName;
 const iban=accountIdentity.replace(/^iban:/i,'').replace(/\s/g,'').toUpperCase();
 const validIban=/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban);
 if(/^iban:/i.test(accountIdentity)&&!validIban)throw TypeError('A verified stable bank account identity is required');
 const identity=validIban?'iban:'+iban:accountIdentity;
 return 'account:'+createHash('sha256').update(JSON.stringify(['company-bank-account-v1',providerKey,bankName,countryCode,identity]),'utf8').digest('hex');
}
