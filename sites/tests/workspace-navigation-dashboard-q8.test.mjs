import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState} from '../lib/domain.ts';
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const file=path=>new URL(path,import.meta.url).href;
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
function compiled(path,imports){
 let source=readFileSync(new URL(path,import.meta.url),'utf8');if(path==='../app/dashboard.tsx')source+='\nexport {SettingsView};';
 let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url]of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),...imports}))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(url));
 return data(code);
}
async function fixture(t,{settingsOnly=false,messagesOnly=false}={}){
 const key='__dashboard_navigation_'+crypto.randomUUID().replaceAll('-',''),f={slots:[],cursor:0,effects:[],closed:false,scheduled:false,requests:[],reads:0,mainFocus:0};globalThis[key]=f;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 f.schedule=()=>{if(f.closed||f.scheduled)return;f.scheduled=true;queueMicrotask(()=>{f.scheduled=false;f.render();});};
 f.state=initial=>{const index=f.cursor++;f.slots[index]??={value:typeof initial==='function'?initial():initial};return [f.slots[index].value,value=>{f.slots[index].value=typeof value==='function'?value(f.slots[index].value):value;f.schedule();}];};
 f.ref=initial=>{const index=f.cursor++;f.slots[index]??={current:initial};return f.slots[index];};
 f.memo=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.slots[index]={value:fn(),deps};return f.slots[index].value;};
 f.callback=(fn,deps)=>f.memo(()=>fn,deps);
 f.effect=(fn,deps)=>{const index=f.cursor++;if(!equal(f.slots[index]?.deps,deps))f.effects.push(()=>{f.slots[index]?.cleanup?.();f.slots[index]={deps,cleanup:fn()};});};
 const ref=`globalThis[${JSON.stringify(key)}]`,react=data(`const f=${ref};export const useState=(...a)=>f.state(...a),useRef=(...a)=>f.ref(...a),useCallback=(...a)=>f.callback(...a),useMemo=(...a)=>f.memo(...a),useEffect=(...a)=>f.effect(...a);`);
 const browser=new EventTarget();browser.location=new URL('https://workspace.example/?view=settings');browser.confirm=()=>false;browser.history={state:null,replaceState(state,unused,url){this.state=state;browser.location=new URL(url,browser.location);},pushState(state,unused,url){this.replaceState(state,unused,url);},go(){throw Error('No traversal needed in this request-race test');}};
 const shell={ownerDocument:{defaultView:browser},contains:()=>false,addEventListener(){},removeEventListener(){}};
 const previousWindow=globalThis.window,previousDocument=globalThis.document;globalThis.window=browser;globalThis.document={activeElement:null};
 const inert=data('export default function View(){return null;}');
 const aliases=Object.fromEntries(['economy-overview','payment-history','gmail-summary','invoice-evidence','customer-messages','gmail-workspace','bank-connection'].map(name=>['@/components/'+name,inert]));
 const noCalls=names=>data(names.map(name=>`export function ${name}(){throw Error('Unexpected unrelated ${name} call');}`).join('\n'));
 const location=file('../lib/workspace-location.ts'),navigation=compiled('../components/workspace-navigation.tsx',{'react':import.meta.resolve('react'),'@/lib/workspace-location':location});
 const hook=compiled('../components/use-workspace-navigation.ts',{react,'@/lib/workspace-location':location,'@/lib/workspace-drafts':file('../lib/workspace-drafts.ts')});
 const module=await import(compiled('../app/dashboard.tsx',{...aliases,react,'@/components/workspace-navigation':navigation,'@/components/use-workspace-navigation':hook,'@/lib/workspace-location':location,'@/lib/domain':file('../lib/domain.ts'),
  '@/components/bank-payments':data('export default function BankPayments(){return null;} export function BankPaymentSummary(){return null;}'),
  '@/components/payment-control':data('export function usePaymentControl(){return {data:null,error:"",busy:false,refresh:async()=>{},start:async()=>{throw Error("History must not start controls");}};} export const ControlButton=()=>null,ControlConnections=()=>null,ControlProgress=()=>null,ControlQueue=()=>null,ControlReview=()=>null,controlDate=()=>"";'),
  '@/lib/payment-presentation':data('export const bankVisibleTransactions=state=>state.transactions,payerLabel=transaction=>transaction.party;export function bankPaymentView(){return {};}'),
  '@/components/payment-bank-filter':data('export const needsPaymentIdentification=()=>false;'),
  '@/lib/payment-overview':noCalls(['buildPaymentOverview','paymentGroup','paymentTitle']),
  '@/lib/reconciliation':noCalls(['analyze']),'@/lib/bankgiro-parser.js':noCalls(['parseSpecificationBytes']),
  '@/lib/imports':noCalls(['parseCSV','guessMapping','mapCSV','parseCAMT','sha256','readInvoiceFile','extractInvoiceText','downloadFile','csvCell']),
 }));
 const messages=messagesOnly?await import(compiled('../components/customer-messages.tsx',{react,'@/lib/domain':file('../lib/domain.ts'),'@/lib/payment-presentation':compiled('../lib/payment-presentation.ts',{'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js')})})):null;
 const original=emptyState();original.company={...original.company,name:'Original synthetic company'};
 const saved=structuredClone(original);saved.company.name='Saved synthetic company';
 f.original=original;f.saved=saved;
 t.mock.method(globalThis,'fetch',async(path,options={})=>{
  f.requests.push({path,method:options.method||'GET'});
  if(messagesOnly){const message={id:'synthetic-message-id',status:'draft',version:1,subject:'Synthetic subject',body:'Synthetic message',kind:'partial',invoice:{party:'Synthetic customer',number:'SYN-1'},facts:{total_cents:10000,paid_cents:0,remaining_cents:10000},payments:[],findings:[],recipient:'synthetic@example.test',review_id:'synthetic-review'};if(path==='/api/customer-messages/list')return Response.json({items:[message]});if(path==='/api/gmail/status?summary=1')return Response.json({send_enabled:false});if(path==='/api/customer-messages/review')return Response.json(message);throw Error('Unexpected message request '+path);}
  if(path==='/api/bank/invoice-candidates')return Response.json({candidates:{}});
  assert.equal(path,'/api/state');
  if(options.method==='POST')return Response.json({state:saved,revision:2,message:'Saved'});
  if(++f.reads===1)return Response.json({state:original,revision:1,audit:[]});
  return await new Promise(resolve=>{f.releaseRead=()=>resolve(Response.json({state:original,revision:1,audit:[]}));});
 });
 f.settingsState=emptyState();f.settingsSave=async()=>true;
 f.render=()=>{if(f.closed)return;f.cursor=0;f.tree=messages?messages.default({embedded:true,initialMessageId:'synthetic-message-id'}):settingsOnly?module.SettingsView({state:f.settingsState,save:f.settingsSave,busy:false,exportData(){},toggleDemo(){},demo:false}):module.default({initialView:'settings'});for(const node of elements(f.tree)){if(node.props?.className==='app-shell'&&node.props.ref)node.props.ref.current=shell;if(node.props?.id==='main-content'&&node.props.ref)node.props.ref.current={focus(){f.mainFocus++;}};}for(const effect of f.effects.splice(0))effect();};
 f.find=predicate=>elements(f.tree).find(predicate);
 t.after(()=>{f.closed=true;for(const slot of f.slots)slot?.cleanup?.();delete globalThis[key];if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 f.render();await flush();return f;
}
test('a workspace read begun before a save cannot restore the older company or revision afterward',async t=>{
 const f=await fixture(t),settings=()=>f.find(node=>node.props?.toggleDemo&&node.props?.save);
 const pending=f.find(node=>node.props?.['aria-label']==='Uppdatera').props.onClick();await flush();assert.ok(f.releaseRead);
 assert.equal(await settings().props.save({type:'settings.save',name:'Saved synthetic company',email:'synthetic@example.test'}),true);await flush();
 assert.equal(settings().props.state.company.name,'Saved synthetic company');
 f.releaseRead();await pending;await flush();assert.equal(settings().props.state.company.name,'Saved synthetic company');
});
test('ordinary view links change the URL without initiating another workspace read or financial action',async t=>{
 const f=await fixture(t),navigation=f.find(node=>node.props?.onNavigate&&node.props?.company&&node.props?.view);
 assert.equal(navigation.props.onNavigate('bank'),true);await flush();
 assert.equal(globalThis.window.location.search,'?view=bank');assert.equal(f.reads,1);assert.equal(f.requests.some(request=>request.method==='POST'),false);assert.ok(f.mainFocus>0);
});
test('activating the current Messages secondary link preserves the opened task editor',async t=>{
 const f=await fixture(t),navigation=()=>f.find(node=>node.props?.onNavigate&&node.props?.company&&node.props?.view);
 navigation().props.onNavigate('overview');await flush();f.find(node=>node.props?.task&&node.props?.demoToggle).props.task({type:'message',entity_id:'synthetic-message-id'});await flush();
 const editor=()=>f.find(node=>node.props?.initialMessageId!==undefined);assert.equal(editor().props.initialMessageId,'synthetic-message-id');const key=editor().key;
 f.find(node=>node.type?.name==='WorkspaceLink'&&node.props.view==='messages').props.onNavigate('messages');await flush();assert.equal(editor().props.initialMessageId,'synthetic-message-id');assert.equal(editor().key,key);
});
test('the real message editor opts its editable subject and body into the draft guard',async t=>{
 const f=await fixture(t,{messagesOnly:true}),region=f.find(node=>node.props?.['data-workspace-draft']!==undefined);assert.ok(region);
 const subject=elements(region).find(node=>node.props?.id==='customer-subject'),body=elements(region).find(node=>node.props?.id==='customer-body');assert.equal(subject.props.value,'Synthetic subject');assert.equal(body.props.value,'Synthetic message');assert.equal(subject.props.readOnly,false);assert.equal(body.props.readOnly,false);
 body.props.onChange({target:{value:'Unsaved synthetic message'}});await flush();assert.equal(f.find(node=>node.props?.id==='customer-body').props.value,'Unsaved synthetic message');assert.equal(f.requests.some(request=>request.path.endsWith('/edit')||request.path.endsWith('/send')),false);
});
test('the Settings deep link fills untouched fields when the workspace arrives',async t=>{
 const f=await fixture(t,{settingsOnly:true}),name=()=>f.find(node=>node.type==='input'&&!node.props.type),email=()=>f.find(node=>node.type==='input'&&node.props.type==='email');
 f.settingsState=f.original;f.render();await flush();assert.equal(name().props.value,'Original synthetic company');assert.equal(email().props.value,f.original.company.email);
});
test('late workspace data fills only untouched Settings fields and never overwrites a user draft',async t=>{
 const f=await fixture(t,{settingsOnly:true}),name=()=>f.find(node=>node.type==='input'&&!node.props.type),email=()=>f.find(node=>node.type==='input'&&node.props.type==='email');
 name().props.onChange({target:{value:'Unsaved synthetic draft'}});await flush();f.settingsState=structuredClone(f.original);f.settingsState.company.email='arrived@example.test';f.render();await flush();
 assert.equal(name().props.value,'Unsaved synthetic draft');assert.equal(email().props.value,'arrived@example.test');
});
test('a completed Settings save releases only the submitted draft values',async t=>{
 const f=await fixture(t,{settingsOnly:true}),name=()=>f.find(node=>node.type==='input'&&!node.props.type);f.settingsState=f.original;f.render();
 name().props.onChange({target:{value:'Submitted name '}});await flush();
 f.settingsSave=async()=>{f.settingsState=structuredClone(f.original);f.settingsState.company.name='Submitted name';return true;};f.render();
 await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await flush();assert.equal(name().props.value,'Submitted name');
 name().props.onChange({target:{value:'Second submission'}});await flush();let finish;f.settingsSave=()=>new Promise(resolve=>{finish=resolve;});f.render();
 const pending=f.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});name().props.onChange({target:{value:'Newer unsaved edit'}});await flush();finish(true);await pending;await flush();assert.equal(name().props.value,'Newer unsaved edit');
});
