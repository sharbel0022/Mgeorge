import {assertCompanyContext, companyCacheKey, hasCompanyPermission, COMPANY_CONTEXT_VERSION, COMPANY_ROLES} from './company-contract.js';

// This is a browser lifecycle boundary, not an authorization source. Every
// request still requires a current server-side membership and data boundary.
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:@._-]{0,199}$/.test(value);
const authPaths=new Set(['/api/login','/api/logout','/api/me']);
const message='Företagsåtkomsten har ändrats. Läs in sidan igen för att fortsätta.';
function error(code='COMPANY_CONTEXT_STALE',status=409){return Object.assign(new Error(code),{code,status});}
function directory(value){
  if(!record(value)||value.version!==COMPANY_CONTEXT_VERSION||!Array.isArray(value.companies)||!positive(value.contextVersion))throw error('COMPANY_CONTEXT_INVALID');
  if(value.legacy===true){
    if(value.companies.length||value.activeCompanyId!==null||value.context!=null)throw error('COMPANY_CONTEXT_INVALID');
    return {status:'legacy',companies:Object.freeze([]),context:null,activeCompanyId:null,contextVersion:value.contextVersion,error:''};
  }
  const ids=new Set();
  const companies=value.companies.map(item=>{
    if(!record(item)||!identifier(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>240||!COMPANY_ROLES.includes(item.role)||!positive(item.membershipVersion))throw error('COMPANY_CONTEXT_INVALID');
    ids.add(item.id);return Object.freeze({id:item.id,name:item.name,role:item.role,membershipVersion:item.membershipVersion});
  });
  if(value.selectionRequired===true){
    if(value.activeCompanyId!==null||value.context!=null||!identifier(value.actorId)||!companies.length)throw error('COMPANY_CONTEXT_INVALID');
    return {status:'selection_required',companies:Object.freeze(companies),context:null,actorId:value.actorId,activeCompanyId:null,contextVersion:value.contextVersion,error:''};
  }
  const context=assertCompanyContext(value.context);
  const selected=companies.find(item=>item.id===context.companyId);
  if(value.activeCompanyId!==context.companyId||value.contextVersion!==context.contextVersion||!selected||selected.role!==context.role||selected.membershipVersion!==context.membershipVersion)throw error('COMPANY_CONTEXT_INVALID');
  return {status:'ready',companies:Object.freeze(companies),context,activeCompanyId:context.companyId,contextVersion:context.contextVersion,error:''};
}

export function createCompanyClient({fetch:transport,baseUrl,onInvalidate=()=>{}}){
  if(typeof transport!=='function')throw TypeError('A transport is required');
  const origin=new URL(baseUrl).origin,listeners=new Set(),pending=new Set();
  let generation=0,disposed=false,initializing=null;
  let state=Object.freeze({status:'pending',companies:Object.freeze([]),context:null,activeCompanyId:null,contextVersion:null,error:''});
  const publish=next=>{state=Object.freeze(next);for(const listener of listeners){try{listener(state);}catch{/* A subscriber cannot weaken invalidation. */}}};
  const abortPending=()=>{for(const controller of pending)controller.abort();pending.clear();};
  function invalidate(reason='COMPANY_CONTEXT_STALE'){
    if(disposed||state.status==='blocked')return;
    generation++;abortPending();publish({...state,status:'blocked',context:null,companies:Object.freeze([]),activeCompanyId:null,error:message});onInvalidate(reason);
  }
  const current=(version,key)=>{if(disposed||version!==generation||!['ready','legacy'].includes(state.status)||(key&&companyCacheKey(state.context)!==key))throw error();};
  function target(input){const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,baseUrl);return {url,scoped:url.origin===origin&&url.pathname.startsWith('/api/')&&!authPaths.has(url.pathname)&&!url.pathname.startsWith('/api/auth/')};}
  function selectors(url,headers,context){
    const ids=url.searchParams.getAll('companyId'),versions=url.searchParams.getAll('companyContextVersion');
    if(ids.length>1||versions.length>1)throw error('COMPANY_CONTEXT_INVALID');
    for(const value of [headers.get('X-Company-Id'),...ids])if(value!==null&&value!==(context?.companyId??null))throw error('COMPANY_CONTEXT_INVALID');
    for(const value of [headers.get('X-Company-Context-Version'),...versions])if(value!==null&&value!==(context?String(context.contextVersion):null))throw error('COMPANY_CONTEXT_INVALID');
  }
  function guardResponse(response,version,key){
    // Guard consumption too: headers may arrive before a company switch while
    // JSON, PDF or image bytes are still being read from the network.
    return new Proxy(response,{get(source,property){
      if(['json','text','blob','arrayBuffer','formData','bytes'].includes(property)&&typeof source[property]==='function')return async(...args)=>{current(version,key);const result=await source[property](...args);current(version,key);return result;};
      if(property==='clone'&&typeof source.clone==='function')return ()=>{current(version,key);return guardResponse(source.clone(),version,key);};
      const value=Reflect.get(source,property,source);return typeof value==='function'?value.bind(source):value;
    }});
  }
  async function request(input,init){
    const {url,scoped}=target(input);if(!scoped)return transport(input,init);
    if(disposed||!['ready','legacy'].includes(state.status))throw error();
    const context=state.context,key=context?companyCacheKey(context):null,version=generation;
    const method=String(init?.method??(typeof input==='object'?input.method:undefined)??'GET').toUpperCase();
    if(context&&!['GET','HEAD'].includes(method)&&!hasCompanyPermission(context.role,'write'))throw Object.assign(new Error('Din roll har endast läsbehörighet i företaget.'),{code:'COMPANY_FORBIDDEN',status:403});
    if(context&&!['GET','HEAD'].includes(method)&&/^\/api\/(?:bank\/|gmail\/|bankgiro\/source\/|payment-control\/)/.test(url.pathname)&&!hasCompanyPermission(context.role,'manage_integrations'))throw Object.assign(new Error('Åtgärden kräver administratörsbehörighet för företagets anslutningar.'),{code:'COMPANY_FORBIDDEN',status:403});
    const headers=new Headers(init?.headers??(typeof input==='object'&&!(input instanceof URL)?input.headers:undefined));selectors(url,headers,context);
    if(context){headers.set('X-Company-Id',context.companyId);headers.set('X-Company-Context-Version',String(context.contextVersion));}
    const controller=new AbortController(),caller=init?.signal??(typeof input==='object'&&!(input instanceof URL)?input.signal:undefined);
    // AbortSignal.any retains caller cancellation even after response headers.
    const signal=caller?AbortSignal.any([controller.signal,caller]):controller.signal;pending.add(controller);
    try{
      const response=await transport(input,{...init,headers,signal,cache:'no-store'});current(version,key);
      if(response.status===401||response.status===403){invalidate('COMPANY_ACCESS_DENIED');throw error('COMPANY_ACCESS_DENIED',response.status);}
      const responseCompany=response.headers?.get('X-Company-Id'),responseVersion=response.headers?.get('X-Company-Context-Version');
      if(context&&(responseCompany!==null&&responseCompany!==undefined&&responseCompany!==context.companyId||responseVersion!==null&&responseVersion!==undefined&&responseVersion!==String(context.contextVersion))){invalidate();throw error();}
      // A version conflict is terminal for this document. Never retry a stale
      // mutation automatically under whichever company is currently selected.
      if(response.status===409){
        let stale=response.headers?.get('X-Company-Context-Stale')==='1';
        if(!stale&&typeof response.clone==='function'){try{stale=(await response.clone().json())?.code==='COMPANY_CONTEXT_STALE';}catch{/* A normal conflict still belongs to its existing caller. */}}
        current(version,key);if(stale){invalidate();throw error();}
      }
      return guardResponse(response,version,key);
    }catch(cause){if(generation!==version||disposed)throw cause?.code==='COMPANY_ACCESS_DENIED'?cause:error();throw cause;}
    finally{pending.delete(controller);}
  }
  async function readDirectory(){
    const response=await transport('/api/companies',{credentials:'same-origin',cache:'no-store'});
    if(response.status===401)return {status:'signed_out',companies:Object.freeze([]),context:null,activeCompanyId:null,contextVersion:null,error:''};
    if(!response.ok)throw error('COMPANY_CONTEXT_UNAVAILABLE',response.status);
    return directory(await response.json());
  }
  async function initialize(){
    if(disposed)throw error();if(initializing)return initializing;if(state.status!=='pending')return state;
    const version=generation;initializing=(async()=>{try{const next=await readDirectory();if(disposed||version!==generation)throw error();publish(next);return state;}catch(cause){invalidate('COMPANY_CONTEXT_UNAVAILABLE');throw cause;}finally{initializing=null;}})();return initializing;
  }
  async function revalidate(){
    if(disposed||!['ready','legacy'].includes(state.status))return false;
    const before=state,version=generation;
    try{const next=await readDirectory();if(disposed||generation!==version)return false;
      if(next.status!==before.status||next.contextVersion!==before.contextVersion||(next.context&&companyCacheKey(next.context)!==companyCacheKey(before.context))){invalidate();return false;}
      publish(next);return true;
    }catch{invalidate('COMPANY_CONTEXT_UNAVAILABLE');return false;}
  }
  async function switchCompany(companyId){
    if(disposed||!['ready','selection_required'].includes(state.status)||!state.companies.some(company=>company.id===companyId))throw error('COMPANY_CONTEXT_INVALID');
    const previous=state.context,actorId=previous?.actorId??state.actorId,contextVersion=state.contextVersion;
    if(companyId===previous?.companyId)return previous;
    generation++;abortPending();publish({...state,status:'switching',error:''});onInvalidate('COMPANY_CONTEXT_SWITCH');
    const version=generation;
    try{
      const headers={'Content-Type':'application/json',...(previous?{'X-Company-Id':previous.companyId,'X-Company-Context-Version':String(previous.contextVersion)}:{})};
      const response=await transport('/api/companies/active',{method:'POST',credentials:'same-origin',cache:'no-store',headers,body:JSON.stringify({companyId,contextVersion})});
      if(!response.ok)throw error('COMPANY_CONTEXT_SWITCH_FAILED',response.status);
      const body=await response.json(),next=assertCompanyContext(body.context);
      if(disposed||generation!==version||next.companyId!==companyId||next.actorId!==actorId||next.contextVersion<=contextVersion)throw error('COMPANY_CONTEXT_INVALID');
      publish({...state,context:next,activeCompanyId:next.companyId,contextVersion:next.contextVersion});return next;
    }catch(cause){invalidate('COMPANY_CONTEXT_SWITCH_FAILED');throw cause;}
  }
  function href(input){
    const {url,scoped}=target(input);if(!scoped)return String(input);
    if(disposed||!['ready','legacy'].includes(state.status))throw error();selectors(url,new Headers(),state.context);
    if(!state.context)return String(input);
    url.searchParams.set('companyId',state.context.companyId);url.searchParams.set('companyContextVersion',String(state.context.contextVersion));
    return typeof input==='string'&&input.startsWith('/')?url.pathname+url.search+url.hash:url.href;
  }
  return {
    get snapshot(){return state;},initialize,revalidate,switchCompany,fetch:request,href,invalidate,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    dispose(){if(disposed)return;disposed=true;generation++;abortPending();listeners.clear();},
  };
}

