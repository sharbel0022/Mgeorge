import {rmSync} from 'node:fs';

// Test-only ownership of the child, its close event and the SQLite lock holder.
export function createStartupResources(t,folder){
 let holder,child,closed,cleanupPromise;
 const releaseHolder=()=>{
  const current=holder;holder=undefined;
  if(current){try{current.exec('ROLLBACK');}finally{current.close();}}
 };
 const cleanup=()=>cleanupPromise??=(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill();
  if(closed)await closed;
  try{releaseHolder();}finally{rmSync(folder,{recursive:true,force:true});}
 })();
 // RED baseline: the caller invokes cleanup only from its own finally.
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
