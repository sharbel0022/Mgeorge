import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=(path,imports={})=>{let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;for(const [name,target]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),...imports}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(target));return data(source);};
const presentation=compile('../lib/account-evidence-presentation.ts',{'./domain':new URL('../lib/domain.ts',import.meta.url).href});
const {accountEvidenceDisplay}=await import(presentation);
const hook=compile('../components/use-payment-verification.ts',{'@/lib/account-evidence-presentation':presentation});
const {AccountEvidenceResult}=await import(compile('../components/payment-verification.tsx',{'./use-payment-verification':hook}));
const target={transactionId:'synthetic-ais',documentId:'synthetic-report'},checkedAt='2026-11-02T10:00:00.000Z';
const error=(patch={})=>({transactionId:target.transactionId,documentId:target.documentId,revision:7,changed:false,checkedAt:'2026-11-02T10:00:01.000Z',sourceScope:'current_owned_ais_consent',status:'error',reason:'Kontouppgifterna kunde inte verifieras.',complete:false,accountMatch:false,ambiguous:false,providerContacted:true,rows:[],errorCode:'BANK_RATE_LIMIT',stage:'account_details',...patch});
const known=(patch={})=>({status:'known',checkedAt,notBefore:'2026-11-02T12:00:00.000Z',provenance:'retry_after_seconds',...patch});
const show=value=>accountEvidenceDisplay(value,target,7);
const freezeNow=t=>t.mock.method(Date,'now',()=>Date.parse('2026-11-02T10:00:02.000Z'));
const notVerified=result=>{assert.equal(result.verified,false);assert.equal(result.complete,false);assert.equal(result.status,'error');};

// The omission this catches is dropping a real supplier deadline at the final
// display boundary. Literal deadlines are independent of the production parser.
test('an explicit supplier duration shows its lower bound, provenance and server check time without verifying the account',t=>{
 freezeNow(t);const before=error({retryAdvice:known()}),snapshot=structuredClone(before),result=show(before);notVerified(result);
 assert.match(result.next,/2026-11-02 13:00:00/);assert.match(result.next,/Retry-After.*sekunder/);assert.match(result.next,/servern.*2026-11-02 11:00:00/);assert.match(result.next,/ny uttrycklig kontokontroll/);assert.match(result.next,/Ingen automatisk/);assert.deepEqual(before,snapshot);
 const html=renderToStaticMarkup(React.createElement(AccountEvidenceResult,{result}));assert.match(html,/Nästa steg/);assert.match(html,/2026-11-02 13:00:00/);assert.match(html,/Mottagarkonto okänt \/ blockerat/);assert.doesNotMatch(html,/Aktuellt mottagarkonto stämmer|<button|<form/);
});

test('an explicit supplier HTTP date is identified as an HTTP date rather than a local sync schedule',t=>{
 freezeNow(t);const result=show(error({retryAdvice:known({provenance:'retry_after_http_date'})}));notVerified(result);assert.match(result.next,/Retry-After.*HTTP-datum/);assert.match(result.next,/2026-11-02 13:00:00/);assert.doesNotMatch(result.next,/synk|60 sekunder|nextAttemptAt/i);
});

for(const provenance of ['retry_after_missing','retry_after_invalid'])test(provenance+' leaves the supplier deadline unknown and requires manual checking',t=>{
 freezeNow(t);const result=show(error({retryAdvice:{status:'unknown',checkedAt,provenance}}));notVerified(result);assert.match(result.next,/väntetid är okänd/);assert.match(result.next,/Kontrollera.*banken/);assert.match(result.next,/Ingen automatisk/);assert.doesNotMatch(result.next,/2026-11-02 13:00:00|60 sekunder|synk|nästa tillåtna/i);
});

test('a legacy rate limit with no diagnostic never borrows a sync time or the adapter fallback as permission',t=>{
 freezeNow(t);const result=show(error({retryAfter:60,retryBlocked:false,nextAttemptAt:'2026-11-02T12:00:00.000Z'}));notVerified(result);assert.match(result.next,/väntetid är okänd/);assert.match(result.next,/Ingen automatisk/);assert.doesNotMatch(result.next,/2026-11-02|60 sekunder|tillåtna/i);
});

