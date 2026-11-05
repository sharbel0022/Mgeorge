import {existsSync} from 'node:fs';
import {registerManualMultipleCases} from './helpers/manual-multiple-allocation-cases.mjs';
const target=new URL('../sites/lib/manual-multiple-allocation.js',import.meta.url);
registerManualMultipleCases('Node manual vector',existsSync(target)?await import(target):{});
