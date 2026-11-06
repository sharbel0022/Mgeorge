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
// Legacy exported reference only; it is never a runtime configuration fallback.
export const BANK_REDIRECT_URL = 'https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/bank/callback';

/** Only operator-controlled configuration may choose the bank callback host. */
export function runtimeBankRedirectUrl(settings: Record<string, unknown>): string {
  const invalid = () => new RuntimeBankError('BANK_CALLBACK_CONFIGURATION_INVALID', 'Banktjänstens returadress kunde inte verifieras.');
  try {
    const configured = settings.ENABLE_BANKING_REDIRECT_URL;
    const configuredOrigin = settings.APP_ORIGIN;
    if (configured !== undefined && typeof configured !== 'string' || configuredOrigin !== undefined && typeof configuredOrigin !== 'string') throw invalid();
    const explicit = typeof configured === 'string' ? configured.trim() : '';
    const originValue = typeof configuredOrigin === 'string' ? configuredOrigin.trim() : '';
    let origin = '';
    if (originValue) {
      const parsed = new URL(originValue);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        ![parsed.origin, parsed.origin + '/'].includes(originValue)) throw invalid();
      origin = parsed.origin;
    }
    const redirect = explicit || (origin ? origin + '/api/bank/callback' : '');
    const parsed = new URL(redirect);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== '/api/bank/callback' || parsed.href !== redirect || origin && parsed.origin !== origin) throw invalid();
    return redirect;
  } catch { throw invalid(); }
}

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
