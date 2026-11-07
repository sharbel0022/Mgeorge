import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createHash } from 'node:crypto';
const source = new URL('../', import.meta.url);
async function fixture(t, createRoot = () => mkdtempSync(join(tmpdir(), 'mg-launch-'))) {
  // A random checkout's hashed control port can overlap live TCP clients or
  // TIME_WAIT sockets. Select a usable root before any scenario starts; never
  // retry setup/start or change the production occupied-port refusal.
  let root;
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = createRoot();
    const port = 40000 + createHash('sha256').update(realpathSync(candidate)).digest().readUInt32BE(0) % 20000;
    const probe = net.createServer();
    const available = await new Promise((resolve, reject) => {
      probe.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (available) { root = candidate; break; }
    rmSync(candidate, { recursive: true, force: true });
  }
  assert.ok(root, 'no isolated lifecycle fixture control port available');
  t.after(() => rmSync(root, {
    recursive: true,
    force: true
  }));
  cpSync(new URL('scripts', source), join(root, 'scripts'), {
    recursive: true
  });
  cpSync(new URL('.env.example', source), join(root, '.env.example'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'apps/api'), {
    recursive: true
  });
  writeFileSync(join(root, 'apps/api/index.js'), "await import('../../src/server.js');\n");
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    type: 'module',
    dependencies: {
      'lifecycle-local': 'file:fixtures/local'
    },
    scripts: {
      start: 'node scripts/start/index.mjs',
      stop: 'node scripts/stop/index.mjs'
    }
  }));
  mkdirSync(join(root, 'fixtures/local'), {
    recursive: true
  });
  writeFileSync(join(root, 'fixtures/local/package.json'), JSON.stringify({
    name: 'lifecycle-local',
    version: '1.0.0',
    main: 'index.js'
  }));
  writeFileSync(join(root, 'fixtures/local/index.js'), 'module.exports=true;');
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    name: 'test',
    lockfileVersion: 3,
    packages: {
      '': {
        dependencies: {
          'lifecycle-local': 'file:fixtures/local'
        }
      },
      'fixtures/local': {
        name: 'lifecycle-local',
        version: '1.0.0'
      },
      'node_modules/lifecycle-local': {
        resolved: 'fixtures/local',
        link: true
      }
    }
  }));
  return root;
}
function run(root, script, extra = {}) {
  return spawnSync(process.execPath, [`scripts/${script}/index.mjs`], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      ...extra
    },
    encoding: 'utf8',
    timeout: 20000
  });
}
async function freePort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
function launch(t, root, extra = {}) {
  const p = spawn(process.execPath, ['scripts/start/index.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      ...extra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  p.stdout.on('data', v => output += v);
  p.stderr.on('data', v => output += v);
  const exited = new Promise(r => p.once('exit', (code, signal) => r({
    code,
    signal
  })));
  t.after(async () => {
    if (p.exitCode === null && p.signalCode === null) {
      p.kill('SIGTERM');
      await exited;
    }
  });
  return {
    p,
    exited,
    output: () => output,
    async ready() {
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        if (output.includes('Redo:')) return;
        if (p.exitCode !== null) throw Error(output);
        await new Promise(r => setTimeout(r, 40));
      }
      throw Error(output);
    }
  };
}
const fake = `import http from 'node:http';import {writeFileSync} from 'node:fs';const s=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({ok:true,app:'Mgeorge Fakturakoll',...(q.headers['x-mg-launch-token']===process.env.MG_LAUNCH_TOKEN?{launchToken:process.env.MG_LAUNCH_TOKEN}:{})}));});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('message',m=>{if(m==='shutdown')s.close(()=>process.exit(0));});process.on('disconnect',()=>process.exit(0));`;
test('fixture selects a fresh root before setup when a candidate control port is occupied', async t => {
  let occupiedRoot, port, outsider;
  // Arrange an actually occupied candidate without relying on a random port
  // being free. No setup/start scenario has run for any of these roots.
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = mkdtempSync(join(tmpdir(), 'mg-launch-occupied-'));
    const candidatePort = 40000 + createHash('sha256').update(realpathSync(candidate)).digest().readUInt32BE(0) % 20000;
    const listener = net.createServer(socket => socket.end('untouched'));
    const listening = await new Promise((resolve, reject) => {
      listener.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      listener.listen(candidatePort, '127.0.0.1', () => resolve(true));
    });
    if (listening) { occupiedRoot = candidate; port = candidatePort; outsider = listener; break; }
    rmSync(candidate, { recursive: true, force: true });
  }
  assert.ok(outsider, 'could not arrange an occupied candidate');
  t.after(() => rmSync(occupiedRoot, { recursive: true, force: true }));
  t.after(() => new Promise(resolve => outsider.close(resolve)));
  let first = true;
  const root = await fixture(t, () => {
    if (first) { first = false; return occupiedRoot; }
    return mkdtempSync(join(tmpdir(), 'mg-launch-'));
  });
  const result = run(root, 'setup', { DB_PATH: String.raw`C:\new\data.sqlite` });
  assert.equal(result.status, 0, result.stderr);
  const { parseEnv } = await import('node:util');
  assert.equal(parseEnv(readFileSync(join(root, '.env'), 'utf8')).DB_PATH, String.raw`C:\new\data.sqlite`);
  assert.notEqual(root, occupiedRoot, 'select a fresh root before starting the scenario');
  assert.equal(existsSync(join(occupiedRoot, '.env')), false);
  assert.equal(existsSync(join(occupiedRoot, '.runtime')), false);
  assert.equal(outsider.listening, true);
  const reply = await new Promise((resolve, reject) => {
    const client = net.connect(port, '127.0.0.1');
    client.once('error', reject);
    client.once('data', data => { resolve(data.toString()); client.destroy(); });
  });
  assert.equal(reply, 'untouched', 'fixture selection must preserve unrelated listeners');
});

