import { BankProviderError, safeText, isRecord } from '../bank-data-provider.js';
import { validateOpenPaymentsConfig, validateScopes } from './config.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {freshTokenState,invalidateTokenState,assertOpenPaymentsTokenCacheIdentity,sharedTokenState,invalidateSharedTokenState} from './token-cache.js';

function tokenResult(data, scopes) {
  try {
    if (!isRecord(data) || !safeText(data.access_token, 16_384) || data.token_type !== 'Bearer' ||
        !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 3600 || typeof data.scope !== 'string') throw Error();
    validateScopes(data.scope.split(' '), scopes);
  } catch { throw new BankProviderError('INVALID_OAUTH_RESULT', 502); }
  return { value: data.access_token, seconds: data.expires_in };
}

/** Server-only application token. No tenant data or per-consent activation token
 * is stored here. Keep one instance per app/environment/credential generation. */
export class OpenPaymentsTokenClient {
  #config; #http; #now; #local=freshTokenState(); #identity; #key;
  constructor(config, http, now = Date.now, cache) {
    this.#config = validateOpenPaymentsConfig(config, now); this.#http = http; this.#now = now;
    if(cache!==undefined){
      if(!isRecord(cache)||Object.keys(cache).some(key=>key!=='identity'))throw new BankProviderError('PROVIDER_CONFIGURATION_INVALID',409);
      assertOpenPaymentsTokenCacheIdentity(cache.identity);this.#identity=cache.identity;
      const c=this.#config;
      // clientSecret is deliberately non-enumerable on validated config. Hash
      // it explicitly so replacing a secret without renaming the app cannot
      // revive a token issued under the old credential. Never expose the key.
      // The documented token is app/PSU-context scoped, not company scoped.
      // Company membership, consent handles and request budgets remain in the
      // caller's provider and are checked again after every shared-token await.
      this.#key=bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([c.environment,c.clientId,c.clientSecret,c.credentialGeneration,c.credentialsValidUntil,c.apiVersion,c.scopes,c.features,c.redirectUris]))));
    }
  }
  #state(){return this.#identity?sharedTokenState(this.#identity,this.#key,this.#now()):this.#local;}
  #current(state){if(state.retired)throw new BankProviderError('INVALID_ACCESS_TOKEN',401);if(this.#identity)assertOpenPaymentsTokenCacheIdentity(this.#identity);}
  #checkCredentials() {
    if (this.#config.credentialsValidUntil && Date.parse(this.#config.credentialsValidUntil) <= this.#now()) {
      this.invalidate(); throw new BankProviderError('CREDENTIALS_EXPIRED', 409);
    }
  }
  invalidate() {if(this.#identity)invalidateSharedTokenState(this.#identity,this.#key);else invalidateTokenState(this.#local);}
  async accessToken() {
    this.#checkCredentials();
    const state=this.#state();this.#current(state);
    if (state.token && state.token.expiresAt > this.#now() + 30_000) return state.token.value;
    const epoch = state.epoch;
    if (state.flight?.epoch === epoch){const value=await state.flight.promise;this.#checkCredentials();this.#current(state);if(epoch!==state.epoch)throw new BankProviderError('INVALID_ACCESS_TOKEN',401);return value;}
    const flight = { epoch, promise: null };
    flight.promise = (async () => {
      const started = this.#now();
      const body = new URLSearchParams({ client_id: this.#config.clientId, client_secret: this.#config.clientSecret, grant_type: 'client_credentials', scope: this.#config.scopes.join(' ') });
      const response = await this.#http.send({ service: 'auth', path: '/connect/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      const parsed = tokenResult(response.data, this.#config.scopes);
      this.#checkCredentials();this.#current(state);
      if (epoch !== state.epoch) throw new BankProviderError('INVALID_ACCESS_TOKEN', 401);
      const expiresAt = Math.min(started + parsed.seconds * 1000,this.#config.credentialsValidUntil?Date.parse(this.#config.credentialsValidUntil):Infinity);
      if (expiresAt <= this.#now()) throw new BankProviderError('INVALID_OAUTH_RESULT', 502);
      state.token = { value: parsed.value, expiresAt };
      return parsed.value;
    })().finally(() => { if (state.flight === flight) state.flight = null; });
    state.flight = flight;
    const value=await flight.promise;this.#checkCredentials();this.#current(state);
    if(epoch!==state.epoch)throw new BankProviderError('INVALID_ACCESS_TOKEN',401);
    return value;
  }
  async activateAuthorization({ code, redirectUri, consentId, authorisationId }) {
    this.#checkCredentials();
    if (!safeText(code, 4096) || !/^[A-Za-z0-9_-]{1,200}$/.test(consentId) || !/^[A-Za-z0-9_-]{1,200}$/.test(authorisationId) || !this.#config.redirectUris.includes(redirectUri)) throw new BankProviderError('AUTHORIZATION_INVALID', 403);
    const scope = ['accountinformation', 'corporate'];
    const body = new URLSearchParams({ client_id: this.#config.clientId, client_secret: this.#config.clientSecret, code, redirect_uri: redirectUri, scope: scope.join(' '), grant_type: 'authorization_code' });
    const response = await this.#http.send({ service: 'auth', path: '/connect/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-consentId': consentId, 'X-ConsentAuthorisationId': authorisationId }, body: body.toString() });
    tokenResult(response.data, scope);
    this.#checkCredentials();
    // The documented redirect activation token is not used for subsequent AIS calls.
    return { activated: true };
  }
}
