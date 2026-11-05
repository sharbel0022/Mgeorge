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
// Input values survive only while their mounted host node survives. Disconnected
// nodes are discarded so a remount cannot accidentally resurrect an edited draft.
async function fixture(t,{width=390,inline=true}={}){
 const key='__review_focus_'+crypto.randomUUID().replaceAll('-',''),f={width,slots:[],cursor:0,effects:[],scheduled:false,closed:false,nodes:new Map(),queue:tasks(),opened:[],savedDrafts:[],focusLog:[],listeners:new Set(),dialog:null};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
 f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return[f.slots[index].value,value=>{f.slots[index].value=typeof value==='function'?value(f.slots[index].value):value;f.schedule();}];};
 f.ref=initial=>{const index=f.cursor++;f.slots[index]??={current:initial};return f.slots[index];};
 f.callback=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.slots[index]={value:fn,deps};return f.slots[index].value;};
 f.effect=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:fn()};});};
 const browser=new EventTarget(),add=browser.addEventListener.bind(browser),remove=browser.removeEventListener.bind(browser);browser.addEventListener=(type,fn)=>{f.listeners.add(fn);add(type,fn);};browser.removeEventListener=(type,fn)=>{f.listeners.delete(fn);remove(type,fn);};
 const document={defaultView:browser,activeElement:null,querySelector:selector=>selector==='dialog[open]'?f.dialog:null};
 class Element{
  constructor(tag,props={}){this.tagName=tag.toUpperCase();this.props=props;this.value=props.value??props.defaultValue??'';this.children=[];this.isConnected=true;this.parentElement=null;this.ownerDocument=document;}
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
  let element=f.nodes.get(path);if(!element||element.tagName!==jsx.type.toUpperCase()){element=new Element(jsx.type,jsx.props);f.nodes.set(path,element);}
  element.props=jsx.props;element.parentElement=parent;element.children=[];element.isConnected=true;if(parent)parent.children.push(element);else f.root=element;
  if(jsx.props.value!==undefined)element.value=jsx.props.value;
  reference(jsx.props.ref,element);mount(jsx.props.children,element,path+'/children');
 }
 function DraftDetail({task,readable}){
  if(!readable)return React.createElement('p',null,'Fresh detail data is required');
  return React.createElement('div',null,React.createElement('input',{'aria-label':'Synthetic detail input',defaultValue:task.title}),React.createElement('button',{'aria-label':'Save synthetic draft',onClick:()=>f.savedDrafts.push(task.id)},'Save draft'));
 }
 f.render=()=>{
  if(f.closed)return;f.cursor=0;const detailReadable=f.detailReadable!==false;const tree=module.ControlReview({data:f.dataAvailable===false?null:{queue:f.queue},readStatus:f.readStatus||'ready',error:f.error||'',retry:()=>{f.error='';f.readStatus=f.retryPending?'pending':'ready';if(f.retryPending)f.dataAvailable=false;f.render();},open:task=>{f.opened.push(task.id);f.dialog=new Element('dialog',{open:true});f.dialog.focus();},renderDetail:inline?task=>React.createElement(DraftDetail,{key:task.id,task,readable:detailReadable}):undefined});
  for(const node of f.nodes.values()){reference(node.props.ref,null);node.isConnected=false;}mount(tree,null,'root');for(const [path,node]of f.nodes)if(!node.isConnected)f.nodes.delete(path);lostFocus();for(const effect of f.effects.splice(0))effect();
 };
 f.find=predicate=>[...f.nodes.values()].find(node=>node.isConnected&&predicate(node));
 f.row=id=>f.find(node=>node.props['aria-label']==='Granska '+f.queue.find(task=>task.id===id)?.title);
 f.detail=()=>f.find(node=>node.className==='review-detail');f.back=()=>f.find(node=>node.className.includes('review-back'));f.search=()=>f.find(node=>node.props['aria-label']==='Filtrera granskningskön');
 f.activate=async node=>{if(!node.getClientRects().length||node.props.disabled)return false;for(let ancestor=node;ancestor;ancestor=ancestor.parentElement)if(ancestor.props.inert)return false;node.focus();node.props.onClick({target:node,currentTarget:node,detail:0});await flush();return true;};
 f.resize=async next=>{f.width=next;lostFocus();browser.dispatchEvent(new Event('resize'));await flush();};
 f.update=async queue=>{f.queue=queue;f.render();await flush();};
 f.unmount=()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();for(const node of f.nodes.values()){reference(node.props.ref,null);node.isConnected=false;}lostFocus();};
 f.remount=()=>{f.unmount();f.closed=false;f.slots=[];f.nodes=new Map();f.effects=[];f.render();};
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

