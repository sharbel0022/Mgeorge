import { existsSync, readFileSync, writeFileSync, realpathSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import util from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import http from 'node:http';
export const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
export const runtime = join(root, '.runtime');
export const stateFile = join(runtime, 'launcher.json');
export const controlPort = 40000 + createHash('sha256').update(root).digest().readUInt32BE(0) % 20000;
export function versions() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) throw Error('Node.js 22.13 eller senare krävs. Installera Node 22 eller 24 LTS.');
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (npm.status !== 0 || !/^\d+\.\d+\.\d+/.test(npm.stdout.trim()) || Number(npm.stdout.trim().split('.')[0]) < 10) throw Error('npm 10 eller senare krävs tillsammans med Node.js.');
  return {
    node: process.versions.node,
    npm: npm.stdout.trim()
  };
}
export function environment() {
  return {
    ...(existsSync(join(root, '.env')) ? util.parseEnv(readFileSync(join(root, '.env'), 'utf8')) : {}),
    ...process.env
  };
}
export function configuration(env = environment()) {
  for (const k of ['SESSION_SECRET']) if (!/^[a-f0-9]{64}$/i.test(env[k] || '')) throw Error(`${k} måste vara 64 hextecken. Återställ .env; befintliga nycklar ersätts aldrig automatiskt.`);
  const key = env.ENCRYPTION_KEY || env.BANK_DATA_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || '') || env.ENCRYPTION_KEY && env.BANK_DATA_KEY && env.ENCRYPTION_KEY !== env.BANK_DATA_KEY) throw Error('Återställ ursprunglig BANK_DATA_KEY / ENCRYPTION_KEY i .env. Ingen ny krypteringsnyckel har skapats.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT måste vara ett heltal mellan 1 och 65535.');
  const origin = env.APP_ORIGIN || `http://localhost:${port}`;
  const u = new URL(origin);
  if (u.origin !== origin.replace(/\/$/, '') || !['http:', 'https:'].includes(u.protocol) || u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw Error('APP_ORIGIN måste vara en giltig HTTPS-origin eller lokal HTTP-origin.');
  if (Number(u.port || (u.protocol === 'https:' ? 443 : 80)) !== port && u.protocol === 'http:') throw Error(`APP_ORIGIN och PORT måste använda samma lokala port. Ange APP_ORIGIN=http://localhost:${port}.`);
  return {
    port,
    origin: origin.replace(/\/$/, ''),
    db: resolve(root, env.DB_PATH || 'data/mgeorge.sqlite')
  };
}
// dotenv quoting is deliberately verified against Node's actual parser. It is
// not JSON escaping: double quotes interpret backslash-n and embedded quotes.
function dotenvValue(name,value){
  for(const quote of ["'",'`','"','']){
    if(quote&&value.includes(quote))continue;
    const candidate=quote+value+quote;
    const parsed=util.parseEnv(name+'='+candidate+'\n');
    if(Object.keys(parsed).length===1&&parsed[name]===value)return candidate;
  }
  throw Error(`${name} kan inte sparas exakt i dotenv-format. Välj en sökväg utan kontrolltecken. Ingen fil har ändrats.`);
}
export function setupConfiguration() {
  if (existsSync(join(root, '.env'))) {
    configuration();
    console.log('.env finns redan och har behållits.');
    return;
  }
  const db = resolve(root, process.env.DB_PATH || 'data/mgeorge.sqlite');
  const defaultDb = join(root, 'data/mgeorge.sqlite');
  const companyFolders = [resolve(root, process.env.MG_COMPANY_DIRECTORY || join(dirname(db), 'companies')), join(root, 'data/companies')];
  const companyData = companyFolders.some(folder => existsSync(folder) && readdirSync(folder).some(name => /\.sqlite(?:-wal|-shm)?$/.test(name)));
  if (companyData || [db, db + '-wal', db + '-shm', defaultDb, defaultDb + '-wal', defaultDb + '-shm'].some(existsSync)) throw Error('En befintlig databas finns. Återställ ursprunglig .env och BANK_DATA_KEY från din privata säkerhetskopia. Ingen fil har ändrats.');
  if (process.env.BANK_DATA_KEY && process.env.ENCRYPTION_KEY && process.env.BANK_DATA_KEY !== process.env.ENCRYPTION_KEY) throw Error('Motstridiga BANK_DATA_KEY och ENCRYPTION_KEY. Ingen fil har ändrats.');
  const keys = {
    SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
    BANK_DATA_KEY: process.env.ENCRYPTION_KEY || process.env.BANK_DATA_KEY || randomBytes(32).toString('hex')
  };
  configuration({
    ...process.env,
    ...keys,
    APP_ORIGIN: process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`
  });
  let text = readFileSync(join(root, '.env.example'), 'utf8');
  for (const name of ['SESSION_SECRET', 'BANK_DATA_KEY']) {
    if (!new RegExp(`^${name}=.*$`, 'm').test(text)) throw Error(`Miljömallen saknar ${name}`);
    text = text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${keys[name]}`);
  }
  if (process.env.APP_ORIGIN) text = text.replace(/^APP_ORIGIN=.*$/m, `APP_ORIGIN=${process.env.APP_ORIGIN}`);
  if (process.env.PORT && !process.env.APP_ORIGIN) text = text.replace(/^APP_ORIGIN=.*$/m, `APP_ORIGIN=http://localhost:${process.env.PORT}`);
  if (process.env.PORT) text = text.replace(/^PORT=.*$/m, `PORT=${process.env.PORT}`);
  if (process.env.DB_PATH) text = text.replace(/^DB_PATH=.*$/m,()=>`DB_PATH=${dotenvValue('DB_PATH',process.env.DB_PATH)}`);
  writeFileSync(join(root, '.env'), text, {
    flag: 'wx',
    mode: 0o600
  });
  configuration();
  console.log('Säker lokal .env skapad. Spara en privat säkerhetskopia av krypteringsnyckeln.');
}
export function dependenciesPresent(directory = root) {
  const require = createRequire(join(directory, 'package.json'));
  const p = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  try {
    for (const dependency of Object.keys(p.dependencies || {})) require.resolve(dependency);
    return true;
  } catch {
    return false;
  }
}
export async function npm(args, directory = root, {signal} = {}) {
  signal?.throwIfAborted();
  const cli = process.env.npm_execpath;
  const child = cli ? spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    stdio: 'inherit'
  }) : spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: directory,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  let force;
  const interrupt = () => {
    if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');
    force??=setTimeout(()=>child.kill('SIGKILL'),1500);
    force.unref();
  };
  signal?.addEventListener('abort',interrupt,{once:true});
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await new Promise((yes, no) => {
      let spawnError;
      child.once('error',error=>spawnError=error);
      child.once('close',(code,exitSignal)=>{
        if(signal?.aborted)return no(Error('Installationen avbröts.'));
        if(spawnError)return no(spawnError);
        code===0?yes():no(Error(`npm ${args.join(' ')} misslyckades (${exitSignal||code}). Kontrollera nätverk och npm-konfiguration; försök igen.`));
      });
    });
  } finally {
    clearTimeout(force);
    signal?.removeEventListener('abort',interrupt);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
export async function install({signal}={}) {
  signal?.throwIfAborted();
  if (dependenciesPresent()) return;
  console.log('Installerar låsta lokala beroenden med npm ci …');
  await npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'],root,{signal});
  if (!dependenciesPresent()) throw Error('Lokala beroenden saknas efter npm ci. Kör npm run doctor.');
}
export async function available(port) {
  await new Promise((yes, no) => {
    const s = net.createServer();
    s.once('error', () => no(Error(`Backend/frontend: port ${port} är upptagen eller otillgänglig. Stoppa din tidigare start med npm run stop eller välj PORT och APP_ORIGIN i .env (t.ex. 3100 och http://localhost:3100).`)));
    s.listen(port, '127.0.0.1', () => s.close(yes));
  });
}
export function request(options,{timeoutMs=800}={}) {
  return new Promise((yes,no)=>{
    let req,response,deadline,settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(deadline);
      if(error){response?.destroy();req?.destroy();no(error);}else yes(value);
    };
    req=http.request(options,res=>{
      response=res;const chunks=[];let bytes=0;
      res.once('aborted',()=>finish(Error('Beredskapssvaret avbröts.')));
      res.once('error',error=>finish(error));
      res.once('close',()=>{if(!res.complete)finish(Error('Beredskapssvaret stängdes för tidigt.'));});
      res.on('data',chunk=>{
        bytes+=chunk.length;
        if(bytes>8192)return finish(Error('För stort beredskapssvar'));
        chunks.push(chunk);
      });
      res.once('end',()=>{
        if(!res.complete)return finish(Error('Ofullständigt beredskapssvar.'));
        try{finish(null,{status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
        catch{finish(Error('Ogiltigt beredskapssvar'));}
      });
    });
    req.once('error',error=>finish(error));
    deadline=setTimeout(()=>finish(Error('Tidsgräns för beredskap')),timeoutMs);
    req.end();
  });
}
export function prepareRuntime() {
  mkdirSync(runtime, {
    recursive: true,
    mode: 0o700
  });
  chmodSync(runtime, 0o700);
}
export async function optionalStatus(env = environment()) {
  let ai = 'avstängd (lokal OCR används)';
  const entry = join(root, 'packages/ai/index.js');
  if (existsSync(entry)) {
    const module = await import(entry);
    if (module.invoiceAiConfigurationStatus) {
      const status = module.invoiceAiConfigurationStatus(env);
      ai = `${status.status} (${status.code}); lokal konfiguration, ingen leverantörsverifiering`;
    }
  } else if (env.OPENAI_INVOICES_ENABLED === 'true') ai = 'kräver verifierad konfiguration och godkännanden; lokal OCR tillgänglig';
  console.log(`OpenAI: ${ai}`);
  console.log(`Gmail: ${env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? 'OAuth konfigurerad; anslutning kontrolleras i appen' : 'ej konfigurerad (valfri)'}`);
  console.log(`Bank: ${env.ENABLE_BANKING_APPLICATION_ID || env.ENABLEBANKING_APP_ID ? 'konfiguration finns; medgivande kontrolleras i appen' : 'ej konfigurerad (valfri)'}`);
  console.log(`Bankgiro: ${env.BANKGIRO_SOURCE_CONFIG ? 'källa konfigurerad; verifieras vid import' : 'källa saknas (valfri)'}`);
}
