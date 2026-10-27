import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const activationMessage='Banktjänsten behöver aktiveras av systemadministratören.';
const account={uid:'test-account',name:'Företagskonto',account_hint:'•••• 1234',currency:'SEK'};
const connection={id:'test-connection',bank_name:'Swedbank',status:'connected',selected_account_uid:account.uid,valid_until:'2026-12-01T12:00:00Z',last_synced:'2026-10-27T10:00:00Z',accounts:[account]};

// A minimal DOM boundary for behavior tests. This does not replace browser QA:
// templates and action handlers execute unchanged, while transport and actual
// DOM layout are isolated. The startup /me request stays pending; no network,
// credentials, timers or company data are used.
function ui(){
  const elements=new Map(),listeners=new Map();
  function element(key){
    if(!elements.has(key))elements.set(key,{innerHTML:'',value:'',inert:false,isConnected:true,disabled:false,required:false,focus(){},setAttribute(){},addEventListener(name,handler){listeners.set(key+':'+name,handler);},querySelector(selector){return element(key+' '+selector);},querySelectorAll(){return[];}});
    return elements.get(key);
  }
  const context=vm.createContext({
    document:{querySelector:element,getElementById:id=>element('#'+id),addEventListener(){},body:{classList:{add(){},remove(){}}}},
    location:{search:'?tab=connections',assign(){}},window:{addEventListener(name,handler){listeners.set('window:'+name,handler);},scrollTo(){}},history:{pushState(){},replaceState(){}},
    URLSearchParams,URL,Intl,Date,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout(){}
  });
  vm.runInContext(source,context,{filename:'public/app.js'});
  vm.runInContext(readFileSync(new URL('../public/messages.js',import.meta.url),'utf8'),context,{filename:'public/messages.js'});
  vm.runInContext('state.me={authenticated:true,login_required:true}',context);
  return {context,element,run:code=>vm.runInContext(code,context),set:(name,value)=>{context[name]=value;},dispatch:name=>listeners.get('window:'+name)?.(),html:()=>element('#app').innerHTML};
}
const plain=value=>JSON.parse(JSON.stringify(value));
function bankFixture(view,connections=[],extra={}){view.set('fixture',{configured:true,connections,...extra});view.run('state.bank=fixture');}

test('missing activation is shown once on the page and modal, with file fallback and no technical configuration',()=>{
  const view=ui();bankFixture(view,[],{configured:false,activation:{message:activationMessage}});
  const html=view.run('connectionPage()');
  assert.equal(html.split(activationMessage).length-1,1);
  assert.match(html,/Importera bankfil istället/);
  assert.match(html,/Du skickas till bankens säkra inloggning/);
  assert.doesNotMatch(html,/PEM|JWT|ENABLE_BANKING|PRIVATE_KEY|SESSION_SECRET/);
  view.run('globalThis.dialogHtml="";modal=(title,html)=>{dialogHtml=html;};activationDialog("bank")');
  const dialog=view.run('dialogHtml');
  assert.equal(dialog.split(activationMessage).length-1,1);
  assert.match(dialog,/Kontakta systemadministratören/);
  assert.doesNotMatch(dialog,/PEM|JWT|ENABLE_BANKING|PRIVATE_KEY/);
});

