import {randomUuid} from './uuid.js';

export const workspaceViews=['review','messages','documents','connections','overview','receivable','payable','bank','imports','contacts','history','settings'] as const;
export type WorkspaceView=typeof workspaceViews[number];
export type WorkspaceLocation={view:WorkspaceView;openBankImport:boolean};
type Search={view?:unknown;import?:unknown};
const isView=(value:unknown):value is WorkspaceView=>typeof value==='string'&&(workspaceViews as readonly string[]).includes(value);

/** Only view names and the deliberate Bank import entry point belong in URLs. */
export function readWorkspaceLocation(params:URLSearchParams|Search):WorkspaceLocation{
 const one=(key:'view'|'import')=>params instanceof URLSearchParams?(params.getAll(key).length===1?params.get(key):undefined):params[key];
 const value=one('view'),view=isView(value)?value:'overview';
 return {view,openBankImport:view==='bank'&&one('import')==='1'};
}
export function workspaceHref(view:WorkspaceView,openBankImport=false){
 if(!isView(view)||view==='overview')return '/';
 return '/?view='+view+(view==='bank'&&openBankImport?'&import=1':'');
}

type LinkEvent={button:number;defaultPrevented:boolean;ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean;currentTarget:{target:string;hasAttribute:(name:string)=>boolean}};
export const isWorkspaceLinkClick=(event:LinkEvent)=>event.button===0&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&(!event.currentTarget.target||event.currentTarget.target==='_self')&&!event.currentTarget.hasAttribute('download');

const markerKey='__mg_workspace';
type Marker={version:1;session:string;index:number};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function marker(state:unknown):Marker|null{
 const value=object(object(state)[markerKey]);
 return value.version===1&&typeof value.session==='string'&&value.session.length<=100&&Number.isSafeInteger(value.index)&&Number(value.index)>=0?value as Marker:null;
}
type Browser=Pick<Window,'history'|'location'|'addEventListener'|'removeEventListener'>;

/** Owns only same-page view history. It never fetches, saves, or opens a form. */
export function createWorkspaceHistory(browser:Browser,receive:(location:WorkspaceLocation,reason:'initial'|'push'|'pop')=>void,canLeave:()=>boolean=()=>true){
 let current=readWorkspaceLocation(new URLSearchParams(browser.location.search));
 const existing=marker(browser.history.state),session=existing?.session||randomUuid();
 let index=existing?.index||0,restoring=false;
 const write=(method:'pushState'|'replaceState',location:WorkspaceLocation)=>browser.history[method]({...object(browser.history.state),[markerKey]:{version:1,session,index}},'',workspaceHref(location.view,location.openBankImport));
 write('replaceState',current);receive(current,'initial');
 const pop=()=>{
  // Several queued traversals can make event.state older than location. Read
  // both parts from the current entry so a rejected Back is restored once.
  const entry=marker(browser.history.state),known=entry?.session===session,next=readWorkspaceLocation(new URLSearchParams(browser.location.search));
  if(restoring&&known&&entry.index===index){restoring=false;return;}
  restoring=false;
  // Hash-only and repeated same-view events must not discard edits or refocus.
  if(next.view===current.view){if(known)index=entry.index;current=next;return;}
  if(!canLeave()){
   if(known&&entry.index!==index){restoring=true;browser.history.go(index-entry.index);}
   else write('replaceState',current);
   return;
  }
  if(known)index=entry.index;
  current=next;write('replaceState',current);receive(current,'pop');
 };
 browser.addEventListener('popstate',pop);
 return {
  navigate(view:WorkspaceView){
   if(!isView(view))return false;
   if(view===current.view)return true;
   if(restoring||!canLeave())return false;
   index++;current={view,openBankImport:false};write('pushState',current);receive(current,'push');return true;
  },
  dismissBankImport(){if(current.openBankImport){current={...current,openBankImport:false};write('replaceState',current);}},
  dispose(){browser.removeEventListener('popstate',pop);},
 };
}
