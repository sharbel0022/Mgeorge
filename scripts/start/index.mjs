import { fork } from 'node:child_process';
import { watch, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { root, versions, setupConfiguration, configuration, environment, install, available, request, optionalStatus } from './common.mjs';
import { claim } from './control.mjs';
let release,
  child,
  watcher,
  closing = false,
  restarting = false,
  restartTimer;
let activeExit,installation;
const installerController=new AbortController();
async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const current = child;
  const exited = activeExit;
  try {
    if (current.connected) current.send('shutdown');else current.kill('SIGTERM');
  } catch {}
  const force = setTimeout(() => current.kill('SIGKILL'), 7000);
  force.unref();
  await exited;
  clearTimeout(force);
}
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(restartTimer);
  for (const entry of watcher || []) entry.close();
  installerController.abort();
  await installation?.catch(()=>{});
  await stopChild();
  await release?.();
  process.exitCode = code;
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
async function launch() {
  const env = environment(),
    config = configuration(env);
  await available(config.port);
  const token = randomBytes(32).toString('hex');
  child = fork(join(root, 'apps/api/index.js'), [], {
    cwd: root,
    execArgv: [],
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: {
      ...env,
      NODE_ENV: 'development',
      APP_ORIGIN: config.origin,
      MG_LAUNCH_TOKEN: token,
      MG_LAUNCH_MANAGED: '1'
    }
  });
  let exit;
  activeExit = new Promise(r => exit = r);
  const current = child;
  current.once('exit', (code, signal) => {
    exit();
    if (!closing && !restarting) {
      console.error(`Backend avslutades (${signal || code}).`);
      void shutdown(code || 1);
    }
  });
  current.once('error', error => {
    console.error(`Backend kunde inte starta: ${error.message}`);
    void shutdown(1);
  });
  const timeout = Math.min(60000, Math.max(500, Number(env.MG_START_TIMEOUT_MS) || 20000));
  const end = Date.now() + timeout;
  while (Date.now() < end && !closing) {
    if (current.exitCode !== null || current.signalCode !== null) throw Error('Backend avslutades före beredskap.');
    try {
      const health = await request({
        hostname: '127.0.0.1',
        port: config.port,
        path: '/api/health',
        headers: {
          host: new URL(config.origin).host,
          'x-mg-launch-token': token
        }
      },{timeoutMs:Math.max(1,Math.min(800,end-Date.now()))});
      if (health.status === 200 && health.body.ok === true && health.body.app === 'Mgeorge Fakturakoll' && health.body.launchToken === token) {
        await optionalStatus(env);
        console.log(`Redo: ${config.origin} — backend, frontend och dokumentarbetare tillgängliga.`);
        console.log('Dokumentarbetare startas vid behov. Avsluta med Ctrl+C eller npm run stop.');
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r,Math.max(0,Math.min(100,end-Date.now()))));
  }
  if (!closing) throw Error(`Backend nådde inte autentiserad HTTP-beredskap inom ${timeout} ms. Kör npm run doctor.`);
}
try {
  const v = versions();
  console.log(`MG Fakturakoll — Node ${v.node}, npm ${v.npm}`);
  release = await claim(() => {
    void shutdown();
  });
  setupConfiguration();
  installation=install({signal:installerController.signal});
  await installation;
  if (!closing) await launch();
  if (!closing && process.argv.includes('--dev')) {
    watcher = ['src', 'apps', 'packages', 'sites/lib'].filter(directory => existsSync(join(root, directory))).map(directory => watch(join(root, directory), {
      recursive: true
    }, () => {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(async () => {
        if (closing || restarting) return;
        restarting = true;
        console.log('Källkod ändrad; startar om …');
        try {
          await stopChild();
          if (!closing) await launch();
        } catch (e) {
          console.error(e.message);
          await shutdown(1);
        } finally {
          restarting = false;
        }
      }, 200);
    }));
    console.log('Utvecklingsläge: bevakar backend och delade moduler.');
  }
} catch (error) {
  if(!closing){console.error(error.message);await shutdown(1);}
}