/** Installed only after bootstrap and before company UI mounts. Scope is one
 * browser document. Non-API/auth/third-party requests retain their exact input. */
export function installCompanyClientSurface(client,surface=window){
  const original=surface.fetch,wrapped=(...args)=>client.fetch(...args);let closed=false,checking=false;
  surface.fetch=wrapped;
  const document=surface.document;
  const decorate=node=>{
    if(client.snapshot.status!=='ready')return;
    const links=[...(node?.matches?.('a[href]')?[node]:[]),...Array.from(node?.querySelectorAll?.('a[href]')||[])];
    for(const link of links){const value=link.getAttribute('href');if(!value)continue;try{const next=client.href(value);if(next!==value)link.setAttribute('href',next);}catch{link.removeAttribute('href');}}
  };
  const clicked=event=>{
    const link=event.target?.closest?.('a[href]');if(!link)return;
    try{const value=link.getAttribute('href'),next=client.href(value);if(next!==value)link.setAttribute('href',next);}catch{event.preventDefault();event.stopImmediatePropagation?.();}
  };
  const check=async()=>{if(checking||closed||document?.visibilityState==='hidden')return;checking=true;try{await client.revalidate();}finally{checking=false;}};
  const restored=event=>{if(event.persisted)client.invalidate('COMPANY_CONTEXT_RESTORED');};
  document?.addEventListener('click',clicked,true);document?.addEventListener('auxclick',clicked,true);document?.addEventListener('visibilitychange',check);surface.addEventListener('focus',check);surface.addEventListener('pageshow',restored);
  let observer=null;if(typeof surface.MutationObserver==='function'&&document?.body){observer=new surface.MutationObserver(records=>{for(const item of records){if(item.type==='attributes')decorate(item.target);else for(const node of item.addedNodes)decorate(node);}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});decorate(document);}
  return ()=>{if(closed)return;closed=true;observer?.disconnect();document?.removeEventListener('click',clicked,true);document?.removeEventListener('auxclick',clicked,true);document?.removeEventListener('visibilitychange',check);surface.removeEventListener('focus',check);surface.removeEventListener('pageshow',restored);if(surface.fetch===wrapped)surface.fetch=original;};
}
