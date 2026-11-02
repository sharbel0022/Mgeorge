import {digest} from './security.js';

const day=86400000;
const error=(code,message)=>Object.assign(new Error(message),{code,status:409});
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const bankUtcToday=(now=Date.now())=>new Date(now).toISOString().slice(0,10);
const shift=(date,days)=>bankUtcToday(Date.parse(date)+days*day);
const stateError=()=>error('bank_sync_state_invalid','Bankhämtningens sparade datum behöver kontrolleras. Ingen historik har hoppats över.');

function merge(ranges){
  const merged=[];
  for(const range of ranges.map(row=>[...row]).sort((a,b)=>a[0].localeCompare(b[0]))){
    const previous=merged.at(-1);
    if(previous&&Date.parse(range[0])<=Date.parse(previous[1])+day){if(range[1]>previous[1])previous[1]=range[1];}
    else merged.push(range);
  }
  return merged;
}
function read(session,account,lastSynced,now){
  const envelope=session.sync_coverage;
  if(envelope!==undefined&&(!envelope||envelope.version!==1||!envelope.accounts||typeof envelope.accounts!=='object'||Array.isArray(envelope.accounts)))throw stateError();
  const key=digest(account),saved=envelope?.accounts[key],today=bankUtcToday(now);
  if(saved!==undefined){
    if(!saved||!validDate(saved.from)||saved.from>today||!Array.isArray(saved.ranges)||saved.ranges.length>64||saved.ranges.some(range=>!Array.isArray(range)||range.length!==2||!range.every(validDate)||range[0]>range[1]||range[0]<saved.from||range[1]>today))throw stateError();
    return {key,state:{from:saved.from,ranges:merge(saved.ranges)}};
  }
  // Legacy timestamps are only a conservative recovery hint, never evidence
  // that a requested period was fetched. At least the last 30 UTC dates remain.
  let from=shift(today,-29);
  const time=typeof lastSynced==='string'&&lastSynced?Date.parse(lastSynced.includes('T')?lastSynced:lastSynced.replace(' ','T')+'Z'):NaN;
  if(Number.isFinite(time)&&time<=now)from=[from,shift(bankUtcToday(time),-1)].sort()[0];
  return {key,state:{from,ranges:[]}};
}
function coverage(state,now){
  let next=Date.parse(state.from);
  for(const [from,to] of state.ranges){
    if(Date.parse(from)>next)break;
    next=Math.max(next,Date.parse(to)+day);
  }
  const to=next>Date.parse(state.from)?bankUtcToday(next-day):'',complete=!!to&&to>=bankUtcToday(now);
  return {date_from:state.from,date_to:to,pending_from:complete?'':bankUtcToday(next),complete};
}
/** Coverage belongs to this encrypted bank session and the stable account,
 * never a browser setting or a renewed provider account UID. */
export function bankSyncCoverage(session,account,lastSynced,now=Date.now()){
  return coverage(read(session,account,lastSynced,now).state,now);
}
export function planBankSync(session,account,lastSynced,{date_from,date_to}={},now=Date.now()){
  const {key,state}=read(session,account,lastSynced,now),known=coverage(state,now);
  const fallback=known.date_to?[state.from,shift(known.date_to,-1)].sort().at(-1):state.from;
  const from=date_from===undefined?fallback:date_from,to=date_to===undefined?bankUtcToday(now):date_to;
  if(!validDate(from)||!validDate(to)||from>to||to>bankUtcToday(now))throw Object.assign(new Error('Välj giltiga från- och tilldatum, senast dagens UTC-datum.'),{code:'invalid_date_range',status:400});
  return {session,key,state,from,to};
}
/** Call only after every requested page was validated; store this result under
 * the same lease as the successful bank import. No partial window is recorded. */
export function completeBankSync(plan,now=Date.now()){
  const state={from:[plan.state.from,plan.from].sort()[0],ranges:merge([...plan.state.ranges,[plan.from,plan.to]])};
  if(state.ranges.length>64)throw error('bank_sync_window_limit','För många separata datumintervall. Hämta den återstående luckan innan fler historiska perioder läggs till.');
  const session={...plan.session,sync_coverage:{version:1,accounts:{...plan.session.sync_coverage?.accounts,[plan.key]:state}}};
  return {session,coverage:coverage(state,now)};
}
