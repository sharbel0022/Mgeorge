import {existsSync} from 'node:fs';
import {registerManualMultipleCases} from '../../test/helpers/manual-multiple-allocation-cases.mjs';
const target=new URL('../lib/manual-multiple-allocation.js',import.meta.url);
registerManualMultipleCases('Sites manual vector',existsSync(target)?await import(target):{});
