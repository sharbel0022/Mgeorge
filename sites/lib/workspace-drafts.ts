type Control=HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
const control=(target:EventTarget|null):Control|null=>target&&['INPUT','SELECT','TEXTAREA'].includes((target as Element).tagName)?target as Control:null;
const valued=(field:Control)=>!['hidden','submit','reset','button','image'].includes(field.type);
const scopeFor=(field:Control)=>field.form||field.closest<HTMLElement>('[data-workspace-draft]');
function value(field:Control,before=false):string{
 if(field.type==='checkbox'||field.type==='radio')return JSON.stringify([field.type,before?(field as HTMLInputElement).defaultChecked:(field as HTMLInputElement).checked]);
 if(field.type==='file')return JSON.stringify(['file',before?[]:Array.from((field as HTMLInputElement).files||[]).map(file=>[file.name,file.size,file.lastModified])]);
 if(field.tagName==='SELECT')return JSON.stringify(['select',Array.from((field as HTMLSelectElement).options).filter(option=>before?option.defaultSelected:option.selected).map(option=>option.value)]);
 return JSON.stringify([field.type,before?(field as HTMLInputElement|HTMLTextAreaElement).defaultValue:field.value]);
}
const submittedFields=(form:HTMLFormElement)=>Array.from(form.elements).map(field=>control(field)).filter((field):field is Control=>!!field&&valued(field)).map(field=>[field,value(field)] as const);

/** Draft snapshots stay in RAM and are taken before actual user edits. */
export function createWorkspaceDraftGuard(root:HTMLElement){
 const baselines=new Map<Control,string>(),touched=new Set<Control>(),browser=root.ownerDocument.defaultView;
 const fieldFor=(event:Event)=>{const field=control(event.target);return field&&scopeFor(field)&&valued(field)&&!field.disabled&&!('readOnly' in field&&field.readOnly)?field:null;};
 // Focus may precede a server response. Refresh an untouched field's baseline
 // immediately before editing; unrelated loaded fields never become dirty.
 const before=(event:Event)=>{const field=fieldFor(event);if(field&&!touched.has(field))baselines.set(field,value(field));};
 const changed=(event:Event)=>{const field=fieldFor(event);if(!field)return;if(!baselines.has(field))baselines.set(field,value(field,true));if(value(field)===baselines.get(field))touched.delete(field);else touched.add(field);};
 const dirty=(inlineOnly=false)=>{
  const found=new Set<HTMLElement>();
  for(const field of baselines.keys()){
   const scope=scopeFor(field);
   if(!scope?.isConnected||!root.contains(field)){touched.delete(field);baselines.delete(field);continue;}
   if(touched.has(field)&&value(field)!==baselines.get(field)&&(!inlineOnly||!scope.closest('dialog[open]')))found.add(scope);
  }
  return Array.from(found);
 };
 const accept=(scope:HTMLElement|null)=>{if(scope)for(const field of baselines.keys())if(scopeFor(field)===scope){touched.delete(field);baselines.delete(field);}};
 const unloading=(event:BeforeUnloadEvent)=>{if(dirty().length){event.preventDefault();event.returnValue='';}};
 const beforeEvents=['focusin','beforeinput','pointerdown','keydown'];
 for(const name of beforeEvents)root.addEventListener(name,before,true);
 for(const name of ['input','change'])root.addEventListener(name,changed,true);
 browser?.addEventListener('beforeunload',unloading);
 return {
  hasChanges:()=>dirty().length>0,
  canLeave(confirm:(message:string)=>boolean){
   const forms=dirty(true);if(!forms.length)return true;
   if(!confirm('Du har osparade ändringar på sidan. Vill du lämna dem och byta vy?'))return false;
   forms.forEach(accept);return true;
  },
  accept,
  captureSubmission(form:HTMLFormElement|null){
   const submitted=form?submittedFields(form):[];
   return()=>{for(const [field,savedValue]of submitted){
    if(!form?.isConnected||!root.contains(field)||scopeFor(field)!==form)continue;
    // The acknowledged value is the new server baseline, including when a
    // later edit reverted to the value that existed before this submission.
    baselines.set(field,savedValue);
    if(value(field)===savedValue)touched.delete(field);else touched.add(field);
   }};
  },
  dispose(){
   for(const name of beforeEvents)root.removeEventListener(name,before,true);
   for(const name of ['input','change'])root.removeEventListener(name,changed,true);
   browser?.removeEventListener('beforeunload',unloading);
   touched.clear();baselines.clear();
  },
 };
}
