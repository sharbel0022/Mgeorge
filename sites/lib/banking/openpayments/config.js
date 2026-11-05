import { BankProviderError, assertServerRuntime, isRecord, safeText, validInstant } from '../bank-data-provider.js';

const FEATURES = ['bank_discovery', 'consents', 'accounts', 'transactions', 'bankgiro_enrichment'];
const CONFIG_KEYS = ['environment', 'clientId', 'clientSecret', 'credentialGeneration', 'credentialsValidUntil', 'apiVersion', 'scopes', 'features', 'redirectUris'];
export const OPENPAYMENTS_ORIGINS = Object.freeze({
  SANDBOX: Object.freeze({ auth: 'https://oauth.sandbox.openbankingplatform.com', api: 'https://api.sandbox.openbankingplatform.com' }),
  PRODUCTION: Object.freeze({ auth: 'https://auth.openbankingplatform.com', api: 'https://api.openbankingplatform.com' }),
});

export function validateScopes(scopes, expected) {
  const allowed = ['aspspinformation', 'accountinformation', 'bankgiroinformation', 'corporate'];
  if (!Array.isArray(scopes) || scopes.some(scope => !allowed.includes(scope)) || new Set(scopes).size !== scopes.length ||
      !scopes.includes('corporate') || !scopes.includes('accountinformation') ||
      expected && (scopes.length !== expected.length || expected.some(scope => !scopes.includes(scope)))) {
    throw new BankProviderError('SCOPE_NOT_ALLOWED', 403);
  }
  return scopes;
}

export function validateOpenPaymentsConfig(input, now = Date.now) {
  assertServerRuntime();
  const invalid = () => { throw new BankProviderError('PROVIDER_CONFIGURATION_INVALID', 409); };
  if (!isRecord(input) || Object.keys(input).some(key => !CONFIG_KEYS.includes(key)) ||
      !['SANDBOX', 'PRODUCTION'].includes(input.environment) || input.apiVersion !== undefined && input.apiVersion !== 'v1' ||
      !safeText(input.clientId) || !safeText(input.clientSecret, 4096) || !safeText(input.credentialGeneration)) invalid();
  if (input.credentialsValidUntil !== undefined) {
    if (!validInstant(input.credentialsValidUntil)) invalid();
    if (Date.parse(input.credentialsValidUntil) <= now()) throw new BankProviderError('CREDENTIALS_EXPIRED', 409);
  }
  const features = input.features ?? FEATURES.filter(feature => feature !== 'bankgiro_enrichment');
  if (!Array.isArray(features) || !features.length || features.some(feature => !FEATURES.includes(feature)) || new Set(features).size !== features.length) {
    throw new BankProviderError('FEATURE_NOT_ALLOWED', 403);
  }
  if (features.includes('bankgiro_enrichment') && !features.includes('transactions')) throw new BankProviderError('FEATURE_NOT_ALLOWED', 403);
  const expected = [
    ...(input.environment === 'PRODUCTION' && features.includes('bank_discovery') ? ['aspspinformation'] : []),
    'accountinformation', ...(features.includes('bankgiro_enrichment') ? ['bankgiroinformation'] : []), 'corporate',
  ];
  validateScopes(input.scopes ?? expected, expected);
  const redirectUris = input.redirectUris ?? [];
  if (!Array.isArray(redirectUris) || redirectUris.length > 20) invalid();
  for (const value of redirectUris) {
    try {
      const uri = new URL(value);
      if (typeof value !== 'string' || uri.href !== value || uri.protocol !== 'https:' || uri.username || uri.password || uri.hash || uri.search || value.length > 2048) invalid();
    } catch { invalid(); }
  }
  const result = { environment: input.environment, clientId: input.clientId, credentialGeneration: input.credentialGeneration,
    credentialsValidUntil: input.credentialsValidUntil, apiVersion: 'v1', features: Object.freeze([...features]),
    scopes: Object.freeze(expected), redirectUris: Object.freeze([...redirectUris]) };
  Object.defineProperty(result, 'clientSecret', { value: input.clientSecret, enumerable: false });
  return Object.freeze(result);
}