test('setup creates private random keys once and respects overridden DB_PATH', async t => {
  const root = await fixture(t);
  let r = run(root, 'setup');
  assert.equal(r.status, 0, r.stderr);
  const env = readFileSync(join(root, '.env'), 'utf8');
  assert.match(env, /SESSION_SECRET=[a-f0-9]{64}/);
  assert.match(env, /BANK_DATA_KEY=[a-f0-9]{64}/);
  assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  r = run(root, 'setup');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), env);
  rmSync(join(root, '.env'));
  writeFileSync(join(root, 'existing.db'), 'synthetic');
  r = run(root, 'setup', {
    DB_PATH: 'existing.db'
  });
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(root, '.env')), false);
  assert.match(r.stderr, /BANK_DATA_KEY/);
});
test('setup refuses missing encryption key against existing database', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'existing.db'), 'synthetic');
  writeFileSync(join(root, '.env'), 'DB_PATH=existing.db\nSESSION_SECRET=' + 'a'.repeat(64) + '\n');
  const r = run(root, 'setup');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /BANK_DATA_KEY/);
  assert.doesNotMatch(readFileSync(join(root, '.env'), 'utf8'), /BANK_DATA_KEY=/);
});
test('launcher installs a clean locked fixture, reaches authenticated readiness and stops only its own checkout', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'src/server.js'), fake);
  const port = await freePort();
  const x = launch(t, root, {
    PORT: String(port)
  });
  await x.ready();
  assert.match(x.output(), /OpenAI/);
  assert.equal(existsSync(join(root, '.env')), true);
  assert.equal(existsSync(join(root, 'node_modules/lifecycle-local/index.js')), true);
  const other = await fixture(t);
  const stopOther = run(other, 'stop');
  assert.equal(stopOther.status, 0, stopOther.stderr);
  assert.equal(x.p.exitCode, null);
  const stopped = run(root, 'stop');
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal((await x.exited).code, 0);
  const y = launch(t, root, {
    PORT: String(port)
  });
  await y.ready();
  y.p.kill('SIGINT');
  assert.equal((await y.exited).code, 0);
});
test('occupied port is rejected without touching its listener', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'src/server.js'), fake);
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  t.after(() => s.close());
  const x = launch(t, root, {
    PORT: String(s.address().port)
  });
  assert.equal((await x.exited).code, 1);
  assert.match(x.output(), /upptagen/);
  assert.equal(s.listening, true);
});
test('readiness cannot be spoofed by an unrelated healthy server', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'src/server.js'), fake.replace("q.headers['x-mg-launch-token']===process.env.MG_LAUNCH_TOKEN", "false"));
  const x = launch(t, root, {
    PORT: String(await freePort()),
    MG_START_TIMEOUT_MS: '500'
  });
  assert.equal((await x.exited).code, 1);
  assert.match(x.output(), /beredskap/);
});
test('doctor diagnoses without creating configuration or installing dependencies', async t => {
  const root = await fixture(t);
  const r = run(root, 'doctor');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\.env/);
  assert.equal(existsSync(join(root, '.env')), false);
  assert.equal(existsSync(join(root, 'node_modules')), false);
});
test('dev reload stops the old server before reporting readiness again', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'src/server.js'), fake);
  const x = launch(t, root, {
    PORT: String(await freePort())
  });
  await x.ready();
  x.p.kill('SIGTERM');
  await x.exited;
  const devPort = await freePort();
  const p = spawn(process.execPath, ['scripts/start/index.mjs', '--dev'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      PORT: String(devPort),
      APP_ORIGIN: `http://localhost:${devPort}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  p.stdout.on('data', x => output += x);
  p.stderr.on('data', x => output += x);
  const exited = new Promise(r => p.once('exit', r));
  t.after(async () => {
    if (p.exitCode === null) {
      p.kill('SIGTERM');
      await exited;
    }
  });
  const wait = async condition => {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      if (condition()) return;
      await new Promise(r => setTimeout(r, 40));
    }
    throw Error(output);
  };
  await wait(() => output.includes('Utvecklingsläge:'));
  writeFileSync(join(root, 'src/server.js'), fake + '\n// changed\n');
  await wait(() => (output.match(/Redo:/g) || []).length === 2);
  p.kill('SIGINT');
  await exited;
});
test('an unauthenticated control request cannot stop a launcher', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'src/server.js'), fake);
  const x = launch(t, root, {
    PORT: String(await freePort())
  });
  await x.ready();
  const {
    createHash
  } = await import('node:crypto');
  const port = 40000 + createHash('sha256').update(root).digest().readUInt32BE(0) % 20000;
  const response = await fetch(`http://127.0.0.1:${port}/stop`, {
    method: 'POST',
    headers: {
      'x-mg-control-token': 'forged'
    }
  });
  assert.equal(response.status, 403);
  assert.equal(x.p.exitCode, null);
});
test('doctor fails when configured checkout lacks required dependencies', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, '.env'), `PORT=32001\nAPP_ORIGIN=http://localhost:32001\nSESSION_SECRET=${'a'.repeat(64)}\nBANK_DATA_KEY=${'b'.repeat(64)}\n`);
  const r = run(root, 'doctor');
  assert.equal(r.status, 1, r.stdout);
  assert.equal(existsSync(join(root, 'node_modules')), false);
});
test('an old package manager fails before configuration or dependency writes', async t => {
  if (process.platform === 'win32') return;
  const root = await fixture(t);
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/npm'), '#!/bin/sh\nprintf "9.9.0\\n"\n', {
    mode: 0o755
  });
  const r = run(root, 'start', {
    PATH: join(root, 'bin')
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm 10/);
  assert.equal(existsSync(join(root, '.env')), false);
  assert.equal(existsSync(join(root, 'node_modules')), false);
});
test('a second launcher cannot take ownership or replace configuration', async t => {
  const root = await fixture(t);
  writeFileSync(join(root, 'src/server.js'), fake);
  const x = launch(t, root, {
    PORT: String(await freePort())
  });
  await x.ready();
  const before = readFileSync(join(root, '.env'), 'utf8');
  const y = launch(t, root, {
    PORT: String(await freePort())
  });
  assert.equal((await y.exited).code, 1);
  assert.match(y.output(), /launcher/);
  assert.equal(x.p.exitCode, null);
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), before);
});
test('first setup persists supplied encryption and session keys instead of generating competing keys', async t => {
  const root = await fixture(t);
  const r = run(root, 'setup', {
    ENCRYPTION_KEY: 'e'.repeat(64),
    SESSION_SECRET: 'f'.repeat(64)
  });
  assert.equal(r.status, 0, r.stderr);
  const env = readFileSync(join(root, '.env'), 'utf8');
  assert.match(env, new RegExp(`BANK_DATA_KEY=${'e'.repeat(64)}`));
  assert.match(env, new RegExp(`SESSION_SECRET=${'f'.repeat(64)}`));
});
test('setup preserves orphaned company databases when the control database and .env are missing', async t => {
  const root = await fixture(t);
  mkdirSync(join(root, 'data/companies'), {
    recursive: true
  });
  writeFileSync(join(root, 'data/companies/synthetic.sqlite'), 'synthetic');
  const r = run(root, 'setup');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /BANK_DATA_KEY/);
  assert.equal(existsSync(join(root, '.env')), false);
});
test('conflicting supplied encryption keys fail without writing .env', async t => {
  const root = await fixture(t);
  const r = run(root, 'setup', {
    BANK_DATA_KEY: 'a'.repeat(64),
    ENCRYPTION_KEY: 'b'.repeat(64)
  });
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(root, '.env')), false);
});
test('authenticated stop cancels and awaits its installer before releasing checkout ownership',async t=>{
  const root=await fixture(t);writeFileSync(join(root,'src/server.js'),fake);
  const installer=join(root,'slow-npm.mjs');
  writeFileSync(installer,`import {writeFileSync} from 'node:fs';writeFileSync('installer.started','yes');const timer=setInterval(()=>{},100);process.once('SIGTERM',()=>{writeFileSync('installer.terminating','yes');setTimeout(()=>{writeFileSync('installer.stopped','yes');clearInterval(timer);},700);});`);
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>unrelated.kill('SIGTERM'));
  const x=launch(t,root,{PORT:String(await freePort()),npm_execpath:installer});
  const wait=async predicate=>{const end=Date.now()+4000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,30));}assert.fail('owned installer lifecycle did not reach expected state: '+x.output());};
  await wait(()=>existsSync(join(root,'installer.started')));
  const stop=spawn(process.execPath,['scripts/stop/index.mjs'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},stdio:'ignore'});
  const stopped=new Promise(r=>stop.once('exit',code=>r(code)));t.after(()=>stop.kill('SIGTERM'));
  await wait(()=>existsSync(join(root,'installer.terminating')));
  assert.equal(existsSync(join(root,'.runtime/launcher.json')),true,'ownership must survive until npm has exited');
  const competing=run(root,'start',{PORT:String(await freePort()),npm_execpath:installer});assert.equal(competing.status,1);assert.match(competing.stderr,/launcher/);
  assert.equal(await stopped,0);assert.equal((await x.exited).code,0);assert.equal(existsSync(join(root,'installer.stopped')),true);
  assert.equal(unrelated.exitCode,null,'unrelated process must survive');assert.equal(existsSync(join(root,'.runtime/launcher.json')),false);
});
test('readiness deadline terminates a backend with a continuously dripping health response',async t=>{const root=await fixture(t);writeFileSync(join(root,'src/server.js'),`import http from 'node:http';const s=http.createServer((q,r)=>{r.write('{');const tick=setInterval(()=>r.write(' '),30);r.once('close',()=>clearInterval(tick));});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('message',m=>{if(m==='shutdown')s.close(()=>process.exit(0));});process.on('disconnect',()=>process.exit(0));`);const x=launch(t,root,{PORT:String(await freePort()),MG_START_TIMEOUT_MS:'500'});let timer;const result=await Promise.race([x.exited,new Promise(r=>timer=setTimeout(()=>r({hung:true}),3500))]);clearTimeout(timer);assert.equal(result.code,1,'dripping health must not keep launcher alive past its readiness budget');assert.match(x.output(),/beredskap/);});
test('stop control requests have an absolute deadline even when a listener drips bytes',async t=>{const root=await fixture(t);const {createHash}=await import('node:crypto');const {default:http}=await import('node:http');const port=40000+createHash('sha256').update(root).digest().readUInt32BE(0)%20000;mkdirSync(join(root,'.runtime'));writeFileSync(join(root,'.runtime/launcher.json'),JSON.stringify({root,token:'a'.repeat(64)}));const s=http.createServer((q,r)=>{r.write('{');const tick=setInterval(()=>r.write(' '),30);r.once('close',()=>clearInterval(tick));});await new Promise(r=>s.listen(port,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});const stop=spawn(process.execPath,['scripts/stop/index.mjs'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},stdio:'ignore'});t.after(()=>stop.kill('SIGTERM'));let timer;const result=await Promise.race([new Promise(r=>stop.once('exit',code=>r({code}))),new Promise(r=>timer=setTimeout(()=>r({hung:true}),2000))]);clearTimeout(timer);assert.equal(result.code,1,'dripping control endpoint must not hold stop forever');assert.equal(s.listening,true,'unrelated listener must remain running');});
test('first setup exactly roundtrips dotenv paths with backslashes, quotes and replacement characters',async t=>{const {parseEnv}=await import('node:util');for(const path of [String.raw`C:\new\data.sqlite`,String.raw`C:\quoted"directory\data.sqlite`,"folder/it's data.sqlite",'folder/$&quoted" data.sqlite']){const root=await fixture(t);const r=run(root,'setup',{DB_PATH:path});assert.equal(r.status,0,r.stderr);assert.equal(parseEnv(readFileSync(join(root,'.env'),'utf8')).DB_PATH,path,'persisted path must equal original bytes');}});
test('unsupported dotenv path representations fail before configuration writes',async t=>{const root=await fixture(t);const r=run(root,'setup',{DB_PATH:'\rbroken.sqlite'});assert.equal(r.status,1);assert.equal(existsSync(join(root,'.env')),false);assert.equal(existsSync(join(root,'node_modules')),false);});
