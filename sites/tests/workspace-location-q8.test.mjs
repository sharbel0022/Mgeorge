import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const locationModule=()=>import('../lib/workspace-location.ts');
const draftsModule=()=>import('../lib/workspace-drafts.ts');
const flush=async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
class Browser extends EventTarget{
 constructor(href='https://workspace.example/',state={framework:'preserved'}){
  super();this.entries=[{href,state}];this.index=0;this.moves=0;const self=this;
  this.history={get state(){return self.entries[self.index].state;},pushState(state,unused,url){self.entries.splice(self.index+1);self.entries.push({state,href:new URL(url,self.location).href});self.index++;},replaceState(state,unused,url){self.entries[self.index]={state,href:url?new URL(url,self.location).href:self.location.href};},go(delta){self.moves++;assert.ok(self.moves<20,'history must not loop');const target=self.index+delta;if(target<0||target>=self.entries.length)return;self.index=target;const event=new Event('popstate');event.state=self.history.state;queueMicrotask(()=>self.dispatchEvent(event));}};
 }
 get location(){return new URL(this.entries[this.index].href);}
}

test('workspace URLs admit only allowlisted views and the explicit Bank import start flag',async()=>{
 const {readWorkspaceLocation,workspaceHref}=await locationModule();
 assert.deepEqual(readWorkspaceLocation(new URLSearchParams('view=payable&invoice=private&customer=private')),{view:'payable',openBankImport:false});
 for(const query of ['view=__proto__','view=bank&view=settings','view=BANK','view=javascript%3Aalert(1)'])assert.deepEqual(readWorkspaceLocation(new URLSearchParams(query)),{view:'overview',openBankImport:false});
 assert.deepEqual(readWorkspaceLocation(new URLSearchParams('view=bank&import=1')),{view:'bank',openBankImport:true});
 assert.equal(readWorkspaceLocation(new URLSearchParams('view=settings&import=1')).openBankImport,false);
 assert.equal(readWorkspaceLocation(new URLSearchParams('view=bank&import=1&import=1')).openBankImport,false);
 assert.equal(workspaceHref('receivable'),'/?view=receivable');assert.equal(workspaceHref('overview'),'/');
 assert.equal(workspaceHref('bank',true),'/?view=bank&import=1');assert.equal(workspaceHref('settings',true),'/?view=settings');
 assert.equal(workspaceHref('private-customer-name'),'/');
});
test('view navigation supports Back, Forward and reload without duplicate same-view entries',async()=>{
 const {createWorkspaceHistory}=await locationModule(),browser=new Browser('https://workspace.example/?view=receivable&document=private'),seen=[];let guards=0;
 const history=createWorkspaceHistory(browser,(location,reason)=>seen.push([location.view,reason]),()=>{guards++;return true;});
 assert.equal(browser.location.href,'https://workspace.example/?view=receivable');assert.equal(browser.history.state.framework,'preserved');
 history.navigate('payable');history.navigate('bank');history.navigate('settings');history.navigate('settings');
 assert.equal(browser.entries.length,4);assert.equal(guards,3);assert.equal(browser.location.search,'?view=settings');
 browser.history.go(-2);await flush();assert.equal(seen.at(-1)[0],'payable');
 browser.history.go(1);await flush();assert.equal(seen.at(-1)[0],'bank');
 history.dispose();const reloaded=[];const next=createWorkspaceHistory(browser,location=>reloaded.push(location.view));
 assert.deepEqual(reloaded,['bank']);browser.history.go(1);await flush();assert.deepEqual(reloaded,['bank','settings']);
 next.dispose();const before=reloaded.length;browser.history.go(-1);await flush();assert.equal(reloaded.length,before);
 assert.doesNotMatch(JSON.stringify(browser.entries),/private/);
});
test('cancelling Back restores the entry once and preserves Forward for the later accepted traversal',async()=>{
 const {createWorkspaceHistory}=await locationModule(),browser=new Browser(),seen=[];let dirty=false,asked=0;
 const history=createWorkspaceHistory(browser,location=>seen.push(location.view),()=>{if(dirty){asked++;return false;}return true;});
 history.navigate('receivable');history.navigate('bank');dirty=true;
 assert.equal(history.navigate('bank'),true);assert.equal(asked,0);
 browser.history.go(-1);await flush();assert.equal(browser.location.search,'?view=bank');assert.equal(seen.at(-1),'bank');assert.equal(asked,1);assert.equal(browser.entries.length,3);assert.equal(browser.moves,2);
 dirty=false;browser.history.go(-1);await flush();assert.equal(seen.at(-1),'receivable');browser.history.go(1);await flush();assert.equal(seen.at(-1),'bank');
 history.dispose();
});
test('same-view popstate never prompts or resets current work; unknown history markers cannot cause a loop',async()=>{
 const {createWorkspaceHistory}=await locationModule(),browser=new Browser('https://workspace.example/?view=bank'),seen=[];let asked=0;
 const history=createWorkspaceHistory(browser,location=>seen.push(location.view),()=>{asked++;return false;});
 browser.history.pushState(browser.history.state,'','/?view=bank#main-content');browser.history.go(-1);await flush();
 assert.equal(asked,0);assert.deepEqual(seen,['bank']);
 browser.history.pushState({},'','/?view=payable');browser.history.go(-1);await flush();browser.history.go(1);await flush();
 assert.equal(asked,1);assert.equal(browser.location.search,'?view=bank');assert.deepEqual(seen,['bank']);assert.ok(browser.moves<5);
 history.dispose();
});
test('queued history events inspect the current entry and do not repeat a rejected departure',async()=>{
 const {createWorkspaceHistory}=await locationModule(),browser=new Browser();let dirty=false,asked=0;
 const history=createWorkspaceHistory(browser,()=>{},()=>{if(dirty){asked++;return false;}return true;});
 history.navigate('receivable');history.navigate('bank');dirty=true;
 browser.history.go(-1);browser.history.go(-1);await flush();
 assert.equal(browser.location.search,'?view=bank');assert.equal(asked,1);assert.equal(browser.entries.length,3);
 dirty=false;assert.equal(history.navigate('settings'),true);assert.equal(browser.location.search,'?view=settings');history.dispose();
});
test('the import start link can be dismissed without creating a new financial or history action',async()=>{
 const {createWorkspaceHistory}=await locationModule(),browser=new Browser('https://workspace.example/?view=bank&import=1'),seen=[];
 const history=createWorkspaceHistory(browser,location=>seen.push(location));assert.equal(seen[0].openBankImport,true);
 history.dismissBankImport();assert.equal(browser.location.search,'?view=bank');assert.equal(browser.entries.length,1);
 history.navigate('settings');browser.history.go(-1);await flush();assert.equal(seen.at(-1).openBankImport,false);history.dispose();
});

