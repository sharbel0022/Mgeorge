import type {CompanyContext,CompanyRole} from './company-contract.js';
export type CompanyClientStatus='pending'|'ready'|'legacy'|'signed_out'|'switching'|'blocked'|'selection_required';
export interface CompanyClientSnapshot {
  readonly status:CompanyClientStatus;
  readonly companies:ReadonlyArray<{readonly id:string;readonly name:string;readonly role:CompanyRole;readonly membershipVersion:number}>;
  readonly context:Readonly<CompanyContext>|null;
  readonly activeCompanyId:string|null;
  readonly contextVersion:number|null;
  readonly actorId?:string;
  readonly error:string;
}
export interface CompanyClient {
  readonly snapshot:CompanyClientSnapshot;
  initialize():Promise<CompanyClientSnapshot>;
  revalidate():Promise<boolean>;
  switchCompany(companyId:string):Promise<Readonly<CompanyContext>>;
  fetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>;
  href(input:string|URL):string;
  invalidate(reason?:string):void;
  subscribe(listener:(snapshot:CompanyClientSnapshot)=>void):()=>void;
  dispose():void;
}
export declare function createCompanyClient(options:{fetch:typeof fetch;baseUrl:string;onInvalidate?:(reason:string)=>void}):CompanyClient;
export declare function installCompanyClientSurface(client:CompanyClient,surface?:Window & typeof globalThis):()=>void;
