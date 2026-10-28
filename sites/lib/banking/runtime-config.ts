import type { ProviderConfig } from './enable-banking';

export type BankEnvironment = 'SANDBOX' | 'PRODUCTION';
export type RuntimeBankStatus = { configured: boolean; environment: BankEnvironment | null; code: string; message: string };
export type RuntimeBankConfig = ProviderConfig & { environment: BankEnvironment };
export class RuntimeBankError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RuntimeBankError'; this.code = code; }
}
const activation = 'Banktjänsten behöver aktiveras av systemadministratören.';
const value = (env: Record<string, unknown>, key: string) => typeof env[key] === 'string' ? env[key].trim() : '';

// Credentials come exclusively from protected Worker runtime secrets. A legacy
// encrypted_key in D1, a request body or browser storage is never a source.
export function runtimeBankConfig(env: Record<string, unknown>): RuntimeBankConfig {
  const environment = value(env, 'ENABLE_BANKING_ENVIRONMENT').toUpperCase();
  if (environment !== 'SANDBOX' && environment !== 'PRODUCTION') throw new RuntimeBankError('BANK_ENVIRONMENT_REQUIRED', activation);
  // Check the rotation attestation before accessing private key material.
  if (environment === 'PRODUCTION' && value(env, 'ENABLE_BANKING_KEY_ROTATED') !== 'true') throw new RuntimeBankError('BANK_KEY_ROTATION_REQUIRED', activation);
  const applicationId = value(env, 'ENABLE_BANKING_APPLICATION_ID');
  const privateKeyPem = value(env, 'ENABLE_BANKING_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!applicationId || !privateKeyPem) throw new RuntimeBankError('BANK_RUNTIME_NOT_CONFIGURED', activation);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId) || privateKeyPem.length > 16_384 || !/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PRIVATE KEY-----$/.test(privateKeyPem)) throw new RuntimeBankError('BANK_RUNTIME_CONFIGURATION_INVALID', activation);
  return { applicationId, privateKeyPem, environment };
}
export function runtimeBankStatus(env: Record<string, unknown>): RuntimeBankStatus {
  try { const config = runtimeBankConfig(env); return { configured: true, environment: config.environment, code: 'configured', message: '' }; }
  catch (error) { return { configured: false, environment: null, code: error instanceof RuntimeBankError ? error.code : 'BANK_RUNTIME_NOT_CONFIGURED', message: activation }; }
}
