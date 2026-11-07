import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { versions, root, configuration, dependenciesPresent, available, optionalStatus, environment } from '../start/common.mjs';
import { controlRequest } from '../start/control.mjs';
let failed = false;
try {
  const v = versions();
  console.log(`Node ${v.node}; npm ${v.npm}`);
} catch (e) {
  console.log(e.message);
  failed = true;
}
if (!dependenciesPresent()) failed = true;
console.log(`Beroenden: ${dependenciesPresent() ? 'tillgängliga' : 'saknas; npm start installerar med npm ci'}`);
if (!existsSync(join(root, '.env'))) {
  console.log('.env saknas; npm start skapar säker konfiguration för en ny installation.');
  failed = true;
}
try {
  const config = configuration();
  console.log(`Databas: ${config.db} (${existsSync(config.db) ? 'finns; innehåll har inte öppnats' : 'skapas icke-destruktivt vid start'})`);
  let owned;
  try {
    owned = await controlRequest('status');
  } catch {}
  if (owned?.body?.owned) console.log('Launcher: aktiv i denna checkout');else {
    await available(config.port);
    console.log(`Port ${config.port}: ledig (loopback)`);
  }
  console.log(`Adress: ${config.origin}`);
} catch (e) {
  console.log(e.message);
  failed = true;
}
await optionalStatus(environment());
process.exitCode = failed ? 1 : 0;
