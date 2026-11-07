export const originalFetch = globalThis.fetch;

const PREFIX = '/repos/sharbel0022/Mgeorge/';
const CODES = new Set(['ABORT_ERR', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE']);
const safeCode = error => CODES.has(error?.code) ? error.code : 'UNKNOWN';

function scopedUrl(input, init) {
  const method = init?.method === undefined ? (input instanceof Request ? input.method : 'GET') : init.method;
  if (typeof method !== 'string' || method.toUpperCase() !== 'GET') return null;
  let url;
  try { url = new URL(input instanceof Request ? input.url : input); } catch { return null; }
  return url.origin === 'https://api.github.com' && !url.username && !url.password && url.pathname.startsWith(PREFIX) ? url : null;
}

function safeEndpoint(url) {
  const route = url.pathname.slice(PREFIX.length);
  if (route === 'branches/main' || route === 'pulls') return PREFIX + route;
  return PREFIX + (route.startsWith('branches/') ? 'branches/[ref]' : '[resource]');
}

export function createGitHubReadTransport(fetchImpl, diagnose = row => process.stderr.write(JSON.stringify(row) + '\n')) {
  return async function githubReadFetch(...args) {
    const [input, init] = args, url = scopedUrl(input, init);
    if (!url) return Reflect.apply(fetchImpl, this, args);
    try {
      const suppliedHeaders = init?.headers;
      const headers = new Headers(suppliedHeaders === undefined && input instanceof Request ? input.headers : suppliedHeaders);
      headers.set('Connection', 'close');
      // Inherit every RequestInit option, including non-enumerable options, without mutating the caller.
      const options = Object.create(init ?? null, { headers: { value: headers, enumerable: true } });
      const forwarded = [...args]; forwarded[1] = options;
      return await Reflect.apply(fetchImpl, this, forwarded);
    } catch (error) {
      try {
        diagnose({ event: 'github-read-failure', method: 'GET', endpoint: safeEndpoint(url),
          code: safeCode(error), causeCode: safeCode(error?.cause) });
      } catch { /* Diagnostics must never replace the original failure. */ }
      throw error;
    }
  };
}

globalThis.fetch = createGitHubReadTransport(originalFetch);
