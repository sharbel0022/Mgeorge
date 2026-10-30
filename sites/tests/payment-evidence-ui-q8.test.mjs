import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState,applyCommand} from '../lib/domain.ts';
import {extractPaymentReferences} from '../lib/payment-references.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const file=path=>new URL(path,import.meta.url).href;
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compile(source,imports={}){
  let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,url] of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':file('../lib/domain.ts'),'./domain':file('../lib/domain.ts'),'./reconciliation-engine.js':file('../lib/reconciliation-engine.js'),'./payment-references.js':file('../lib/payment-references.js'),...imports}))for(const q of [String.fromCharCode(34),String.fromCharCode(39)])code=code.replaceAll(q+name+q,JSON.stringify(url));
  return data(code);
}
const presentation=compile(read('../lib/payment-presentation.ts'));
const reconciliation=compile(read('../lib/reconciliation.ts'));
const dashboard=read('../app/dashboard.tsx');
const detailCode=dashboard.slice(dashboard.indexOf('function TransactionDetail('),dashboard.indexOf('\nfunction NewTransaction('));
const detailImports=dashboard.split('\n').filter(line=>line.startsWith('import {')&&/from '(?:react|lucide-react|@\/lib\/domain|@\/lib\/payment-presentation)'/.test(line)).join('\n');
const {default:Detail}=await import(compile(detailImports+`\nimport {analyze} from 'reconciliation';const shortDate=x=>x,controlDate=x=>x;const DetailSurface=({children})=>children,PaymentHistory=()=>null,InvoiceEvidence=()=>null,FormError=()=>null,Field=({children})=>children;\n`+detailCode+'\nexport default TransactionDetail;',{'@/lib/payment-presentation':presentation,reconciliation}));
const snapshot={party:'RETAINED ORIGINAL PAYER',payerReference:'0594',bankReference:'SOURCE-1',description:'Synthetic retained description',date:'2026-10-30',amount:10000,account:'Synthetic account'};
const payment=extra=>({id:'synthetic-payment',...snapshot,currency:'SEK',source:'Enable Banking',evidence:'bank_api',externalId:'SOURCE-1',kind:'payment',verified:true,duplicateOf:'',ignored:false,parentId:'',importId:'',createdAt:'2026-10-30',original:{...snapshot},...extra});
function renderDetail(t){const state=emptyState();state.transactions.push(t);const before=JSON.stringify(state);const html=renderToStaticMarkup(React.createElement(Detail,{tx:t,state,demo:true,save(){throw Error('Render must not save');},close(){},open(){},busy:false,error:''}));assert.equal(JSON.stringify(state),before);return html;}
function originalSection(html){return [...html.matchAll(/<details[^>]*><summary>[^<]*<\/summary>(?:(?!<details).)*?<\/details>/gs)].map(match=>match[0]).find(block=>block.includes('RETAINED ORIGINAL PAYER'));}
async function renderMessage(t,transaction,{finding}={}){
  const key='__payment_ui_'+crypto.randomUUID().replaceAll('-','');
  const review={id:'synthetic-review',status:'draft',version:1,kind:'partial',invoice:{party:'SYNTHETIC CUSTOMER',number:'INVOICE-1'},facts:{total_cents:20000,paid_cents:10000,remaining_cents:10000},payments:[{...transaction,allocated:10000,effect:'payment'}],findings:finding?[{transaction_id:'finding',reason:'Synthetic uncertain suggestion',transaction:finding}]:[],subject:'Synthetic subject',body:'Synthetic body',recipient:'synthetic@example.test'};
  const state={cursor:0,review};globalThis[key]=state;t.after(()=>delete globalThis[key]);
  const shim=data(`const f=globalThis[${JSON.stringify(key)}];export const useState=x=>[f.cursor++===2?f.review:x,()=>{}],useRef=x=>({current:x}),useEffect=()=>{};`);
  const {default:Messages}=await import(compile(read('../components/customer-messages.tsx'),{react:shim,'@/lib/payment-presentation':presentation}));
  const before=JSON.stringify(review),html=renderToStaticMarkup(React.createElement(Messages));assert.equal(JSON.stringify(review),before);return html;
}

