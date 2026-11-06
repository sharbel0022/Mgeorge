import {BankProviderError,assertServerRuntime} from '../bank-data-provider.js';

// Cache identities come only from a verified server transport. They contain no
// credentials and are never serialized. Weak ownership lets a retired runtime
// release its cache, while each live transport is independently bounded.
const identities=new WeakMap();
const MAX_ENTRIES=128,MAX_IDLE_MS=3600000;
const invalid=()=>new BankProviderError('INVALID_ACCESS_TOKEN',401);
export const freshTokenState=()=>({token:null,flight:null,cooldown:null,epoch:0,retired:false,lastUsed:0});
export function invalidateTokenState(state,receipt){
 // An API response rejects exactly the token used by that request. A delayed
 // 401 must not retire a newer token, including a newly issued identical value.
 if(receipt!==undefined){if(state.token!==receipt)return;state.token=null;if(!state.flight)state.epoch++;return;}
 state.epoch++;state.token=null;state.flight=null;
}
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
  if(!state.flight&&!cooling(state,now)&&(now-state.lastUsed>=MAX_IDLE_MS||state.token&&state.token.expiresAt<=now)){
   retire(state);cache.entries.delete(storedKey);
  }
 }
 let state=cache.entries.get(key);
 if(state)cache.entries.delete(key);
 else{
  if(cache.entries.size>=MAX_ENTRIES){
   const oldest=[...cache.entries].find(([,value])=>!cooling(value,now));
   if(!oldest)throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryBlocked:true});
   retire(oldest[1]);cache.entries.delete(oldest[0]);
  }
  state=freshTokenState();
 }
 state.lastUsed=now;cache.entries.set(key,state);return state;
}
function cooling(state,now){return !!state.cooldown&&(state.cooldown.blocked||state.cooldown.until>now);}
export function invalidateSharedTokenState(identity,key,receipt){
 const state=identities.get(identity)?.entries.get(key);if(state)invalidateTokenState(state,receipt);
}
