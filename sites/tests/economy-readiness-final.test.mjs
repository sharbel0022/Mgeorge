import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState} from '../lib/domain.ts';

const file=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
  let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'@/lib/economy-summary.js':file('../lib/economy-summary.js'),...imports}))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(url));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const {default:Overview}=await import(compiled('../components/economy-overview.tsx',{'./payment-control':compiled('../components/payment-control.tsx')}));
const noAction=()=>{throw Error('Rendering must not start a control or navigate');};
function render(overrides={}){
  const state=emptyState(),before=JSON.stringify(state);
  const html=renderToStaticMarkup(React.createElement(Overview,{state,data:null,loading:false,error:'',demo:false,signedIn:false,busy:false,start:noAction,open:noAction,task:noAction,invoice:noAction,demoToggle:noAction,...overrides}));
  assert.equal(JSON.stringify(state),before);
  assert.equal((html.match(/<strong>—<\/strong>/g)||[]).length,4);
  return html;
}

test('an initial pending overview does not declare the user signed out before authentication resolves',()=>{
  const html=render({loading:true});
  assert.match(html,/class="economy-notice" role="status">Hämtar ekonomiöversikten/);
  assert.match(html,/Hämtar betalningar/);assert.match(html,/Hämtar fakturor/);
  assert.doesNotMatch(html,/Logga in för att se|Inga verifierade betalningskopplingar|Inga granskade öppna kundfakturor/);
});
test('a failed initial overview reports unavailable reads instead of inventing a signed-out result',()=>{
  const html=render({error:'Synthetic transport unavailable'});
  assert.match(html,/class="economy-notice" role="alert">Uppgifterna kunde inte uppdateras/);
  assert.match(html,/Uppgifterna om betalningar kunde inte hämtas/);assert.match(html,/Uppgifterna om fakturor kunde inte hämtas/);
  assert.doesNotMatch(html,/Logga in för att se|Hämtar ekonomiöversikten|Hämtar betalningar|Hämtar fakturor/);
});
test('a retried overview presents the active read instead of the previous error or unknown authentication',()=>{
  const html=render({loading:true,error:'Synthetic previous transport failure'});
  assert.match(html,/class="economy-notice" role="status">Hämtar ekonomiöversikten/);
  assert.match(html,/Hämtar betalningar/);assert.match(html,/Hämtar fakturor/);
  assert.doesNotMatch(html,/Logga in för att se|Uppgifterna om (?:betalningar|fakturor) kunde inte hämtas/);
});
test('a completed signed-out read keeps explicit sign-in guidance without pretending a read is active',()=>{
  const html=render();
  assert.match(html,/Logga in för att se företagets ekonomi/);assert.match(html,/Logga in för att se betalningar/);assert.match(html,/Logga in för att se fakturor/);
  assert.doesNotMatch(html,/Hämtar ekonomiöversikten|Hämtar betalningar|Hämtar fakturor|Uppgifterna kunde inte uppdateras/);
});