test('activation details are escaped and sandbox is visibly identified',()=>{
  const view=ui();bankFixture(view,[],{configured:false,environment:'SANDBOX',activation:{message:'Produktion <script>alert(1)</script> väntar på godkännande.'}});
  const html=view.run('connectionPage()');
  assert.match(html,/Testmiljö/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});

test('bank-confirmed consent waits for account selection and does not claim connected',()=>{
  const view=ui();bankFixture(view,[{...connection,status:'pending_account',selected_account_uid:''}]);
  const html=view.run('connectionPage()');
  assert.match(html,/Välj företagskonto/);
  assert.match(html,/Anslut valt konto/);
  assert.match(html,/•••• 1234/);
  assert.doesNotMatch(html,/>Ansluten<|data-sync=/);
});

test('connected account exposes masked details, consent validity and actions',()=>{
  const view=ui();bankFixture(view,[connection]);
  const html=view.run('connectionPage()');
  for(const expected of ['•••• 1234','Senast uppdaterad','Medgivandet gäller till','Uppdatera bankhändelser','Förnya anslutningen','Koppla från banken'])assert.ok(html.includes(expected),expected);
  assert.match(html,/>Ansluten</);
  assert.doesNotMatch(html,/Välj konto…|Anslut valt konto/);
});

test('public login replaces bank content and logout is offered only for authenticated public access',()=>{
  const view=ui();bankFixture(view,[connection]);
  view.run('state.me={authenticated:true,login_required:true};render()');
  assert.match(view.html(),/data-action="logout"/);
  view.run('showLogin("Sessionen har gått ut.")');
  assert.match(view.html(),/id="login-form"/);
  assert.match(view.html(),/autocomplete="current-password"/);
  assert.match(view.html(),/Sessionen har gått ut/);
  assert.doesNotMatch(view.html(),/•••• 1234|data-sync=|data-action="logout"/);
  view.run('state.me={authenticated:true,login_required:false};render()');
  assert.doesNotMatch(view.html(),/data-action="logout"/);
});

test('expired sessions erase private state and browser history cannot restore it',()=>{
  const view=ui();
  view.run("state.me={authenticated:true,login_required:true};state.settings={company_name:'PRIVATE COMPANY'};for(const key of ['invoices','transactions','allocations','suggestions','documents','imports','audit'])state[key]=[{secret:'PRIVATE RECORD'}];state.bank={configured:true,connections:[{secret:'PRIVATE BANK'}]};state.gmail={email:'PRIVATE EMAIL'};state.preview={secret:'PRIVATE PREVIEW'};state.filters.customers.q='PRIVATE SEARCH';state.loaded='2026-10-27T12:00:00Z';render()");
  assert.match(view.html(),/PRIVATE COMPANY/);
  view.run('showLogin("Sessionen har gått ut.")');
  for(const key of ['invoices','transactions','allocations','suggestions','documents','imports','audit'])assert.equal(view.run(`state.${key}.length`),0);
  assert.equal(view.run('state.bank.connections.length'),0);assert.equal(view.run('state.preview'),null);
  assert.equal(view.run('state.filters.customers.q'),'');assert.deepEqual(plain(view.run('state.settings')),{});
  view.dispatch('popstate');
  assert.match(view.html(),/id="login-form"/);assert.doesNotMatch(view.html(),/PRIVATE/);
  view.run("state.audit=[{secret:'PRIVATE LATE AUDIT'}];render()");
  assert.equal(view.run('state.audit.length'),0);assert.doesNotMatch(view.html(),/PRIVATE/);
});

test('a refresh completed after authentication loss cannot restore company records',async()=>{
  const view=ui();let release;const gate=new Promise(resolve=>{release=resolve;});
  view.set('gate',gate);view.set('responses',{'/dashboard':{},'/invoices':{items:[{secret:'PRIVATE RESPONSE'}]},'/bank-transactions':{items:[]},'/allocations':{items:[]},'/bank/status':{configured:false,connections:[]},'/settings':{company_name:'PRIVATE COMPANY'},'/gmail/status':{},'/suggestions':{items:[]},'/imports':{items:[]},'/documents':{items:[]}});
  view.run("api=async path=>path==='/me'?{authenticated:true,login_required:true}:gate.then(()=>responses[path])");
  const pending=view.run('refresh()');await Promise.resolve();
  view.run('showLogin()');release();await pending;
  assert.equal(view.run('state.invoices.length'),0);assert.equal(view.run('state.me.authenticated'),false);
  assert.match(view.html(),/id="login-form"/);assert.doesNotMatch(view.html(),/PRIVATE/);
});

for(const status of ['renewal_required','error','missing'])test(`account-selection result does not report success when refreshed status is ${status}`,async()=>{
  const view=ui();bankFixture(view,status==='missing'?[]:[{...connection,status}]);
  view.element('#acc-test-connection').value=account.uid;
  view.run('globalThis.messages=[];toast=(message,error)=>messages.push({message,error});api=async()=>({initial_sync_error:"Bankhändelser kunde inte hämtas."});refresh=async()=>true');
  await view.run('selectBankAccount("test-connection")');
  const [message]=plain(view.run('messages'));
  assert.equal(message.error,true);
  assert.doesNotMatch(message.message,/är anslutet/);
  if(status==='renewal_required')assert.match(message.message,/förnyas/);
});

test('account selection requires a selection and reports confirmed enrichment counts',async()=>{
  const view=ui();bankFixture(view,[connection]);
  view.run('globalThis.calls=0;globalThis.messages=[];toast=(message,error)=>messages.push({message,error});api=async()=>{calls++;return {imported:0,duplicate:1,enriched:1};};refresh=async()=>true');
  await assert.rejects(view.run('selectBankAccount("test-connection")'),/Välj företagets konto/);
  assert.equal(view.run('calls'),0);
  view.element('#acc-test-connection').value=account.uid;
  await view.run('selectBankAccount("test-connection")');
  assert.match(view.run('messages[0].message'),/Kontot är anslutet.*1 bankhändelse kompletterad/);
});

test('rejected account verification refreshes expired consent so renewal controls become available',async()=>{
  const view=ui();bankFixture(view,[{...connection,status:'pending_account',selected_account_uid:''}]);
  view.element('#acc-test-connection').value=account.uid;
  view.set('updatedBank',{configured:true,connections:[{...connection,status:'renewal_required',selected_account_uid:''}]});
  view.run('globalThis.requests=[];api=async path=>{requests.push(path);if(path==="/bank/accounts")throw Object.assign(Error("Bankmedgivandet har upphört."),{status:409});if(path==="/bank/status")return updatedBank;throw Error("unexpected request");}');
  await assert.rejects(view.run('selectBankAccount("test-connection")'),/Bankmedgivandet har upphört/);
  assert.deepEqual(plain(view.run('requests')),['/bank/accounts','/bank/status']);
  assert.equal(view.run('state.bank.connections[0].status'),'renewal_required');
  assert.match(view.html(),/data-renew-bank="test-connection"/);
  assert.doesNotMatch(view.html(),/Anslut valt konto/);
});

function importView(){
  const view=ui();bankFixture(view,[connection]);
  view.run('globalThis.requests=[];globalThis.messages=[];globalThis.dialogHtml="";globalThis.submitPreview=null;base64=async()=>"dGVzdA==";modal=(title,html,label,onSubmit)=>{dialogHtml=html;submitPreview=onSubmit;};api=async(path,method,body)=>{requests.push({path,method,body});return {items:[],count:0,review:0,imported:0,duplicate:0,enriched:1};};refresh=async()=>true;navigate=()=>{};toast=(message,error)=>messages.push({message,error})');
  return view;
}

test('bank specification import preserves saved account identity through preview and commit',async()=>{
  const view=importView();await view.run('previewFile({name:"specification.xml"})');
  assert.match(view.run('dialogHtml'),/•••• 1234/);
  assert.match(view.run('dialogHtml'),/value="" disabled selected/);
  await view.run('submitPreview({get:key=>key==="connection_id"?"test-connection":null})');
  const preview=view.run('previewPanel()');
  assert.match(preview,/Konto: Swedbank · Företagskonto · •••• 1234/);
  await view.run('commitImport()');
  const requests=plain(view.run('requests'));
  assert.deepEqual(requests.map(r=>r.path),['/import/preview','/import/commit']);
  for(const {body}of requests){assert.equal(body.connection_id,connection.id);assert.equal(body.account_uid,account.uid);assert.equal('account' in body,false);}
  assert.equal(requests[1].body.confirm,true);
  assert.match(view.run('messages[0].message'),/1 bankhändelse kompletterad/);
});

test('standalone import requires an explicit alias and never submits a saved connection',async()=>{
  const view=importView();await view.run('previewFile({name:"statement.csv"})');
  await assert.rejects(view.run('submitPreview({get:key=>key==="connection_id"?"manual":"   "})'),/Ange ett kontonamn/);
  await assert.rejects(view.run('submitPreview({get:()=>"unknown-connection"})'),/Välj kontot/);
  assert.equal(view.run('requests.length'),0);
  await view.run('submitPreview({get:key=>key==="connection_id"?"manual":"  Separat företagskonto  "})');
  await view.run('commitImport()');
  for(const {body}of plain(view.run('requests'))){assert.equal(body.account,'Separat företagskonto');assert.equal('connection_id' in body,false);assert.equal('account_uid' in body,false);}
});

test('manual sync displays enriched payments and does not approve invoice matches',async()=>{
  const view=ui();bankFixture(view,[connection]);
  view.element('#from-test-connection').value='2026-09-28';view.element('#to-test-connection').value='2026-10-27';
  view.run('globalThis.requests=[];globalThis.messages=[];api=async(path,method,body)=>{requests.push({path,method,body});return {imported:0,duplicate:1,enriched:1};};refresh=async()=>true;toast=message=>messages.push(message)');
  await view.run('syncBank("test-connection")');
  assert.deepEqual(plain(view.run('requests.map(r=>r.path)')),['/bank/sync']);
  assert.match(view.run('messages[0]'),/1 bankhändelse kompletterad/);
});

test('Bankgiro aggregate review does not expose a match approval and explains missing details',()=>{
  const view=ui();view.set('aggregate',{id:'aggregate',account:'saved account',booked_at:'2026-10-27',amount_cents:10000,available_cents:10000,allocated_cents:0,payer:'Bankgiro',reference:'',bank_reference:'BANK-REF',bankgiro:'123-4567',description:'Bankgiroinsättning',is_aggregate:true,status:'review'});
  view.run('state.transactions=[aggregate];state.invoices=[{id:"invoice",direction:"customer",remaining_cents:10000,invoice_number:"1001",party:"Kund"}];globalThis.dialogHtml="";globalThis.submitLabel=null;modal=(title,html,label)=>{dialogHtml=html;submitLabel=label;};transactionDialog("aggregate")');
  assert.equal(view.run('submitLabel'),null);
  assert.match(view.run('dialogHtml'),/Betalardetaljer saknas – importera betalningsspecifikation/);
  assert.match(view.run('dialogHtml'),/Bankens transaktionsreferens/);
  assert.match(view.run('dialogHtml'),/Företagets Bankgiro/);
});
