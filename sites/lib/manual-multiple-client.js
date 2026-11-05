// Shared browser flow. Only a reviewed, immutable vector can reach the economic
// endpoint. Transport validation is never a replacement for server evidence.
const VERSION='manual-multiple-allocation-v1';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const requestId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{10,80}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>natural(value)&&value>0;
// Sites uses an integer workspace revision; Node uses a canonical SHA-256
// snapshot revision. Do not coerce either representation during comparison.
const revision=value=>natural(value)||hash(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const sum=values=>{let total=0;for(const value of values){if(!natural(value)||!Number.isSafeInteger(total+value))return null;total+=value;}return total;};
const vector=rows=>rows.map(row=>[row.invoiceId,row.amountMinor]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
const sameVector=(a,b)=>JSON.stringify(vector(a))===JSON.stringify(vector(b));
const sameReferences=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const badResponse=()=>Error('Svaret kunde inte verifieras. Läs underlaget igen.');

export function parseManualAmount(value){
 if(typeof value!=='string')return null;
 const input=value.trim().replace(/[\u00a0\u202f]/g,' '),match=/^(\d+|[1-9]\d{0,2}(?: \d{3})+)(?:[,.](\d{1,2}))?$/.exec(input);
 if(!match)return null;
 const amount=Number(match[1].replaceAll(' ',''))*100+Number((match[2]||'').padEnd(2,'0'));
 return positive(amount)?amount:null;
}
export const manualMoney=value=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);

function common(value,transactionId,companyId){
 return object(value)&&value.version===VERSION&&value.method==='manual_multiple'&&value.mode==='manual_review'&&text(value.ownerId)&&text(value.companyId)&&(!companyId||value.companyId===companyId)&&id(value.transactionId)&&value.transactionId===transactionId&&revision(value.revision)&&text(value.bankId)&&text(value.accountId)&&value.currency==='SEK'&&text(value.payer)&&positive(value.availableMinor)&&positive(value.requiredMinor)&&natural(value.shortfallMinor)&&natural(value.excessMinor)&&value.shortfallMinor===Math.max(0,value.requiredMinor-value.availableMinor)&&value.excessMinor===Math.max(0,value.availableMinor-value.requiredMinor)&&Array.isArray(value.references)&&value.references.length>=2&&value.references.length<=20&&value.references.every(text)&&new Set(value.references).size===value.references.length;
}
function invoiceRows(rows,references){
 return Array.isArray(rows)&&rows.length>=2&&rows.length<=20&&rows.length===references.length&&new Set(rows.map(row=>row?.invoiceId)).size===rows.length&&rows.every(row=>object(row)&&id(row.invoiceId)&&text(row.number)&&row.number===row.reference&&references.includes(row.reference)&&text(row.customer)&&row.currency==='SEK'&&positive(row.invoiceTotalMinor)&&positive(row.invoiceRemainingBeforeMinor)&&row.invoiceRemainingBeforeMinor<=row.invoiceTotalMinor)&&sameReferences(rows.map(row=>row.reference),references);
}
export function validManualDiscovery(value,transactionId,companyId=null){
 return common(value,transactionId,companyId)&&invoiceRows(value.invoices,value.references)&&sum(value.invoices.map(row=>row.invoiceRemainingBeforeMinor))===value.requiredMinor;
}
export function validManualQuote(value,discovery,draft){
 if(!validManualDiscovery({...value,invoices:value?.allocations},discovery.transactionId,discovery.companyId)||!hash(value.reviewHash)||value.ownerId!==discovery.ownerId||value.revision!==discovery.revision||value.availableMinor!==discovery.availableMinor||value.bankId!==discovery.bankId||value.accountId!==discovery.accountId||value.payer!==discovery.payer||!sameReferences(value.references,discovery.references)||!text(value.note)||value.note!==draft.note||!sameVector(value.allocations,draft.allocations))return false;
 for(const row of value.allocations){
  const before=discovery.invoices.find(invoice=>invoice.invoiceId===row.invoiceId);
  if(!before||['number','reference','customer','currency','invoiceTotalMinor','invoiceRemainingBeforeMinor'].some(key=>row[key]!==before[key])||!positive(row.amountMinor)||!natural(row.invoiceRemainingAfterMinor)||row.invoiceRemainingAfterMinor!==row.invoiceRemainingBeforeMinor-row.amountMinor)return false;
 }
 return positive(value.allocatedMinor)&&sum(value.allocations.map(row=>row.amountMinor))===value.allocatedMinor&&natural(value.paymentRemainingMinor)&&value.paymentRemainingMinor===value.availableMinor-value.allocatedMinor&&!(value.paymentRemainingMinor>0&&value.allocations.some(row=>row.invoiceRemainingAfterMinor>0));
}
/** A receipt describes a past manual write, never current automatic eligibility. */
export function validManualReceipt(result,{transactionId,companyId=null,pending=null,expectedRequestId=null}={}){
 const value=result?.receipt;
 if(!object(result)||typeof result.replayed!=='boolean'||result.changed!==!result.replayed||!object(value)||value.version!==VERSION||value.method!=='manual_multiple'||value.automatic!==false||!text(value.receiptId)||!requestId(value.requestId)||expectedRequestId&&value.requestId!==expectedRequestId||!text(value.approvedBy)||typeof value.approvedAt!=='string'||!Number.isFinite(Date.parse(value.approvedAt))||!hash(value.reviewHash)||!text(value.note)||!Array.isArray(value.allocations))return false;
 const requiredMinor=sum(value.allocations.map(row=>row?.invoiceRemainingBeforeMinor));
 const discovery={...value,mode:'manual_review',revision:value.revisionBefore,availableMinor:value.availableBeforeMinor,requiredMinor,shortfallMinor:Math.max(0,requiredMinor-value.availableBeforeMinor),excessMinor:Math.max(0,value.availableBeforeMinor-requiredMinor),invoices:value.allocations};
 const plan={...discovery,allocations:value.allocations},draft={allocations:value.allocations,note:value.note};
 if(!validManualDiscovery(discovery,transactionId,companyId)||!validManualQuote(plan,discovery,draft)||new Set(value.allocations.map(row=>row.id)).size!==value.allocations.length||value.allocations.some(row=>!id(row.id)||row.transactionId!==transactionId))return false;
 return !pending||value.requestId===pending.body.requestId&&value.ownerId===pending.ownerId&&value.companyId===pending.companyId&&value.reviewHash===pending.body.reviewHash&&value.note===pending.body.note&&sameVector(value.allocations,pending.body.allocations);
}

/** @param {string} path @param {any} [body] */
export async function manualMultipleTransport(path,body){
 const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 let value;try{value=await response.json();}catch{throw Object.assign(badResponse(),{status:response.status});}
 if(!response.ok)throw Object.assign(Error(typeof value?.error==='string'?value.error:'Fördelningen kunde inte behandlas.'),{status:response.status,code:typeof value?.code==='string'?value.code:''});
 return value;
}

/** @param {{transactionId:string,companyId?:string|null,scopeKey:string,storage?:any,request?:(path:string,body?:any)=>Promise<any>,newRequestId?:()=>string,onChange?:(snapshot:any)=>void,onCommitted?:(receipt:any)=>void}} options */
export function createManualMultipleClient({transactionId,companyId=null,scopeKey,storage,request=manualMultipleTransport,newRequestId=()=>crypto.randomUUID(),onChange=()=>{},onCommitted=()=>{}}){
 const key='mgeorge:manual-multiple:v1:'+scopeKey;let disposed=false,epoch=0,pending=null,busy=false;
 /** @type {any} */ let state={phase:'closed',discovery:null,quote:null,receipt:null,error:'',requestId:''};
 const publish=next=>{state={...state,...next};if(!disposed)onChange(clone(state));};
 const active=token=>!disposed&&token===epoch;
 function clearPending(){
  const owned=pending;pending=null;
  // Another controller may already own a newer request in this scope. History
  // reads own no pending request; old completions must not erase newer intent.
  try{if(owned&&storage?.getItem(key)===JSON.stringify(owned))storage.removeItem(key);}catch{/* A leftover record can still recover its historical receipt. */}
 }
 function success(result,token){
  if(!active(token))return;
  if(!validManualReceipt(result,{transactionId,companyId,pending,expectedRequestId:pending?.body.requestId||state.requestId||null}))throw badResponse();
  clearPending();publish({phase:'saved',quote:null,receipt:clone(result.receipt),error:'',requestId:result.receipt.requestId});onCommitted(clone(result.receipt));
 }
 function persist(value){if(!storage?.setItem)throw Error('Webbläsaren kunde inte spara begäran för säker återhämtning. Kontrollera webbläsarens lagring och försök igen.');try{storage.setItem(key,JSON.stringify(value));}catch{throw Error('Webbläsaren kunde inte spara begäran för säker återhämtning. Kontrollera webbläsarens lagring och försök igen.');}}
 try{
  const saved=storage?.getItem(key);if(saved){const value=JSON.parse(saved),body=value?.body;
   if(!object(value)||!text(value.ownerId)||!text(value.companyId)||companyId&&value.companyId!==companyId||!object(body)||body.transactionId!==transactionId||!requestId(body.requestId)||!hash(body.reviewHash)||body.confirm!==true||!text(body.note)||!Array.isArray(body.allocations)||body.allocations.length<2||body.allocations.length>20||body.allocations.some(row=>!id(row.invoiceId)||!positive(row.amountMinor)))throw badResponse();
   pending=value;state={...state,phase:'unknown',requestId:body.requestId,error:'Ett tidigare godkännande behöver bekräftas med sitt sparade kvitto.'};
  }
 }catch{state={...state,phase:'unreadable',error:'Den sparade begäran kunde inte läsas säkert. Kontrollera fördelningshistoriken innan en ny granskning görs.'};}
 const unknownText='Utfallet är ännu okänt. Hämta kvittot eller försök samma godkännande igen. Begärans-ID bevaras.';
 async function receiptRead(token){
  const result=await request('/api/manual-allocations?requestId='+encodeURIComponent(pending?.body.requestId||state.requestId));
  if(!active(token))return;success(result,token);
 }
 async function send(firstAttempt){
  if(!pending||busy||disposed)return;busy=true;const token=++epoch;publish({phase:'submitting',error:'',requestId:pending.body.requestId});
  try{const result=await request('/api/manual-allocations',clone(pending.body));success(result,token);}
  catch(error){
   if(!active(token))return;
   // An unclassified 400 may follow a committed write just like a 500/network
   // loss. A subsequent missing receipt is not proof that it did not commit.
   const definitive=firstAttempt&&[400,409].includes(error?.status)&&typeof error?.code==='string'&&error.code.startsWith('MANUAL_')&&!['MANUAL_OUTCOME_UNKNOWN','MANUAL_REQUEST_REUSED'].includes(error.code);
   try{await receiptRead(token);}catch(readError){if(active(token)){
    if(definitive&&readError?.status===404&&readError?.code==='MANUAL_RECEIPT_NOT_FOUND'){clearPending();publish({phase:'closed',discovery:null,quote:null,error:error.message,requestId:''});}
    else publish({phase:'unknown',error:unknownText});
   }}
  }finally{busy=false;}
 }
 return {
  get snapshot(){return clone(state);},
  async load(){
   if(busy||disposed||state.phase==='unreadable')return;if(pending)return this.recover();
   busy=true;const token=++epoch;publish({phase:'loading',error:'',quote:null,receipt:null,requestId:''});
   try{const value=await request('/api/manual-allocations?transactionId='+encodeURIComponent(transactionId));if(!validManualDiscovery(value,transactionId,companyId))throw badResponse();if(active(token))publish({phase:'editing',discovery:clone(value)});}catch(error){if(active(token))publish({phase:'closed',discovery:null,error:error?.message||'Underlaget kunde inte läsas.'});}finally{busy=false;}
  },
  edit(){if(!busy&&!pending&&!disposed&&state.phase==='review')publish({phase:'editing',quote:null,error:''});},
  invalidate(){if(!pending&&!disposed&&state.phase!=='saved'){++epoch;busy=false;publish({phase:'closed',discovery:null,quote:null,error:'Uppgifterna har ändrats. Läs hela fördelningen igen.'});}},
  async review(draft){
   if(busy||pending||disposed||state.phase!=='editing')return;
   const rows=draft?.allocations,note=typeof draft?.note==='string'?draft.note.trim():'';
   if(!Array.isArray(rows)||rows.length!==state.discovery.invoices.length||new Set(rows.map(row=>row?.invoiceId)).size!==rows.length||rows.some(row=>!id(row?.invoiceId)||!positive(row.amountMinor)||!state.discovery.invoices.some(invoice=>invoice.invoiceId===row.invoiceId))||!note||note.length>1500){publish({error:'Ange ett positivt belopp för varje faktura och beskriv din granskning av originalen.'});return;}
   const selection={transactionId,allocations:rows.map(row=>({invoiceId:row.invoiceId,amountMinor:row.amountMinor})),note};busy=true;const token=++epoch;publish({phase:'reviewing',quote:null,error:''});
   try{const value=await request('/api/manual-allocations/preview',selection);if(!validManualQuote(value,state.discovery,selection))throw badResponse();if(active(token))publish({phase:'review',quote:clone(value)});}catch(error){if(active(token))publish({phase:'editing',quote:null,error:error?.message||'Granskningen kunde inte läsas.'});}finally{busy=false;}
  },
  async confirm(checked){
   if(checked!==true||busy||pending||disposed||state.phase!=='review')return;
   const review=state.quote,body={transactionId,allocations:review.allocations.map(row=>({invoiceId:row.invoiceId,amountMinor:row.amountMinor})),note:review.note,reviewHash:review.reviewHash,requestId:newRequestId(),confirm:true};
   if(!requestId(body.requestId)){publish({error:'En säker identifierare kunde inte skapas. Läs in sidan igen.'});return;}
   const saved={ownerId:review.ownerId,companyId:review.companyId,body};
   try{persist(saved);}catch(error){publish({error:error.message});return;}
   pending=saved;await send(true);
  },
  async retry(){await send(false);},
  async recover(){
   if(!pending||busy||disposed)return;busy=true;const token=++epoch;publish({phase:'recovering',error:'',requestId:pending.body.requestId});
   try{await receiptRead(token);}catch{if(active(token))publish({phase:'unknown',error:unknownText});}finally{busy=false;}
  },
  async readReceipt(receiptRequestId){
   if(pending||busy||disposed||!requestId(receiptRequestId))return;busy=true;const token=++epoch;publish({phase:'recovering',quote:null,receipt:null,error:'',requestId:receiptRequestId});
   try{await receiptRead(token);}catch(error){if(active(token))publish({phase:'closed',error:error?.message||'Kvittot kunde inte läsas.'});}finally{busy=false;}
  },
  dispose(){disposed=true;++epoch;},
 };
}
