import { versions, setupConfiguration, install } from '../start/common.mjs';
import { claim } from '../start/control.mjs';
let release;
const controller=new AbortController();
const interrupt=()=>controller.abort();
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try {
  versions();
  release = await claim(interrupt);
  setupConfiguration();
  await install({signal:controller.signal});
  console.log('Installation klar. Starta med npm start.');
} catch (error) {
  if(!controller.signal.aborted){console.error(error.message);process.exitCode=1;}
} finally {
  await release?.();
  process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
}
