import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {BankProviderError,assertServerRuntime,isRecord,safeText} from '../bank-data-provider.js';
import {validateOpenPaymentsConfig} from './config.js';
import {createOpenPaymentsTokenFence} from './token-coordinator-fence.js';

// One SQL owner per provider application and corporate PSU context. Company
// guards and HTTP clients are supplied only for the current exchange, never
// retained in the shared state. No DDL, provider fallback, or plaintext storage.
const capabilities=new WeakMap(),receipts=new WeakMap();
const SQL_NOW="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const CONTROL='company_application_token_control',STATE='company_application_tokens';
const MAX_TIME=8640000000000000,MAX_TOKEN_MS=3600000,LEASE_MS=30000,DISPATCH_MS=20000;
const READY=`EXISTS(SELECT 1 FROM ${CONTROL} WHERE id=1 AND recovery_required=0)`;
const hash=value=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const configParts=c=>[c.environment,c.clientId,c.clientSecret,c.credentialGeneration,c.credentialsValidUntil,c.apiVersion,c.scopes,c.features,c.redirectUris];
const configKey=c=>hash(configParts(c));
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const fail=(code,status=409,options)=>{throw new BankProviderError(code,status,options);};
const storage=()=>new BankProviderError('APPLICATION_TOKEN_STORAGE_UNAVAILABLE',503);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);

/** Only this factory can produce a coordinator accepted by TokenClient. */
export function assertOpenPaymentsTokenCoordinator(value,configuration){
 const capability=capabilities.get(value);
 if(!capability||configuration&&capability.configKey!==configKey(configuration))fail('PROVIDER_CONFIGURATION_INVALID');
 return value;
}