function draftFixture(){
 const browser=new Browser(),forms=new Set(),listeners=new Map();
 const root={ownerDocument:{defaultView:browser},contains:node=>forms.has(node)||forms.has(node.form||node.closest?.('[data-workspace-draft]')),addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type){listeners.delete(type);}};
 const form=(value='',dialog=false,standalone=false)=>{const form={tagName:standalone?'DIV':'FORM',isConnected:true,elements:[],closest:()=>dialog?{}:null,querySelectorAll(){return this.elements;}};const control={tagName:'INPUT',type:'text',value,defaultValue:value,disabled:false,readOnly:false,isConnected:true,form:standalone?null:form,closest:()=>standalone?form:null};form.elements.push(control);forms.add(form);return {form,control};};
 const emit=(type,target)=>listeners.get(type)?.({target});
 return {browser,root,form,emit,forms,listeners};
}
test('draft guards ignore search and unchanged/reverted forms while protecting actual inline edits',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('Original');
 f.emit('input',{tagName:'INPUT',type:'search',form:null,closest:()=>null,value:'search'});assert.equal(guard.hasChanges(),false);
 f.emit('focusin',a.control);f.emit('change',a.control);assert.equal(guard.hasChanges(),false);
 a.control.value='Edited';f.emit('input',a.control);assert.equal(guard.hasChanges(),true);
 let asked=0;assert.equal(guard.canLeave(()=>{asked++;return false;}),false);assert.equal(asked,1);assert.equal(guard.hasChanges(),true);
 a.control.value='Original';f.emit('input',a.control);assert.equal(guard.hasChanges(),false);
 a.control.value='Edited again';f.emit('input',a.control);assert.equal(guard.canLeave(()=>true),true);assert.equal(guard.hasChanges(),false);
 guard.dispose();assert.equal(f.listeners.size,0);
});
test('modal drafts survive view navigation and still warn before unloading the document',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('Original',true);
 f.emit('focusin',a.control);a.control.value='Unsaved modal';f.emit('input',a.control);
 assert.equal(guard.canLeave(()=>{throw Error('A surviving modal must not block a view change');}),true);assert.equal(guard.hasChanges(),true);
 const unload=new Event('beforeunload',{cancelable:true});f.browser.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
 guard.accept(a.form);assert.equal(guard.hasChanges(),false);
 const clean=new Event('beforeunload',{cancelable:true});f.browser.dispatchEvent(clean);assert.equal(clean.defaultPrevented,false);
 guard.dispose();
});
test('accepting one saved form never clears a different draft and removed forms do not cause stale prompts',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('A'),b=f.form('B',true);
 for(const entry of [a,b]){f.emit('focusin',entry.control);entry.control.value+=' changed';f.emit('input',entry.control);}
 guard.accept(b.form);assert.equal(guard.canLeave(()=>false),false);
 a.form.isConnected=false;f.forms.delete(a.form);assert.equal(guard.hasChanges(),false);guard.dispose();
});
test('a completed submission cannot clear edits made while its request was pending',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('Original');
 f.emit('focusin',a.control);a.control.value='Submitted';f.emit('input',a.control);
 const saved=guard.captureSubmission(a.form);a.control.value='Newer unsaved edit';f.emit('input',a.control);saved();
 assert.equal(guard.hasChanges(),true);assert.equal(guard.canLeave(()=>false),false);
 guard.captureSubmission(a.form)();assert.equal(guard.hasChanges(),false);guard.dispose();
});
test('standalone message draft regions block view loss while unrelated search remains untracked',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('Original message',false,true);
 a.control.tagName='TEXTAREA';a.control.type='textarea';f.emit('focusin',a.control);f.emit('beforeinput',a.control);a.control.value='Unsaved message';f.emit('input',a.control);
 assert.equal(guard.hasChanges(),true);assert.equal(guard.canLeave(()=>false),false);
 const unload=new Event('beforeunload',{cancelable:true});f.browser.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
 a.control.value='Original message';f.emit('input',a.control);assert.equal(guard.hasChanges(),false);
 f.emit('input',{tagName:'INPUT',type:'search',form:null,closest:()=>null,value:'private filter'});assert.equal(guard.hasChanges(),false);guard.dispose();
});
test('first edit uses the loaded baseline even when focus preceded the async value',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('Initial placeholder');
 f.emit('focusin',a.control);a.control.value=a.control.defaultValue='Loaded company';f.emit('beforeinput',a.control);a.control.value='Temporary edit';f.emit('input',a.control);
 a.control.value='Loaded company';f.emit('input',a.control);assert.equal(guard.hasChanges(),false);assert.equal(guard.canLeave(()=>{throw Error('Reverted loaded value is clean');}),true);guard.dispose();
});
test('late data in an untouched neighboring field does not turn a reverted edit into a dirty form',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('Original name'),email={...a.control,value:'',defaultValue:'',type:'email'};a.form.elements.push(email);
 f.emit('focusin',a.control);a.control.value='Temporary name';f.emit('input',a.control);email.value=email.defaultValue='loaded@example.test';
 a.control.value='Original name';f.emit('input',a.control);assert.equal(guard.hasChanges(),false);guard.dispose();
});

