import { BankProviderError, assertServerRuntime, createProviderBinding, scopedResourceCodec, isRecord, safeText, snapshot, validDate } from './bank-data-provider.js';
import { bankApiDataHash } from '../bank-api-original.js';
import { validateOpenPaymentsConfig, OPENPAYMENTS_ORIGINS, validateScopes } from './openpayments/config.js';
import { createOpenPaymentsHttpClient } from './openpayments/http.js';
import { OpenPaymentsTokenClient } from './openpayments/token.js';
import { authorizationRedirect, consentStatus, scaStatus, methodsFromResponse, randomState } from './openpayments/authorization.js';

const CONSENTS = '/psd2/consent/v1/consents';
const ACCOUNTS = '/psd2/accountinformation/v1/accounts';
const ASPSPS = '/psd2/aspspinformation/v1/aspsps';
const BIC = /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?$/;
const resourceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const invalid = () => new BankProviderError('PROVIDER_RESPONSE_INVALID');
const authInvalid = () => new BankProviderError('AUTHORIZATION_INVALID', 403);
const mismatch = () => new BankProviderError('RESOURCE_SCOPE_MISMATCH', 403);
const endOfDate = date => `${date}T23:59:59.999Z`;

function assertAccountAvailable(raw) {
  if (!isRecord(raw) || raw.usage !== undefined && raw.usage !== 'ORGA' ||
      raw.status !== undefined && !['enabled', 'blocked', 'deleted'].includes(raw.status)) throw invalid();
  // The documented absent status means available. An explicit restriction is
  // bank evidence and must survive otherwise matching account identifiers.
  if (raw.status === 'blocked' || raw.status === 'deleted') throw new BankProviderError('BANK_ACCOUNT_UNAVAILABLE', 403);
}
function identity(raw) {
  assertAccountAvailable(raw);
  if (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)) throw invalid();
  const fields = ['iban', 'bban', 'clearingNumber', 'accountNumber', 'bankgiroNumber', 'plusgiroNumber'];
  const result = { currency: raw.currency };
  for (const field of fields) {
    if (raw[field] === undefined || raw[field] === null) continue;
    if (!safeText(raw[field], 100)) throw invalid();
    result[field] = raw[field];
  }
  // No guessed IBAN, calculated BBAN, or identity derived from a Bankgiro number.
  if (!result.iban && !result.bban && !result.accountNumber) throw invalid();
  return result;
}
function checkIdentity(expected, actual) {
  assertAccountAvailable(actual);
  const fields = ['iban', 'bban', 'clearingNumber', 'accountNumber'];
  let shared = false;
  for (const key of fields) if (expected[key] !== undefined && actual[key] !== undefined) {
    if (actual[key] !== expected[key]) throw mismatch();
    if (key !== 'clearingNumber') shared = true;
  }
  if (!shared) throw mismatch();
  if (actual.currency && expected.currency !== actual.currency) throw mismatch();
}
function transaction(raw, range, booked) {
  if (!isRecord(raw) || !isRecord(raw.transactionAmount) || typeof raw.transactionAmount.amount !== 'string' || !/^-?\d{1,30}(?:\.\d{1,8})?$/.test(raw.transactionAmount.amount) ||
      typeof raw.transactionAmount.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.transactionAmount.currency)) throw invalid();
  if (booked || raw.bookingDate !== undefined) {
    if (!validDate(raw.bookingDate) || raw.bookingDate < range.dateFrom || raw.bookingDate > range.dateTo) throw invalid();
  }
  for (const key of ['transactionId', 'entryReference', 'endToEndId', 'remittanceInformationStructured', 'remittanceInformationUnstructured']) {
    if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== 'string') throw invalid();
  }
  if (raw.isEnriched !== undefined && typeof raw.isEnriched !== 'boolean') throw invalid();
  return snapshot(raw);
}

/** Framework-independent, server-only adapter. Construct once per credential
 * generation. Explicitly bind each company; never use it as a global workspace. */
