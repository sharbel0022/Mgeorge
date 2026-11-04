import type {CompanyAction,CompanyContext} from '../company-contract.js';
import type {ProviderResourceStorage} from './bank-data-provider.js';
import type {OpenPaymentsTransport} from './openpayments-provider.js';
import type {CompanyProviderManagerOptions} from './company-provider-manager.js';
import {createCompanyProviderManager} from './company-provider-manager.js';
export interface CompanyProviderRuntimeOptions {
 settings():Record<string,unknown>|Promise<Record<string,unknown>>;
 repository:CompanyProviderManagerOptions['repository'];codec:ProviderResourceStorage;
 currentContext():CompanyContext|Promise<CompanyContext>;
 assertCurrent(context:Readonly<CompanyContext>,action:CompanyAction):void|Promise<void>;
 withBankLock:CompanyProviderManagerOptions['withBankLock'];
 transport?:OpenPaymentsTransport;transportBinding?:string;callbackUri?:string;
 paths?:CompanyProviderManagerOptions['paths'];now?:()=>number;randomId?:()=>string;hash?:(value:string)=>string|Promise<string>;
}
/** available describes NEW onboarding; retained connection lifecycle availability
 * is projected separately by manager.status(), with live generation/authority. */
export interface CompanyProviderConfigStatus {provider:'open_payments';enabled:boolean;configured:boolean;registered:boolean;available:boolean;environment:'SANDBOX'|'PRODUCTION'|null;reason:'disabled'|'configuration_required'|'transport_required'|'company_registration_required'|'available';payments:'disabled';}
/** PEM settings, when provided by the runtime, are named
 * MG_OPENPAYMENTS_CLIENT_CERTIFICATE_PEM and MG_OPENPAYMENTS_CLIENT_PRIVATE_KEY_PEM.
 * Native Node uses its real mTLS transport. Workers must supply an independently
 * approved mTLS transport; a local certificate string never sets attestation. */
export function createCompanyProviderRuntime(options:CompanyProviderRuntimeOptions):Promise<{readonly manager:ReturnType<typeof createCompanyProviderManager>;configStatus():Promise<CompanyProviderConfigStatus>}>;
