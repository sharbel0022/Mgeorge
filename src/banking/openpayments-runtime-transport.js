import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {isAbsolute,parse,resolve,join,sep} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {createOpenPaymentsNodeTransport} from './openpayments-node-transport.js';
import {createOpenPaymentsTokenCacheIdentity,invalidateOpenPaymentsTokenCacheIdentity} from '../../sites/lib/banking/openpayments/token-cache.js';

const MAX_PEM_BYTES=128*1024;
const CONFIG_KEY='SAAS_OPENPAYMENTS_MTLS_CONFIG';
const digest=value=>createHash('sha256').update(value).digest('hex');
const denied=()=>Object.assign(new Error('The server client certificate configuration could not be verified.'),{code:'INVALID_CLIENT_CERTIFICATE',status:409});
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identities=new WeakMap();
function forgetIdentity(environment){const current=identities.get(environment);if(current)invalidateOpenPaymentsTokenCacheIdentity(current.identity);identities.delete(environment);}

function credentialFile(path,privateKey=false) {
  let fd;
  try {
    if(typeof path!=='string'||!path||path.length>4096||!isAbsolute(path)||resolve(path)!==path||/[\u0000-\u001f\u007f]/.test(path))throw denied();
    let current=parse(path).root;
    for(const part of path.slice(current.length).split(sep)){
      current=join(current,part);if(lstatSync(current).isSymbolicLink())throw denied();
    }
    fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
    const before=fstatSync(fd);
    // File credentials are a POSIX server deployment interface. In particular,
    // a Windows mode bit is not accepted as proof of an owner-only key ACL.
    if(!before.isFile()||before.size<1||before.size>MAX_PEM_BYTES||before.mode&0o022||
      privateKey&&(typeof process.getuid!=='function'||before.uid!==process.getuid()||before.mode&0o077))throw denied();
    const bytes=Buffer.alloc(MAX_PEM_BYTES+1);let length=0,read;
    while(length<bytes.length&&(read=readSync(fd,bytes,length,bytes.length-length,null))>0)length+=read;
    const after=fstatSync(fd),named=lstatSync(path);
    if(length!==before.size||length>MAX_PEM_BYTES||named.isSymbolicLink()||
      ['dev','ino','size','mtimeMs','ctimeMs','mode','uid'].some(key=>before[key]!==after[key]||after[key]!==named[key]))throw denied();
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
  } catch { throw denied(); }
  finally {if(fd!==undefined)closeSync(fd);}
}

/** Server-only opt-in. No body/query/header can select credentials, hosts or CA.
 * Missing configuration keeps production disabled. Existing injected transports
 * remain an explicit trusted composition boundary for isolated tests/adapters. */
export function configuredOpenPaymentsNodeTransport({environment=process.env,configuration}={}) {
  if(environment.SAAS_BANK_ENABLED!=='true'||configuration?.environment!=='PRODUCTION'){forgetIdentity(environment);return null;}
  const raw=environment[CONFIG_KEY],providerRaw=environment.SAAS_OPENPAYMENTS_CONFIG;if(raw===undefined||raw===''){forgetIdentity(environment);return null;}
  let config;
  try {
    if(typeof raw!=='string'||raw.length>20000)throw denied();config=JSON.parse(raw);
    const keys=['version','credentialGeneration','certificateFile','privateKeyFile','certificateSha256','caFile','caSha256'];
    if(!plain(config)||Object.keys(config).some(key=>!keys.includes(key))||config.version!==1||
      typeof config.credentialGeneration!=='string'||!config.credentialGeneration||config.credentialGeneration!==configuration.credentialGeneration||
      !hex(config.certificateSha256)||Object.hasOwn(config,'caFile')!==Object.hasOwn(config,'caSha256')||
      Object.hasOwn(config,'caFile')&&!hex(config.caSha256))throw denied();
  } catch {forgetIdentity(environment);throw denied();}
  const material=()=>{
    const certificatePem=credentialFile(config.certificateFile),privateKeyPem=credentialFile(config.privateKeyFile,true);
    const caPem=Object.hasOwn(config,'caFile')?credentialFile(config.caFile):undefined;
    try {
      if(new X509Certificate(certificatePem).fingerprint256.replaceAll(':','').toLowerCase()!==config.certificateSha256||
        caPem!==undefined&&digest(caPem)!==config.caSha256)throw denied();
    } catch {throw denied();}
    return {certificatePem,privateKeyPem,...(caPem===undefined?{}:{caPem})};
  };
  let initial,native;
  try{initial=material();native=createOpenPaymentsNodeTransport(initial);}
  catch(error){forgetIdentity(environment);throw error;}
  const fingerprint=digest(JSON.stringify(initial)),binding=digest(JSON.stringify([raw,providerRaw,fingerprint]));
  let identity=identities.get(environment);
  if(identity?.binding!==binding){forgetIdentity(environment);identity={binding,identity:createOpenPaymentsTokenCacheIdentity()};identities.set(environment,identity);}
  const cacheIdentity=identity.identity,invalidateTokenCache=()=>{invalidateOpenPaymentsTokenCacheIdentity(cacheIdentity);if(identities.get(environment)?.identity===cacheIdentity)identities.delete(environment);};
  const validateCertificate=()=>{
    try{
      if(environment[CONFIG_KEY]!==raw||environment.SAAS_OPENPAYMENTS_CONFIG!==providerRaw||identities.get(environment)?.identity!==cacheIdentity||digest(JSON.stringify(material()))!==fingerprint)throw denied();
      native.validateCertificate();
    }catch(error){invalidateTokenCache();if(identities.get(environment)?.identity===cacheIdentity)identities.delete(environment);throw error;}
  };
  return Object.freeze({kind:'mtls',cacheIdentity,invalidateTokenCache,validateCertificate,async request(input,init){
    validateCertificate();const response=await native.request(input,init);
    try{validateCertificate();return response;}
    catch(error){try{await response.body?.cancel();}catch{}throw error;}
  }});
}