export class OpenPaymentsProvider {
  #config; #http; #tokens; #now;
  constructor(configuration, options = {}) {
    assertServerRuntime();
    this.#now = options.now ?? Date.now;
    this.#config = validateOpenPaymentsConfig(configuration, this.#now);
    this.#http = createOpenPaymentsHttpClient(this.#config, options);
    this.#tokens = new OpenPaymentsTokenClient(this.#config, this.#http, this.#now);
    Object.defineProperty(this, 'id', { value: 'open_payments', enumerable: true });
    Object.freeze(this);
  }
  forCompany(context, dependencies) {
    return new OpenPaymentsCompanyConnection(context, dependencies, this.#config, this.#http, this.#tokens, this.#now);
  }
}

class OpenPaymentsCompanyConnection {
  #context; #dependencies; #config; #http; #tokens; #now; #resources;
  constructor(input, dependencies, config, http, tokens, now) {
    const context = snapshot(input, 'INVALID_PROVIDER_BINDING'), binding = createProviderBinding(context?.binding);
    if (binding.provider !== 'open_payments' || binding.environment !== config.environment || binding.generation !== config.credentialGeneration ||
        !safeText(context.corporateId) || !safeText(context.psuId) || !BIC.test(context.bicFi) ||
        typeof dependencies?.assertCurrent !== 'function' ||
        context.corporateIdType !== undefined && !safeText(context.corporateIdType, 100) ||
        context.affiliatedAspspId !== undefined && !safeText(context.affiliatedAspspId, 100)) throw new BankProviderError('INVALID_PROVIDER_BINDING', 403);
    if (context.psu !== undefined) {
      const ip = context.psu?.ipAddress, agent = context.psu?.userAgent;
      if (typeof ip !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(part => Number(part) > 255) ||
          typeof agent !== 'string' || !agent || agent.length > 512 || /[\r\n\u0000]/.test(agent)) throw new BankProviderError('INVALID_PROVIDER_BINDING', 403);
      Object.freeze(context.psu);
    }
    context.binding = binding;
    this.#context = Object.freeze(context); this.#dependencies = Object.freeze({ ...dependencies });
    this.#config = config; this.#http = http; this.#tokens = tokens; this.#now = now;
    this.#resources = scopedResourceCodec(binding, dependencies.codec, now);
    Object.defineProperties(this, { provider: { value: 'open_payments', enumerable: true }, binding: { value: binding, enumerable: true } });
    Object.freeze(this);
  }
  async #guard() {
    try { await this.#dependencies.assertCurrent(this.binding); }
    catch { throw mismatch(); }
    if (this.#config.credentialsValidUntil && Date.parse(this.#config.credentialsValidUntil) <= this.#now()) throw new BankProviderError('CREDENTIALS_EXPIRED', 409);
  }
  #feature(name) { if (!this.#config.features.includes(name)) throw new BankProviderError('FEATURE_NOT_ALLOWED', 403); }
  #psuRequired() { if (!this.#context.psu) throw authInvalid(); }
  #consentTime(consent) {
    if (consent && (!validDate(consent.validUntil) || Date.parse(endOfDate(consent.validUntil)) <= this.#now())) throw new BankProviderError('CONSENT_NOT_VALID', 409);
  }
  #headers(consent) {
    const headers = { 'X-BicFi': this.#context.bicFi, 'PSU-ID': this.#context.psuId, 'PSU-Corporate-ID': this.#context.corporateId, 'TPP-Redirect-Preferred': String(consent?.redirectPreferred === true) };
    if (this.#context.corporateIdType) headers['PSU-Corporate-ID-Type'] = this.#context.corporateIdType;
    if (this.#context.affiliatedAspspId) headers['X-AffiliatedASPSP-ID'] = this.#context.affiliatedAspspId;
    if (this.#context.psu) { headers['PSU-IP-Address'] = this.#context.psu.ipAddress; headers['PSU-User-Agent'] = this.#context.psu.userAgent; }
    return headers;
  }
  async #request(path, { method = 'GET', body, consent, discovery = false, revokeExpired = false } = {}) {
    if (revokeExpired && (method !== 'DELETE' || body !== undefined || !consent || path !== `${CONSENTS}/${consent.id}`)) throw mismatch();
    const consentTime = () => { if (!revokeExpired) this.#consentTime(consent); };
    await this.#guard(); consentTime();
    const token = await this.#tokens.accessToken();
    await this.#guard(); consentTime();
    try {
      const result = await this.#http.send({ path, method, body: body === undefined ? undefined : JSON.stringify(body), headers: {
        ...(discovery ? {} : this.#headers(consent)), Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(consent && path.startsWith(ACCOUNTS) ? { 'Consent-ID': consent.id } : {}),
      } });
      await this.#guard(); consentTime();
      return result;
    } catch (error) {
      if (error instanceof BankProviderError && error.code === 'INVALID_ACCESS_TOKEN') this.#tokens.invalidate();
      throw error;
    }
  }
  #original(response, operation) {
    const bankData = snapshot(response.data), bankDataSha256 = bankApiDataHash(bankData);
    if (!bankDataSha256) throw invalid();
    return { provider: 'open_payments', binding: this.binding, bankDataVersion: 'openpayments-response-v1', bankData,
      bankDataSha256, representation: 'provider_json', operation, requestId: response.requestId, receivedAt: response.rawResponse.receivedAt, rawResponse: response.rawResponse };
  }
  async #finish(value, consent) { await this.#guard(); this.#consentTime(consent); return value; }
  async #resource(kind, handle, revokeExpired = false) {
    if (revokeExpired && kind !== 'consent') throw mismatch();
    await this.#guard();
    const value = await (revokeExpired ? this.#resources.openConsentForRevocation(handle) : this.#resources.open(kind, handle)), consent = kind === 'consent' ? value : value.consent;
    if (!isRecord(consent) || consent.corporateId !== this.#context.corporateId || consent.psuId !== this.#context.psuId || consent.bicFi !== this.#context.bicFi ||
        !resourceId(consent.id) || !validDate(consent.validUntil) || (!revokeExpired && Date.parse(endOfDate(consent.validUntil)) <= this.#now()) ||
        consent.corporateIdType !== this.#context.corporateIdType || consent.affiliatedAspspId !== this.#context.affiliatedAspspId) throw mismatch();
    return value;
  }
  async #validConsent(consent) {
    const response = await this.#request(`${CONSENTS}/${consent.id}`, { consent });
    const status = consentStatus(response.data.consentStatus);
    if (status !== 'valid' || !validDate(response.data.validUntil) || Date.parse(endOfDate(response.data.validUntil)) <= this.#now()) throw new BankProviderError('CONSENT_NOT_VALID', 409);
    // Never extend locally granted access; apply a bank-shortened lifetime to
    // every later request and the return boundary within this operation.
    if (response.data.validUntil < consent.validUntil) consent.validUntil = response.data.validUntil;
    return response;
  }
  async listBanks(countries = ['SE']) {
    this.#feature('bank_discovery');
    if (!Array.isArray(countries) || countries.length < 1 || countries.length > 10 || countries.some(country => !/^[A-Z]{2}$/.test(country)) || new Set(countries).size !== countries.length) throw invalid();
    const response = await this.#request(`${ASPSPS}?${new URLSearchParams({ isoCountryCodes: countries.join(',') })}`, { discovery: true });
    if (!Array.isArray(response.data.aspsps) || response.data.aspsps.length > 2000) throw invalid();
    const banks = response.data.aspsps.map(bank => {
      if (!isRecord(bank) || !BIC.test(bank.bicFi) || typeof bank.name !== 'string' || !bank.name || bank.name.length > 140) throw invalid();
      return { id: bank.bicFi, name: bank.name };
    });
    return this.#finish({ banks, original: this.#original(response, 'list_banks') });
  }
  async discoverCapabilities() {
    this.#feature('bank_discovery');
    const response = await this.#request(`${ASPSPS}/${this.#context.bicFi}`, { discovery: true }), raw = response.data;
    if (raw.bicFi !== this.#context.bicFi || typeof raw.name !== 'string' || !raw.name || raw.name.length > 140) throw invalid();
    const accountInformation = {};
    if (raw.accountInformation !== undefined) {
      if (!isRecord(raw.accountInformation)) throw invalid();
      for (const key of ['transactionHistoryMaxDays', 'extendedTransactionHistoryMaxDays', 'extendedTransactionHistoryAvailableWindowMinutes']) {
        if (raw.accountInformation[key] === undefined) continue;
        if (!Number.isSafeInteger(raw.accountInformation[key]) || raw.accountInformation[key] < 0) throw invalid();
        accountInformation[key] = raw.accountInformation[key];
      }
    }
    const methods = raw.supportedAuthorizationMethods ?? [];
    if (!Array.isArray(methods)) throw invalid();
    const authorizationMethods = [];
    for (const item of methods) {
      if (!isRecord(item) || typeof item.name !== 'string') throw invalid();
      if (item.name === 'OAuth2' && !authorizationMethods.includes('redirect')) authorizationMethods.push('redirect');
      if (item.name === 'Decoupled' && !authorizationMethods.includes('decoupled')) authorizationMethods.push('decoupled');
    }
    return this.#finish({ provider: 'open_payments', binding: this.binding, bank: { id: raw.bicFi, name: raw.name },
      corporateAccountAccess: 'requires_company_consent', accountInformation, authorizationMethods,
      bankgiro: { status: this.#config.scopes.includes('bankgiroinformation') ? 'unknown' : 'not_configured', reason: 'company_bankgiro_coverage_not_discoverable_from_aspsp_metadata' },
      payments: 'disabled', checkedAt: new Date(this.#now()).toISOString(), original: this.#original(response, 'bank_capabilities') });
  }
  async createConsent(input) {
    input = Object.freeze(snapshot(input, 'AUTHORIZATION_INVALID'));
    this.#feature('consents'); this.#psuRequired();
    if (!isRecord(input) || Object.keys(input).some(key => !['validUntil', 'frequencyPerDay', 'redirectPreferred'].includes(key)) ||
        !validDate(input.validUntil) || Date.parse(endOfDate(input.validUntil)) <= this.#now() ||
        input.redirectPreferred !== undefined && typeof input.redirectPreferred !== 'boolean') throw authInvalid();
    const frequencyPerDay = input.frequencyPerDay ?? 4;
    if (!Number.isInteger(frequencyPerDay) || frequencyPerDay < 1 || frequencyPerDay > 4) throw authInvalid();
    const consent = { id: '', corporateId: this.#context.corporateId, psuId: this.#context.psuId, bicFi: this.#context.bicFi,
      corporateIdType: this.#context.corporateIdType, affiliatedAspspId: this.#context.affiliatedAspspId,
      validUntil: input.validUntil, redirectPreferred: input.redirectPreferred === true };
    const response = await this.#request(CONSENTS, { method: 'POST', consent, body: { access: {}, recurringIndicator: true, validUntil: input.validUntil, frequencyPerDay, combinedServiceIndicator: false } });
    if (!resourceId(response.data.consentId)) throw invalid();
    consent.id = response.data.consentId;
    return this.#finish({ handle: await this.#resources.seal('consent', consent, endOfDate(consent.validUntil)), status: consentStatus(response.data.consentStatus), original: this.#original(response, 'create_consent') });
  }
  async getConsentStatus(handle) {
    const consent = await this.#resource('consent', handle), response = await this.#request(`${CONSENTS}/${consent.id}/status`, { consent });
    return this.#finish({ status: consentStatus(response.data.consentStatus), original: this.#original(response, 'consent_status') });
  }
  async revokeConsent(handle) {
    const consent = await this.#resource('consent', handle, true);
    await this.#request(`${CONSENTS}/${consent.id}`, { method: 'DELETE', consent, revokeExpired: true });
    await this.#guard();
  }
  async createAuthorisation(handle) {
    this.#psuRequired();
    const consent = await this.#resource('consent', handle), response = await this.#request(`${CONSENTS}/${consent.id}/authorisations`, { method: 'POST', consent });
    if (!resourceId(response.data.authorisationId)) throw authInvalid();
    const methods = methodsFromResponse(response.data), status = scaStatus(response.data.scaStatus);
    const value = { id: response.data.authorisationId, consent, methods };
    const expiresAt = new Date(Math.min(Date.parse(endOfDate(consent.validUntil)), this.#now() + 10 * 60_000)).toISOString();
    return this.#finish({ handle: await this.#resources.seal('authorisation', value, expiresAt), methods, scaStatus: status, original: this.#original(response, 'create_authorisation') });
  }
  async startAuthorisation(handle, input) {
    input = Object.freeze(snapshot(input, 'AUTHORIZATION_INVALID'));
    this.#psuRequired();
    const authorization = await this.#resource('authorisation', handle);
    if (!isRecord(input) || Object.keys(input).some(key => !['authenticationMethodId', 'redirectUri'].includes(key)) || !authorization.methods.some(method => method.authenticationMethodId === input.authenticationMethodId)) throw authInvalid();
    if (authorization.consent.redirectPreferred && (!this.#config.redirectUris.includes(input.redirectUri) || typeof this.#dependencies.consumeRedirectState !== 'function')) throw authInvalid();
    const response = await this.#request(`${CONSENTS}/${authorization.consent.id}/authorisations/${authorization.id}`, { method: 'PUT', consent: authorization.consent, body: { authenticationMethodId: input.authenticationMethodId } });
    const status = scaStatus(response.data.scaStatus), approach = response.headers.get('aspsp-sca-approach');
    if (approach === 'DECOUPLED') {
      if (response.data.challengeData !== undefined && !isRecord(response.data.challengeData)) throw authInvalid();
      return this.#finish({ approach: 'decoupled', scaStatus: status, challengeData: snapshot(response.data.challengeData ?? {}), consentValid: false });
    }
    if (approach !== 'REDIRECT' || typeof this.#dependencies.consumeRedirectState !== 'function') throw authInvalid();
    const state = randomState(), flowId = crypto.randomUUID(), redirectUri = input.redirectUri;
    const redirectUrl = authorizationRedirect(response.data._links?.scaOAuth?.href, { config: this.#config, consent: authorization.consent, authorisationId: authorization.id, redirectUri, state });
    const expiresAt = new Date(Math.min(Date.parse(endOfDate(authorization.consent.validUntil)), this.#now() + 10 * 60_000)).toISOString();
    const flowHandle = await this.#resources.seal('redirect', { consent: authorization.consent, authorisationId: authorization.id, state, redirectUri, flowId }, expiresAt);
    return this.#finish({ approach: 'redirect', scaStatus: status, redirectUrl, flowHandle, consentValid: false });
  }
  async getAuthorisationStatus(handle) {
    const authorization = await this.#resource('authorisation', handle);
    const response = await this.#request(`${CONSENTS}/${authorization.consent.id}/authorisations/${authorization.id}`, { consent: authorization.consent });
    if (response.data.challengeData !== undefined && !isRecord(response.data.challengeData)) throw authInvalid();
    return this.#finish({ scaStatus: scaStatus(response.data.scaStatus), challengeData: snapshot(response.data.challengeData ?? {}), consentValid: false });
  }
  async completeRedirect(handle, callback) {
    callback = Object.freeze(snapshot(callback, 'AUTHORIZATION_INVALID'));
    const flow = await this.#resource('redirect', handle);
    try {
      if (!isRecord(callback) || Object.keys(callback).some(key => !['code', 'scope', 'state'].includes(key)) || callback.state !== flow.state || !safeText(callback.code, 4096) || typeof callback.scope !== 'string') throw Error();
      validateScopes(callback.scope.split(' '), ['accountinformation', 'corporate']);
      if (typeof this.#dependencies.consumeRedirectState !== 'function' || await this.#dependencies.consumeRedirectState({ binding: this.binding, state: flow.state, flowId: flow.flowId }) !== true) throw Error();
    } catch { throw authInvalid(); }
    await this.#guard();
    await this.#tokens.activateAuthorization({ code: callback.code, redirectUri: flow.redirectUri, consentId: flow.consent.id, authorisationId: flow.authorisationId });
    await this.#guard();
    const response = await this.#request(`${CONSENTS}/${flow.consent.id}/status`, { consent: flow.consent });
    return this.#finish({ status: consentStatus(response.data.consentStatus), original: this.#original(response, 'redirect_consent_status') });
  }
  async listAccounts(handle) {
    this.#feature('accounts');
    const consent = await this.#resource('consent', handle), current = await this.#validConsent(consent);
    const response = await this.#request(ACCOUNTS, { consent });
    if (!Array.isArray(response.data.accounts) || response.data.accounts.length > 1000 || new Set(response.data.accounts.map(account => account?.resourceId)).size !== response.data.accounts.length) throw invalid();
    const accounts = [];
    const expiresAt = endOfDate(current.data.validUntil < consent.validUntil ? current.data.validUntil : consent.validUntil);
    for (const account of response.data.accounts) {
      if (!isRecord(account) || !resourceId(account.resourceId)) throw invalid();
      const ids = identity(account), payload = { id: account.resourceId, identity: ids, consent };
      accounts.push({ handle: await this.#resources.seal('account', payload, expiresAt), identity: ids, name: typeof account.name === 'string' ? account.name : '', bankgiroMappingVerified: false });
    }
    return this.#finish({ accounts, validUntil: expiresAt, original: this.#original(response, 'list_accounts') }, consent);
  }
  async getAccount(handle) {
    this.#feature('accounts');
    const account = await this.#resource('account', handle);
    await this.#validConsent(account.consent);
    const response = await this.#request(`${ACCOUNTS}/${account.id}`, { consent: account.consent });
    if (response.data.resourceId !== undefined && response.data.resourceId !== account.id) throw mismatch();
    const ids = identity(response.data); checkIdentity(account.identity, ids);
    return this.#finish({ identity: ids, bankgiroMappingVerified: false, original: this.#original(response, 'account_details') }, account.consent);
  }
  async getTransactions(handle, input) {
    input = Object.freeze(snapshot(input));
    this.#feature('transactions');
    if (!isRecord(input) || Object.keys(input).some(key => !['dateFrom', 'dateTo', 'requireBankgiro'].includes(key)) || !validDate(input.dateFrom) || !validDate(input.dateTo) || input.dateFrom > input.dateTo || input.requireBankgiro !== undefined && typeof input.requireBankgiro !== 'boolean') throw invalid();
    const account = await this.#resource('account', handle), requested = this.#config.scopes.includes('bankgiroinformation');
    if (input.requireBankgiro && !requested) throw new BankProviderError('BANKGIRO_NOT_AVAILABLE', 409);
    await this.#validConsent(account.consent);
    const path = `${ACCOUNTS}/${account.id}/transactions`, origin = OPENPAYMENTS_ORIGINS[this.#config.environment].api;
    let next = `${path}?${new URLSearchParams({ bookingStatus: 'booked', dateFrom: input.dateFrom, dateTo: input.dateTo })}`;
    const seen = new Set(), cursors = new Set(), booked = [], bankgiro = [], originals = [], deadline = this.#now() + 120_000;
    let allHaveBankgiro = true;
    while (next) {
      if (seen.has(next) || seen.size >= 20 || this.#now() >= deadline) throw invalid();
      seen.add(next);
      const response = await this.#request(next, { consent: account.consent }), data = response.data;
      if (this.#now() >= deadline) throw new BankProviderError('PROVIDER_TIMEOUT', 504, { retryable: true });
      if (data.account !== undefined) { if (!isRecord(data.account)) throw invalid(); checkIdentity(account.identity, data.account); }
      if (!isRecord(data.transactions) || !Array.isArray(data.transactions.booked) || !isRecord(data.transactions._links)) throw invalid();
      if (data.transactions.pending !== undefined && (!Array.isArray(data.transactions.pending) || data.transactions.pending.length > 0)) throw invalid();
      booked.push(...data.transactions.booked.map(row => transaction(row, input, true)));
      if (data.transactions.bankgiro !== undefined) {
        if (!requested || !Array.isArray(data.transactions.bankgiro)) throw invalid();
        bankgiro.push(...data.transactions.bankgiro.map(row => transaction(row, input, false)));
      } else allHaveBankgiro = false;
      if (booked.length + bankgiro.length > 5000) throw invalid();
      originals.push(this.#original(response, 'transactions'));
      const link = data.transactions._links.next;
      if (link === undefined || link === null) { next = ''; continue; }
      if (!isRecord(link) || typeof link.href !== 'string' || link.href.length > 8192 || /[\\\r\n#]/.test(link.href)) throw invalid();
      let url; try { url = new URL(link.href, origin); } catch { throw invalid(); }
      const keys = [...url.searchParams.keys()], cursor = url.searchParams.get('continuationKey');
      if (url.origin !== origin || url.pathname !== path || url.username || url.password || new Set(keys).size !== keys.length || keys.some(key => !['bookingStatus', 'dateFrom', 'dateTo', 'continuationKey'].includes(key)) ||
          url.searchParams.get('bookingStatus') !== 'booked' || !safeText(cursor, 4096) || cursors.has(cursor) ||
          !validDate(url.searchParams.get('dateFrom')) || !validDate(url.searchParams.get('dateTo')) ||
          url.searchParams.get('dateFrom') < input.dateFrom || url.searchParams.get('dateTo') > input.dateTo || url.searchParams.get('dateFrom') > url.searchParams.get('dateTo')) throw invalid();
      cursors.add(cursor); next = url.pathname + url.search;
    }
    if (input.requireBankgiro && !allHaveBankgiro) throw new BankProviderError('BANKGIRO_NOT_AVAILABLE', 409);
    return this.#finish({ booked, bankgiro, originals, bankgiroEvidence: { status: !requested ? 'not_requested' : allHaveBankgiro ? 'returned_by_provider' : 'not_returned', completeness: 'unknown' }, paymentReconciliationAllowed: false }, account.consent);
  }
}
