import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');

// Compile the real Dialog in isolation: only the browser focus/visibility and
// React effect boundaries are modeled. Assertions exercise its Escape cleanup,
// never source text. Root's Chromium check covers the actual responsive CSS.
async function fixture(t,{openerPresent=true,fallbackPresent=true}={}){
 const key='__dialog_focus_'+crypto.randomUUID().replaceAll('-','');
 const f={effects:[],cleanup:null,closed:0,prevented:0};globalThis[key]=f;
 const document={activeElement:null,getElementById:id=>id==='main-content'&&fallbackPresent?f.main:null};
 class Element{
  constructor(name){this.name=name;this.isConnected=true;this.visible=true;this.enabled=true;this.focusCalls=[];this.style={overflow:'auto'};}
  getClientRects(){return this.isConnected&&this.visible?[{}]:[];}
  focus(options){this.focusCalls.push(options);if(this.getClientRects().length&&this.enabled)document.activeElement=this;}
 }
 document.body=new Element('BODY');document.body.enabled=false;document.activeElement=null;
 f.main=new Element('main-content');f.opener=new Element('desktop payment button');
 if(openerPresent)f.opener.focus();
 const previousDocument=globalThis.document,previousElement=globalThis.HTMLElement;
 globalThis.document=document;globalThis.HTMLElement=Element;f.document=document;
 t.after(()=>{delete globalThis[key];if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=previousElement;});
 const source=ts.createSourceFile('dashboard.tsx',readFileSync(new URL('../app/dashboard.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const dialog=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Dialog');
 assert.ok(dialog,'The production Dialog component must be available for this behavior test');
 const hooks=`const f=globalThis[${JSON.stringify(key)}];const useRef=initial=>({current:initial}),useEffect=effect=>f.effects.push(effect),X=()=>null;`;
 let code=ts.transpileModule(hooks+'\n'+ts.createPrinter().printNode(ts.EmitHint.Unspecified,dialog,source)+'\nexport {Dialog};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replaceAll('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')));
 const module=await import(data(code));
 const nativeDialog=new Element('dialog');
 nativeDialog.showModal=()=>{document.activeElement=nativeDialog;};
 nativeDialog.close=()=>{document.activeElement=document.body;};
 const tree=module.Dialog({title:'Synthetic payment',close:()=>{f.closed++;f.cleanup();f.cleanup=null;},children:null});
 tree.props.ref.current=nativeDialog;f.cleanup=f.effects[0]();
 f.escape=()=>tree.props.onCancel({preventDefault(){f.prevented++;}});
 return f;
}

test('Escape restores visible main content when the desktop opener becomes hidden on mobile',async t=>{
 const f=await fixture(t);f.opener.visible=false;f.escape();
 assert.equal(f.document.activeElement,f.main);assert.equal(f.closed,1);assert.equal(f.prevented,1);
 assert.equal(f.document.body.style.overflow,'auto');assert.deepEqual(f.main.focusCalls,[{preventScroll:true}]);
});

test('Escape restores the original opener when the viewport and opener remain usable',async t=>{
 const f=await fixture(t);f.escape();
 assert.equal(f.document.activeElement,f.opener);assert.equal(f.main.focusCalls.length,0);
 assert.deepEqual(f.opener.focusCalls.at(-1),{preventScroll:true});
});

test('Escape restores main content when the opener was removed while the dialog was open',async t=>{
 const f=await fixture(t);f.opener.isConnected=false;f.escape();
 assert.equal(f.document.activeElement,f.main);
});

test('Escape restores main content when a connected visible opener no longer accepts focus',async t=>{
 const f=await fixture(t);f.opener.enabled=false;f.escape();
 assert.equal(f.document.activeElement,f.main);
});

test('Escape restores main content when no HTMLElement opener was captured',async t=>{
 const f=await fixture(t,{openerPresent:false});f.escape();
 assert.equal(f.document.activeElement,f.main);
});

test('Escape safely closes when both the usable opener and main-content fallback are missing',async t=>{
 const f=await fixture(t,{fallbackPresent:false});f.opener.isConnected=false;
 assert.doesNotThrow(()=>f.escape());assert.equal(f.closed,1);assert.equal(f.document.body.style.overflow,'auto');
});