for(const width of [390,1440])test(`95 UI review read failure and retry keep keyboard focus inside the workspace at ${width}px`,async t=>{
 const f=await fixture(t,{width});await f.activate(f.row('task-1'));
 if(width===390)f.find(node=>node.props['aria-label']==='Synthetic detail input').focus();
 f.error='Synthetic unavailable response';f.render();await flush();
 assert.notEqual(f.document.activeElement,f.document.body,'a failed read must not drop focus to the document body');
 assert.equal(f.document.activeElement,f.root);assert.equal(f.root.props.role,'alert');assert.ok(f.root.props['aria-label']);
 const retry=f.find(node=>node.props.children==='Hämta granskningskön igen');await f.activate(retry);
 assert.notEqual(f.document.activeElement,f.document.body,'recovery must retain a visible focus target');
 assert.ok(f.root.contains(f.document.activeElement));assert.ok(f.document.activeElement.getClientRects().length);
 assert.equal(f.root.props.role,undefined);assert.deepEqual(f.opened,[]);
});
test('95 UI a failed review read never steals focus from an unrelated page control',async t=>{
 const f=await fixture(t);f.outside.focus();f.error='Synthetic unavailable response';f.render();await flush();
 assert.equal(f.document.activeElement,f.outside);
});
for(const readStatus of ['pending','signed_out','failed'])test(`95 UI review ${readStatus} hides stale tasks and retains focus`,async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));f.find(node=>node.props['aria-label']==='Synthetic detail input').focus();
 f.readStatus=readStatus;f.render();await flush();
 const row=f.row('task-1');assert.equal(Boolean(row?.getClientRects().length),false,'unavailable review data must not expose a stale row');if(row)assert.equal(await f.activate(row),false);assert.ok(f.document.activeElement===f.root,'focus must move to the retained review region');assert.ok(f.root.props['aria-label']);
 if(readStatus==='failed')await f.activate(f.find(node=>node.props.children==='Hämta granskningskön igen'));
 else{f.readStatus='ready';f.render();await flush();}
 assert.ok(f.root.contains(f.document.activeElement));assert.ok(f.document.activeElement.getClientRects().length);
});

for(const width of [390,1440])test(`edited review detail stays mounted and inert through a failed read, pending retry and recovery at ${width}px`,async t=>{
 const f=await fixture(t,{width});await f.activate(f.row('task-1'));
 const editor=f.find(node=>node.props['aria-label']==='Synthetic detail input'),save=f.find(node=>node.props['aria-label']==='Save synthetic draft');
 editor.value='Unsaved corrected invoice reference';editor.focus();
 f.error='Synthetic unavailable response';f.render();await flush();
 assert.ok(f.find(node=>node.props['aria-label']==='Synthetic detail input')===editor,'a transient read error must not unmount the edited child');
 assert.equal(editor.getClientRects().length,0,'stale detail must be hidden');
 assert.equal(await f.activate(save),false,'stale save actions must be unavailable');
 assert.deepEqual(f.savedDrafts,[]);
 let inert=false;for(let node=editor;node;node=node.parentElement)inert||=node.props.inert===true;assert.equal(inert,true,'retained editor must also be inert');
 f.retryPending=true;await f.activate(f.find(node=>node.props.children==='Hämta granskningskön igen'));
 assert.ok(f.find(node=>node.props['aria-label']==='Synthetic detail input')===editor,'a pending retry without queue data must retain the same edited child');
 assert.equal(editor.getClientRects().length,0);
 f.readStatus='ready';f.dataAvailable=true;f.render();await flush();
 assert.ok(f.find(node=>node.props['aria-label']==='Synthetic detail input')===editor);
 assert.equal(editor.value,'Unsaved corrected invoice reference');assert.ok(editor.getClientRects().length);
 await f.activate(save);assert.deepEqual(f.savedDrafts,['task-1']);
});

test('sign-out clears a retained review draft before the next sign-in',async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));
 const editor=f.find(node=>node.props['aria-label']==='Synthetic detail input');editor.value='Private unsaved draft';
 f.error='Synthetic unavailable response';f.render();await flush();
 f.error='';f.readStatus='signed_out';f.dataAvailable=false;f.render();await flush();
 assert.equal(editor.isConnected,false);assert.equal(f.find(node=>node.props['aria-label']==='Synthetic detail input'),undefined);
 f.readStatus='ready';f.dataAvailable=true;f.render();await flush();
 const reopened=f.find(node=>node.props['aria-label']==='Synthetic detail input');assert.notEqual(reopened,editor);assert.notEqual(reopened.value,'Private unsaved draft');
});

for(const width of [390,1440])test(`parent unreadable props cannot unmount a retained draft during failed refresh at ${width}px`,async t=>{
 const f=await fixture(t,{width});await f.activate(f.row('task-1'));
 const editor=f.find(node=>node.props['aria-label']==='Synthetic detail input');editor.value='Unsaved bank evidence note';editor.focus();
 f.detailReadable=false;f.readStatus='failed';f.dataAvailable=false;f.render();await flush();
 assert.ok(f.find(node=>node.props['aria-label']==='Synthetic detail input')===editor,'retain the last ready detail props, not a newly unreadable child');
 assert.equal(editor.getClientRects().length,0);
 f.retryPending=true;await f.activate(f.find(node=>node.props.children==='Hämta granskningskön igen'));
 assert.ok(f.find(node=>node.props['aria-label']==='Synthetic detail input')===editor);
 f.detailReadable=true;f.readStatus='ready';f.dataAvailable=true;f.render();await flush();
 assert.ok(f.find(node=>node.props['aria-label']==='Synthetic detail input')===editor);assert.equal(editor.value,'Unsaved bank evidence note');assert.ok(editor.getClientRects().length);
});

test('company-boundary remount discards a retained review draft',async t=>{
 const f=await fixture(t);await f.activate(f.row('task-1'));
 const editor=f.find(node=>node.props['aria-label']==='Synthetic detail input');editor.value='Previous company draft';
 f.error='Synthetic unavailable response';f.render();await flush();
 f.error='';f.readStatus='pending';f.dataAvailable=false;f.queue=[{...tasks()[0],id:'other-company-task',title:'Other company document'}];f.remount();await flush();
 assert.equal(editor.isConnected,false);assert.equal(f.find(node=>node.props['aria-label']==='Synthetic detail input'),undefined);
 f.readStatus='ready';f.dataAvailable=true;f.render();await flush();
 const reopened=f.find(node=>node.props['aria-label']==='Synthetic detail input');assert.ok(reopened!==editor);assert.equal(reopened.value,'Other company document');
});
