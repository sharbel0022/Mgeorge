import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const compile=(path,imports={})=>{
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,target] of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),...imports}))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(target));
 return 'data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL='+new URL(path,import.meta.url).href).toString('base64');
};
const presentation=compile('../lib/account-evidence-presentation.ts',{'./domain':new URL('../lib/domain.ts',import.meta.url).href});
const hook=compile('../components/use-payment-verification.ts',{'@/lib/account-evidence-presentation':presentation});
const {PaymentVerificationReport}=await import(compile('../components/payment-verification.tsx',{'./use-payment-verification':hook}));
const checks=[['received','Banktransaktion mottagen'],['report','Bankgirooriginal mottaget'],['original','Originalintegritet'],['account','Mottagarkonto'],['deposit','Samma insättning'],['payer','Betalare'],['reference','Betalningsreferens'],['invoice','Faktura'],['customer','Kundrelation'],['amount','Fakturabelopp och saldo'],['reconciliation','Avstämning']];
function verifiedReport(){
 return {transactionId:'synthetic-payment',checkedAt:'2026-11-02T12:00:00.000Z',mode:'preview',changed:false,automaticEligible:false,bookedAllocationCount:1,countedEconomically:true,steps:checks.map(([id,label])=>({id,label,status:'passed',statusLabel:'Kontrollerat',facts:[{label:'Referens',value:'00599'}],source:'Syntetiskt bevarat original',checkedAt:'2026-11-02T12:00:00.000Z',rule:'synthetic-evidence-rule',reason:label+' har kontrollerats.',next:'Bevara underlaget för '+label+'.'}))};
}
const step=(report,id)=>report.steps.find(item=>item.id===id);
const render=report=>renderToStaticMarkup(React.createElement(PaymentVerificationReport,{report}));
function summary(html){
 const match=html.match(/<section\b[^>]*aria-label="Samlad betalningskontroll"[^>]*>([\s\S]*?)<\/section>/);
 assert.ok(match,'overall result and pending check must be visible before the detailed disclosures');
 assert.ok(html.indexOf(match[0])<html.indexOf('<ol'),'the summary precedes the individual checks');
 assert.doesNotMatch(match[0],/<details\b|<summary\b/,'the next action must not require opening a disclosure');
 return match[0];
}
function assertState(html,label){
 const visible=summary(html);
 assert.match(visible,new RegExp('role="status"[^>]*>[\\s\\S]*?<strong>'+label+'</strong>'),'the overall result has its own accessible status');
 return visible;
}

test('complete current evidence and a recorded economic payment can show Verifierad',()=>{
 const report=verifiedReport(),before=structuredClone(report),html=render(report),visible=assertState(html,'Verifierad');
 assert.match(visible,/Alla obligatoriska kontroller/);
 assert.equal((html.match(/<details>/g)||[]).length,11);
 assert.match(html,/00599/);assert.match(html,/synthetic-evidence-rule/);
 assert.doesNotMatch(html,/<button\b|<form\b|<a\s/);
 assert.deepEqual(report,before,'rendering cannot change recorded evidence or payment state');
});

test('direct bank evidence can omit a separate report and deposit link only when the server marks them unnecessary',()=>{
 const report=verifiedReport();step(report,'report').status='not_required';step(report,'deposit').status='not_required';
 assertState(render(report),'Verifierad');
});

test('every missing or blocked required check prevents a verified overall payment and exposes that exact next action',()=>{
 for(const [id,label] of checks)for(const status of ['missing','blocked']){
  const report=verifiedReport();Object.assign(step(report,id),{status,reason:'Saknat underlag för '+label+'.',next:'Kontrollera exakt '+label+'.'});
  const visible=assertState(render(report),'Blockerad');
  assert.ok(visible.includes(label),id+' must identify the pending check');
  assert.ok(visible.includes('Saknat underlag för '+label+'.'),id+' must preserve the reason');
  assert.ok(visible.includes('Kontrollera exakt '+label+'.'),id+' must preserve the next action');
 }
});

test('a manual source relationship remains Behöver granskas despite all other checks and a recorded payment',()=>{
 const report=verifiedReport();Object.assign(step(report,'deposit'),{status:'manual',statusLabel:'Manuell relation',reason:'Administratören har beslutat att underlagen hör samman.',next:'Verifiera kundrelationen separat.'});
 const visible=assertState(render(report),'Behöver granskas');
 assert.match(visible,/Samma insättning/);assert.match(visible,/Administratören har beslutat/);assert.match(visible,/Verifiera kundrelationen separat/);
});

