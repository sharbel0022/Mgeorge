import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBridge } from './bridge.js';

const invalid = () => Object.assign(new Error('INVALID_CONFIGURATION'), { code: 'INVALID_CONFIGURATION' });
async function readPrivate(path, limit) {
  if (typeof path !== 'string' || resolve(path) !== path || await realpath(path) !== path) throw invalid();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > limit) throw invalid();
    const bytes = await file.readFile();
    if (bytes.length !== info.size) throw invalid();
    return bytes;
  } finally { await file.close(); }
}
export async function loadConfiguration(environment = process.env) {
  try {
    const c = JSON.parse((await readPrivate(environment.BANKGIRO_BRIDGE_CONFIG, 65536)).toString());
    if (!c || typeof c !== 'object' || !c.sftp || ['bearerToken', 'password', 'privateKey', 'passphrase'].some(key => key in c || key in c.sftp)) throw invalid();
    const tokenFile = environment.BANKGIRO_BRIDGE_BEARER_TOKEN_FILE;
    const tokenEnv = environment.BANKGIRO_BRIDGE_BEARER_TOKEN;
    if (Boolean(tokenFile) === Boolean(tokenEnv)) throw invalid();
    c.bearerToken = tokenFile ? (await readPrivate(tokenFile, 1024)).toString().replace(/\r?\n$/, '') : tokenEnv;
    const password = environment.BANKGIRO_BRIDGE_SFTP_PASSWORD;
    if (Boolean(password) === Boolean(c.sftp.privateKeyFile)) throw invalid();
    if (password) c.sftp.password = password;
    else { c.sftp.privateKey = await readPrivate(c.sftp.privateKeyFile, 65536); c.sftp.passphrase = environment.BANKGIRO_BRIDGE_SFTP_PASSPHRASE; }
    c.pollIntervalMs ??= 60000;
    c.http ??= {}; c.http.port ??= 8788;
    if ((c.http.host != null && c.http.host !== '127.0.0.1') || !Number.isInteger(c.http.port) || c.http.port < 0 || c.http.port > 65535 || !Number.isInteger(c.pollIntervalMs) || c.pollIntervalMs < 30000 || c.pollIntervalMs > 240000) throw invalid();
    return c;
  } catch { throw invalid(); }
}

export async function main() {
  const c = await loadConfiguration();
  const bridge = await createBridge(c);
  const controller = new AbortController();
  let timer; let stopped = false; let server; let stopping;
  const log = code => process.stderr.write(JSON.stringify({ code }) + '\n');
  const scan = async () => {
    try { await bridge.syncOnce({ signal: controller.signal }); }
    catch (error) { if (!stopped) log(['HOST_IDENTITY_FAILED', 'AUTHORIZATION_BLOCKED'].includes(error.code) ? error.code : 'SOURCE_UNAVAILABLE'); }
  };
  const stop = () => {
    if (stopping) return stopping;
    stopped = true; clearTimeout(timer); controller.abort();
    stopping = bridge.close();
    return stopping;
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  if (c.enabled) await scan();
  if (stopped) return;
  server = bridge.createHttpServer();
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(c.http.port, '127.0.0.1', ready); }).catch(async () => { await stop(); throw invalid(); });
  process.stdout.write(JSON.stringify({ code: 'BRIDGE_READY', host: '127.0.0.1', port: server.address().port }) + '\n');
  const tick = async () => {
    if (stopped) return;
    if (c.enabled) await scan();
    if (!stopped) timer = setTimeout(tick, c.pollIntervalMs);
  };
  timer = setTimeout(tick, c.pollIntervalMs);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write(JSON.stringify({ code: 'BRIDGE_START_FAILED' }) + '\n'); process.exitCode = 1; });
}
