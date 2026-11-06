const PROFILE_VERSION='invoice-ai-integration-2026-11-06.v1';
const PROFILES=Object.freeze({'luna-v1':Object.freeze({model:'gpt-6-luna',reasoningEffort:'low'}),'sol-v1':Object.freeze({model:'gpt-6.1-sol',reasoningEffort:'low'})});
const REVIEW='AI-förslag behöver kontrolleras mot originalet före registrering.';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const integer=(value,fallback,max)=>{const n=value===undefined||value===''?fallback:Number(value);return Number.isSafeInteger(n)&&n>0&&n<=max?n:null;};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const organization=value=>typeof value==='string'?value.replace(/[- ]/g,''):'';
function validOrganization(value){
 const n=organization(value);return /^\d{10}$/.test(n)&&Number(n[2])>=2&&[...n].reduce((s,c,i)=>{const v=Number(c)*(i%2?1:2);return s+Math.floor(v/10)+v%10;},0)%10===0;
}

/** All live consent comes from server configuration, never document metadata. */
export function invoiceAiPolicy(environment={},owner=''){
 if(environment.OPENAI_INVOICES_ENABLED!=='true')return {status:'disabled'};
 const blocked=code=>({status:'blocked',code});
 if(['PRIVACY','SECURITY','COST'].some(name=>environment['OPENAI_INVOICES_'+name+'_APPROVED']!=='true'))return blocked('APPROVAL_REQUIRED');
 if(typeof environment.OPENAI_INVOICES_APPROVAL_ID!=='string'||!/^[-A-Za-z0-9._:/]{3,120}$/.test(environment.OPENAI_INVOICES_APPROVAL_ID))return blocked('APPROVAL_REQUIRED');
 const owners=parse(environment.OPENAI_INVOICES_ALLOWED_OWNERS),orgs=parse(environment.OPENAI_INVOICES_COMPANY_ORGANIZATIONS);
 if(!Array.isArray(owners)||owners.length>100||!owners.every(o=>typeof o==='string'&&o.length>0&&o.length<=200)||!owners.includes(owner))return blocked('OWNER_NOT_APPROVED');
 if(!orgs||typeof orgs!=='object'||Array.isArray(orgs)||!Object.hasOwn(orgs,owner)||!validOrganization(orgs[owner]))return blocked('COMPANY_IDENTITY_REQUIRED');
 if(typeof environment.OPENAI_API_KEY!=='string'||!environment.OPENAI_API_KEY.trim())return blocked('API_KEY_MISSING');
 const profile=Object.hasOwn(PROFILES,environment.OPENAI_INVOICES_PROFILE)?PROFILES[environment.OPENAI_INVOICES_PROFILE]:null;if(!profile)return blocked('MODEL_PROFILE_REQUIRED');
 const maxDocumentMicroUsd=integer(environment.OPENAI_INVOICES_MAX_DOCUMENT_MICRO_USD,250000,10_000_000),dailyBudgetMicroUsd=integer(environment.OPENAI_INVOICES_DAILY_BUDGET_MICRO_USD,2_000_000,100_000_000);
 if(!maxDocumentMicroUsd||!dailyBudgetMicroUsd||maxDocumentMicroUsd>dailyBudgetMicroUsd)return blocked('BUDGET_INVALID');
 return {status:'enabled',owner,approvalId:environment.OPENAI_INVOICES_APPROVAL_ID,profileId:environment.OPENAI_INVOICES_PROFILE,version:PROFILE_VERSION,model:profile.model,reasoningEffort:profile.reasoningEffort,expectedCompanyOrganization:organization(orgs[owner]),maxDocumentMicroUsd,dailyBudgetMicroUsd};
}
function note(baseline,code,status='fallback'){
 return {...baseline,ai:{version:PROFILE_VERSION,status,code,requiresHumanReview:true,bankEvidence:false}};
}
function validClaim(field){
 return field&&typeof field==='object'&&field.value!=null&&field.evidence&&Number.isSafeInteger(field.evidence.page)&&field.evidence.page>=1&&field.evidence.page<=10&&typeof field.evidence.quote==='string'&&field.evidence.quote.trim().length>0&&field.evidence.quote.length<=600;
}
const scalarMap={invoice_number:'invoiceNumber',issued_at:'invoiceDate',due_at:'dueDate',total_cents:'totalAmount',vat_cents:'vatAmount',net_cents:'netAmount',reference:'paymentReference',currency:'currency'};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'?a.normalize('NFKC').trim()===b.normalize('NFKC').trim():a===b;
function safeScalar(key,value){
 if(['total_cents','vat_cents','net_cents'].includes(key))return Number.isSafeInteger(value)&&value>=0&&value<=100_000_000_000&&(key!=='total_cents'||value>0);
 if(typeof value!=='string'||!value.trim()||value.length>240)return false;
 if(key==='organization_number')return validOrganization(value);
 if(key==='currency')return value==='SEK';
 if(['issued_at','due_at'].includes(key))return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 return true;
}
/** Claims retain their model provenance. They never certify a bank reference. */
export function mergeInvoiceSuggestion(baseline,result){
 const candidate=result?.candidate,issues=Array.isArray(result?.issues)?result.issues.filter(x=>typeof x==='string').slice(0,50):[];
 if(result?.status!=='review'||!candidate||typeof candidate!=='object'){
  const code=typeof result?.code==='string'&&/^[A-Z_]{1,80}$/.test(result.code)?result.code:issues.find(x=>/^[a-z_]{1,80}$/.test(x))?.toUpperCase()||'AI_UNAVAILABLE';
  const output=note(baseline,code);output.ai={...output.ai,issues,model:result?.model||null,usage:result?.usage||null,costMicroUsd:result?.costMicroUsd??null};return output;
 }
 const output=structuredClone(baseline),conflicts=[],filled=[];
 const map={...scalarMap};
 if(output.fields?.direction?.value==='supplier'){map.party='supplierName';map.organization_number='supplierOrgNumber';}
 else if(output.fields?.direction?.value==='customer'){map.party='recipientName';map.organization_number='recipientOrgNumber';}
 let economicRisk=issues.some(x=>/MISMATCH|CONFLICT|INVALID|CURRENCY|TAX|RECIPIENT|INJECTION|MULTIPLE|NOT_INVOICE|INCOMPLETE_TABLE|AMBIGUOUS|DO_NOT_RECONCILE|COMPANY_ORGANIZATION_(?:UNKNOWN|MISSING)/.test(x.toUpperCase()));
 const c=key=>candidate[key]?.value;
 if(c('currency')&&c('currency')!=='SEK')economicRisk=true;
 if([c('netAmount'),c('vatAmount'),c('totalAmount')].every(Number.isSafeInteger)&&Math.abs(c('netAmount')+c('vatAmount')-c('totalAmount'))>1)economicRisk=true;
 if(c('invoiceDate')&&c('dueDate')&&c('dueDate')<c('invoiceDate'))economicRisk=true;
 // A conflicting accounting observation blocks all automatic filling of
 // monetary fields; retain the complete candidate separately for a reviewer.
 for(const [target,name]of Object.entries(map)){
  const claim=candidate[name],previous=output.fields?.[target];
  if(previous?.value!=null&&validClaim(claim)&&!same(previous.value,claim.value)&&['total_cents','net_cents','vat_cents','currency','organization_number'].includes(target))economicRisk=true;
 }
 const originalConflict=(output.issues||[]).some(x=>/motstridig|stämmer inte|fel mottagare|ogiltig|oläsligt värde/i.test(x));
 for(const [target,name]of Object.entries(map)){
  const claim=candidate[name],previous=output.fields?.[target];
  if(!previous||!validClaim(claim)||!safeScalar(target,claim.value))continue;
  if(previous.value!=null&&!same(previous.value,claim.value)){conflicts.push(target);continue;}
  if(previous.value==null&&!economicRisk&&!originalConflict){
   output.fields[target]={...previous,value:claim.value,confidence:0,evidence:('AI-förslag, sida '+claim.evidence.page+': '+claim.evidence.quote).slice(0,300),warning:REVIEW,provenance:{kind:'openai_document_claim',verified:false,page:claim.evidence.page}};
   filled.push(target);
  }
 }
 // Never overwrite parser-derived parties, line items or formal reference proof.
 output.ai={version:PROFILE_VERSION,status:'review',requiresHumanReview:true,bankEvidence:false,model:result.model||null,usage:result.usage||null,costMicroUsd:result.costMicroUsd??null,candidate,issues,conflicts,filledFields:filled,economicRisk};
 output.level=baseline.level==='red'?'red':'yellow';
 output.issues=[...new Set([...(baseline.issues||[]),REVIEW,...(conflicts.length?['AI-förslaget avviker från tidigare tolkade uppgifter. Kontrollera originalet.']:[]),...(economicRisk?['AI-tolkningen innehåller ekonomiskt osäkra uppgifter. Ingen automatisk registrering tillåts.']:[])])];
 return output;
}

