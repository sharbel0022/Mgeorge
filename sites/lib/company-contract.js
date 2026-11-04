import {resolveInvoiceReference} from './invoice-reference-policy.js';

/** Shared wire shapes. A valid shape is NEVER proof of a live membership. */
export const COMPANY_CONTEXT_VERSION='company-context-v1';
export const COMPANY_BOUNDARY_VERSION='company-data-boundary-v1';
export const COMPANY_REFERENCE_POLICY_VERSION='company-reference-policy-v1';
export const COMPANY_ROLES=Object.freeze(['owner','admin','accountant','viewer']);
export const COMPANY_ACTIONS=Object.freeze(['read','write','manage_integrations','manage_members','manage_company','manage_reference_policy','restore']);

const grants=Object.freeze({
  owner:COMPANY_ACTIONS,
  admin:Object.freeze(['read','write','manage_integrations','manage_company','manage_reference_policy']),
  accountant:Object.freeze(['read','write']),
  viewer:Object.freeze(['read']),
});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:@._-]{0,199}$/.test(value)&&value!=='.'&&value!=='..';
const version=value=>Number.isSafeInteger(value)&&value>0;
const fail=(code,status=403)=>{throw Object.assign(new Error(code),{code,status});};

export function hasCompanyPermission(role,action){
  return COMPANY_ROLES.includes(role)&&COMPANY_ACTIONS.includes(action)&&grants[role].includes(action);
}
export function assertCompanyPermission(role,action){
  if(!hasCompanyPermission(role,action))fail('COMPANY_FORBIDDEN');
}

export function assertCompanyContext(value){
  if(!record(value)||value.version!==COMPANY_CONTEXT_VERSION||!identity(value.companyId)||!identity(value.storageOwner)
    ||!identity(value.actorId)||!COMPANY_ROLES.includes(value.role)||!version(value.membershipVersion)
    ||!version(value.companyVersion)||!version(value.contextVersion))fail('COMPANY_CONTEXT_INVALID');
  return Object.freeze({version:COMPANY_CONTEXT_VERSION,companyId:value.companyId,storageOwner:value.storageOwner,
    actorId:value.actorId,role:value.role,membershipVersion:value.membershipVersion,
    companyVersion:value.companyVersion,contextVersion:value.contextVersion});
}

/** Include the actor and authorization versions, even for the same company ID. */
export function companyCacheKey(value){
  const c=assertCompanyContext(value);
  return JSON.stringify([c.version,c.companyId,c.storageOwner,c.actorId,c.role,c.membershipVersion,c.companyVersion,c.contextVersion]);
}

export function companyDataBoundary(value){
  const c=assertCompanyContext(value);
  return Object.freeze({version:COMPANY_BOUNDARY_VERSION,companyId:c.companyId,storageOwner:c.storageOwner,boundaryVersion:1});
}
export function assertCompanyBoundary(value,expected){
  if(!record(value)||value.version!==COMPANY_BOUNDARY_VERSION||value.boundaryVersion!==1
    ||!identity(value.companyId)||!identity(value.storageOwner))fail('COMPANY_BOUNDARY_INVALID');
  if(expected){
    const c=expected.version===COMPANY_CONTEXT_VERSION?assertCompanyContext(expected):assertCompanyBoundary(expected);
    if(c.companyId!==value.companyId||c.storageOwner!==value.storageOwner)fail('COMPANY_BOUNDARY_MISMATCH');
  }
  return Object.freeze({version:COMPANY_BOUNDARY_VERSION,companyId:value.companyId,storageOwner:value.storageOwner,boundaryVersion:1});
}

/** Jobs retain their initiation authorization; switching the UI is irrelevant. */
export function pinCompanyJob(value,jobId){
  const c=assertCompanyContext(value);
  if(!identity(jobId))fail('COMPANY_JOB_INVALID');
  return Object.freeze({jobId,...companyDataBoundary(c),
    // Job and original boundaries share the stable storage identity, but have
    // distinct wire versions so neither can accidentally stand for the other.
    version:'company-job-v1',actorId:c.actorId,role:c.role,membershipVersion:c.membershipVersion,companyVersion:c.companyVersion});
}
export function assertCompanyJob(value,job){
  const c=assertCompanyContext(value);
  if(!record(job)||job.version!=='company-job-v1'||!identity(job.jobId)||job.boundaryVersion!==1
    ||job.companyId!==c.companyId||job.storageOwner!==c.storageOwner||job.actorId!==c.actorId||job.role!==c.role
    ||job.membershipVersion!==c.membershipVersion||job.companyVersion!==c.companyVersion)fail('COMPANY_JOB_MISMATCH');
  return Object.freeze({...job});
}

export function validateCompanyReferencePolicy(value,expected){
  if(!record(value)||value.version!==COMPANY_REFERENCE_POLICY_VERSION||!identity(value.companyId)
    ||!version(value.policyVersion)||!['explicit_only','invoice_number'].includes(value.mode)||!identity(value.updatedBy)
    ||typeof value.provenance!=='string'||!value.provenance.trim()||value.provenance.length>1000
    ||/[\u0000-\u001f\u007f]/.test(value.provenance))fail('COMPANY_REFERENCE_POLICY_INVALID',400);
  if(expected&&value.companyId!==assertCompanyContext(expected).companyId)fail('COMPANY_BOUNDARY_MISMATCH');
  return Object.freeze({version:COMPANY_REFERENCE_POLICY_VERSION,companyId:value.companyId,policyVersion:value.policyVersion,
    mode:value.mode,updatedBy:value.updatedBy,provenance:value.provenance});
}

/** Adapts tenant-scoped intent to the existing financial rules, never bank data. */
export function resolveCompanyReference(invoice,{context,companyName,policy}={}){
  const c=assertCompanyContext(context),p=policy==null?null:validateCompanyReferencePolicy(policy,c);
  const policies=p?[{version:'invoice-reference-policy-v1',id:'company-reference-v1',companyName,
    referenceSource:p.mode==='invoice_number'?'invoice_number':'explicit_reference',direction:'customer',matchMode:'exact'}]:[];
  return {...resolveInvoiceReference(invoice,{company:{name:companyName},policies}),companyId:c.companyId,policyVersion:p?.policyVersion??null};
}
