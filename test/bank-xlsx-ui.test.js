import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function view(){
  const elements=new Map();const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',value:'',isConnected:true,focus(){},addEventListener(){},setAttribute(){},querySelector:selector=>element(key+' '+selector),querySelectorAll:()=>[]});return elements.get(key);};
  const context=vm.createContext({document:{querySelector:element,getElementById:id=>element('#'+id),addEventListener(){},body:{classList:{add(){},remove(){}}}},location:{search:''},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../public/payment-control.js',import.meta.url),'utf8'),context);
  return code=>vm.runInContext(code,context);
}

test('Node Bankgiro picker includes XLSX and review preview describes saving an original without bank events',()=>{
  const run=view();run('globalThis.selectedAccept="";closeModal=()=>{};filePicker=accept=>{selectedAccept=accept};bankFilePicker()');assert.match(run('selectedAccept'),/\.xlsx/);
  run('state.preview={name:"synthetic.xlsx",count:1,review:1,review_only:true,items:[],warnings:["Kontokoppling behöver verifieras."]}');
  const html=run('previewPanel()');assert.match(html,/Spara original för granskning/);assert.match(html,/Inga bankhändelser skapas/);assert.doesNotMatch(html,/Bekräfta import av/);
});

test('Node review-only confirmation reports the retained original without claiming a financial import',async()=>{
  const run=view();run('state.preview={name:"synthetic.xlsx",account:"Syntetiskt konto",content_base64:"test",review_only:true};globalThis.message="";api=async()=>({imported:0,duplicate:0,review:1,review_only:true});refresh=async()=>true;toast=text=>{message=text};navigate=()=>{}');
  await run('commitImport()');assert.match(run('message'),/Originalet.*granskning/);assert.doesNotMatch(run('message'),/bankhändelser importerade/);assert.equal(run('state.preview'),null);
});

test('Node XLSX preview shows the observed sender and generic reference without requiring a saved economic bank row',()=>{
  const run=view();run('state.preview={name:"synthetic.xlsx",count:1,review:1,review_only:true,warnings:[],items:[{payer:"Testbageriet AB",reference:"0017",amount_cents:12345,booked_at:"2026-10-20",bankgiro:"1234-5678",payer_bankgiro:"987-6543",review_only:true,account_evidence:{report:{sequence:"41"},cells:{reference:"C19"}}}]}');
  const html=run('previewPanel()');assert.match(html,/Testbageriet AB/);assert.match(html,/>0017</);assert.match(html,/Betalningsreferens/);assert.match(html,/1234-5678/);assert.match(html,/<details/);assert.match(html,/C19/);assert.doesNotMatch(html,/<th>OCR<|Betalare okänd|Betalt/);
});
