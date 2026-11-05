import { BankProviderError, safeText, isRecord } from '../bank-data-provider.js';
import { validateOpenPaymentsConfig, validateScopes } from './config.js';

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
  #config; #http; #now; #token = null; #flight = null; #epoch = 0;
  constructor(config, http, now = Date.now) { this.#config = validateOpenPaymentsConfig(config, now); this.#http = http; this.#now = now; }
  #checkCredentials() {
    if (this.#config.credentialsValidUntil && Date.parse(this.#config.credentialsValidUntil) <= this.#now()) {
      this.invalidate(); throw new BankProviderError('CREDENTIALS_EXPIRED', 409);
    }
  }
  invalidate() { this.#epoch++; this.#token = null; this.#flight = null; }
  async accessToken() {
    this.#checkCredentials();
    if (this.#token && this.#token.expiresAt > this.#now() + 30_000) return this.#token.value;
    const epoch = this.#epoch;
    if (this.#flight?.epoch === epoch) return this.#flight.promise;
    const flight = { epoch, promise: null };
    flight.promise = (async () => {
      const started = this.#now();
      const body = new URLSearchParams({ client_id: this.#config.clientId, client_secret: this.#config.clientSecret, grant_type: 'client_credentials', scope: this.#config.scopes.join(' ') });
      const response = await this.#http.send({ service: 'auth', path: '/connect/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      const parsed = tokenResult(response.data, this.#config.scopes);
      this.#checkCredentials();
      if (epoch !== this.#epoch) throw new BankProviderError('INVALID_ACCESS_TOKEN', 401);
      const expiresAt = started + parsed.seconds * 1000;
      if (expiresAt <= this.#now()) throw new BankProviderError('INVALID_OAUTH_RESULT', 502);
      this.#token = { value: parsed.value, expiresAt };
      return parsed.value;
    })().finally(() => { if (this.#flight === flight) this.#flight = null; });
    this.#flight = flight;
    return flight.promise;
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