test('recorded allocations do not hide a current customer review',()=>{
 const report=verifiedReport();report.bookedAllocationCount=3;Object.assign(step(report,'customer'),{status:'review',reason:'Kundrelationen är inte självständigt verifierad.',next:'Granska behörig tredjepartsrelation.'});
 const visible=assertState(render(report),'Behöver granskas');
 assert.match(visible,/Kundrelation/);assert.match(visible,/Granska behörig tredjepartsrelation/);
});

test('automatic eligibility is a proposal with the server-provided next decision still visible',()=>{
 const report=verifiedReport();report.automaticEligible=true;report.bookedAllocationCount=0;Object.assign(step(report,'reconciliation'),{status:'review',statusLabel:'Förslag · separat beslut krävs',reason:'En säker matchning föreslås men ingen allokering har skapats.',next:'Granska underlagen och fatta ett separat beslut.'});
 const visible=assertState(render(report),'Behöver granskas');
 assert.match(visible,/Avstämning/);assert.match(visible,/ingen allokering har skapats/);assert.match(visible,/fatta ett separat beslut/);
});

test('complete steps alone do not turn an unbooked proposal or a non-economic report observation into a verified payment',()=>{
 for(const fields of [{bookedAllocationCount:0,automaticEligible:true},{countedEconomically:false}])assertState(render({...verifiedReport(),...fields}),'Behöver granskas');
});

test('a blocking source check is shown before an earlier review and is separate from the account-read status',()=>{
 const report=verifiedReport();step(report,'received').status='review';Object.assign(step(report,'account'),{status:'blocked',reason:'Rapportens konto kan inte knytas till valt bankkonto.',next:'Begär bankens uttryckliga kontobesked.'});
 const visible=assertState(render(report),'Blockerad');
 assert.match(visible,/Mottagarkonto/);assert.match(visible,/Begär bankens uttryckliga kontobesked/);assert.doesNotMatch(visible,/Banktransaktion mottagen har kontrollerats/);
 assert.equal((visible.match(/role="status"/g)||[]).length,1);
});

test('a partial, contradictory or malformed report fails closed without crashing the public renderer',()=>{
 const mutations=[
  ()=>null,
  report=>({...report,steps:undefined}),
  report=>({...report,steps:[]}),
  report=>({...report,steps:report.steps.filter(item=>item.id!=='original')}),
  report=>{step(report,'original').id='received';return report;},
  report=>{step(report,'account').status='invented';return report;},
  report=>{step(report,'reference').reason={html:'unexpected'};return report;},
  report=>{step(report,'reference').facts=[null];return report;},
  report=>{step(report,'original').status='not_required';return report;},
  report=>{step(report,'invoice').checkedAt='not-a-date';return report;},
  report=>{step(report,'original').source='';return report;},
  report=>{step(report,'account').next='  ';return report;},
  report=>({...report,checkedAt:'not-a-date'}),
  report=>({...report,countedEconomically:undefined}),
  report=>({...report,bookedAllocationCount:-1}),
  report=>({...report,bookedAllocationCount:0.5}),
  report=>({...report,changed:true}),
 ];
 for(const mutate of mutations){
  const visible=assertState(render(mutate(verifiedReport())),'Blockerad');
  assert.match(visible,/Läs in betalningskontrollen igen/);
 }
});

test('the visible reason and next step escape bank text while original evidence remains available',()=>{
 const report=verifiedReport();Object.assign(step(report,'reference'),{status:'blocked',reason:'Referens <script>unsafe</script> är motstridig.',next:'Granska <img onerror="unsafe"> i originalet.'});
 const html=render(report),visible=assertState(html,'Blockerad');
 assert.match(visible,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.match(visible,/&lt;img onerror=&quot;unsafe&quot;&gt;/);
 assert.doesNotMatch(html,/<script\b|<img\b|<button\b|<form\b/);
 assert.equal((html.match(/<details>/g)||[]).length,11);
});

test('a structured status from malformed JSON cannot execute coercion or crash the summary',()=>{
 const report=verifiedReport();step(report,'account').status=JSON.parse('{"toString":null}');
 assertState(render(report),'Blockerad');
});
