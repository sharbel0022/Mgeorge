import {INVOICE_AI_PROFILES,getInvoiceAiProfile} from './profiles.js';
const blocked=code=>({status:'blocked',code});
const whole=(value,fallback,max)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d+$/.test(value))return null;const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=max?n:null;};
// Decimal money is parsed as integer micro-USD, never rounded through binary floats.
const money=(value,fallback,max)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(value))return null;const [units,fraction='']=value.split('.');const n=Number(units)*1000000+Number(fraction.padEnd(6,'0'));return Number.isSafeInteger(n)&&n>0&&n<=max?n:null;};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const modelId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
export function reviewedInvoiceAiProfile(contract,model){
 if(!contract||!modelId(model)||contract.model!==model||typeof contract.approvalId!=='string'||!/^[-A-Za-z0-9._:/]{3,120}$/.test(contract.approvalId)||!/^\d{4}-\d{2}-\d{2}$/.test(contract.reviewedOn||'')||typeof contract.source!=='string'||!/^https:\/\/(?:developers\.openai\.com|platform\.openai\.com|openai\.com)\//.test(contract.source))return null;
 const capabilities=contract.capabilities,pricing=contract.pricing;
 if(!capabilities||['responses','structuredOutputs','imageInput','pdfInput','inputTokenCounting'].some(k=>capabilities[k]!==true)||!['none','low','medium','high'].includes(capabilities.reasoningEffort))return null;
 if(!pricing||['inputMicroUsdPerMillionTokens','outputMicroUsdPerMillionTokens'].some(k=>!Number.isSafeInteger(pricing[k])||pricing[k]<=0||pricing[k]>1000000000))return null;
 const base=getInvoiceAiProfile('luna-v1'),limits=contract.limits;
 if(!limits||!Number.isSafeInteger(limits.maxInputTokens)||limits.maxInputTokens<1||limits.maxInputTokens>base.limits.maxInputTokens||!Number.isSafeInteger(limits.maxOutputTokens)||limits.maxOutputTokens<1||limits.maxOutputTokens>base.limits.maxOutputTokens)return null;
 return Object.freeze({...base,id:'reviewed-custom',model,reasoningEffort:capabilities.reasoningEffort,limits:Object.freeze({...base.limits,maxInputTokens:limits.maxInputTokens,maxOutputTokens:limits.maxOutputTokens}),version:'reviewed:'+contract.approvalId,pricingVersion:'reviewed:'+contract.approvalId,source:contract.source,verifiedOn:contract.reviewedOn,pricing:Object.freeze({inputMicroUsdPerMillionTokens:pricing.inputMicroUsdPerMillionTokens,outputMicroUsdPerMillionTokens:pricing.outputMicroUsdPerMillionTokens})});
}
function select(model,contract){return Object.values(INVOICE_AI_PROFILES).find(p=>p.model===model)||reviewedInvoiceAiProfile(contract,model);}
/** Server configuration only. No network probing, key material, or claim of model access. */
export function resolveInvoiceAiConfiguration(environment={}){
 const flag=environment.OPENAI_ENABLED??environment.OPENAI_INVOICES_ENABLED??'false';
 if(flag==='false')return {status:'disabled',code:'OPENAI_DISABLED'};
 if(flag!=='true')return blocked('ENABLED_INVALID');
 const key=environment.OPENAI_API_KEY;
 if(typeof key!=='string'||!key)return blocked('API_KEY_MISSING');
 if(key.length>4096||!/^[\x21-\x7E]+$/.test(key))return blocked('API_KEY_INVALID');
 const customContract=parse(environment.OPENAI_MODEL_CONTRACT),fallbackContract=parse(environment.OPENAI_FALLBACK_MODEL_CONTRACT);
 // A present (even empty) OPENAI_MODEL overrides the legacy profile.
 const primary=environment.OPENAI_MODEL!==undefined?select(environment.OPENAI_MODEL,customContract):getInvoiceAiProfile(environment.OPENAI_INVOICES_PROFILE);
 if(!primary)return blocked('MODEL_PROFILE_REQUIRED');
 const fallback=environment.OPENAI_FALLBACK_MODEL?select(environment.OPENAI_FALLBACK_MODEL,fallbackContract):null;
 if(environment.OPENAI_FALLBACK_MODEL&&!fallback)return blocked('FALLBACK_MODEL_INVALID');
 const maxOutputTokens=whole(environment.OPENAI_MAX_OUTPUT_TOKENS,primary.limits.maxOutputTokens,8192),timeoutMs=whole(environment.OPENAI_TIMEOUT_MS,30000,45000);
 if(!maxOutputTokens||maxOutputTokens>primary.limits.maxOutputTokens||fallback&&maxOutputTokens>fallback.limits.maxOutputTokens||!timeoutMs)return blocked('LIMITS_INVALID');
 const maxDocumentMicroUsd=whole(environment.OPENAI_INVOICES_MAX_DOCUMENT_MICRO_USD,250000,10000000);
 const dailyBudgetMicroUsd=environment.OPENAI_DAILY_BUDGET_USD!==undefined?money(environment.OPENAI_DAILY_BUDGET_USD,null,100000000):whole(environment.OPENAI_INVOICES_DAILY_BUDGET_MICRO_USD,2000000,100000000);
 const monthlyBudgetMicroUsd=environment.OPENAI_MONTHLY_BUDGET_USD!==undefined?money(environment.OPENAI_MONTHLY_BUDGET_USD,null,1000000000):whole(environment.OPENAI_INVOICES_MONTHLY_BUDGET_MICRO_USD,50000000,1000000000);
 if(!maxDocumentMicroUsd||!dailyBudgetMicroUsd||!monthlyBudgetMicroUsd||maxDocumentMicroUsd>dailyBudgetMicroUsd||dailyBudgetMicroUsd>monthlyBudgetMicroUsd)return blocked('BUDGET_INVALID');
 const withLimits=p=>p?Object.freeze({...p,limits:Object.freeze({...p.limits,maxOutputTokens,timeoutMs})}):null;
 return {status:'configured',profile:withLimits(primary),fallbackProfile:withLimits(fallback),customContract,fallbackContract,maxDocumentMicroUsd,dailyBudgetMicroUsd,monthlyBudgetMicroUsd};
}
export function invoiceAiConfigurationStatus(environment={}){
 const c=resolveInvoiceAiConfiguration(environment);
 return {status:c.status,code:c.code||'OPENAI_CONFIGURED',model:c.profile?.model||null,fallbackModel:c.fallbackProfile?.model||null,limits:c.profile?{maxOutputTokens:c.profile.limits.maxOutputTokens,timeoutMs:c.profile.limits.timeoutMs}:null,budgets:c.profile?{maxDocumentMicroUsd:c.maxDocumentMicroUsd,dailyBudgetMicroUsd:c.dailyBudgetMicroUsd,monthlyBudgetMicroUsd:c.monthlyBudgetMicroUsd}:null,liveVerified:false};
}
/** Revalidate the immutable host profile before provider use, including direct adapters. */
export function invoiceAiPolicyProfile(policy){
 const base=getInvoiceAiProfile(policy.profileId)||reviewedInvoiceAiProfile(policy.modelContract,policy.model);
 if(!base||base.model!==policy.model||base.reasoningEffort!==policy.reasoningEffort)return null;
 if(!policy.profile)return base;
 const {maxOutputTokens,timeoutMs}=policy.profile.limits||{};
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>base.limits.maxOutputTokens||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)return null;
 return Object.freeze({...base,limits:Object.freeze({...base.limits,maxOutputTokens,timeoutMs})});
}
