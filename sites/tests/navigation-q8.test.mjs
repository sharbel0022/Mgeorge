import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

function componentModule(){
 let code=ts.transpileModule(readFileSync(new URL('../components/workspace-navigation.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const name of ['react','react/jsx-runtime','lucide-react'])for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(import.meta.resolve(name)));
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const base={view:'bank',reviewCount:4,company:{name:'Syntetiskt Företag AB',email:'demo@example.test'},open:false,onNavigate(){throw Error('Rendering may not navigate');},onClose(){throw Error('Rendering may not close');}};

test('desktop navigation identifies the current area without relying on color',async()=>{
 const ui=await componentModule(),html=render(ui.default,base);
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 assert.match(html,/<button[^>]*aria-current="page"[^>]*>[\s\S]*?<span>Bank<\/span>/);
 assert.match(html,/<nav aria-label="Huvudmeny">/);
 assert.doesNotMatch(html,/<dialog/);
});
test('nested document and history views retain their parent navigation context',async()=>{
 const ui=await componentModule();
 for(const [view,label]of [['documents','Behöver granskas'],['messages','Behöver granskas'],['history','Inställningar'],['contacts','Kundfakturor']]){
  const html=render(ui.default,{...base,view});
  const current=html.match(/<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/g)||[];
  assert.equal(current.length,1);assert.ok(current[0].includes(label),view);
 }
});
test('mobile trigger exposes a controlled dialog and its expanded state',async()=>{
 const ui=await componentModule();
 for(const open of [false,true]){
  const html=render(ui.MobileMenuButton,{open,onClick(){}});
  assert.match(html,/aria-controls="workspace-mobile-navigation"/);
  assert.match(html,/aria-haspopup="dialog"/);
  assert.ok(html.includes(`aria-expanded="${open}"`));
  assert.match(html,/aria-label="Öppna menyn"/);
 }
});
test('opened mobile navigation is a labelled dialog with an explicit close control',async()=>{
 const ui=await componentModule(),html=render(ui.default,{...base,open:true});
 assert.match(html,/<dialog[^>]*id="workspace-mobile-navigation"[^>]*aria-label="Huvudmeny"[^>]*aria-modal="true"/);
 assert.match(html,/aria-label="Stäng menyn"/);
 assert.equal((html.match(/<dialog/g)||[]).length,1);
});
test('navigation escapes company data and reports review counts without exposing document content',async()=>{
 const ui=await componentModule(),html=render(ui.default,{...base,view:'review',company:{name:'<script>unsafe</script>',email:'<img src=x>'}});
 assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(html,/<script|<img/);
 assert.match(html,/aria-label="4 ärenden att granska"/);
});

function keyboardEvent({key='Tab',shiftKey=false,ctrlKey=false,at='last'}={}){
 let focused=null,prevented=false;
 const button=name=>({tabIndex:0,getClientRects:()=>[{}],focus(){focused=name;}});
 const first=button('close'),middle=button('overview'),last=button('imports');
 const hidden={...button('hidden'),getClientRects:()=>[]};
 const currentTarget={querySelectorAll:()=>[first,middle,last,hidden],ownerDocument:{activeElement:{first,middle,last}[at]}};
 return {event:{key,shiftKey,ctrlKey,altKey:false,metaKey:false,currentTarget,preventDefault(){prevented=true;}},result:()=>({focused,prevented})};
}
test('Tab on the final mobile menu control returns focus to the close button',async()=>{
 const ui=await componentModule(),input=keyboardEvent();
 ui.retainMobileNavigationFocus(input.event);
 assert.deepEqual(input.result(),{focused:'close',prevented:true});
});
test('Shift+Tab on the first mobile menu control returns focus to the final visible control',async()=>{
 const ui=await componentModule(),input=keyboardEvent({at:'first',shiftKey:true});
 ui.retainMobileNavigationFocus(input.event);
 assert.deepEqual(input.result(),{focused:'imports',prevented:true});
});
test('ordinary navigation within the mobile menu keeps native keyboard behavior',async()=>{
 const ui=await componentModule(),input=keyboardEvent({at:'middle'});
 ui.retainMobileNavigationFocus(input.event);
 assert.deepEqual(input.result(),{focused:null,prevented:false});
});
test('mobile menu does not capture browser shortcuts or non-Tab keys',async()=>{
 const ui=await componentModule();
 for(const options of [{key:'Escape'},{ctrlKey:true}]){
  const input=keyboardEvent(options);ui.retainMobileNavigationFocus(input.event);
  assert.deepEqual(input.result(),{focused:null,prevented:false});
 }
});