test('an oversized supplier wait requires manual checking without showing a truncated retry date',t=>{
 freezeNow(t);const result=show(error({retryAdvice:{status:'manual_block',checkedAt,provenance:'retry_after_exceeds_limit'},retryAfter:31536000,retryBlocked:true}));notVerified(result);assert.match(result.next,/manuell kontroll/);assert.match(result.next,/banken/);assert.match(result.next,/Ingen automatisk/);assert.doesNotMatch(result.next,/2027-|31536000|2026-11-02 13:00:00|ny uttrycklig kontokontroll vid behov/);
});

test('an elapsed supplier lower bound requires a fresh manual check and never claims that retry is now allowed',t=>{
 freezeNow(t);const result=show(error({retryAdvice:known({notBefore:'2026-11-02T10:00:01.000Z'})}));notVerified(result);assert.match(result.next,/har passerat/);assert.match(result.next,/Kontrollera aktuell väntetid/);assert.match(result.next,/Ingen automatisk/);assert.doesNotMatch(result.next,/nu tillåt|försök nu|kan nu/i);
});

test('malformed or forged advice cannot display a deadline, raw text or an unrelated source',t=>{
 freezeNow(t);
 const variants=[known({provenance:'bank_auto_sync_status.nextAttemptAt'}),known({notBefore:'2026-11-02 raw-secret'}),known({notBefore:'2027-11-03T10:00:00.000Z'}),known({notBefore:'2026-11-02T09:59:59.000Z'}),known({checkedAt:'2026-11-02T10:00:02.000Z'}),known({checkedAt:'2026-10-31T10:00:00.000Z'}),known({rawHeader:'raw-secret'}),{status:'unknown',checkedAt,provenance:'retry_after_invalid',notBefore:'2026-11-02T12:00:00.000Z'},{status:'manual_block',checkedAt,provenance:'retry_after_seconds'},'raw-secret',null,{}];
 for(const retryAdvice of variants){const result=show(error({retryAdvice}));notVerified(result);assert.match(result.next,/väntetid är okänd/,JSON.stringify(retryAdvice));assert.doesNotMatch(result.next,/raw-secret|2026-11-02 13:00:00|nextAttemptAt|31536000/);}
});

test('retry advice getters are ignored without evaluation',t=>{
 freezeNow(t);let reads=0;const getter=()=>{reads++;throw Error('raw-secret');},withGetter=known();Object.defineProperty(withGetter,'notBefore',{get:getter,enumerable:true});
 for(const value of [error({retryAdvice:withGetter}),Object.defineProperty(error(),'retryAdvice',{get:getter,enumerable:true})]){const result=show(value);notVerified(result);assert.match(result.next,/väntetid är okänd/);assert.doesNotMatch(result.next,/raw-secret|2026-11-02 13:00:00/);}assert.equal(reads,0);
});

test('retry advice never applies outside an incomplete current rate limit, and cannot promote bank identity',t=>{
 freezeNow(t);for(const patch of [{errorCode:'BANK_TIMEOUT'},{status:'stale'},{stage:'transactions'},{providerContacted:false},{complete:true},{accountMatch:true},{ambiguous:true},{rows:[{}]},{transactionId:'foreign'},{documentId:'foreign'},{revision:6}]){const result=show(error({...patch,retryAdvice:known()}));assert.equal(result.verified,false);assert.doesNotMatch(result.next,/2026-11-02 13:00:00|Retry-After/);}
 const matched=error({status:'matched',snapshotCurrent:true,complete:true,accountMatch:true,resourcesRead:1,resourcesTotal:1,reportRowCount:1,rows:[{rowIndex:0,status:'matched',matched:true,ambiguous:false,scheme:'BBAN',sourcePath:'account_id.other.identification',sourceScope:'current_owned_ais_consent'}],retryAdvice:known()});const result=show(matched);assert.equal(result.verified,true);assert.doesNotMatch(result.next,/Retry-After|2026-11-02 13:00:00/);assert.match(result.next,/sparas inte som kontoalias/);
});

test('a session rate limit uses the same safe wait without implying that account details were read',t=>{
 freezeNow(t);const result=show(error({stage:'session',resourcesRead:0,resourcesAttempted:0,retryAdvice:known()}));notVerified(result);assert.match(result.next,/Retry-After/);assert.doesNotMatch(result.reason,/kontouppgifter motsvarar/);
});
