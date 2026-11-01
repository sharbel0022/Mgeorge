import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

let code=ts.transpileModule(readFileSync(new URL('../components/payment-verification.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const name of ['react','react/jsx-runtime'])for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(import.meta.resolve(name)));
const {default:Panel,PaymentVerificationReport}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const labels=['Banktransaktion mottagen','Bankgirooriginal mottaget','Originalintegritet','Mottagarkonto','Samma insättning','Betalare','Betalningsreferens','Faktura','Kundrelation','Fakturabelopp och saldo','Avstämning'];
const report={transactionId:'synthetic-id',checkedAt:'2026-11-01T21:00:00.000Z',mode:'preview',changed:false,automaticEligible:false,bookedAllocationCount:0,steps:labels.map((label,n)=>({id:'step-'+n,label,status:n===4?'manual':n===3?'blocked':'review',statusLabel:n===4?'Manuell relation':n===3?'Mottagarkontot saknas':'Kräver granskning',facts:[{label:'Exakt referens',value:'0599'},{label:'Bankfält',value:'<script>untrusted bank value</script>'}],source:'Bevarat bankoriginal',checkedAt:'2026-11-01T21:00:00.000Z',rule:'synthetic-read-only-v1',reason:'Bankuppgifter och manuellt beslut har olika proveniens.',next:'Granska originalen före separat administratörsbeslut.'}))};
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

test('the monochrome detail exposes eleven native keyboard disclosures with evidence and next steps',()=>{
 const html=render(PaymentVerificationReport,{report});
 assert.equal((html.match(/<details>/g)||[]).length,11);assert.equal((html.match(/<summary>/g)||[]).length,11);for(const label of labels)assert.ok(html.includes(label));
 for(const field of ['Källa','Kontrollerad','Kontrollregel','Nästa steg','synthetic-read-only-v1','0599'])assert.ok(html.includes(field));
 assert.match(html,/Manuell relation/);assert.match(html,/Mottagarkontot saknas/);assert.match(html,/Läsande kontroll · inga saldon ändras/);
 assert.doesNotMatch(html,/<button|<form|<a\s|method=|action=/,'the explanation report has no economic action controls');
 assert.match(html,/&lt;script&gt;untrusted bank value&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
});

test('demo never invents successful original verification or fetches a production payment',()=>{
 const before=structuredClone(report),html=render(Panel,{transactionId:'synthetic-id',revision:1,demo:true});
 assert.match(html,/<h3 id="verification-heading-synthetic-id">Betalningskontroll<\/h3>/);assert.match(html,/Demoläget har inga åtkomliga bank- eller fakturaoriginal/);assert.doesNotMatch(html,/is-passed|Intakt i denna kontroll/);assert.deepEqual(report,before);
});
