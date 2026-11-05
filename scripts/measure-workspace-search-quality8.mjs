import {performance} from 'node:perf_hooks';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWorkspaceSearchIndex,searchWorkspaceIndex} from '../src/workspace-search.js';
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/\s+/g,' ').trim();
const money=value=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
const records=Array.from({length:9996},(_,i)=>({type:i%2?'transaction':'invoice',id:'synthetic-'+i,number:'SYN-'+String(i).padStart(6,'0'),party:'Syntetiskt bolag '+i,reference:'REF-'+String(i).padStart(6,'0'),bankReference:'BANK-'+i,amountCents:10000+i,date:'2026-10-01'}));
for(let i=0;i<8;i++)records[i]={...records[i],type:'invoice',number:'0599'+i};
records.push({type:'invoice',id:'exact-invoice',number:'0599',party:'Ångström Test AB',reference:'SYN-Q8-00599',amountCents:123450,date:'2026-11-05'},
 {type:'transaction',id:'exact-payment',party:'Ångström Test AB',reference:'0599',bankReference:'SYN-Q8-BANK',amountCents:123450,date:'2026-11-05'},
 {type:'transaction',id:'negative-payment',party:'Synthetic refund AB',reference:'SYN-Q8-REFUND',amountCents:-123450,date:'2026-11-06'},
 {type:'invoice',id:'other-amount',number:'SYN-Q8-OTHER',party:'Ångström Test AB',reference:'SYN-Q8-OTHER',amountCents:123451,date:'2026-11-05'});
const cases=[
 {id:'common-party-many-results',query:'Syntetiskt',invoices:['synthetic-0','synthetic-1','synthetic-2','synthetic-3'],transactions:['synthetic-9','synthetic-11','synthetic-13','synthetic-15']},
 {id:'combined-swedish',query:'Ångström 1 234,50 2026-11-05 0599',invoices:['exact-invoice'],transactions:['exact-payment']},
 {id:'reordered-swedish',query:'0599 05/11/2026 1234,50 ångström',invoices:['exact-invoice'],transactions:['exact-payment']},
 {id:'date-and-amount',query:'05.11.2026 1 234,50 SEK',invoices:['exact-invoice'],transactions:['exact-payment']},
 {id:'exact-ranks-before-limit',query:'0599',firstInvoice:'exact-invoice'},
 {id:'negative-amount',query:'-1234,50',invoices:[],transactions:['negative-payment']},
 {id:'fullwidth-reference',query:'ＳＹＮ－Ｑ８－００５９９',invoices:['exact-invoice'],transactions:[]},
 {id:'no-match',query:'synthetic-absent-party',invoices:[],transactions:[]},
 {id:'blank',query:'   ',invoices:[],transactions:[]},
];
// Prior production WorkspaceSearch algorithm, applied to the same 10,000 rows.
// It normalized each row on every query, searched one contiguous string and
// stopped at four results; dates were absent from its searchable text.
function baseline(query){
 const q=normalize(query),result={invoices:[],transactions:[]};if(!q)return result;
 for(const type of ['invoice','transaction'])for(const row of records){
  if(row.type!==type)continue;
  const content=type==='invoice'?`${row.number||''} ${row.party} ${row.reference||''} ${money(row.amountCents)}`:`${row.party} ${row.bankReference||''} ${row.reference||''} ${money(row.amountCents)}`;
  const bucket=type==='invoice'?result.invoices:result.transactions;
  if(normalize(content).includes(q))bucket.push(row);if(bucket.length===4)break;
 }
 return result;
}
const started=performance.now(),index=createWorkspaceSearchIndex(records),indexBuildMs=performance.now()-started;
const after=query=>searchWorkspaceIndex(index,query);
const ids=result=>({invoices:result.invoices.map(row=>row.id),transactions:result.transactions.map(row=>row.id)});
const correct=(scenario,result)=>scenario.firstInvoice?result.invoices[0]?.id===scenario.firstInvoice:JSON.stringify(ids(result))===JSON.stringify({invoices:scenario.invoices,transactions:scenario.transactions});
const measurements=[];
for(const [name,fn]of [['before',baseline],['after',after]]){
 for(const scenario of cases){
  fn(scenario.query);const samples=[];let result;
  for(let i=0;i<12;i++){const begin=performance.now();result=fn(scenario.query);samples.push(performance.now()-begin);}
  samples.sort((a,b)=>a-b);measurements.push({phase:name,id:scenario.id,correct:correct(scenario,result),result:ids(result),samples:12,p50_ms:samples[Math.floor(samples.length*.5)],p95_ms:samples[Math.ceil(samples.length*.95)-1]});
 }
}
const report={schema:'workspace-search-quality8-v1',generated_at:new Date().toISOString(),runtime:process.version,record_count:records.length,index_build_ms:indexBuildMs,source_sha256:createHash('sha256').update(readFileSync(new URL('../src/workspace-search.js',import.meta.url))).digest('hex'),scope:'Synthetic CPU search measurement. Old production matching loop versus cached index; excludes React rendering, browser/network, and bank matching. Search results never establish payment evidence.',metrics:Object.fromEntries(['before','after'].map(phase=>{const rows=measurements.filter(row=>row.phase===phase);return[phase,{correct_cases:rows.filter(row=>row.correct).length,cases:rows.length,slowest_case_p95_ms:Math.max(...rows.map(row=>row.p95_ms))}];})),cases:measurements};
const output=process.argv[2]||'docs/quality8/search-measurement.json';writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,index_build_ms:report.index_build_ms,metrics:report.metrics},null,2));
if(report.metrics.after.correct_cases!==cases.length)process.exitCode=1;
