import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(path,imports={}){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const urls={...Object.fromEntries(['react','react/jsx-runtime','lucide-react'].map(name=>[name,import.meta.resolve(name)])),'@/lib/workspace-location':new URL('../lib/workspace-location.ts',import.meta.url).href,...imports};
 for(const [name,url]of Object.entries(urls))for(const q of ['"',"'"])code=code.replaceAll(q+name+q,JSON.stringify(url));
 return data(code);
}
const home=()=>import(compiled('../app/page.tsx',{'./dashboard':data('export default function Dashboard(){return null;}')}));
const nav=()=>import(compiled('../components/workspace-navigation.tsx'));
const base={view:'bank',reviewCount:0,company:{name:'Synthetic company',email:'owner@example.test'},open:false,onNavigate(){},onClose(){}};
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
function contents(Component,props){const child=Component(props).props.children[0].props.children;return child.type(child.props);}

for(const view of ['overview','receivable','payable','bank','review','documents','messages','imports','contacts','settings','connections','history'])test('SSR restores the allowlisted '+view+' deep link',async()=>{
 const {default:Home}=await home(),page=await Home({searchParams:Promise.resolve({view})});
 assert.equal(page.props.initialView,view);
 assert.equal(page.props.openBankImport,false);
});
test('SSR rejects duplicate and unknown views and limits the import start flag to Bank',async()=>{
 const {default:Home}=await home();
 for(const view of [['bank','settings'],'__proto__','javascript:alert(1)','BANK',undefined]){
  const page=await Home({searchParams:Promise.resolve({view,import:'1'})});
  assert.equal(page.props.initialView,'overview');assert.equal(page.props.openBankImport,false);
 }
 assert.equal((await Home({searchParams:Promise.resolve({view:'bank',import:'1'})})).props.openBankImport,true);
 assert.equal((await Home({searchParams:Promise.resolve({view:'bank',import:['1','1']})})).props.openBankImport,false);
});
test('primary workspace destinations are actual links with safe reusable URLs',async()=>{
 const ui=await nav(),html=renderToStaticMarkup(React.createElement(ui.default,base));
 for(const [view,label]of [['overview','Översikt'],['receivable','Kundfakturor'],['payable','Leverantörsfakturor'],['bank','Bank'],['review','Behöver granskas'],['settings','Inställningar']]){
  const href=view==='overview'?'/':'/?view='+view;
  const link=(html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g)||[]).find(value=>value.includes('<span>'+label+'</span>'));
  assert.ok(link,'missing link for '+view);assert.ok(link.includes('href="'+href+'"'));
 }
});
test('modified and middle clicks on the workspace brand preserve native browser behavior',async()=>{
 const ui=await nav();
 for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
  const navigated=[],tree=contents(ui.default,{...base,onNavigate:view=>navigated.push(view)}),brand=elements(tree).find(node=>node.type==='a'&&node.props.className==='brand');
  let prevented=false;
  brand.props.onClick({button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,defaultPrevented:false,currentTarget:{target:'',hasAttribute:()=>false},preventDefault(){prevented=true;},...extra});
  assert.equal(prevented,false,JSON.stringify(extra));assert.deepEqual(navigated,[]);
 }
});
