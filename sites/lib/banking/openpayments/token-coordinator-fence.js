import {BankProviderError,assertServerRuntime} from '../bank-data-provider.js';

const capabilities=new WeakMap();
const denied=()=>new BankProviderError('AUTHORIZATION_INVALID',403);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0;

/** Trusted server composition. A capability has no SQL, setters or readable
 * metadata. It can prove only this exact application epoch in this raw DB. */
export function createOpenPaymentsTokenFence({database,familyKey,configHash,epoch,controlRevision}){
 assertServerRuntime();
 if(!database||typeof database.prepare!=='function'||!hash(familyKey)||!hash(configHash)||!version(epoch)||!version(controlRevision))throw denied();
 const capability=Object.freeze({});
 capabilities.set(capability,Object.freeze({database,familyKey,configHash,epoch,controlRevision}));
 return capability;
}

/** Resolve only inside a trusted database composer. No arbitrary query, table,
 * column, caller-provided SQL or returned credential data is supported. */
export function openPaymentsTokenFenceStatement(capability,database){
 assertServerRuntime();
 const value=capabilities.get(capability);
 if(!value||value.database!==database)throw denied();
 return database.prepare(`SELECT CASE WHEN
  EXISTS(SELECT 1 FROM company_application_token_control WHERE id=1 AND revision=? AND recovery_required=0)
  AND EXISTS(SELECT 1 FROM company_application_tokens WHERE family_key=? AND config_hash=? AND epoch=?)
  THEN 1 ELSE json('AUTHORIZATION_CHANGED') END`).bind(value.controlRevision,value.familyKey,value.configHash,value.epoch);
}
