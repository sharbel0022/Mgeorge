import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { createSession, fixtureResponse, scenarios } from './fixtures.mjs';
import { renderQaFrame } from './qa-frame.mjs';

// This process has no upstream API or proxy. Refuse accidental future transports.
const denied = () => { throw new Error('Outbound network is disabled in the synthetic UI server'); };
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
net.connect = denied; net.createConnection = denied; tls.connect = denied;
globalThis.fetch = denied; syncBuiltinESMExports();
const host = '127.0.0.1';
const port = Number(process.env.MGEORGE_95_UI_PORT || 5195);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
const origin = `http://${host}:${port}`;
const scratch = process.env.MGEORGE_95_UI_QA || path.join(tmpdir(), 'mgeorge-95-ui-qa');
const web = path.join(scratch, 'web');
const sessions = new Map();
const logFile = path.join(scratch, 'requests.jsonl');
await fs.mkdir(scratch, { recursive: true });
await fs.access(path.join(web, 'index.html'));
function headers(extra = {}, allowSameOriginFrame = false) {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors '" + (allowSameOriginFrame ? "self" : "none") + "'", ...extra };
}
function json(res, status, body, extra = {}) { res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', ...extra })); res.end(JSON.stringify(body)); }
function cookieSession(req) { const id = (req.headers.cookie || '').match(/(?:^|;\s*)mg95qa=([a-f0-9-]+)/)?.[1]; return id && sessions.get(id); }
const server = http.createServer(async (req, res) => {
  let safePath = '[invalid]'; let session;
  try {
    if (req.headers.host !== `${host}:${port}` || (req.headers.origin && req.headers.origin !== origin)) return json(res, 421, { error: 'Only the loopback harness origin is accepted.' });
    const url = new URL(req.url, origin); safePath = url.pathname;
    if (url.origin !== origin) return json(res, 421, { error: 'External origins are rejected.' });
    if (req.method === 'GET' && url.pathname === '/qa-frame') {
      const frame = renderQaFrame(url);
      res.writeHead(frame.status, headers({ 'Content-Type': 'text/html; charset=utf-8' })); res.end(frame.body); return;
    }
    session = cookieSession(req);
    if (req.method === 'GET' && ['/', '/bank'].includes(url.pathname)) {
      const scenario = url.searchParams.get('scenario');
      if (scenario !== null && !Object.hasOwn(scenarios, scenario)) return json(res, 400, { error: 'Unknown fixture scenario', scenarios: Object.keys(scenarios) });
      const extra = { 'Content-Type': 'text/html; charset=utf-8' };
      if (!session || scenario !== null) { const id = randomUUID(); session = createSession(scenario || 'standard'); sessions.set(id, session); extra['Set-Cookie'] = `mg95qa=${id}; Path=/; HttpOnly; SameSite=Strict`; }
      res.writeHead(200, headers(extra, true)); res.end(await fs.readFile(path.join(web, 'index.html'))); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!session) return json(res, 428, { error: 'Open a harness page before requesting synthetic API data.' });
      const companyIds = url.searchParams.getAll('companyId'), versions = url.searchParams.getAll('companyContextVersion');
      if (companyIds.length > 1 || versions.length > 1 || [req.headers['x-company-id'], ...companyIds].some(value => value !== undefined && value !== session.companyId) || [req.headers['x-company-context-version'], ...versions].some(value => value !== undefined && value !== String(session.contextVersion))) return json(res, 409, { error: 'Synthetic company context is stale.', code: 'COMPANY_CONTEXT_STALE' });
      let body = {};
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers.origin !== origin) return json(res, 421, { error: 'Synthetic mutations require the exact local origin.' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Only synthetic JSON requests are supported.' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return json(res, 413, { error: 'Synthetic request too large.' }); }
        try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'Invalid synthetic JSON.' }); }
      }
      const response = fixtureResponse(session, req.method, url, body);
      if (response.pending) { res.on('close', () => {}); return; }
      return json(res, response.status, response.body, { 'X-Company-Id': session.companyId, 'X-Company-Context-Version': String(session.contextVersion) });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Synthetic server route not supported.' });
    const asset = url.pathname.slice(1);
    if (!/^(?:app\.(?:js|css)|chunks\/[A-Za-z0-9_-]+\.js)$/.test(asset)) return json(res, 404, { error: 'Unknown local resource.' });
    res.writeHead(200, headers({ 'Content-Type': asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' })); res.end(await fs.readFile(path.join(web, asset)));
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: 'Synthetic harness failure', code: error.code || 'HARNESS_ERROR' }); else res.destroy();
  } finally {
    // Deliberately omit queries, cookies, request bodies and arbitrary header values.
    await fs.appendFile(logFile, JSON.stringify({ at: new Date().toISOString(), method: ['GET', 'POST', 'HEAD'].includes(req.method) ? req.method : '[other]', path: safePath.length <= 240 ? safePath : '[oversize]', scenario: session?.scenario || null, companyId: session?.companyId || null, status: res.headersSent ? res.statusCode : 'pending' }) + '\n').catch(() => {});
  }
});
server.listen(port, host, () => console.log(JSON.stringify({ origin, web, logFile, scenarios: Object.keys(scenarios), syntheticOnly: true })));
