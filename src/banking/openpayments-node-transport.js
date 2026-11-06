import https from 'node:https';
import { X509Certificate, createPrivateKey } from 'node:crypto';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const ID = '[A-Za-z0-9_-]{1,200}';
const CONSENT = new RegExp(`^/psd2/consent/v1/consents(?:/${ID}(?:/status|/authorisations(?:/${ID})?)?)?$`);
const ACCOUNT = new RegExp(`^/psd2/accountinformation/v1/accounts(?:/${ID}(?:/transactions)?)?$`);
const ASPSP = /^\/psd2\/aspspinformation\/v1\/aspsps(?:\/[A-Z]{6}[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?)?$/;
const HEADERS = new Set([
  'accept', 'authorization', 'content-type', 'x-request-id', 'x-bicfi',
  'psu-id', 'psu-corporate-id', 'psu-corporate-id-type', 'psu-ip-address',
  'psu-user-agent', 'tpp-redirect-preferred', 'tpp-redirect-uri',
  'consent-id', 'x-affiliatedaspsp-id', 'x-consentid', 'x-consentauthorisationid'
]);
const MESSAGES = {
  INVALID_CLIENT_CERTIFICATE: 'The client certificate or private key is invalid.',
  CLIENT_CERTIFICATE_EXPIRED: 'The client certificate has expired.',
  INVALID_REQUEST: 'The Open Payments request is not permitted.',
  REQUEST_ABORTED: 'The Open Payments request was aborted.',
  REQUEST_TIMEOUT: 'The Open Payments request timed out.',
  PROVIDER_REDIRECT: 'The Open Payments server returned a redirect.',
  RESPONSE_TOO_LARGE: 'The Open Payments response exceeded the size limit.',
  PROVIDER_NETWORK_ERROR: 'The Open Payments connection failed.'
};

function failure(code) {
  const error = new Error(MESSAGES[code]);
  error.code = code;
  return error;
}

function checkedRequest(input, init) {
  const raw = input instanceof URL ? input.href : input;
  if (typeof raw !== 'string' || /[\s\\#\u0000-\u001f\u007f]/u.test(raw)) {
    throw failure('INVALID_REQUEST');
  }
  let url;
  try { url = new URL(raw); } catch { throw failure('INVALID_REQUEST'); }
  const rawPath = /^https:\/\/[^/?#]+([^?#]*)/u.exec(raw)?.[1] || '/';
  const method = init?.method;
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      rawPath !== url.pathname || url.pathname.includes('%') ||
      !['GET', 'POST', 'PUT', 'DELETE'].includes(method) ||
      !(init.headers instanceof Headers) ||
      (init.body !== undefined && typeof init.body !== 'string') ||
      (method === 'GET' && init.body !== undefined)) {
    throw failure('INVALID_REQUEST');
  }
  if (url.origin === 'https://auth.openbankingplatform.com') {
    if (url.pathname !== '/connect/token' || url.search || method !== 'POST') {
      throw failure('INVALID_REQUEST');
    }
  } else if (url.origin === 'https://api.openbankingplatform.com') {
    const path = url.pathname;
    const consent = CONSENT.test(path);
    const permitted = (method === 'GET' && (ASPSP.test(path) || ACCOUNT.test(path) ||
      (consent && path !== '/psd2/consent/v1/consents'))) ||
      (consent && method === 'POST' && (path === '/psd2/consent/v1/consents' || path.endsWith('/authorisations'))) ||
      (consent && method === 'PUT' && new RegExp(`/authorisations/${ID}$`).test(path)) ||
      (consent && method === 'DELETE' && new RegExp(`^/psd2/consent/v1/consents/${ID}$`).test(path));
    if (!permitted || (url.search && (method !== 'GET' || consent))) {
      throw failure('INVALID_REQUEST');
    }
  } else {
    throw failure('INVALID_REQUEST');
  }
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) throw failure('INVALID_REQUEST');
    seen.add(key);
  }
  for (const key of init.headers.keys()) {
    if (!HEADERS.has(key)) throw failure('INVALID_REQUEST');
  }
  if (init.signal !== undefined && !(init.signal instanceof AbortSignal)) {
    throw failure('INVALID_REQUEST');
  }
  return url;
}

