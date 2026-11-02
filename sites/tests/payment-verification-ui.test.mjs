import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const compile=(path,imports={})=>{let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;for(const [name,target]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),...imports}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(target));return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');};
const presentation=compile('../lib/account-evidence-presentation.ts',{'./domain':new URL('../lib/domain.ts',import.meta.url).href}),hook=compile('../components/use-payment-verification.ts',{'@/lib/account-evidence-presentation':presentation});
let code=ts.transpileModule(readFileSync(new URL('../components/payment-verification.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const name of ['react','react/jsx-runtime'])for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(import.meta.resolve(name)));
code=code.replaceAll("'./use-payment-verification'",JSON.stringify(hook));
const {default:Panel,PaymentVerificationReport,AccountEvidenceResult}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
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

test('economic and evidence rows stay distinct and transient failures keep source, time and next action visible',()=>{for(const countedEconomically of [true,false]){const html=render(PaymentVerificationReport,{report:{...report,countedEconomically}});assert.match(html,countedEconomically?/Ekonomisk bankpost/:/Evidensrad/);assert.match(html,countedEconomically?/räknas som pengar/:/räknas inte som en separat ekonomisk insättning/);}const html=render(AccountEvidenceResult,{result:{verified:false,status:'ambiguous',checkedAt:'2026-11-02T10:00:00Z',complete:false,reason:'Flera konton kan passa.',source:'Bankens aktuella ägda AIS-medgivande',next:'Granska originalet.'}});for(const text of ['okänt / blockerat','Flera konton','Källa','Kontrollerad','Fullständighet','Ofullständig','Nästa steg','Granska originalet'])assert.ok(html.includes(text));assert.doesNotMatch(html,/Aktuellt mottagarkonto stämmer|is-passed|<form/);});

test('real panel titles a unique unregistered hint as a proposal and renders only an explicit account read control',async()=>{const value={...report,countedEconomically:true,invoiceHint:{number:'0712',proposal:true},accountEvidenceTarget:{transactionId:'synthetic-id',documentId:'synthetic-report'},invoiceOriginal:{documentId:'private-proof',integrity:'passed',sha256:'f'.repeat(64),sizeBytes:123}};const hook='data:text/javascript;base64,'+Buffer.from('export function usePaymentVerification(){return '+JSON.stringify({report:value,error:'',loading:false,account:null,accountLoading:false})+';}').toString('base64');const {default:ActualPanel}=await import(compile('../components/payment-verification.tsx',{'./use-payment-verification':hook}));const html=render(ActualPanel,{transactionId:'synthetic-id',revision:7});assert.match(html,/Betalningskontroll · Fakturaförslag 0712/);assert.match(html,/Kontrollera mottagarkonto hos banken/);assert.equal((html.match(/<button/g)||[]).length,1);assert.equal((html.match(/<details>/g)||[]).length,11);assert.doesNotMatch(html,/private-proof|ffffffffff|<form/);});

test('current account result renders Swedish status labels while internal protocol statuses stay separate',()=>{for(const [status,label]of [['matched','Kontot stämmer'],['missing','Uppgift saknas'],['blocked','Blockerat'],['stale','Inaktuell kontroll'],['mismatch','Kontouppgifterna avviker'],['incomplete','Ofullständig kontroll'],['ambiguous','Tvetydigt resultat'],['error','Kontrollen misslyckades'],['unknown','Okänt resultat']]){const html=render(AccountEvidenceResult,{result:{verified:status==='matched',status,checkedAt:null,complete:false,reason:'Syntetisk kontroll.',source:'Bankens kontoläsning',next:'Granska originalet.'}});assert.match(html,new RegExp('<dt>Resultat</dt><dd>'+label+'</dd>'));assert.doesNotMatch(html,new RegExp('<dd>'+status+'</dd>'));}});