/**
 * Load originals only after approval. The caller supplies an integrity-checked,
 * locally parsed original (including actual page count). API exceptions and raw
 * response bodies are not exposed in user-facing results or audit diagnostics.
 */
export async function enrichInvoiceForReview({baseline,owner,documentId,sha256,mime,environment={},store,loadOriginal,authorize=()=>{},adapter}){
 const policy=invoiceAiPolicy(environment,owner);
 if(policy.status==='disabled')return baseline;
 if(policy.status!=='enabled')return note(baseline,policy.code,'blocked');
 if(baseline?.level==='green')return baseline; // hybrid: already-readable originals incur no AI cost
 if(typeof documentId!=='string'||!documentId||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||!store||typeof loadOriginal!=='function')return note(baseline,'AI_CONTEXT_INVALID','blocked');
 await authorize();
 const companyRole=baseline.fields?.direction?.value==='customer'?'supplier':'recipient';
 const key=await hash(JSON.stringify([PROFILE_VERSION,owner,sha256,mime,policy.profileId,policy.model,policy.reasoningEffort,policy.expectedCompanyOrganization,companyRole]));
 let previous;
 try{previous=await store.load(key);}catch{return note(baseline,'AI_STORE_UNAVAILABLE');}
 await authorize();
 if(previous){const result=mergeInvoiceSuggestion(baseline,previous);result.ai={...result.ai,replayed:true};return result;}
 let original;
 try{original=await loadOriginal();}catch{return note(baseline,'ORIGINAL_PREFLIGHT_FAILED');}
 await authorize();
 if(!(original?.bytes instanceof Uint8Array)||!Number.isSafeInteger(original.pageCount)||original.pageCount<1||original.pageCount>10)return note(baseline,'ORIGINAL_PREFLIGHT_FAILED');
 let reserved;
 try{reserved=await store.reserve({key,documentId,sha256,profileVersion:PROFILE_VERSION,reservedMicroUsd:policy.maxDocumentMicroUsd,dailyBudgetMicroUsd:policy.dailyBudgetMicroUsd});}
 catch{return note(baseline,'AI_STORE_UNAVAILABLE');}
 await authorize();
 if(reserved.status!=='reserved'){
  if(reserved.status==='existing'){
   try{previous=await store.load(key);}catch{}
   if(previous){const result=mergeInvoiceSuggestion(baseline,previous);result.ai={...result.ai,replayed:true};return result;}
  }
  return note(baseline,reserved.status==='budget_exhausted'?'AI_DAILY_BUDGET_EXHAUSTED':'AI_REQUEST_ALREADY_RESERVED');
 }
 let result;
 try{
  if(typeof adapter!=='function')throw Error('Adapter unavailable');
  result=await adapter({bytes:original.bytes,mime,pageCount:original.pageCount,sha256,owner,documentId,inputValidated:true,policy,companyRole,documentText:baseline.text_excerpt||'',deterministic:baseline.fields,apiKey:environment.OPENAI_API_KEY});
 }catch{result={status:'fallback',code:'AI_REQUEST_FAILED'};}
 await authorize();
 try{if(!await store.record(key,result))return note(baseline,'AI_RECEIPT_NOT_SAVED');}
 catch{return note(baseline,'AI_RECEIPT_NOT_SAVED');}
 await authorize();
 return mergeInvoiceSuggestion(baseline,result);
}
