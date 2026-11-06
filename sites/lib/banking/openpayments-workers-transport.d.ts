import type {OpenPaymentsConfig,OpenPaymentsTransport} from './openpayments-provider.js';
export interface OpenPaymentsWorkersRuntimeTransport {
 readonly transport:OpenPaymentsTransport;
 readonly certificateValidUntil:string;
 assertCurrent():void;
}
/** Trusted environment only. No private key is accepted by this interface. */
export function configuredOpenPaymentsWorkersTransport(options:{
 configuration:Pick<OpenPaymentsConfig,'environment'|'credentialGeneration'>|null|undefined;
 environment:()=>Record<string,unknown>;
 now?:()=>number;
}):OpenPaymentsWorkersRuntimeTransport|null;
