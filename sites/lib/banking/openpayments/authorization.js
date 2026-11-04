import { BankProviderError, isRecord } from '../bank-data-provider.js';
import { OPENPAYMENTS_ORIGINS, validateScopes } from './config.js';

const fail = () => { throw new BankProviderError('AUTHORIZATION_INVALID', 403); };
export const SCA_STATUSES = ['received', 'psuIdentified', 'psuAuthenticated', 'scaMethodSelected', 'started', 'unconfirmed', 'finalised', 'failed', 'exempted'];
export const CONSENT_STATUSES = ['received', 'rejected', 'valid', 'revokedByPsu', 'expired', 'terminatedByTpp', 'partiallyAuthorised'];
export function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function scaStatus(value) { if (!SCA_STATUSES.includes(value)) fail(); return value; }
export function consentStatus(value) { if (!CONSENT_STATUSES.includes(value)) throw new BankProviderError('PROVIDER_RESPONSE_INVALID'); return value; }

/** Do not fetch discovery URLs or follow arbitrary returned URLs. The guide's
 * redirect template must name this exact consent/authorisation and read scope. */
export function authorizationRedirect(template, { config, consent, authorisationId, redirectUri, state }) {
  try {
    if (typeof template !== 'string' || template.length > 8192 || !config.redirectUris.includes(redirectUri)) fail();
    const uri = new URL(template), origin = OPENPAYMENTS_ORIGINS[config.environment].auth;
    if (uri.origin !== origin || uri.pathname !== '/connect/authorize' || uri.username || uri.password || uri.hash) fail();
    const params = uri.searchParams, names = [...params.keys()];
    if (new Set(names).size !== names.length || names.length !== 6 || names.some(name => !['client_id', 'scope', 'response_type', 'redirect_uri', 'state', 'acr_values'].includes(name))) fail();
    validateScopes((params.get('scope') ?? '').split(' '), ['accountinformation', 'corporate']);
    if (params.get('response_type') !== 'code' || !['[CLIENT_ID]', config.clientId].includes(params.get('client_id')) ||
        !['[TPP_REDIRECT_URI]', redirectUri].includes(params.get('redirect_uri')) || params.get('state') !== '[TPP_STATE]') fail();
    const expected = [`idp:${consent.bicFi}`, `consentId:${consent.id}`, `ConsentAuthorisationId:${authorisationId}`];
    const acr = (params.get('acr_values') ?? '').split(' ');
    if (acr.length !== expected.length || expected.some(value => !acr.includes(value))) fail();
    params.set('client_id', config.clientId); params.set('redirect_uri', redirectUri); params.set('state', state);
    return uri.href;
  } catch { fail(); }
}

export function methodsFromResponse(data) {
  if (!Array.isArray(data.scaMethods) || data.scaMethods.length > 30) fail();
  const methods = data.scaMethods.map(item => {
    if (!isRecord(item) || typeof item.authenticationMethodId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.authenticationMethodId) ||
        typeof item.authenticationType !== 'string' || typeof item.name !== 'string' || item.name.length > 200) fail();
    return { authenticationMethodId: item.authenticationMethodId, authenticationType: item.authenticationType, name: item.name };
  });
  if (new Set(methods.map(item => item.authenticationMethodId)).size !== methods.length) fail();
  return methods;
}
