import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
const flush=async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
const tasks=()=>['First','Second','Third'].map((title,index)=>({id:'task-'+index,type:'document',entity_id:'synthetic-document-'+index,title:title+' document',reason:'Synthetic review',action:'Granska',priority:index}));

// Run the actual component/hooks against a small DOM model. Visibility follows
// the existing review CSS: below 901px either the list or detail is displayed.
// Native button activation is its focused click; hidden/removed focus falls to
// BODY before effects, matching root's Chromium reproduction. Browser QA remains
// separate; this harness asserts effects and DOM focus, never source patterns.
async function fixture(t,{width=390,inline=true}={}){
 const key='__review_focus_'+crypto.randomUUID().replaceAll('-',''),f={width,slots:[],cursor:0,effects:[],scheduled:false,closed:false,nodes:new Map(),queue:tasks(),opened:[],focusLog:[],listeners:new Set(),dialog:null};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
 f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return[f.slots[index].value,value=>{f.slots[index].value=typeof value==='function'?value(f.slots[index].value):value;f.schedule();}];};
 f.ref=initial=>{const index=f.cursor++;f.slots[index]??={current:initial};return f.slots[index];};
 f.callback=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.slots[index]={value:fn,deps};return f.slots[index].value;};
 f.effect=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:fn()};});};
 const browser=new EventTarget(),add=browser.addEventListener.bind(browser),remove=browser.removeEventListener.bind(browser);browser.addEventListener=(type,fn)=>{f.listeners.add(fn);add(type,fn);};browser.removeEventListener=(type,fn)=>{f.listeners.delete(fn);remove(type,fn);};
 const document={defaultView:browser,activeElement:null,querySelector:selector=>selector==='dialog[open]'?f.dialog:null};
 class Element{
  constructor(tag,props={}){this.tagName=tag.toUpperCase();this.props=props;this.children=[];this.isConnected=true;this.parentElement=null;this.ownerDocument=document;}
  [Symbol.for('nodejs.util.inspect.custom')](){return `<${this.tagName} ${this.props['aria-label']||this.className}>`;}
  get className(){return this.props.className||'';}
  get tabIndex(){return this.props.tabIndex??(['BUTTON','INPUT','SELECT'].includes(this.tagName)?0:-1);}
  contains(other){return this===other||this.children.some(child=>child.contains(other));}
  getClientRects(){
   if(!this.isConnected)return [];
   for(let node=this;node;node=node.parentElement){
    if(node.props.hidden)return [];
    if(f.width<=900&&node.className.split(' ').includes('review-list')&&node.parentElement?.className.includes('show-detail'))return [];
    if(f.width<=900&&node.className.split(' ').includes('review-detail')&&!node.parentElement?.className.includes('show-detail'))return [];
    if(f.width>900&&node.className.split(' ').includes('review-back'))return [];
   }
   return [{}];
  }
  focus(){if(!this.getClientRects().length)return;document.activeElement=this;f.focusLog.push(this);for(let node=this;node;node=node.parentElement)node.props.onFocusCapture?.({target:this,currentTarget:node});}
 }
 document.body=new Element('body');document.activeElement=document.body;f.document=document;f.outside=new Element('button',{'aria-label':'Outside review'});f.outside.focus();
 const previousWindow=globalThis.window,previousDocument=globalThis.document;globalThis.window=browser;globalThis.document=document;
 const react=data(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useCallback=(...a)=>f.callback(...a),useEffect=(...a)=>f.effect(...a);`);
 let code=ts.transpileModule(readFileSync(new URL('../components/payment-control.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,value]of Object.entries({react,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':url('../lib/domain.ts'),'@/lib/economy-summary.js':url('../lib/economy-summary.js')}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(value));
 const module=await import(data(code));
 const reference=(ref,value)=>{if(typeof ref==='function')ref(value);else if(ref)ref.current=value;};
 const lostFocus=()=>{if(!document.activeElement.getClientRects().length)document.activeElement=document.body;};
 function mount(jsx,parent,path){
  if(!jsx||typeof jsx!=='object')return;
  if(Array.isArray(jsx)){jsx.forEach((child,index)=>mount(child,parent,path+'/'+(child?.key??index)));return;}
  if(typeof jsx.type==='function'){mount(jsx.type(jsx.props),parent,path);return;}
  if(typeof jsx.type!=='string')return;
  let element=f.nodes.get(path);if(!element||element.tagName!==jsx.type.toUpperCase()){element=new Element(jsx.type);f.nodes.set(path,element);}
  element.props=jsx.props;element.parentElement=parent;element.children=[];element.isConnected=true;if(parent)parent.children.push(element);else f.root=element;
  reference(jsx.props.ref,element);mount(jsx.props.children,element,path+'/children');
 }
 f.render=()=>{
  if(f.closed)return;f.cursor=0;const tree=module.ControlReview({data:{queue:f.queue},open:task=>{f.opened.push(task.id);f.dialog=new Element('dialog',{open:true});f.dialog.focus();},renderDetail:inline?task=>React.createElement('div',{key:task.id},React.createElement('input',{'aria-label':'Synthetic detail input',defaultValue:task.title})):undefined});
  for(const node of f.nodes.values()){reference(node.props.ref,null);node.isConnected=false;}mount(tree,null,'root');lostFocus();for(const effect of f.effects.splice(0))effect();
 };
 f.find=predicate=>[...f.nodes.values()].find(node=>node.isConnected&&predicate(node));
 f.row=id=>f.find(node=>node.props['aria-label']==='Granska '+f.queue.find(task=>task.id===id)?.title);
 f.detail=()=>f.find(node=>node.className==='review-detail');f.back=()=>f.find(node=>node.className.includes('review-back'));f.search=()=>f.find(node=>node.props['aria-label']==='Filtrera granskningskön');
 f.activate=async node=>{node.focus();node.props.onClick({target:node,currentTarget:node,detail:0});await flush();};
 f.resize=async next=>{f.width=next;lostFocus();browser.dispatchEvent(new Event('resize'));await flush();};
 f.update=async queue=>{f.queue=queue;f.render();await flush();};
 f.unmount=()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();for(const node of f.nodes.values()){reference(node.props.ref,null);node.isConnected=false;}lostFocus();};
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Focus/render must not call an API');});
 t.after(()=>{f.unmount();delete globalThis[key];if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 f.render();await flush();return f;
}

test('mobile keyboard row activation focuses a visible labelled detail and Back restores the same row',async t=>{
 const f=await fixture(t),row=f.row('task-1');await f.activate(row);
 assert.equal(f.document.activeElement.className,'review-detail');assert.ok(f.detail().getClientRects().length);assert.equal(f.detail().props.role,'region');assert.ok(f.detail().props['aria-label']);assert.equal(f.detail().tabIndex,-1);assert.deepEqual(f.opened,[]);
 await f.activate(f.back());assert.equal(f.document.activeElement,row);assert.ok(row.getClientRects().length);
});
test('initial render and desktop selection preserve list browsing without actions or focus jumps',async t=>{
 const f=await fixture(t,{width:1440});assert.equal(f.document.activeElement,f.outside);assert.deepEqual(f.opened,[]);
 const row=f.row('task-1');await f.activate(row);assert.equal(f.document.activeElement,row);assert.ok(row.getClientRects().length);assert.ok(f.detail().getClientRects().length);assert.deepEqual(f.opened,[]);
 await f.update([...f.queue].reverse());assert.equal(f.document.activeElement,row);
});
test('filtering keeps focus in the filter and Back uses a visible remaining row after removal',async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));const input=f.search();input.focus();input.props.onChange({target:{value:'Third'}});await flush();
 assert.equal(f.document.activeElement,input);assert.equal(f.row('task-1'),undefined);const remaining=f.row('task-2');await f.activate(remaining);await f.update(tasks().filter(task=>task.id!=='task-2'));
 assert.equal(f.document.activeElement.className,'review-workspace');assert.ok(f.document.activeElement.getClientRects().length);assert.equal(f.search().props.value,'Third');
});
test('Back chooses a visible fallback when the originating row has been removed',async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));await f.update(tasks().filter(task=>task.id!=='task-1'));await f.activate(f.back());
 assert.equal(f.document.activeElement,f.row('task-0'));assert.ok(f.document.activeElement.getClientRects().length);assert.deepEqual(f.opened,[]);
});
test('removing a focused inline editor or the last task recovers to a visible labelled region',async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));f.find(node=>node.props['aria-label']==='Synthetic detail input').focus();await f.update(tasks().filter(task=>task.id!=='task-1'));
 assert.equal(f.document.activeElement.className,'review-detail');await f.update([]);assert.equal(f.document.activeElement.className,'review-workspace');assert.ok(f.document.activeElement.props['aria-label']);
});
test('viewport changes repair only focus hidden by the review layout',async t=>{
 const f=await fixture(t,{width:1440});const row=f.row('task-1');await f.activate(row);await f.resize(390);assert.equal(f.document.activeElement.className,'review-detail');
 f.back().focus();await f.resize(1440);assert.equal(f.document.activeElement,row);
 f.outside.focus();await f.resize(390);assert.equal(f.document.activeElement,f.outside);
});
test('a desktop detail hidden on narrowing returns focus to its visible list row',async t=>{
 const f=await fixture(t,{width:1440});f.find(node=>node.props['aria-label']==='Synthetic detail input').focus();await f.resize(390);
 assert.equal(f.document.activeElement,f.row('task-0'));assert.ok(f.document.activeElement.getClientRects().length);
});
test('explicit modal opening retains modal focus and never runs from render or resize',async t=>{
 const f=await fixture(t,{inline:false});assert.deepEqual(f.opened,[]);await f.activate(f.row('task-1'));assert.equal(f.document.activeElement,f.dialog);assert.deepEqual(f.opened,['task-1']);
 await f.resize(1440);await f.update([...f.queue]);assert.equal(f.document.activeElement,f.dialog);assert.deepEqual(f.opened,['task-1']);
});
test('unmount removes viewport recovery and never refocuses a disconnected review',async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));f.unmount();f.outside.focus();const count=f.focusLog.length;await f.resize(1440);
 assert.equal(f.listeners.size,0);assert.equal(f.focusLog.length,count);assert.equal(f.document.activeElement,f.outside);
});
