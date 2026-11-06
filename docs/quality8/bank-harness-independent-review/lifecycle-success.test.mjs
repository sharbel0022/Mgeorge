import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { jsUrl, moduleDirectory } from './loader-under-test.mjs';
console.log('OWN_TEMP_DIR='+moduleDirectory);
test('a late async import remains available through the last test',async()=>{
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(existsSync(moduleDirectory),true);
 const module=await import(jsUrl('export const answer=42;'));
 assert.equal(module.answer,42);
});
test('selected child completion mode',()=>{assert.equal(2+2,4);});
