import type {CompanyAction,CompanyContext,CompanyDataBoundary,CompanyRole} from './company-contract.js';
export {saasOnboardingEnabled} from './company-contract.js';
export interface CompanyScope {readonly kind:'legacy'|'legacy-worker'|'company'|'worker';readonly owner:string;readonly actorId:string;readonly action:CompanyAction;readonly context:Readonly<CompanyContext>|null;readonly grant?:{id:string;version:number;runner:string;credentialHash:string};readonly legacyCredential?:{runner:string;credentialHash:string};}
export interface CompanyDirectory {version:'company-context-v1';companies:Array<{id:string;name:string;role:CompanyRole;membershipVersion:number;companyVersion:number}>;activeCompanyId:string|null;contextVersion:number;context?:Readonly<CompanyContext>;legacy?:true;selectionRequired?:true;actorId?:string;}
export const ownerTables:readonly string[];
export function resolveCompanyScope(database:D1Database,actorId:string,options?:{companyId?:string;contextVersion?:number;action?:CompanyAction}):Promise<CompanyScope>;
export function companyDirectory(database:D1Database,actorId:string):Promise<CompanyDirectory>;
export function selectCompany(database:D1Database,actorId:string,companyId:string,expectedVersion:number):Promise<Readonly<CompanyContext>>;
export function provisionCompany(database:D1Database,input:{id:string;name:string;actorId:string;legacyOwner?:string;verifiedBy:string;verificationEvidence:string;verifiedLegacyOwner?:string}):Promise<{companyId:string;storageOwner:string}>;
export function assertScopeCurrent(database:D1Database,scope:CompanyScope,action?:CompanyAction):Promise<void>;
export function changeCompanyMembership(database:D1Database,scope:CompanyScope,input:{actorId:string;role:CompanyRole;status:'active'|'revoked'}):Promise<unknown>;
export function createWorkerGrant(database:D1Database,scope:CompanyScope,input:{runner:'cloud'|'local';credentialHash:string}):Promise<void>;
export function resolveWorkerScope(database:D1Database,owner:string,runner:string,credentialHash:string):Promise<CompanyScope>;
export function resolveWorkerCredential(database:D1Database,runner:string,credentialHash:string):Promise<CompanyScope|null>;
export function boundaryForScope(database:D1Database,scope:CompanyScope,owner:string):Promise<Readonly<CompanyDataBoundary>|null>;
export function resolveCompanyMailbox(configuration:unknown,options:{context:CompanyContext|null;legacyOwner?:string|null;legacyAccount:string;required?:boolean}):string|null;
export function createCompanyDatabase(database:D1Database,getScope:()=>Promise<CompanyScope>|CompanyScope):D1Database;
