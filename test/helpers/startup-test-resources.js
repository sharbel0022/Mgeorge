import {rmSync} from 'node:fs';

// Test-only ownership of the child, its close event and the SQLite lock holder.
export function createStartupResources(t,folder){
 let holder,child,closed,cleanupPromise;
 const releaseHolder=()=>{
  const current=holder;holder=undefined;
  if(current){try{current.exec('ROLLBACK');}finally{current.close();}}
 };
 const cleanup=()=>cleanupPromise??=(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  if(closed)await closed;
  try{releaseHolder();}finally{rmSync(folder,{recursive:true,force:true});}
 })();
 // The event listener starts teardown immediately; the caller and after hook
 // await the same promise and report any cleanup error.
 const onAbort=()=>{void cleanup().catch(()=>{});};
 t.after(cleanup);
 t.signal.addEventListener('abort',onAbort,{once:true});
 if(t.signal.aborted){onAbort();throw t.signal.reason;}
 return {
  hold(value){holder=value;return value;},
  watch(value){
   child=value;
   closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
   return new Promise((resolve,reject)=>{child.once('error',reject);closed.then(resolve);});
  },
  releaseHolder,
  cleanup,
 };
}