export function createOpenPaymentsTokenCoordinator({database,codec,configuration,transportIdentity,certificateValidUntil,now=Date.now,assertCurrent}={}){
 assertServerRuntime();
 if(typeof database?.prepare!=='function'||typeof codec?.seal!=='function'||typeof codec?.unseal!=='function'||typeof assertCurrent!=='function'||typeof now!=='function'||!hex(transportIdentity))fail('PROVIDER_CONFIGURATION_INVALID');
 const config=validateOpenPaymentsConfig(configuration,now),familyKey=hash(['openpayments-app-v1',config.environment,config.clientId,'corporate']);
 if(certificateValidUntil!==undefined&&!integer(certificateValidUntil,1,MAX_TIME)||config.environment==='PRODUCTION'&&certificateValidUntil===undefined)fail('INVALID_CLIENT_CERTIFICATE');
 const configHash=hash(['openpayments-config-v1',...configParts(config),transportIdentity,certificateValidUntil??null]);
 const binding=Object.freeze({familyKey,configHash});
 const prepared=(sql,args)=>database.prepare(sql).bind(...args);
 async function first(sql,...args){try{return await prepared(sql,args).first();}catch{throw storage();}}
 async function run(sql,...args){
  let result;try{result=await prepared(sql,args).run();}catch{throw storage();}
  if(result?.success===false||!integer(result?.meta?.changes))throw storage();return result.meta.changes;
 }
 async function current(){
  await assertCurrent();
  if(config.credentialsValidUntil&&Date.parse(config.credentialsValidUntil)<=now())fail('CREDENTIALS_EXPIRED');
  if(certificateValidUntil!==undefined&&certificateValidUntil<=now())fail('CLIENT_CERTIFICATE_EXPIRED');
 }
 async function control(allowRecovery=false){
  const row=await first(`SELECT *, (SELECT count(*) FROM ${CONTROL}) AS rows FROM ${CONTROL} WHERE id=1`);
  if(!row||row.rows!==1||row.id!==1||!integer(row.revision,1)||![0,1].includes(row.recovery_required)||typeof row.restore_marker!=='string'||row.restore_marker.length>100||typeof row.recovery_evidence!=='string'||row.recovery_evidence.length>200)throw storage();
  if(row.recovery_required&&!allowRecovery)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
  return row;
 }
 function validRow(row){
  if(!row)return null;
  if(row.family_key!==familyKey||!hex(row.config_hash)||typeof row.configuration_evidence!=='string'||row.configuration_evidence.length>200||!integer(row.epoch,1)||!integer(row.revision,1)||!integer(row.fence)||
   ['expires_at','lease_until','uncertain_until','cooldown_until','updated_at','db_now'].some(key=>!integer(row[key],0,MAX_TIME))||
   ![0,1].includes(row.cooldown_blocked)||typeof row.token_ciphertext!=='string'||row.token_ciphertext.length>32768||typeof row.token_version!=='string'||row.token_version.length>100||typeof row.lease_token!=='string'||row.lease_token.length>100||
   typeof row.last_safe_code!=='string'||!/^[A-Z_]{0,80}$/.test(row.last_safe_code)||
   (row.token_ciphertext===''?row.token_version!==''||row.expires_at!==0:!row.token_version||row.expires_at<=0)||
   (row.lease_token===''?row.lease_until!==0:row.lease_until<=0||row.uncertain_until<row.lease_until))throw storage();
  return row;
 }
 const row=async()=>validRow(await first(`SELECT *,${SQL_NOW} AS db_now FROM ${STATE} WHERE family_key=?`,familyKey));
 function active(value){if(value&&value.config_hash!==configHash)fail('APPLICATION_TOKEN_CONFIGURATION_CHANGED');return value;}
 async function read(){
  await current();const gate=await control(),value=active(await row()),fresh=await control();await current();
  if(fresh.revision!==gate.revision)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
  if(value)Object.defineProperty(value,'controlRevision',{value:gate.revision});return{gate,value};
 }
 async function ensure(){
  let {value}=await read();if(value)return value;
  await run(`INSERT INTO ${STATE}(family_key,config_hash,updated_at) SELECT ?,?,${SQL_NOW} WHERE ${READY} ON CONFLICT(family_key) DO NOTHING`,familyKey,configHash);
  ({value}=await read());if(!value)throw storage();return value;
 }
 function cooldown(value){
  if(value?.cooldown_blocked)fail('PROVIDER_RATE_LIMIT',429,{retryBlocked:true});
  if(value&&value.cooldown_until>value.db_now)fail('PROVIDER_RATE_LIMIT',429,{retryable:true,retryAfter:Math.ceil((value.cooldown_until-value.db_now)/1000)});
 }
 async function receipt(value,minRemaining=30000){
  const bound=Object.freeze({...binding,epoch:value.epoch,tokenVersion:value.token_version});let payload;
  try{payload=await codec.unseal(bound,value.token_ciphertext);}catch{throw storage();}
  if(!isRecord(payload)||payload.version!==1||JSON.stringify(payload.binding)!==JSON.stringify(bound)||!safeText(payload.value,16384)||payload.expiresAt!==value.expires_at||!integer(payload.issuedAt,1,MAX_TIME)||payload.expiresAt>payload.issuedAt+MAX_TOKEN_MS||payload.expiresAt<=payload.issuedAt)throw storage();
  const fresh=(await read()).value;
  if(fresh?.controlRevision!==value.controlRevision)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
  if(!fresh||fresh.epoch!==value.epoch||fresh.token_version!==value.token_version||fresh.token_ciphertext!==value.token_ciphertext||fresh.expires_at<=fresh.db_now+minRemaining)fail('INVALID_ACCESS_TOKEN',401);
  const result=Object.freeze({value:payload.value,expiresAt:payload.expiresAt});receipts.set(result,{...bound,owner:capability});return result;
 }
 async function saveCooldown(error,owned){
  if(error?.code!=='PROVIDER_RATE_LIMIT')return;
  const {value}=await read();if(!value)throw storage();
  if(owned&&value.controlRevision!==owned.controlRevision)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
  const seconds=integer(error.retryAfter,1)?error.retryAfter:60;
  const blocked=error.retryBlocked===true||!integer(value.db_now+seconds*1000,0,MAX_TIME);
  const until=blocked?0:value.db_now+seconds*1000;
  const ownedSql=owned?' AND epoch=? AND lease_token=? AND fence=?':'';
  const args=owned?[owned.epoch,owned.lease_token,owned.fence]:[];
  const changed=await run(`UPDATE ${STATE} SET cooldown_until=MAX(cooldown_until,?),cooldown_blocked=MAX(cooldown_blocked,?),last_safe_code='PROVIDER_RATE_LIMIT',${owned?"lease_token='',lease_until=0,uncertain_until=0,":''}revision=revision+1,updated_at=${SQL_NOW} WHERE family_key=? AND config_hash=?${ownedSql} AND ${READY} AND (SELECT revision FROM ${CONTROL} WHERE id=1)=?`,until,blocked?1:0,familyKey,configHash,...args,value.controlRevision);
  if(changed!==1)fail('APPLICATION_TOKEN_LEASE_LOST');
 }
 async function cleanFailure(owned,error,sent){
  if(error?.code==='PROVIDER_RATE_LIMIT'&&!error.mayHaveSucceeded){await saveCooldown(error,owned);return;}
  // Before the internal dispatch fence succeeds no HTTP operation was allowed.
  // Afterwards even parse/codec failures leave a bounded uncertainty embargo.
  await run(`UPDATE ${STATE} SET lease_token='',lease_until=0,${sent?'':"uncertain_until=0,"}last_safe_code=?,revision=revision+1,updated_at=${SQL_NOW} WHERE family_key=? AND config_hash=? AND epoch=? AND lease_token=? AND fence=? AND ${READY} AND (SELECT revision FROM ${CONTROL} WHERE id=1)=?`,
   error instanceof BankProviderError&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'PROVIDER_UNAVAILABLE_NETWORK',familyKey,configHash,owned.epoch,owned.lease_token,owned.fence,owned.controlRevision);
 }
 async function issueOwned(owned,issue){
  let sent=false;
  const assertBeforeSend=async(assertCaller)=>{
   if(sent)fail('APPLICATION_TOKEN_LEASE_LOST');
   if(assertCaller!==undefined&&typeof assertCaller!=='function')fail('PROVIDER_CONFIGURATION_INVALID');
   const checkedAt=performance.now();
   const value=(await read()).value;
   if(value?.controlRevision!==owned.controlRevision)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
   if(!value||value.epoch!==owned.epoch||value.lease_token!==owned.lease_token||value.fence!==owned.fence||value.lease_until<=value.db_now)fail('APPLICATION_TOKEN_LEASE_LOST');
   // The caller's own tenant authority may change while the global SQL read is
   // queued. Recheck it afterwards, before acknowledging a possible dispatch.
   // Monotonic elapsed time conservatively bounds the age of that DB clock.
   if(assertCaller)await assertCaller();
   if(value.lease_until-value.db_now<=performance.now()-checkedAt)fail('APPLICATION_TOKEN_LEASE_LOST');
   sent=true;
  };
  try{
   const parsed=await issue({startedAt:owned.updated_at,maxExpiresAt:owned.uncertain_until,assertBeforeSend});
   if(!sent)fail('APPLICATION_TOKEN_LEASE_LOST');
   if(!isRecord(parsed)||!safeText(parsed.value,16384)||!integer(parsed.seconds,1,3600))fail('INVALID_OAUTH_RESULT',502);
   await current();await control();
   const expiresAt=Math.min(owned.updated_at+parsed.seconds*1000,config.credentialsValidUntil?Date.parse(config.credentialsValidUntil):MAX_TIME,certificateValidUntil??MAX_TIME);
   const tokenVersion=crypto.randomUUID(),bound=Object.freeze({...binding,epoch:owned.epoch,tokenVersion});
   const payload={version:1,binding:bound,value:parsed.value,expiresAt,issuedAt:owned.updated_at};let encrypted;
   try{encrypted=await codec.seal(bound,payload);}catch{throw storage();}
   if(typeof encrypted!=='string'||!encrypted||encrypted.length>32768||encrypted===parsed.value)throw storage();
   await current();await control();
   const changes=await run(`UPDATE ${STATE} SET token_ciphertext=?,token_version=?,expires_at=?,lease_token='',lease_until=0,uncertain_until=0,last_safe_code='',revision=revision+1,updated_at=${SQL_NOW} WHERE family_key=? AND config_hash=? AND epoch=? AND lease_token=? AND fence=? AND lease_until>${SQL_NOW} AND ?>${SQL_NOW} AND ${READY} AND (SELECT revision FROM ${CONTROL} WHERE id=1)=?`,
    encrypted,tokenVersion,expiresAt,familyKey,configHash,owned.epoch,owned.lease_token,owned.fence,expiresAt,owned.controlRevision);
   if(changes!==1)fail('APPLICATION_TOKEN_LEASE_LOST');
   const value=(await read()).value;
   if(!value||value.token_version!==tokenVersion)fail('INVALID_ACCESS_TOKEN',401);
   return receipt(value,0);
  }catch(error){await cleanFailure(owned,error,sent);throw error;}
 }
 async function access(issue){
  if(typeof issue!=='function')fail('PROVIDER_CONFIGURATION_INVALID');
  for(let attempt=0;attempt<=30;attempt++){
   const value=await ensure();
   if(value.token_ciphertext&&value.expires_at>value.db_now+30000)return receipt(value);
   cooldown(value);
   if(value.lease_token&&value.lease_until>value.db_now){if(attempt===30)fail('APPLICATION_TOKEN_BUSY',409,{retryable:true,retryAfter:1});await sleep(25);continue;}
   if(value.uncertain_until>value.db_now)fail('APPLICATION_TOKEN_UNCERTAIN',409,{retryable:true,retryAfter:Math.ceil((value.uncertain_until-value.db_now)/1000)});
   const lease=crypto.randomUUID();
   const changes=await run(`UPDATE ${STATE} SET lease_token=?,lease_until=${SQL_NOW}+${LEASE_MS},uncertain_until=${SQL_NOW}+${LEASE_MS+DISPATCH_MS+MAX_TOKEN_MS},fence=fence+1,revision=revision+1,updated_at=${SQL_NOW} WHERE family_key=? AND config_hash=? AND epoch=? AND revision=? AND lease_until<=${SQL_NOW} AND uncertain_until<=${SQL_NOW} AND cooldown_blocked=0 AND cooldown_until<=${SQL_NOW} AND expires_at<=${SQL_NOW}+30000 AND ${READY} AND (SELECT revision FROM ${CONTROL} WHERE id=1)=?`,lease,familyKey,configHash,value.epoch,value.revision,value.controlRevision);
   if(changes!==1)continue;
   const owned=(await read()).value;
   if(!owned||owned.lease_token!==lease)fail('APPLICATION_TOKEN_LEASE_LOST');
   return issueOwned(owned,issue);
  }
  fail('APPLICATION_TOKEN_BUSY',409,{retryable:true,retryAfter:1});
 }
 const capability=Object.freeze({
  binding,
  async assertCurrent(){await read();},
  async ensureRegistered(){await ensure();},
  async captureFence(){const {gate,value}=await read();return createOpenPaymentsTokenFence({database,...binding,epoch:value?.epoch||1,controlRevision:gate.revision});},
  access,
  async invalidate(value){
   const issued=receipts.get(value);if(!issued||issued.owner!==capability)fail('INVALID_ACCESS_TOKEN',401);
   await read();await run(`UPDATE ${STATE} SET token_ciphertext='',token_version='',expires_at=0,revision=revision+1,updated_at=${SQL_NOW} WHERE family_key=? AND config_hash=? AND epoch=? AND token_version=? AND ${READY}`,familyKey,configHash,issued.epoch,issued.tokenVersion);
  },
  async assertIssuerAvailable(){const value=await ensure();cooldown(value);},
  async recordIssuerFailure(error){if(error?.code!=='PROVIDER_RATE_LIMIT')return;await ensure();await saveCooldown(error);},
  async rotate({expectedConfigHash,expectedEpoch,evidenceId}={}){
   if(!hex(expectedConfigHash)||!integer(expectedEpoch,1)||!evidence(evidenceId)||expectedConfigHash===configHash)fail('APPLICATION_TOKEN_CONFIGURATION_CHANGED');
   await current();await control();
   const changes=await run(`UPDATE ${STATE} SET config_hash=?,configuration_evidence=?,epoch=epoch+1,revision=revision+1,fence=fence+1,uncertain_until=MAX(uncertain_until,expires_at),token_ciphertext='',token_version='',expires_at=0,lease_token='',lease_until=0,last_safe_code='APPLICATION_TOKEN_CONFIGURATION_CHANGED',updated_at=${SQL_NOW} WHERE family_key=? AND config_hash=? AND epoch=? AND ${READY}`,configHash,evidenceId,familyKey,expectedConfigHash,expectedEpoch);
   if(changes!==1)fail('APPLICATION_TOKEN_CONFIGURATION_CHANGED');await read();
  },
  async releaseRecovery({expectedRevision,expectedMarker,evidenceId}={}){
   if(!integer(expectedRevision,1)||!safeText(expectedMarker,100)||!evidence(evidenceId))fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
   await current();const gate=await control(true);
   if(!gate.recovery_required||gate.revision!==expectedRevision||gate.restore_marker!==expectedMarker)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
   const exists=await first("SELECT name FROM sqlite_master WHERE type='table' AND name=?",STATE);
   if(exists&&(await first(`SELECT count(*) AS rows FROM ${STATE}`))?.rows!==0)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
   const changes=await run(`UPDATE ${CONTROL} SET recovery_required=0,recovery_evidence=?,revision=revision+1 WHERE id=1 AND recovery_required=1 AND revision=? AND restore_marker=?`,evidenceId,expectedRevision,expectedMarker);
   if(changes!==1)fail('APPLICATION_TOKEN_RECOVERY_REQUIRED');
  },
 });
 capabilities.set(capability,{configKey:configKey(config)});return capability;
}
