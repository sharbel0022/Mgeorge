import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ingestFixture} from './helpers/bankgiro-ingest-fixture.mjs';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(path,imports){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [from,to]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
async function fixture(t){
 const f=await ingestFixture(t);assert.ok(f.moduleUrls,'ingest fixture must expose the actual authenticated server and source service');
 const {server,service}=f.moduleUrls;
 const noAis=data(`export {failure as bankFailure} from ${JSON.stringify(server)};export async function automaticSync(){throw Error('AIS must not run')}export async function automaticSyncStatus(){throw Error('AIS must not run')}`);
 const rpc=compiled('../lib/banking/mcp.ts',{'./service':noAis,'../server':server,'../bankgiro-ingest-service':service});
 const route=await import(compiled('../app/mcp/route.ts',{'@/lib/banking/mcp':rpc}));
 t.mock.method(globalThis,'fetch',async()=>{throw Error('No network permitted in synthetic Bankgiro MCP tests');});
 f.call=async(name,args={},extra={})=>{
  const r=await route.POST(new Request('https://synthetic.example/mcp',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({jsonrpc:'2.0',id:1,method:name?'tools/call':'tools/list',...(name?{params:{name,arguments:args}}:{})})}));
  const text=await r.text();let body;try{body=JSON.parse(text);}catch{body={errorText:text};}
  return{response:r,body};
 };
 return f;
}

test('report tools advertise separate read status and idempotent bounded worker without source configuration',async t=>{
 const f=await fixture(t),{body}=await f.call();
 for(const name of ['bankgiro_source_status','bankgiro_auto_ingest']){
  const tool=body.result.tools.find(tool=>tool.name===name);assert.ok(tool,name);
  assert.deepEqual(tool.inputSchema.properties,{});assert.equal(tool.inputSchema.additionalProperties,false);
  assert.equal(tool.annotations.readOnlyHint,name==='bankgiro_source_status');
  if(name==='bankgiro_auto_ingest')assert.equal(tool.annotations.idempotentHint,true);
 }
});
test('actual report service stays disabled over MCP without reading or writing D1/R2',async t=>{
 const f=await fixture(t),before=f.read();
 f.env.DB={prepare(){throw Error('Disabled source may not access D1')},batch(){throw Error('Disabled source may not write D1')}};
 f.env.BUCKET={get(){throw Error('Disabled source may not read original')},put(){throw Error('Disabled source may not retain original')}};
 for(const name of ['bankgiro_source_status','bankgiro_auto_ingest']){
  const {body,response}=await f.call(name);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(body.result?.isError,undefined,JSON.stringify(body));
  assert.equal(body.result.structuredContent.enabled,false);assert.equal(body.result.structuredContent.state,'DISABLED');
  assert.equal(body.result.structuredContent.reason,'SOURCE_NOT_CONFIGURED');
 }
 assert.deepEqual(f.read(),before);
});
test('report MCP rejects unauthenticated calls and owner/source/force overrides',async t=>{
 const f=await fixture(t);
 for(const name of ['bankgiro_source_status','bankgiro_auto_ingest']){
  for(const args of [{owner:'foreign'},{sourceUrl:'https://untrusted.example'},{force:true},[]]){
   const {body}=await f.call(name,args);assert.equal(body.error?.code,-32602);
  }
 }
 f.user=null;
 for(const name of ['bankgiro_source_status','bankgiro_auto_ingest'])assert.equal((await f.call(name)).body.result?.isError,true);
});
test('report MCP rejects cross-origin requests before source or original operations',async t=>{
 const f=await fixture(t),before=f.read();
 const {response}=await f.call('bankgiro_auto_ingest',{}, {Origin:'https://untrusted.example'});
 assert.equal(response.status,403);assert.deepEqual(f.read(),before);
});
