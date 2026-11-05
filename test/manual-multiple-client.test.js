import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {registerManualClientCases} from './helpers/manual-multiple-client-cases.mjs';
const context=vm.createContext({Intl,Date,structuredClone,URLSearchParams});
vm.runInContext(readFileSync(new URL('../public/manual-multiple-client.js',import.meta.url),'utf8'),context);
const client=vm.runInContext('manualMultipleClient',context);
registerManualClientCases(test,client,'Node client');
test('the classic adapter executes the exact shared client implementation',()=>{
 const source=readFileSync(new URL('../sites/lib/manual-multiple-client.js',import.meta.url),'utf8').replace(/^export /gm,'');
 assert.equal(readFileSync(new URL('../public/manual-multiple-client.js',import.meta.url),'utf8'),`// Classic adapter; shared behavior is verified against the Sites module.\nconst manualMultipleClient = (() => {\n${source}\nreturn {createManualMultipleClient,parseManualAmount,manualMoney,manualMultipleTransport,validManualDiscovery,validManualQuote,validManualReceipt};\n})();\n`);
});
