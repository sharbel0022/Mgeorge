import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.join(process.env.MGEORGE_ONBOARDING_QA || path.join(tmpdir(), 'mgeorge-saas-onboarding-qa'), 'web');
const port = 5178;
export async function startServer() {
 const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method !== 'GET' || pathname.startsWith('/api/')) { res.writeHead(403); res.end('Synthetic API interception required'); return; }
  const asset = pathname === '/app.js' ? 'app.js' : pathname === '/app.css' ? 'app.css' : 'index.html';
  try { res.writeHead(200, { 'Content-Type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' }); res.end(await fs.readFile(path.join(root, asset))); }
  catch { res.writeHead(404); res.end(); }
 });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
 return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await startServer();
