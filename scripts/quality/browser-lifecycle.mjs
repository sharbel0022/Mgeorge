const requiredAssets = ['index.html', 'app.js', 'app.css'];

export function browserAssetsComplete(checks) {
  return Array.isArray(checks)
    && checks.every(item => item.match === true)
    && requiredAssets.every(path => checks.some(item => item.path === path && item.match === true));
}

async function bounded(action, timeoutMs, label) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const exited = server => server.exitCode !== null || server.signalCode !== null;
function signalAndWait(server, signal, timeoutMs) {
  if (exited(server)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.removeListener('exit', onExit);
      server.removeListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error(`${signal} timed out after ${timeoutMs} ms`)), timeoutMs);
    server.once('exit', onExit);
    server.once('error', onError);
    try {
      if (!server.kill(signal) && !exited(server)) finish(new Error(`${signal} could not be delivered`));
      else if (exited(server)) finish();
    } catch (error) {
      finish(error);
    }
  });
}

// Cleanup failures must make the receipt red, without preventing subsequent
// resources from being closed or preventing the receipt from being written.
export async function closeBrowserResources({ browser, server, browserTimeoutMs = 5000, termTimeoutMs = 2000, killTimeoutMs = 2000 }) {
  const failures = [];
  if (browser) {
    try { await bounded(() => browser.close(), browserTimeoutMs, 'Browser close'); }
    catch (error) { failures.push(`Browser cleanup failed: ${String(error).slice(0, 1000)}`); }
  }
  if (server && !exited(server)) {
    try { await signalAndWait(server, 'SIGTERM', termTimeoutMs); }
    catch (error) { failures.push(`Synthetic server SIGTERM cleanup failed: ${String(error).slice(0, 1000)}`); }
    if (!exited(server)) {
      try { await signalAndWait(server, 'SIGKILL', killTimeoutMs); }
      catch (error) { failures.push(`Synthetic server SIGKILL cleanup failed: ${String(error).slice(0, 1000)}`); }
    }
  }
  return failures;
}