test('Q8 UI evidence: typed transaction snapshot remains visible and is labelled manual, not bank supplied',()=>{
  const state=applyCommand(emptyState(),{type:'transactions.import',rows:[{...snapshot}]}).state;
  const html=renderDetail(state.transactions[0]),section=originalSection(html);assert.ok(section);assert.match(section,/manuellt registrerade ursprungsuppgifter/i);assert.doesNotMatch(section,/bankens ursprungliga|bankens original/i);assert.match(section,/0594/);assert.match(html,/Betalare okänd/);
});
test('Q8 UI evidence: an unproven historical snapshot stays unknown even when a later manual verification exists',()=>{
  const html=renderDetail(payment({source:'Historical import',evidence:'manual_verified',verification:{party:'SEPARATELY VERIFIED PAYER',payerReference:'MANUAL-2',note:'Explicit separate review',at:'2026-10-30'}})),section=originalSection(html);
  assert.ok(section);assert.match(section,/källan är inte verifierad/i);assert.doesNotMatch(section,/manuellt registrerade ursprungsuppgifter|bankens ursprungliga/i);assert.match(html,/Manuellt bekräftad betalare:.*SEPARATELY VERIFIED PAYER/s);
});
test('Q8 UI evidence: genuine bank original remains separate from later manual completion',()=>{
  const html=renderDetail(payment({party:'SEPARATELY VERIFIED PAYER',verification:{party:'SEPARATELY VERIFIED PAYER',payerReference:'MANUAL-2',note:'Explicit separate review',at:'2026-10-30'}})),section=originalSection(html);
  assert.ok(section);assert.match(section,/bankens ursprungliga uppgifter/i);assert.match(section,/RETAINED ORIGINAL PAYER/);assert.doesNotMatch(section,/SEPARATELY VERIFIED PAYER/);assert.match(html,/Manuellt bekräftad betalare:.*SEPARATELY VERIFIED PAYER/s);
});
test('Q8 UI evidence: customer review labels explicit invoice references separately from OCR, including findings and original',async t=>{
  const transaction=payment({referenceEvidence:extractPaymentReferences({invoice_number:'0594'})});
  const html=await renderMessage(t,transaction,{finding:payment({id:'finding',payerReference:'0005',original:{...snapshot,payerReference:'0005'},referenceEvidence:extractPaymentReferences({invoice_number:'0005'})})});
  assert.match(html,/Fakturareferens[^<]*0594/);assert.match(html,/Fakturareferens[^<]*0005/);assert.doesNotMatch(html,/OCR (?:0594|0005)/);assert.match(originalSection(html),/<dt>Fakturareferens<\/dt>/);assert.doesNotMatch(originalSection(html),/Betalarens OCR/);
});
test('Q8 UI evidence: explicitly supplied bank OCR retains its label and leading zeros',async t=>{
  const html=await renderMessage(t,payment({payerReference:'0001230',original:{...snapshot,payerReference:'0001230'},referenceEvidence:extractPaymentReferences({ocr:'0001230'})}));
  assert.match(html,/OCR[^<]*0001230/);assert.match(originalSection(html),/<dt>(?:Betalarens )?OCR<\/dt>/);assert.match(originalSection(html),/0001230/);
});
test('Q8 UI evidence: manual payment original is retained without becoming bank facts or an OCR',async t=>{
  const html=await renderMessage(t,payment({source:'Betalningsspecifikation: SOURCE-1',evidence:'verified_specification',verification:{party:'MANUAL PAYER',payerReference:'0594',note:'Explicit separate review',at:'2026-10-30'}}));
  const section=originalSection(html);assert.ok(section);assert.match(section,/manuellt registrerade ursprungsuppgifter/i);assert.doesNotMatch(section,/Bankens original|Betalarens OCR/);assert.match(section,/0594/);assert.match(html,/Manuellt bekräftad referens:.*0594/s);assert.match(html,/MANUAL PAYER/);assert.doesNotMatch(html,/OCR 0594/);
});
test('Q8 UI evidence: unknown historical payment origin is neither bank supplied nor presumed manual',async t=>{
  const html=await renderMessage(t,payment({evidence:undefined,source:'Historical import'})),section=originalSection(html);assert.ok(section);assert.match(section,/källan är inte verifierad/i);assert.doesNotMatch(section,/Bankens original|manuellt registrerade/i);assert.match(section,/RETAINED ORIGINAL PAYER/);assert.match(section,/0594/);assert.doesNotMatch(html,/OCR 0594/);
});
test('Q8 UI evidence: an unproven bank-file snapshot is not reclassified as manual by a historical default source label',()=>{
  const html=renderDetail(payment({evidence:'bank_file',source:'Manuellt registrerad'})),section=originalSection(html);assert.ok(section);assert.match(section,/källan är inte verifierad/i);assert.doesNotMatch(section,/Bankens ursprungliga|manuellt registrerade ursprungsuppgifter/i);
});
