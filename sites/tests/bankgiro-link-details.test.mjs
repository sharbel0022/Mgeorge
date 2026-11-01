import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const path=p=>new URL(p,import.meta.url).href;
const source=readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8');
const detail=source.slice(source.indexOf('function TransactionDetail('),source.indexOf('\nfunction NewTransaction('));
const imports=source.split('\n').filter(line=>line.startsWith('import {')&&/from '(?:react|lucide-react|@\/lib\/domain|@\/lib\/payment-presentation)'/.test(line)).join('\n');
const fake=data('export const useState=x=>[x,()=>{}],useRef=x=>({current:x}),useEffect=fn=>globalThis.__bankgiroDetailEffects.push(fn),useMemo=fn=>fn(),useCallback=fn=>fn;');
const stub=data('export const bankPaymentView=()=>({payer:"Synthetic",reference:{},original:{}}),bankVisibleTransactions=s=>s.transactions,payerLabel=t=>t.party;');
let compiled=ts.transpileModule(imports+'\nconst analyze=()=>[],shortDate=x=>x,controlDate=x=>x;const DetailSurface=()=>null,PaymentHistory=()=>null,PaymentVerificationPanel=()=>null,InvoiceEvidence=()=>null,FormError=()=>null,Field=()=>null,BankgiroLinkReview=()=>null;\n'+detail+'\nexport default TransactionDetail;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,url]of Object.entries({'react':fake,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),'@/lib/domain':path('../lib/domain.ts'),'@/lib/payment-presentation':stub}))for(const q of ['"',"'"])compiled=compiled.replaceAll(q+name+q,JSON.stringify(url));
const {default:Detail}=await import(data(compiled));
test('opening retained originals does not fetch bank details or write production metadata',async()=>{
 const state=emptyState(),tx=syntheticBankTransaction({description:'Bankgiro inbetalning',party:'',payerReference:'',kind:'batch'});state.transactions.push(tx);
 const originalFetch=globalThis.fetch;let writes=0;globalThis.__bankgiroDetailEffects=[];globalThis.fetch=async()=>{writes++;return Response.json({details:{reason:'Synthetic'}});};
 try{Detail({tx,state,busy:false,error:'',save(){throw Error('No financial action on open');},open(){},close(){}});for(const effect of globalThis.__bankgiroDetailEffects)effect();await Promise.resolve();assert.equal(writes,0);}finally{globalThis.fetch=originalFetch;delete globalThis.__bankgiroDetailEffects;}
});