/** A server-only, production mTLS connection with a bounded streaming response. */
export function createOpenPaymentsNodeTransport({ certificatePem, privateKeyPem, caPem, now = Date.now } = {}) {
  let certificate;
  let privateKey;
  let validFrom;
  let validTo;
  let authorities = [];
  try {
    if (typeof certificatePem !== 'string' || typeof privateKeyPem !== 'string' || typeof now !== 'function') {
      throw new Error();
    }
    certificate = new X509Certificate(certificatePem);
    privateKey = createPrivateKey(privateKeyPem);
    validFrom = Date.parse(certificate.validFrom);
    validTo = Date.parse(certificate.validTo);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) throw new Error();
    if (caPem !== undefined) {
      if (typeof caPem !== 'string' || !caPem || caPem.length > 128 * 1024) throw new Error();
      const blocks = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!blocks?.length || blocks.length > 20 || caPem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) throw new Error();
      authorities = blocks.map(block => new X509Certificate(block));
      if (authorities.some(ca => !ca.ca || !Number.isFinite(Date.parse(ca.validFrom)) || !Number.isFinite(Date.parse(ca.validTo)))) throw new Error();
    }
  } catch {
    throw failure('INVALID_CLIENT_CERTIFICATE');
  }

  function validateCertificate() {
    let timestamp;
    try {
      timestamp = now();
      if (!Number.isFinite(timestamp) || !certificate.checkPrivateKey(privateKey) || timestamp < validFrom || authorities.some(ca => timestamp < Date.parse(ca.validFrom))) {
        throw new Error();
      }
    } catch {
      throw failure('INVALID_CLIENT_CERTIFICATE');
    }
    if (timestamp >= validTo || authorities.some(ca => timestamp >= Date.parse(ca.validTo))) throw failure('CLIENT_CERTIFICATE_EXPIRED');
  }
  validateCertificate();

  async function request(input, init) {
    validateCertificate();
    const url = checkedRequest(input, init);
    if (init.signal?.aborted) throw failure('REQUEST_ABORTED');

    return new Promise((resolve, reject) => {
      let req;
      let incoming;
      let controller;
      let timer;
      let terminal = false;
      let headersResolved = false;
      let ended = false;
      let received = 0;
      const cleanup = () => {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', onAbort);
      };
      const destroy = () => {
        incoming?.destroy();
        req?.destroy();
      };
      const fail = code => {
        if (terminal) return;
        terminal = true;
        cleanup();
        const error = failure(code);
        if (controller) controller.error(error);
        if (!headersResolved) reject(error);
        destroy();
      };
      const onAbort = () => fail('REQUEST_ABORTED');
      timer = setTimeout(() => fail('REQUEST_TIMEOUT'), REQUEST_TIMEOUT_MS);
      timer.unref?.();
      init.signal?.addEventListener('abort', onAbort, { once: true });
      if (init.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        req = https.request(url, {
          method: init.method,
          headers: Object.fromEntries(init.headers),
          cert: certificatePem,
          key: privateKeyPem,
          ...(caPem === undefined ? {} : { ca: caPem }),
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          agent: false
        }, response => {
          incoming = response;
          incoming.on('error', () => fail('PROVIDER_NETWORK_ERROR'));
          if (terminal) { destroy(); return; }
          const status = incoming.statusCode;
          if (!Number.isInteger(status) || status < 200 || status > 599) {
            fail('PROVIDER_NETWORK_ERROR');
            return;
          }
          if (status >= 300 && status < 400) {
            fail('PROVIDER_REDIRECT');
            return;
          }
          try {
            const headers = new Headers();
            for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
              headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
            }
            const length = headers.get('content-length');
            if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
              // The HTTP client classifies these statuses without reading a body.
              // Preserve status and Retry-After while closing an unsafe payload.
              if ([401, 403, 429].includes(status) || status >= 500) {
                const result = new Response(null, { status, headers });
                headersResolved = true;
                terminal = true;
                cleanup();
                destroy();
                resolve(result);
                return;
              }
              fail('RESPONSE_TOO_LARGE');
              return;
            }
            if ([204, 205].includes(status)) {
              const result = new Response(null, { status, headers });
              headersResolved = true;
              terminal = true;
              cleanup();
              destroy();
              resolve(result);
              return;
            }
            incoming.pause();
            const stream = new ReadableStream({
              start(streamController) {
                controller = streamController;
                incoming.on('data', chunk => {
                  if (terminal) return;
                  const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                  received += bytes.byteLength;
                  if (received > MAX_RESPONSE_BYTES) { fail('RESPONSE_TOO_LARGE'); return; }
                  controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
                  if (controller.desiredSize <= 0) incoming.pause();
                });
                incoming.on('end', () => {
                  if (terminal) return;
                  ended = true;
                  terminal = true;
                  cleanup();
                  controller.close();
                });
                incoming.on('aborted', () => fail('PROVIDER_NETWORK_ERROR'));
                incoming.on('close', () => {
                  if (!ended) fail('PROVIDER_NETWORK_ERROR');
                });
              },
              pull() { if (!terminal) incoming.resume(); },
              cancel() {
                if (terminal) return;
                terminal = true;
                cleanup();
                destroy();
              }
            });
            const result = new Response(stream, { status, headers });
            headersResolved = true;
            resolve(result);
          } catch {
            fail('PROVIDER_NETWORK_ERROR');
          }
        });
        req.on('error', () => fail('PROVIDER_NETWORK_ERROR'));
        if (terminal) destroy();
        else req.end(init.body);
      } catch {
        fail('PROVIDER_NETWORK_ERROR');
      }
    });
  }

  return Object.freeze({ kind: 'mtls', validateCertificate, request });
}
