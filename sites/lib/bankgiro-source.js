/** Transport-only contract. No provider endpoint or production source is registered here. */
export function ingestError(code){return Object.assign(new Error(code),{code});}
const text=(value,max=500)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
export function validateAuthorization(auth,owner,sourceId,now,expected){
 if(!auth||auth.status!=='VERIFIED'||auth.owner!==owner||auth.sourceId!==sourceId||!text(auth.scopeId)||!text(auth.generation)||!text(auth.evidenceId)||!Number.isFinite(Date.parse(auth.validUntil))||Date.parse(auth.validUntil)<=now)throw ingestError('AUTHORIZATION_BLOCKED');
 if(expected&&(auth.scopeId!==expected.scopeId||auth.generation!==expected.generation||auth.owner!==expected.owner||auth.sourceId!==expected.sourceId))throw ingestError('AUTHORIZATION_CHANGED');
 return {...auth};
}

/** An explicit recipient in the retained original must agree with current scope.
 * Legacy authorization without a Bankgiro number supplies no recipient claim. */
export function assertBankgiroReportRecipient(authorization,recipients){
 if(authorization.bankgiro===undefined)return;
 const expected=authorization.bankgiro;
 if(typeof expected!=='string'||!/^\d{4,10}$/.test(expected))throw ingestError('AUTHORIZATION_BLOCKED');
 for(const recipient of recipients){
  if(recipient===undefined||recipient===null||recipient==='')continue;
  if(typeof recipient!=='string'||!/^\d[\d\s-]*$/.test(recipient)||recipient.replace(/[\s-]/g,'')!==expected)throw ingestError('ACCOUNT_MISMATCH');
 }
}

export function validateReportPage(page,limit){
 if(!page||!Array.isArray(page.reports)||page.reports.length>limit||!(page.nextCursor===null||text(page.nextCursor,2000)))throw ingestError('INVALID_PAGE');
 if(page.nextPollAt!==undefined&&!Number.isFinite(Date.parse(page.nextPollAt)))throw ingestError('INVALID_PAGE');
 if(page.missingReportIds!==undefined&&(!Array.isArray(page.missingReportIds)||page.missingReportIds.length>1000||!page.missingReportIds.every(x=>text(x))))throw ingestError('INVALID_PAGE');
 const reports=page.reports.map(r=>{if(!r||!text(r.reportId)||!text(r.filename,255)||! /\.(csv|xml|xlsx|opbg\.json)$/i.test(r.filename)||/[\\/]/.test(r.filename)||typeof r.sha256!=='string'||! /^[a-f0-9]{64}$/i.test(r.sha256)||r.availableAt!==undefined&&!Number.isFinite(Date.parse(r.availableAt)))throw ingestError('INVALID_PAGE');return {reportId:r.reportId,filename:r.filename,sha256:r.sha256.toLowerCase(),...(r.availableAt?{availableAt:r.availableAt}:{})};});
 return {reports,nextCursor:page.nextCursor,nextPollAt:page.nextPollAt,missingReportIds:page.missingReportIds};
}
export function sanitizedIngestCode(error){
 const allowed=['AUTHORIZATION_BLOCKED','AUTHORIZATION_CHANGED','INVALID_PAGE','HASH_MISMATCH','IDENTITY_CONFLICT','ACCOUNT_MISMATCH','LEASE_LOST','TIMEOUT','INVALID_ORIGINAL','INVALID_SINK_RESULT','RATE_LIMITED','SOURCE_UNAVAILABLE','BANKGIRO_INFORMATION_UNAVAILABLE','BANKGIRO_INFORMATION_PARTIAL','BANKGIRO_ENRICHMENT_REVIEW'];
 if(allowed.includes(error?.code))return error.code;
 if(error?.status===429||error?.statusCode===429)return 'RATE_LIMITED';
 return 'SOURCE_UNAVAILABLE';
}
export function retryAt(error,attempt,now){
 const maximum=8640000000000000;
 let deadline=now+Math.min(3600000,30000*2**Math.min(attempt,7));
 const raw=error?.retryAfter;
 if(typeof raw==='number'&&raw>=0)deadline=Math.max(deadline,now+raw*1000);
 else if(typeof raw==='string'&&raw.trim()){
  const seconds=Number(raw),time=!Number.isNaN(seconds)&&seconds>=0?now+seconds*1000:Date.parse(raw);
  if(!Number.isNaN(time))deadline=Math.max(deadline,time);
 }
 // Cap only to the maximum representable instant. An explicit provider wait
 // must never be shortened to our generated backoff; overflow stays blocked.
 return Math.min(maximum,deadline);
}
/** Deliberate public projection: opaque transport cursors and original/account metadata stay internal. */
export function publicBankgiroStatus(status){
 const instant=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():null;
 const fields=['enabled','sourceId','mode','state','reason','nextPollAt','missingReportIds','lastError'];
 const result=Object.fromEntries(fields.map(key=>[key,status[key]]));
 for(const key of ['authorization','lastSuccessAt','lastFailureAt','lastFailureCode'])if(Object.hasOwn(status,key))result[key]=status[key];
 result.counts=Object.fromEntries(['PENDING','RETRY','IMPORTED','REVIEW','DUPLICATE','BLOCKED'].filter(key=>Object.hasOwn(status.counts||{},key)).map(key=>[key,status.counts[key]]));
 result.jobs=(status.jobs||[]).map(job=>({...Object.fromEntries(['id','reportId','status','attempts'].map(key=>[key,job[key]])),nextAttemptAt:instant(job.nextAttemptAt),updatedAt:instant(job.updatedAt),...(Object.hasOwn(job,'lastError')&&sanitizedIngestCode({code:job.lastError})===job.lastError?{lastError:job.lastError}:{})}));
 return result;
}
