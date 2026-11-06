import {BankProviderError,assertServerRuntime} from '../bank-data-provider.js';

// Cache identities come only from a verified server transport. They contain no
// credentials and are never serialized. Weak ownership lets a retired runtime
// release its cache, while each live transport is independently bounded.
const identities=new WeakMap();
const MAX_ENTRIES=128,MAX_IDLE_MS=3600000;
const invalid=()=>new BankProviderError('INVALID_ACCESS_TOKEN',401);
export const freshTokenState=()=>({token:null,flight:null,epoch:0,retired:false,lastUsed:0});
export function invalidateTokenState(state){state.epoch++;state.token=null;state.flight=null;}
function retire(state){invalidateTokenState(state);state.retired=true;}

export function createOpenPaymentsTokenCacheIdentity(){
 assertServerRuntime();const identity=Object.freeze({});identities.set(identity,{active:true,entries:new Map()});return identity;
}
function cacheFor(identity){
 const cache=identities.get(identity);if(!cache?.active)throw invalid();return cache;
}
export function assertOpenPaymentsTokenCacheIdentity(identity){cacheFor(identity);}
export function invalidateOpenPaymentsTokenCacheIdentity(identity){
 const cache=identities.get(identity);if(!cache)return;cache.active=false;
 for(const state of cache.entries.values())retire(state);cache.entries.clear();
}
export function sharedTokenState(identity,key,now){
 const cache=cacheFor(identity);
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!Number.isFinite(now))throw invalid();
 for(const [storedKey,state]of cache.entries){
  if(!state.flight&&(now-state.lastUsed>=MAX_IDLE_MS||state.token&&state.token.expiresAt<=now)){
   retire(state);cache.entries.delete(storedKey);
  }
 }
 let state=cache.entries.get(key);
 if(state)cache.entries.delete(key);
 else{
  if(cache.entries.size>=MAX_ENTRIES){const oldest=cache.entries.keys().next().value;retire(cache.entries.get(oldest));cache.entries.delete(oldest);}
  state=freshTokenState();
 }
 state.lastUsed=now;cache.entries.set(key,state);return state;
}
export function invalidateSharedTokenState(identity,key){
 const state=identities.get(identity)?.entries.get(key);if(state)invalidateTokenState(state);
}
