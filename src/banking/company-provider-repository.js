import {assertCompanyContext,assertCompanyPermission,companyCacheKey} from '../../sites/lib/company-contract.js';
import {createCompanyProviderRepository,providerRepositoryError} from '../../sites/lib/banking/company-provider-repository.js';

/** Thin adapter over the current runtime's physically scoped SQLite proxy.
 * Existing integration lease.write synchronously owns BOTH the catalogue and
 * tenant transaction. No raw partition path or financial API is exposed.
 * sessionHash is the actual authenticated request hash, not browserHash. */
export function createNodeCompanyProviderRepository({db,codec,currentContext,assertCurrent,retainedProviderGrantInUse,sessionHash,now=Date.now,randomId}={}){
 if(!db||typeof db.prepare!=='function'||typeof currentContext!=='function'||typeof assertCurrent!=='function'||typeof retainedProviderGrantInUse!=='function')throw TypeError('Runtime-owned provider repository adapters required');
 const statements=new WeakMap();
 const synchronous=value=>{if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw providerRepositoryError('RESOURCE_SCOPE_MISMATCH',403);}return value;};
 const prepare=(query,args=[])=>{
  const execute=()=>{
   const real=db.prepare(query);
   return real.columns().length?{success:true,results:real.all(...args),meta:{changes:0}}:{success:true,results:[],meta:{changes:Number(real.run(...args).changes)}};
  };
  const statement={bind(...values){return prepare(query,values);},async first(){return db.prepare(query).get(...args)??null;},async all(){return {results:db.prepare(query).all(...args)};},async run(){return execute();}};
  statements.set(statement,execute);return statement;
 };
 return createCompanyProviderRepository({database:{prepare},codec,currentContext,assertCurrent,flowDialect:'node',sessionHash,now,...(randomId?{randomId}:{}),
  write({context,lease,statements:batch,grantFingerprint,connectionId,sessionHash:expectedSession}){
   if(typeof lease?.write!=='function')throw providerRepositoryError('RESOURCE_SCOPE_MISMATCH',403);
   return synchronous(lease.write(()=>{
    const actual=assertCompanyContext(synchronous(currentContext()));
    if(companyCacheKey(actual)!==companyCacheKey(context))throw providerRepositoryError('RESOURCE_SCOPE_MISMATCH',403);
    assertCompanyPermission(actual.role,'manage_integrations');synchronous(assertCurrent(context,'manage_integrations'));synchronous(lease.assert());
    if(expectedSession!==undefined&&synchronous(sessionHash?.())!==expectedSession)throw providerRepositoryError('RESOURCE_SCOPE_MISMATCH',403);
    if(grantFingerprint){const inUse=synchronous(retainedProviderGrantInUse(grantFingerprint,connectionId));if(inUse!==false)throw providerRepositoryError('PROVIDER_GRANT_REUSED');}
    const results=batch.map(item=>{const execute=statements.get(item);if(!execute)throw providerRepositoryError('RESOURCE_SCOPE_MISMATCH',403);return execute();});
    synchronous(assertCurrent(context,'manage_integrations'));return results;
   }));
  },
 });
}
