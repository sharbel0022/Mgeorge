import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const scratch = process.env.MGEORGE_QA_SCRATCH || path.join(tmpdir(), 'mgeorge-payment-ui-qa');
const root = path.join(scratch, 'web');
const port = Number(process.env.MGEORGE_QA_PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + port);
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'No API is available on the synthetic QA host; Playwright must intercept this request.' }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const resolved = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!resolved.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
  try {
    const content = await fs.readFile(resolved);
    res.writeHead(200, { 'content-type': types[path.extname(resolved)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log('Synthetic API-intercepted Dashboard host: http://127.0.0.1:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
