import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { controlPort, stateFile, prepareRuntime, request, root } from './common.mjs';
export async function controlRequest(action) {
  if (!existsSync(stateFile)) return null;
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.root !== root || typeof state.token !== 'string') throw Error('Launcherinformationen tillhör inte denna checkout. Ingen process har stoppats.');
  return request({
    hostname: '127.0.0.1',
    port: controlPort,
    path: `/${action}`,
    method: action === 'stop' ? 'POST' : 'GET',
    headers: {
      'x-mg-control-token': state.token
    }
  });
}
export async function claim(onStop) {
  prepareRuntime();
  const token = randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    const supplied = String(req.headers['x-mg-control-token'] || '');
    const authorized = /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
    res.setHeader('content-type', 'application/json');
    if (!authorized) {
      res.writeHead(403);
      return res.end('{}');
    }
    if (req.url === '/status' && req.method === 'GET') return res.end(JSON.stringify({
      root,
      owned: true
    }));
    if (req.url === '/stop' && req.method === 'POST') {
      res.end(JSON.stringify({
        root,
        stopping: true
      }));
      setImmediate(onStop);
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  server.requestTimeout = 2000;
  server.headersTimeout = 3000;
  server.keepAliveTimeout = 500;
  await new Promise((yes, no) => {
    server.once('error', error => no(Error(error.code === 'EADDRINUSE' ? 'En launcher kör redan eller dess kontrollport är upptagen. Kör npm run stop i denna checkout; inga främmande processer stoppas.' : error.message)));
    server.listen(controlPort, '127.0.0.1', yes);
  });
  const pending = stateFile + '.' + token;
  try {
    writeFileSync(pending, JSON.stringify({
      root,
      token
    }), {
      flag: 'wx',
      mode: 0o600
    });
    renameSync(pending, stateFile);
  } catch (error) {
    try {
      unlinkSync(pending);
    } catch {}
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
  return async () => {
    await new Promise(r => {
      server.close(r);
      server.closeAllConnections();
    });
    try {
      if (JSON.parse(readFileSync(stateFile, 'utf8')).token === token) unlinkSync(stateFile);
    } catch {}
  };
}
