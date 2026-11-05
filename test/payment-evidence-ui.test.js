import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function ui(){
 const elements=new Map();
 const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',setAttribute(){},addEventListener(){},querySelector:element,querySelectorAll(){return[];}});return elements.get(key);};
 const context=vm.createContext({document:{querySelector:element,getElementById:element,addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){},scrollTo(){}},location:{search:''},history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout(){}});
 for(const name of ['workspace-search','app','messages','payment-control'])vm.runInContext(readFileSync(new URL(`../public/${name}.js`,import.meta.url),'utf8'),context);
 return {run:code=>vm.runInContext(code,context),set:(key,value)=>context[key]=value};
}
const payment=(reference,kind)=>({id:'t',booked_at:'2026-10-26',amount_cents:62500,verified_cents:62500,account:'SYNTHETIC',payer:'Bank payer <AB>',reference,bank_reference:'BANK-ID',source:'enablebanking',raw_bank_data_sha256:'a'.repeat(64),raw_bank_data:{status:'BOOK',debtor:{name:'Bank payer <AB>'}},reference_evidence:{candidates:[{kind,value:reference}]}});
const message=t=>({invoice:{party:'Invoice customer',invoice_number:'0599',total_cents:62500,paid_cents:62500,remaining_cents:0},kind:'confirmation',payments:[t],findings:[]});
test('technical bank evidence keeps raw values and paths escaped without changing payment facts',()=>{
 const v=ui(),t={...payment('000018','ocr'),payer_evidence:{name:{rawValue:'  <script>  ',source:'Document[0]/Dbtr[0]/Nm[0]'}}};v.set('t',t);const before=JSON.stringify(t);
 const html=v.run('bankTechnicalEvidenceUI(t)');assert.match(html,/Document\[0\]\/Dbtr/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/  &lt;script&gt;  /);assert.equal(JSON.stringify(t),before);
});

for(const [kind,reference,label] of [['invoice','0599','Fakturareferens'],['structured','AB/0012','Betalningsreferens'],['ocr','000018','OCR']])test(`message approval preserves a typed ${kind} reference in payments and findings`,()=>{
 const v=ui(),t=payment(reference,kind),m=message(t);m.findings.push({transaction_id:'t',details:{reason:'Uncertain proposal'}});v.set('m',m);v.set('rows',[t]);v.run('state.transactions=rows');
 const before=JSON.stringify(m),html=v.run('messageEvidence(m)');
 assert.equal((html.match(new RegExp(label+' '+reference.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length,2);
 if(kind!=='ocr')assert.doesNotMatch(html,new RegExp('OCR '+reference.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(html,/Bank payer &lt;AB&gt;/);assert.doesNotMatch(html,/<AB>/);assert.equal(JSON.stringify(m),before);
});

test('message approval separates manually entered payer and reference from bank facts',()=>{
 const v=ui(),m=message({...payment('0599','ocr'),source:'manual',payer:'Manual <payer>'});v.set('m',m);
 const html=v.run('messageEvidence(m)');
 assert.match(html,/Betalare okänd/);assert.match(html,/Manuellt angiven betalare: Manual &lt;payer&gt;/);assert.match(html,/Manuellt angiven referens: 0599/);assert.doesNotMatch(html,/OCR 0599|<payer>/);
});

for(const field of ['bank_evidence_conflicts','ancestor_bank_evidence_conflicts'])for(const remaining of [37500,0])test(`${field} stays visible over retained ${remaining?'partial':'excess'} allocations`,()=>{
 const v=ui(),t={id:'t',amount_cents:62500,available_cents:remaining?0:10000,status:'review',[field]:[{}]};v.set('t',t);v.run(`state.invoices=[{id:'i',remaining_cents:${remaining}}];state.allocations=[{transaction_id:'t',invoice_id:'i'}]`);
 assert.equal(v.run('bankStatusLabelUI(t)'),'Motstridigt bankunderlag');
});

test('ordinary partial and excess labels remain available',()=>{
 const v=ui();v.run("state.invoices=[{id:'i',remaining_cents:37500}];state.allocations=[{transaction_id:'t',invoice_id:'i'}]");v.set('t',{id:'t',amount_cents:62500,available_cents:0,status:'matched'});
 assert.equal(v.run('bankStatusLabelUI(t)'),'Delbetalning');v.run('state.invoices[0].remaining_cents=0;t.available_cents=10000');assert.equal(v.run('bankStatusLabelUI(t)'),'Överbetalning');
});
