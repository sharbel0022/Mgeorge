import { root } from '../start/common.mjs';
import { controlRequest } from '../start/control.mjs';
try {
  const result = await controlRequest('stop');
  if (!result) console.log('Ingen launcher kör i denna checkout.');else if (result.status !== 200 || !result.body.stopping || result.body.root !== root) throw Error('Launcher kunde inte autentiseras. Ingen process har stoppats.');else {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      await new Promise(r => setTimeout(r, 100));
      try {
        const state = await controlRequest('status');
        if (!state) break;
      } catch (error) {
        if (['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) break;
        throw error;
      }
      if (Date.now() + 100 >= end) throw Error('Stopp begärt men inte bekräftat inom tidsgränsen.');
    }
    console.log('MG Fakturakolls launcher har stoppats.');
  }
} catch (error) {
  if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) console.log('Ingen aktiv launcher hittades. Inga processer signalerades.');else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
