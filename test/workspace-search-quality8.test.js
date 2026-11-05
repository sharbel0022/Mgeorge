import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSearchIndex, searchWorkspaceIndex } from '../src/workspace-search.js';

const records = [
  { type: 'invoice', id: 'invoice-a', number: 'SYN-0599', party: 'Ångström Test AB', reference: '0599', amountCents: 123450, date: '2026-11-05' },
  { type: 'invoice', id: 'invoice-b', number: 'SYN-05990', party: 'Ångström Test AB', reference: '05990', amountCents: 123450, date: '2026-11-05' },
  { type: 'transaction', id: 'bank-a', party: 'Ångström Test AB', reference: '0599', bankReference: 'SYN-BANK-A', amountCents: 123450, date: '2026-11-05' },
  { type: 'transaction', id: 'bank-b', party: 'Synthetic Different AB', reference: '0599', amountCents: -123450, date: '2026-11-06' },
];

test('search combines Swedish amount, date, reference and party independent of order', () => {
  const index = createWorkspaceSearchIndex(records);
  for (const query of ['Ångström 1 234,50 2026-11-05 0599', '0599 05/11/2026 1234,50 ångström', 'ÅNGSTRÖM 2026-11-05 1\u00a0234,50 kr']) {
    const result = searchWorkspaceIndex(index, query);
    assert.ok(result.invoices.some(row => row.id === 'invoice-a'), query);
    assert.ok(result.transactions.some(row => row.id === 'bank-a'), query);
    assert.ok(!result.transactions.some(row => row.id === 'bank-b'), query);
  }
});

test('exact references rank ahead of substrings before category limits apply', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ type: 'invoice', id: `prefix-${i}`, number: `0599${i + 1}`, amountCents: 10000 }));
  rows.push({ type: 'invoice', id: 'exact', number: '0599', amountCents: 10000 });
  const result = searchWorkspaceIndex(createWorkspaceSearchIndex(rows), '0599');
  assert.equal(result.invoices.length, 4);
  assert.equal(result.invoices[0].id, 'exact');
});

test('blank, absent and overly long searches have deterministic empty results', () => {
  const index = createWorkspaceSearchIndex(records);
  for (const query of ['', ' \u00a0 ', null, undefined, 'x'.repeat(513), 'missingparty']) {
    const result = searchWorkspaceIndex(index, query);
    assert.deepEqual(result.invoices, []);
    assert.deepEqual(result.transactions, []);
  }
});

test('search preserves input records and never mutates accounting state', () => {
  const copy = structuredClone(records);
  const index = createWorkspaceSearchIndex(records);
  searchWorkspaceIndex(index, '0599');
  assert.deepEqual(records, copy);
});

test('amount signs, fullwidth text and category limits are supported', () => {
  const index = createWorkspaceSearchIndex(records);
  assert.deepEqual(searchWorkspaceIndex(index, '-1234,50').transactions.map(row => row.id), ['bank-b']);
  assert.equal(searchWorkspaceIndex(index, 'ＳＹＮ－０５９９').invoices[0].id, 'invoice-a');
  assert.equal(searchWorkspaceIndex(index, '0599', { limitPerType: 1 }).invoices.length, 1);
});

test('the full list mode never truncates filters at the workspace suggestion limit',()=>{
 const rows=Array.from({length:120},(_,i)=>({type:'invoice',id:'synthetic-'+i,party:'Synthetic common party',number:'SYN-'+i}));
 assert.equal(searchWorkspaceIndex(createWorkspaceSearchIndex(rows),'common',{limitPerType:null}).invoices.length,120);
});

test('search queries cannot reinterpret bare leading-zero references as money',()=>{
 const rows=[{type:'invoice',id:'reference',number:'00599',amountCents:80000},{type:'invoice',id:'amount',number:'SYN-OTHER',amountCents:59900}];
 assert.deepEqual(searchWorkspaceIndex(createWorkspaceSearchIndex(rows),'00599').invoices.map(row=>row.id),['reference']);
 assert.deepEqual(searchWorkspaceIndex(createWorkspaceSearchIndex(rows),'599,00 kr').invoices.map(row=>row.id),['amount']);
});

test('Node, Sites and the shipped classic-script adapter have identical search behavior',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../src/workspace-search.js',import.meta.url),'utf8');
 assert.equal(readFileSync(new URL('../sites/lib/workspace-search.js',import.meta.url),'utf8'),source);
 const adapter=readFileSync(new URL('../public/workspace-search.js',import.meta.url),'utf8');
 assert.ok(adapter.includes(source.replaceAll('export function ','function ')));
 const browser=runInNewContext(adapter+'\nworkspaceSearch');
 for(const query of ['Ångström 1 234,50 2026-11-05 0599','-1234,50','0599','missingparty']){
  assert.deepEqual(JSON.parse(JSON.stringify(browser.searchWorkspaceIndex(browser.createWorkspaceSearchIndex(records),query))),searchWorkspaceIndex(createWorkspaceSearchIndex(records),query));
 }
 const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.ok(index.indexOf('src="/workspace-search.js"')<index.indexOf('src="/app.js"'));
});

test('the actual static handler serves only the public search adapter as JavaScript',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm'),{resolve,extname}=await import('node:path'),{fileURLToPath}=await import('node:url');
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8'),start=source.indexOf('function serveStatic('),end=source.indexOf('\nfunction addInvoice(',start),root=fileURLToPath(new URL('..',import.meta.url));
 assert.ok(start>=0&&end>start);
 const handler=runInNewContext(source.slice(start,end).replaceAll('import.meta.url',JSON.stringify(new URL('../src/server.js',import.meta.url).href))+'\nserveStatic',{baseHeaders:{},readFileSync,resolve:(...parts)=>resolve(root,...parts),extname,URL,json:(res,status,body)=>{res.status=status;res.body=body;}});
 const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
 const served=response();handler({},served,'/workspace-search.js');assert.equal(served.status,200);assert.equal(served.headers['Content-Type'],'text/javascript; charset=utf-8');assert.match(String(served.body),/const workspaceSearch =/);
 for(const path of ['/src/workspace-search.js','/sites/lib/workspace-search.js','/../src/server.js']){const blocked=response();handler({},blocked,path);assert.equal(blocked.status,404);}
});

test('numeric suffixes and leading-zero references cannot be consumed into the following amount',()=>{
 const rows=[{type:'invoice',id:'hyphen-ref',number:'SYN-001',amountCents:12300},{type:'invoice',id:'zero-ref',number:'001',amountCents:12300},{type:'invoice',id:'wrong-amount',number:'SYN-WRONG',amountCents:112300}];
 const index=createWorkspaceSearchIndex(rows);
 assert.deepEqual(searchWorkspaceIndex(index,'SYN-001 123,00').invoices.map(row=>row.id),['hyphen-ref']);
 assert.equal(searchWorkspaceIndex(index,'001 123,00').invoices[0].id,'zero-ref');
 assert.deepEqual(searchWorkspaceIndex(index,'1 123,00').invoices.map(row=>row.id),['wrong-amount']);
});
