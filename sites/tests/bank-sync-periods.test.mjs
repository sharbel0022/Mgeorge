import test from 'node:test';
import assert from 'node:assert/strict';
import {bankUtcDate, bankSyncRange, fetchBankPeriods, BankPeriodError} from '../lib/banking/sync-periods.ts';

const periodError=()=>Object.assign(new Error('unavailable'),{code:'BANK_PERIOD_UNAVAILABLE'});
const options=(extra={})=>({dateFrom:'2026-01-01',dateTo:'2026-01-01',budget:{requests:0,rows:0},authorize:async()=>{},isPeriodError:e=>e?.code==='BANK_PERIOD_UNAVAILABLE',fetchPage:async()=>({transactions:[]}),...extra});

test('bank calendar uses UTC at Swedish midnight, DST and year boundaries',()=>{
 for(const [instant,expected]of [['2026-12-31T23:30:00Z','2026-12-31'],['2026-03-29T00:30:00Z','2026-03-29'],['2026-10-25T00:30:00Z','2026-10-25'],['2026-06-30T22:30:00Z','2026-06-30']])assert.equal(bankUtcDate(Date.parse(instant)),expected);
 assert.deepEqual(bankSyncRange('2025-12-01','2026-01-02T00:30:00Z','2026-01-04'),{dateFrom:'2025-12-30',dateTo:'2026-01-04'});
 assert.deepEqual(bankSyncRange('2024-01-01','2024-03-02T04:00:00Z','2024-03-03'),{dateFrom:'2024-02-28',dateTo:'2024-03-03'});
});

test('invalid or future dates fail without any bank request',async()=>{
 let calls=0;
 for(const [dateFrom,dateTo]of [['2026-02-30','2026-03-01'],['2026-03-02','2026-03-01'],['','2026-01-01'],['2026-1-01','2026-01-01'],['9999-01-01','9999-01-02']])await assert.rejects(fetchBankPeriods(options({dateFrom,dateTo,fetchPage:async()=>{calls++;return{transactions:[]};}})),e=>e instanceof BankPeriodError&&e.code==='BANK_DATE_RANGE_INVALID');
 assert.equal(calls,0);
 assert.throws(()=>bankSyncRange('2026-01-01','not-a-timestamp','2026-02-01'),/datum|tidpunkt/);
});

test('a leap-year long interval is fetched once per non-overlapping inclusive window',async()=>{
 const calls=[];const result=await fetchBankPeriods(options({dateFrom:'2023-12-31',dateTo:'2024-04-01',fetchPage:async input=>{calls.push(input);return{transactions:[{date:input.dateFrom}]};}}));
 assert.deepEqual(calls.map(x=>[x.dateFrom,x.dateTo]),[['2023-12-31','2024-03-29'],['2024-03-30','2024-04-01']]);
 assert.equal(result.length,2);
});

test('narrower retry resets pagination and discards rows from the abandoned window',async()=>{
 const calls=[];const result=await fetchBankPeriods(options({dateFrom:'2026-01-01',dateTo:'2026-01-04',fetchPage:async input=>{
  calls.push(input);
  if(input.dateTo==='2026-01-04'&&input.dateFrom==='2026-01-01'){
   if(input.continuationKey)throw periodError();
   return{transactions:[{id:'abandoned'}],continuation_key:'old-cursor'};
  }
  assert.equal(input.continuationKey,undefined);return{transactions:[{id:input.dateFrom}]};
 }}));
 assert.deepEqual(result.flatMap(x=>x.transactions).map(x=>x.id),['2026-01-01','2026-01-03']);
 assert.deepEqual(calls.map(x=>[x.dateFrom,x.dateTo,x.continuationKey]),[['2026-01-01','2026-01-04',undefined],['2026-01-01','2026-01-04','old-cursor'],['2026-01-01','2026-01-02',undefined],['2026-01-03','2026-01-04',undefined]]);
});

test('empty history pages retain the same inclusive period until continuation ends',async()=>{
 const calls=[];const result=await fetchBankPeriods(options({dateFrom:'2026-03-28',dateTo:'2026-03-30',fetchPage:async input=>{calls.push(input);return input.continuationKey?{transactions:[{id:'history'}]}:{transactions:[],continuation_key:'history-preparation'};}}));
 assert.deepEqual(calls.map(x=>[x.dateFrom,x.dateTo]),[['2026-03-28','2026-03-30'],['2026-03-28','2026-03-30']]);assert.equal(result[0].transactions[0].id,'history');
});

test('rate, expiry, timeout and invalid date errors never trigger interval retries',async()=>{
 for(const code of ['BANK_RATE_LIMIT','BANK_RECONNECT_REQUIRED','BANK_TIMEOUT','BANK_DATE_RANGE_INVALID']){
  let calls=0;const error=Object.assign(Error(code),{code});
  await assert.rejects(fetchBankPeriods(options({dateFrom:'2026-01-01',dateTo:'2026-01-31',fetchPage:async()=>{calls++;throw error;}})),e=>e===error);assert.equal(calls,1);
 }
});

test('unavailable single days and global request limits never return partial coverage',async()=>{
 let calls=0;
 await assert.rejects(fetchBankPeriods(options({fetchPage:async()=>{calls++;throw periodError();}})),e=>e.code==='BANK_PERIOD_UNAVAILABLE');assert.equal(calls,1);
 const budget={requests:24,rows:0};
 await assert.rejects(fetchBankPeriods(options({dateTo:'2026-01-02',budget,fetchPage:async()=>({transactions:[{id:'partial'}],continuation_key:'next'})})),e=>e.code==='BANK_SYNC_LIMIT');assert.equal(budget.requests,25);
});

test('a lost lease stops before calling the provider',async()=>{
 let calls=0;await assert.rejects(fetchBankPeriods(options({authorize:async()=>{throw Error('BANK_LEASE_LOST');},fetchPage:async()=>{calls++;return{transactions:[]};}})),/BANK_LEASE_LOST/);assert.equal(calls,0);
});
