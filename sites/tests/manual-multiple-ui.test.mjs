import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createManualMultipleClient} from '../lib/manual-multiple-client.js';
import {candidates,quote,selection,receipt,storage} from '../../test/helpers/manual-multiple-client-cases.mjs';
let source=ts.transpileModule(readFileSync(new URL('../components/manual-multiple-allocation.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,url]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'@/lib/manual-multiple-client.js':new URL('../lib/manual-multiple-client.js',import.meta.url).href}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(url));
const {ManualMultipleView:View,default:Panel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const draft={amounts:{'invoice-a':'300,01','invoice-b':'430,99'},note:'Originalen är granskade.'};
const render=props=>renderToStaticMarkup(React.createElement(View,{snapshot:{phase:'closed',error:''},draft,confirmed:false,onAction(){},onDraft(){},onConfirmed(){},...props}));
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];

test('Sites entry is adjacent to the existing proposal and demo cannot start real allocation',()=>{
 const dashboard=readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8');assert.match(dashboard,/<ReconciliationProposalPanel[^\n]+\n\s*<ManualMultipleAllocation/);
 const html=renderToStaticMarkup(React.createElement(Panel,{transactionId:'synthetic-payment',revision:7,companyKey:'synthetic-company',demo:true}));assert.match(html,/Demoläget/);assert.doesNotMatch(html,/Godkänn hela fördelningen|type="submit"/);
});
test('editing shows all exact references, available amount, note and no final approval',()=>{
 const html=render({snapshot:{phase:'editing',discovery:candidates(),error:''}});
 for(const value of ['00042','00043','300,01','430,99','731,00','Granska hela fördelningen','Beskriv granskningen av originalen'])assert.ok(html.includes(value),value);
 assert.match(html,/&lt;payer&gt;/);assert.match(html,/&lt;customer&gt;/);assert.doesNotMatch(html,/<payer>|<customer>|Godkänn hela fördelningen/);
});
test('three explicit invoice rows retain leading zeroes and link only to the existing owned-original route',()=>{
 const c=candidates();c.invoices[0].invoiceTotalMinor=c.invoices[0].invoiceRemainingBeforeMinor=10001;c.invoices[1].invoiceTotalMinor=c.invoices[1].invoiceRemainingBeforeMinor=20002;c.invoices.push({...c.invoices[1],invoiceId:'invoice-c',number:'00044',reference:'00044',invoiceTotalMinor:43097,invoiceRemainingBeforeMinor:43097});c.references.push('00044');
 const html=render({snapshot:{phase:'editing',discovery:c,error:''},draft:{amounts:{'invoice-a':'100,01','invoice-b':'200,02','invoice-c':'430,97'},note:''},originals:{'invoice-a':'owned-original-a','invoice-b':'owned-original-b','invoice-c':'owned-original-c'}});
 for(const value of ['00042','00043','00044','100,01','200,02','430,97'])assert.ok(html.includes(value),value);assert.equal((html.match(/Visa fakturaoriginal/g)||[]).length,3);assert.match(html,/href="\/api\/files\?id=owned-original-c"/);assert.doesNotMatch(html,/Godkänn hela fördelningen/);
});
for(const amount of [73000,73201])test('review displays exact row remainders and payment remainder for '+amount,()=>{
 const base=candidates({availableMinor:amount,shortfallMinor:Math.max(0,73100-amount),excessMinor:Math.max(0,amount-73100)}),q=quote(base,selection({allocations:[{invoiceId:'invoice-a',amountMinor:30001},{invoiceId:'invoice-b',amountMinor:amount<73100?42999:43099}]}));
 const html=render({snapshot:{phase:'review',quote:q,error:''}});assert.match(html,/Fakturarest efter/);assert.match(html,/Betalningsrest efter/);assert.ok(html.includes(amount<73100?'1,00':'1,01'));assert.match(html,/type="checkbox"/);assert.match(html,/<button[^>]*disabled=""[^>]*>Godkänn hela fördelningen/);assert.doesNotMatch(html,/name="manual-amount/);
});
test('view action handlers reach the real immutable review controller only after the confirmation checkbox',async()=>{
 const calls=[],client=createManualMultipleClient({transactionId:'synthetic-payment',companyId:'synthetic-company',scopeKey:'synthetic',storage:storage(),newRequestId:()=> 'synthetic-ui-request',request:async(path,body)=>{calls.push({path,body});return path.includes('?transactionId=')?candidates():path.endsWith('/preview')?quote():receipt(body);}});
 await client.load();const action=name=>name==='review'?client.review(selection()):name==='confirm'?client.confirm(confirmed):client.edit();let confirmed=false;
 let tree=View({snapshot:client.snapshot,draft,confirmed,onAction:action,onDraft(){},onConfirmed:v=>confirmed=v});let button=elements(tree).find(node=>node.type==='button'&&node.props.children==='Granska hela fördelningen');await button.props.onClick();assert.equal(client.snapshot.phase,'review');assert.equal(calls.length,2);
 tree=View({snapshot:client.snapshot,draft,confirmed,onAction:action,onDraft(){},onConfirmed:v=>confirmed=v});button=elements(tree).find(node=>node.type==='button'&&node.props.children==='Godkänn hela fördelningen');assert.equal(button.props.disabled,true);await button.props.onClick();assert.equal(calls.length,2);
 elements(tree).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});tree=View({snapshot:client.snapshot,draft,confirmed,onAction:action,onDraft(){},onConfirmed:v=>confirmed=v});button=elements(tree).find(node=>node.type==='button'&&node.props.children==='Godkänn hela fördelningen');assert.equal(button.props.disabled,false);await button.props.onClick();assert.equal(calls.length,3);assert.equal(client.snapshot.phase,'saved');
});
test('unknown and historical outcomes show recovery or manual provenance without automatic VERIFIED language',()=>{
 const unknown=render({snapshot:{phase:'unknown',error:'Utfallet är ännu okänt.',requestId:'synthetic-request'}});assert.match(unknown,/Hämta kvitto/);assert.match(unknown,/Försök samma godkännande igen/);assert.doesNotMatch(unknown,/Granska hela fördelningen|Godkänn hela fördelningen/);
 const html=render({snapshot:{phase:'saved',receipt:receipt({requestId:'synthetic-request',reviewHash:'a'.repeat(64)}).receipt,error:''}});assert.match(html,/Manuellt registrerad fördelning/);assert.match(html,/vid godkännandet/);assert.match(html,/00042/);assert.match(html,/00043/);assert.doesNotMatch(html,/VERIFIED|Automatiskt verifierad|is-passed/);
});