async function hookFixture(t){
 const key='__workspace_navigation_'+crypto.randomUUID().replaceAll('-',''),forms=draftFixture(),browser=new Browser('https://workspace.example/?view=receivable');forms.root.ownerDocument.defaultView=browser;
 const f={slots:[],cursor:0,effects:[],closed:false,scheduled:false,initial:'receivable',transitions:0,browser,root:{current:forms.root}};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
 f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return [f.slots[index].value,value=>{f.slots[index].value=typeof value==='function'?value(f.slots[index].value):value;f.schedule();}];};
 f.ref=initial=>{const index=f.cursor++;f.slots[index]??={current:initial};return f.slots[index];};
 f.callback=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.slots[index]={value:fn,deps};return f.slots[index].value;};
 f.effect=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:fn()};});};
 const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'),react=data(`const f=globalThis[${JSON.stringify(key)}];export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useCallback=(...a)=>f.callback(...a),useEffect=(...a)=>f.effect(...a);`);
 let code=ts.transpileModule(readFileSync(new URL('../components/use-workspace-navigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [name,url]of Object.entries({react,'@/lib/workspace-location':new URL('../lib/workspace-location.ts',import.meta.url).href,'@/lib/workspace-drafts':new URL('../lib/workspace-drafts.ts',import.meta.url).href}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(url));
 const hook=await import(data(code)),previous=globalThis.window;globalThis.window=browser;browser.confirm=()=>false;
 f.render=()=>{if(f.closed)return;f.cursor=0;f.value=hook.useWorkspaceNavigation(f.initial,f.root,()=>{f.transitions++;});for(const effect of f.effects.splice(0))effect();};
 f.unmount=()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();};
 t.after(()=>{f.unmount();delete globalThis[key];if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
 f.render();await flush();return f;
}
test('the hook retains each view filter in RAM through Back and ignores late initial props',async t=>{
 const f=await hookFixture(t);let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('History must not call APIs');});
 f.value.setSearch('private customer');f.value.setFilter('partial');await flush();
 assert.equal(f.value.navigate('bank'),true);await flush();assert.equal(f.value.search,'');assert.equal(f.value.filter,'all');
 f.value.setSearch('private reference');f.value.setFilter('identify');await flush();
 f.initial='overview';f.render();await flush();assert.equal(f.value.view,'bank');assert.equal(f.value.search,'private reference');
 f.browser.history.go(-1);await flush();assert.equal(f.value.view,'receivable');assert.equal(f.value.search,'private customer');assert.equal(f.value.filter,'partial');
 f.browser.history.go(1);await flush();assert.equal(f.value.view,'bank');assert.equal(f.value.filter,'identify');
 assert.equal(network,0);assert.doesNotMatch(JSON.stringify(f.browser.entries),/private|partial|identify/);
 f.value.resetFilters();await flush();assert.equal(f.value.search,'');assert.equal(f.value.filter,'all');
 const transitions=f.transitions;f.unmount();f.browser.history.go(-1);await flush();assert.equal(f.transitions,transitions);
});

test('a successful save rebases a later revert against the submitted value, not the previous server value',async()=>{
 const {createWorkspaceDraftGuard}=await draftsModule(),f=draftFixture(),guard=createWorkspaceDraftGuard(f.root),a=f.form('A'),other=f.form('Other');
 f.emit('focusin',a.control);f.emit('beforeinput',a.control);a.control.value='B';f.emit('input',a.control);
 const saved=guard.captureSubmission(a.form);f.emit('beforeinput',a.control);a.control.value='A';f.emit('input',a.control);
 f.emit('focusin',other.control);other.control.value='Other draft';f.emit('input',other.control);
 saved();assert.equal(guard.hasChanges(),true);guard.accept(other.form);assert.equal(guard.hasChanges(),true);
 let prompts=0;assert.equal(guard.canLeave(()=>{prompts++;return false;}),false);assert.equal(prompts,1);
 a.control.value='B';f.emit('input',a.control);assert.equal(guard.hasChanges(),false);guard.dispose();
});
