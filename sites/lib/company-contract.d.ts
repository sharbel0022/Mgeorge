export type CompanyRole='owner'|'admin'|'accountant'|'viewer';
export type CompanyAction='read'|'write'|'manage_integrations'|'manage_members'|'manage_company'|'manage_reference_policy'|'restore';
export declare const COMPANY_CONTEXT_VERSION:'company-context-v1';
export declare const COMPANY_BOUNDARY_VERSION:'company-data-boundary-v1';
export declare const COMPANY_REFERENCE_POLICY_VERSION:'company-reference-policy-v1';
export declare const COMPANY_ROLES:readonly CompanyRole[];
export declare const COMPANY_ACTIONS:readonly CompanyAction[];

/** Server-resolved snapshot; validation alone never authorizes a request. */
export interface CompanyContext {
  version:typeof COMPANY_CONTEXT_VERSION;
  companyId:string;
  storageOwner:string;
  actorId:string;
  role:CompanyRole;
  membershipVersion:number;
  companyVersion:number;
  contextVersion:number;
}
export interface CompanyMembership {
  companyId:string;
  actorId:string;
  role:CompanyRole;
  status:'active'|'revoked';
  membershipVersion:number;
}
export interface CompanyAuthorization {
  context:CompanyContext;
  action:CompanyAction;
  /** A database-backed assertion run again at the effect boundary. */
  assertCurrent:()=>void|Promise<void>;
}
export interface CompanyDataBoundary {
  version:typeof COMPANY_BOUNDARY_VERSION;
  companyId:string;
  storageOwner:string;
  boundaryVersion:1;
}
export interface CompanyJob {
  version:'company-job-v1';
  jobId:string;
  companyId:string;
  storageOwner:string;
  boundaryVersion:1;
  actorId:string;
  role:CompanyRole;
  membershipVersion:number;
  companyVersion:number;
}
export interface CompanyReferencePolicy {
  version:typeof COMPANY_REFERENCE_POLICY_VERSION;
  companyId:string;
  policyVersion:number;
  mode:'explicit_only'|'invoice_number';
  updatedBy:string;
  provenance:string;
}
export declare function hasCompanyPermission(role:unknown,action:unknown):boolean;
export declare function assertCompanyPermission(role:unknown,action:unknown):void;
export declare function assertCompanyContext(value:unknown):Readonly<CompanyContext>;
export declare function companyCacheKey(value:unknown):string;
export declare function companyDataBoundary(value:unknown):Readonly<CompanyDataBoundary>;
export declare function assertCompanyBoundary(value:unknown,expected?:CompanyContext|CompanyDataBoundary):Readonly<CompanyDataBoundary>;
export declare function pinCompanyJob(value:unknown,jobId:string):Readonly<CompanyJob>;
export declare function assertCompanyJob(value:unknown,job:unknown):Readonly<CompanyJob>;
export declare function validateCompanyReferencePolicy(value:unknown,expected?:CompanyContext):Readonly<CompanyReferencePolicy>;
export declare function resolveCompanyReference(invoice:unknown,options:{context:CompanyContext;companyName:string;policy?:CompanyReferencePolicy|null}):import('./invoice-reference-policy').InvoiceReferenceDecision & {companyId:string;policyVersion:number|null};
