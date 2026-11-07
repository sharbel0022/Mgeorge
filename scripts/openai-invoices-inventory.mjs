import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const BASE='https://api.openai.com/v1';
const modelId=value=>typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,160}$/.test(value);
const projectId=value=>typeof value==='string'&&/^proj_[A-Za-z0-9_-]{1,150}$/.test(value);
const secret=value=>typeof value==='string'&&/^[\x21-\x7e]{1,4096}$/.test(value);
async function readJson(url,key,fetchImpl,headers={}){
  const controller=new AbortController();let timer;
  const operation=(async()=>{
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+key,...headers}});
    if(response.status!==200)throw Object.assign(Error('request_failed'),{status:response.status});
    const reader=response.body?.getReader();let text='',size=0;
    if(reader){const decoder=new TextDecoder('utf-8',{fatal:true});try{
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1_000_000)throw Error('response_limit');text+=decoder.decode(part.value,{stream:true});}
      text+=decoder.decode();
    }finally{reader.releaseLock();}}
    else{text=await response.text();if(new TextEncoder().encode(text).length>1_000_000)throw Error('response_limit');}
    return JSON.parse(text);
  })();
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('request_timeout'));},15000);})]);}
  finally{clearTimeout(timer);controller.abort();}
}

/** Read-only metadata probe. Never sends invoice content or performs paid generation. */
export async function inspectOpenAiProject({apiKey,adminKey,project,allowNetwork=false,includeCosts=false,fetchImpl=fetch,now=new Date()}={}){
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('invalid_inventory_time');
  const report={
    schemaVersion:1,checkedAt:now.toISOString(),networkAuthorized:allowNetwork===true,
    project:projectId(project)?project:null,
    models:{status:'NOT_VERIFIED',reason:'NETWORK_DISABLED',ids:null,lunaAvailable:null,solAvailable:null},
    usageCosts:{status:'NOT_VERIFIED',reason:includeCosts?'NETWORK_DISABLED':'NOT_REQUESTED',period:null,amountUsd:null},
    prepaidCredits:{status:'NOT_VERIFIED',reason:'AUTHORIZED_BILLING_DASHBOARD_REQUIRED',amount:null},
    providerBudget:{status:'NOT_VERIFIED',reason:'AUTHORIZED_PROJECT_BUDGET_CONFIGURATION_REQUIRED',amount:null},
    notes:['Model listing is access evidence, not an executed multimodal extraction.','Costs are historical usage, not prepaid credit or a confirmed hard budget.','No invoice, prompt, key or provider error body is retained.'],
  };
  if(allowNetwork!==true)return report;
  if(!secret(apiKey)){report.models.reason='API_KEY_MISSING';}
  else{
    try{
      const data=await readJson(BASE+'/models',apiKey,fetchImpl,projectId(project)?{'OpenAI-Project':project}:{});
      if(data.object!=='list'||!Array.isArray(data.data)||data.data.length>5000||data.data.some(x=>!modelId(x?.id)))throw Error('invalid_model_list');
      const ids=[...new Set(data.data.map(x=>x.id))].sort();
      report.models={status:'VERIFIED_LIST',reason:null,ids,lunaAvailable:ids.includes('gpt-6-luna'),solAvailable:ids.includes('gpt-6.1-sol')};
    }catch{report.models.reason='MODEL_LIST_UNAVAILABLE';}
  }
  if(!includeCosts)return report;
  if(!secret(adminKey)){report.usageCosts.reason='ADMIN_KEY_MISSING';return report;}
  if(!projectId(project)){report.usageCosts.reason='PROJECT_SCOPE_REQUIRED';return report;}
  const end=Math.floor(now.getTime()/1000),start=Math.floor(end/86400)*86400-7*86400;
  report.usageCosts.period={startTime:start,endTime:end};
  try{
    // Explicit project filter avoids disclosing unrelated organization spend.
    const query=new URLSearchParams({start_time:String(start),end_time:String(end),limit:'8',bucket_width:'1d'});
    query.append('project_ids',project);
    const data=await readJson(BASE+'/organization/costs?'+query,adminKey,fetchImpl);
    if(data.object!=='page'||data.has_more!==false||!Array.isArray(data.data)||data.data.length>8)throw Error('incomplete_costs');
    let amount=0,buckets=0;
    for(const bucket of data.data){
      if(!Number.isSafeInteger(bucket.start_time)||!Number.isSafeInteger(bucket.end_time)||!Array.isArray(bucket.results)||bucket.results.length>1000)throw Error('invalid_costs');
      for(const row of bucket.results){
        if(row.object!=='organization.costs.result'||row.amount?.currency!=='usd'||!Number.isFinite(row.amount.value))throw Error('invalid_costs');
        amount+=row.amount.value;if(!Number.isFinite(amount))throw Error('invalid_costs');
      }buckets++;
    }
    report.usageCosts={status:'VERIFIED_USAGE_COSTS',reason:null,period:report.usageCosts.period,amountUsd:Math.round(amount*1_000_000)/1_000_000,buckets,creditBalanceVerified:false,budgetVerified:false};
  }catch{report.usageCosts.reason='SCOPED_COSTS_UNAVAILABLE';}
  return report;
}
async function main(){
  const args=process.argv.slice(2);let output=null,network=false,costs=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--output'&&args[i+1])output=resolve(args[++i]);
    else if(args[i]==='--network')network=true;
    else if(args[i]==='--costs')costs=true;
    else throw Error('invalid_arguments');
  }
  const report=await inspectOpenAiProject({apiKey:process.env.OPENAI_API_KEY,adminKey:process.env.OPENAI_ADMIN_KEY,project:process.env.OPENAI_PROJECT_ID,allowNetwork:network,includeCosts:costs});
  const text=JSON.stringify(report,null,2)+'\n';
  if(output){mkdirSync(dirname(output),{recursive:true,mode:0o700});writeFileSync(output,text,{mode:0o600,flag:'wx'});}
  process.stdout.write(text);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(()=>{process.stderr.write('OpenAI inventory failed; no provider details or credentials were logged.\n');process.exitCode=1;});
}
