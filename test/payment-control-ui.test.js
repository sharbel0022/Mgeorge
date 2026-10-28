import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {paymentGroup} from '../src/payment-overview.js';
function view(){
 const elements=new Map();
 function el(key){if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',hidden:false,isConnected:true,value:'',inert:false,disabled:false,focus(){},setAttribute(){},addEventListener(){},querySelector:el,querySelectorAll(){return[];}});return elements.get(key);}
 const ctx=vm.createContext({document:{querySelector:el,getElementById:id=>el('#'+id),addEventListener(){},body:{classList:{add(){},remove(){}}},hidden:false},window:{addEventListener(){},scrollTo(){}},location:{search:'',assign(){}},history:{pushState(){},replaceState(){}},URL,URLSearchParams,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),crypto:{randomUUID:()=> 'test_request_000000000001'},setTimeout:()=>1,clearTimeout(){}});
 for(const name of ['app','review','messages','payment-control'])vm.runInContext(readFileSync(new URL(`../public/${name}.js`,import.meta.url),'utf8'),ctx);
 vm.runInContext("state.me={authenticated:true,login_required:true};state.control={counts:{review:0},totals:{},queue:[],run:null}",ctx);
 return {run:code=>vm.runInContext(code,ctx),set:(name,value)=>ctx[name]=value,html:()=>el('#app').innerHTML};
}
test('overview has one main action, five menu areas and explicit no-send explanation',()=>{
 const v=view();v.run('render()');const html=v.html();
 assert.equal((html.match(/data-control-start/g)||[]).length,1);
 for(const text of ['Kontrollera alla betalningar','Att granska','Fakturor','Bank & betalningar','Inställningar','Inga kundmejl skickas'])assert.ok(html.includes(text),text);
 assert.equal(v.run('nav.length'),5);assert.match(html,/inte bevis/);
});
test('untrusted customer text is escaped in the consolidated queue',()=>{
 const v=view();v.set('tasks',[{id:'x',type:'payment',entity_id:'test',title:'<img onerror=alert(1)>',reason:'<script>unsafe</script>',action:'Granska',amount_cents:10000}]);
 const html=v.run('controlQueue(tasks)');assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script/);
});
test('bank UI grouping and read-only server grouping agree',()=>{
 const v=view();for(const t of [{amount_cents:-500000,status:'unmatched'},{amount_cents:40538,description:'Kortköp återbetalning'},{amount_cents:10000,is_aggregate:true},{amount_cents:10000,available_cents:0},{excluded:true,amount_cents:1000}]){v.set('t',t);assert.equal(v.run('paymentGroupUI(t)'),paymentGroup(t));}
});
test('pending start prevents a second request and cannot send customer email',async()=>{
 const v=view();let release;const gate=new Promise(r=>release=r);v.set('gate',gate);
 v.run("globalThis.calls=[];render=()=>{};api=async(path,method,data)=>{calls.push({path,method,data});await gate;return {job:{id:'run',status:'running',steps:[]}}}");
 const first=v.run('startPaymentControl()');const second=v.run('startPaymentControl()');await second;
 assert.equal(v.run('calls.length'),1);assert.equal(v.run('calls[0].path'),'/payment-control/run');
 assert.equal(v.run('Object.keys(calls[0].data).join()'),'request_id');release();await first;
 assert.equal(v.run('state.control.run.id'),'run');assert.equal(v.run('controlBusy()'),true);
});
test('lost response retries with same idempotency key instead of a new job',async()=>{
 const v=view();v.run("globalThis.calls=[];render=()=>{};handleError=()=>{};api=async(path,method,data)=>{calls.push(data.request_id);throw Error('connection interrupted')}");
 await v.run('startPaymentControl()');await v.run('startPaymentControl()');
 assert.equal(v.run('calls.length'),2);assert.equal(v.run('calls[0]'),v.run('calls[1]'));
});
test('logout clears private job summary and ignores late start responses',async()=>{
 const v=view();let release;const gate=new Promise(r=>release=r);v.set('gate',gate);
 v.run("render=()=>{};api=async()=>{await gate;return {job:{id:'PRIVATE-RUN',status:'running',steps:[]}}}");
 const pending=v.run('startPaymentControl()');v.run("showLogin('Logga in igen')");release();await pending;
 assert.equal(v.run('state.control'),null);assert.equal(v.run('state.me.authenticated'),false);assert.doesNotMatch(v.html(),/PRIVATE-RUN/);
});
test('review queue preserves import and full customer-message history navigation',()=>{
 const v=view();const html=v.run('paymentControlReview()');assert.match(html,/data-nav="messages"/);assert.match(html,/data-nav="import"/);assert.doesNotMatch(html,/data-save-message|\/send|approve:/);
});
