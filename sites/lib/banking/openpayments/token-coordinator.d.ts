import type {OpenPaymentsConfig} from '../openpayments-provider.js';
import type {OpenPaymentsTokenFence} from './token-coordinator-fence.js';
declare const issuedReceipt: unique symbol;
export interface OpenPaymentsIssuedReceipt {
 readonly [issuedReceipt]: true;
 readonly value: string;
 readonly expiresAt: number;
}
export type OpenPaymentsTokenBinding={familyKey:string;configHash:string;epoch:number;tokenVersion:string};
export interface OpenPaymentsTokenCoordinator {
 readonly binding:Readonly<{familyKey:string;configHash:string}>;
 /** Read-only readiness; no token request and no first-family insertion. */
 assertCurrent():Promise<void>;
 captureFence():Promise<OpenPaymentsTokenFence>;
 access(issue:(input:{startedAt:number;maxExpiresAt:number;assertBeforeSend():Promise<void>})=>Promise<{value:string;seconds:number}>):Promise<OpenPaymentsIssuedReceipt>;
 invalidate(receipt:OpenPaymentsIssuedReceipt):Promise<void>;
 assertIssuerAvailable():Promise<void>;
 recordIssuerFailure(error:unknown):Promise<void>;
 /** Trusted operator composition only; no HTTP/browser route is supplied. */
 rotate(input:{expectedConfigHash:string;expectedEpoch:number;evidenceId:string}):Promise<void>;
 releaseRecovery(input:{expectedRevision:number;expectedMarker:string;evidenceId:string}):Promise<void>;
}
export function createOpenPaymentsTokenCoordinator(options:{
 database:{prepare(sql:string):{bind(...values:any[]):any;first():Promise<any>;run():Promise<any>};batch?(statements:any[]):Promise<any[]>};
 codec:{seal(binding:OpenPaymentsTokenBinding,value:unknown):Promise<string>;unseal(binding:OpenPaymentsTokenBinding,ciphertext:string):Promise<unknown>};
 configuration:OpenPaymentsConfig;
 transportIdentity:string;
 now?:()=>number;
 assertCurrent:()=>void|Promise<void>;
}):OpenPaymentsTokenCoordinator;
export function assertOpenPaymentsTokenCoordinator(value:unknown,configuration?:OpenPaymentsConfig):OpenPaymentsTokenCoordinator;
