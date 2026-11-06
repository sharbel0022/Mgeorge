import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(new URL('./worktree/sites/package.json',import.meta.url));
const ts=require('typescript');
const baseUrl=new URL('./worktree/sites/tests/banking-security.test.mjs',import.meta.url).href;
const original=readFileSync(new URL('./original/banking-security.test.mjs',import.meta.url),'utf8');
const loader=original.slice(original.indexOf('function compiledModule('),original.indexOf('\nclass LocalD1')).replaceAll('import.meta.url','baseUrl');
const graph=original.slice(original.indexOf('  const cloudflare = jsUrl'),original.indexOf('  f.server = await import')).replaceAll('import.meta.url','baseUrl');
const build=new Function('ts','source','jsUrl','baseUrl','key','actualProvider',loader+'\n'+graph+"\nconst mcpUrl=compiledModule('../lib/banking/mcp.ts',{'./service':serviceUrl});return {cloudflare,auth,serverUrl,normalizerUrl,storeUrl,providerUrl,readGuardUrl,openPaymentsSchedulerUrl,serviceUrl,mcpUrl};");
function measure(mode){
 const modules=new Map();
 const jsUrl=value=>{
  const result=mode==='data'?'data:text/javascript;base64,'+Buffer.from(value).toString('base64'):'file:///tmp/mg-bank-security-measurement/'+createHash('sha256').update(value).digest('hex')+'.mjs';
  modules.set(result,{sourceBytes:Buffer.byteLength(value),specifierBytes:Buffer.byteLength(result)});return result;
 };
 const refs=build(ts,path=>readFileSync(new URL(path,baseUrl),'utf8'),jsUrl,baseUrl,'__mgBankTest_00000000000000000000000000000000',false);
 return {mode,moduleCount:modules.size,totalUniqueSourceBytes:[...modules.values()].reduce((n,v)=>n+v.sourceBytes,0),totalModuleSpecifierBytes:[...modules.values()].reduce((n,v)=>n+v.specifierBytes,0),modules:Object.fromEntries(Object.entries(refs).map(([name,url])=>[name,modules.get(url)]))};
}
const result={baseline:'d294fd87b04d1bf65b124be5ad3dd1bd2654fd73',purpose:'Compile only; no fixture, imports of generated modules, test execution, bank or network calls.',node:process.version,results:[measure('data'),measure('file')]};
writeFileSync(new URL('./module-graph-measurement.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
for(const row of result.results)console.log(JSON.stringify(row));
