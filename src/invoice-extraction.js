// Deterministic, evidence-based interpretation. Document text is never executed
// or sent to a language model. Confidence is a review heuristic, not a probability.
import {fork} from 'node:child_process';
import {parseMoney} from './importers.js';

export const fieldNames=['invoice_number','party','organization_number','issued_at','due_at','total_cents','vat_cents','net_cents','reference','bankgiro','direction','kind','currency'];
const titles={invoice_number:'fakturanummer',party:'kund eller leverantör',organization_number:'organisationsnummer',issued_at:'fakturadatum',due_at:'förfallodatum',total_cents:'totalbelopp',vat_cents:'moms',net_cents:'belopp exklusive moms',reference:'OCR eller referens',bankgiro:'Bankgiro',direction:'fakturatyp',kind:'dokumenttyp',currency:'valuta'};
export function validDate(value){
  let s=String(value||'').trim();const m=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if(m)s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s?s:null;
}
export function validOrganization(value){
  const s=String(value||'').replace(/[-\s]/g,'');if(!/^\d{10}$/.test(s)||Number(s[2])<2)return false;
  return [...s].reduce((sum,c,i)=>{const n=Number(c)*(i%2?1:2);return sum+Math.floor(n/10)+n%10;},0)%10===0;
}
export function interpretInvoice(text,{direction=null,direction_confident=false,method='pdf',ocrConfidence=0}={}){
  text=String(text||'').normalize('NFKC').replace(/\r/g,'').slice(0,150000);
  const fields=Object.fromEntries(fieldNames.map(k=>[k,{value:null,confidence:0,evidence:null}])),issues=[];
  const confidence=method==='ocr'?Math.min(.85,Math.max(0,ocrConfidence/100)):.96;
  const set=(key,value,evidence,score=confidence)=>{fields[key]={value,confidence:value==null?0:score,evidence:evidence?.slice(0,300)||null};};
  const grab=(key,re,convert=s=>s.trim())=>{
    const matches=[...text.matchAll(re)],values=matches.map(m=>convert(m[1])).filter(v=>v!=null);
    const distinct=[...new Set(values)];
    if(distinct.length===1)set(key,distinct[0],matches[0][0]);
    else if(distinct.length>1)issues.push(`Motstridiga värden för ${titles[key]}; dokumentet kan innehålla flera fakturor.`);
    else if(matches.length)issues.push(`Ogiltigt värde för ${titles[key]}.`);
  };
  grab('invoice_number',/(?:faktura\s*(?:nummer|nr|no)|invoice\s*(?:number|no)|fakturanr)\s*[.:#-]*\s*([\p{L}\p{N}][\p{L}\p{N}/_-]{0,79})/giu);
  grab('issued_at',/(?:fakturadatum|invoice\s*date)\s*[:.]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})/gi,validDate);
  grab('due_at',/(?:förfallodatum|förfaller|due\s*date)\s*[:.]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})/gi,validDate);
  const amount='(-?\\d[\\d \\u00a0]*(?:[.,]\\d{1,2})?)(?:[ \\t]*(?:SEK|kr))?';
  const money=s=>{try{return parseMoney(s);}catch{return null;}};
  grab('total_cents',new RegExp('(?:att betala|summa att betala|totalbelopp|amount due|totalt inklusive moms|totalt inkl\\.? moms)\\s*[:.]?\\s*(?:SEK\\s*)?'+amount,'gi'),money);
  grab('vat_cents',new RegExp('(?:^|\\n)[ \\t]*(?:moms(?:belopp)?|VAT)(?!\\s*\\d+%)\\s*[:.]?\\s*'+amount,'gi'),money);
  grab('net_cents',new RegExp('(?:belopp exklusive moms|summa exkl\\.? moms|netto(?:belopp)?|net amount)\\s*[:.]?\\s*'+amount,'gi'),money);
  grab('reference',/(?:OCR(?:[- /]?(?:nummer|referens))?|betalningsreferens|payment reference)\s*[:.]?\s*([\p{L}\p{N}][\p{L}\p{N} /_-]{0,119})/giu);
  grab('bankgiro',/(?:bankgiro|bankgirokonto|bg)\s*[:.]?\s*(\d{3,4}[ -]\d{4})/gi,s=>s.replace(/ /g,'-'));
  grab('organization_number',/(?:org(?:anisations)?\.?\s*(?:nr|nummer)|organisation number)\s*[:.]?\s*(\d{6}[- ]?\d{4})/gi,s=>validOrganization(s)?s.replace(/[- ]/g,''):null);
  const partyLabel=direction==='customer'?'kund|fakturamottagare|customer|bill to':'leverantör|utställare|supplier|seller';
  grab('party',new RegExp('(?:^|\\n)[ \\t]*(?:'+partyLabel+')\\s*:[ \\t]*([^\\n]{2,240})','gi'));
  if(['customer','supplier'].includes(direction))set('direction',direction,'Föreslagen från mejlets riktning',direction_confident?.94:.5);
  const kind=/kreditfaktura|credit\s*(?:invoice|note)/i.test(text)?'credit':/\bkvitto\b|\breceipt\b/i.test(text)?'receipt':/\bfaktura\b|\binvoice\b|fakturanr/i.test(text)?'invoice':'other';
  set('kind',kind,text.match(/kreditfaktura|credit\s*(?:invoice|note)|kvitto|receipt|faktura|invoice/i)?.[0]);
  const currencies=[...new Set(text.match(/\b(?:SEK|EUR|USD|GBP|NOK|DKK)\b/g)||[])];
  if(currencies.length===1)set('currency',currencies[0],currencies[0]);
  else if(!currencies.length&&/\bkr\b/i.test(text))set('currency','SEK','kr',.7);
  if(currencies.length>1)issues.push('Flera valutor finns i underlaget.');
  if(kind==='credit')for(const k of ['total_cents','net_cents','vat_cents'])if(fields[k].value!==null)fields[k].value=Math.abs(fields[k].value);
  const values=Object.fromEntries(fieldNames.map(k=>[k,fields[k].value]));
  issues.push(...validateInvoiceValues(values));
  if(text.trim().length<40)issues.push('Dokumentet saknar tillräcklig läsbar text.');
  const required=['invoice_number','party','issued_at','due_at','total_cents','direction','currency','organization_number'];
  const missing=required.filter(k=>values[k]==null);
  if(missing.length)issues.push('Saknade uppgifter: '+missing.map(k=>titles[k]).join(', '));
  const fatal=values.total_cents==null||values.invoice_number==null||!['invoice','credit'].includes(kind)||issues.some(s=>/Motstridiga|Momsberäkningen|flera fakturor|Flera valutor|läsbar text/.test(s));
  const level=fatal?'red':issues.length||missing.length||required.some(k=>fields[k].confidence<.9)?'yellow':'green';
  return {version:1,method,fields,level,issues:[...new Set(issues)],text_excerpt:text.slice(0,20000),extracted_at:new Date().toISOString()};
}
export function validateInvoiceValues(v){
  const issues=[];
  for(const k of ['issued_at','due_at'])if(v[k]!=null&&!validDate(v[k]))issues.push('Ogiltigt datum: '+titles[k]);
  if(v.issued_at&&v.due_at&&v.due_at<v.issued_at)issues.push('Förfallodatum ligger före fakturadatum.');
  if(v.total_cents!=null&&(!Number.isSafeInteger(v.total_cents)||v.total_cents<=0))issues.push('Totalbelopp måste vara ett positivt öresbelopp.');
  for(const k of ['vat_cents','net_cents'])if(v[k]!=null&&(!Number.isSafeInteger(v[k])||v[k]<0||v[k]>v.total_cents))issues.push('Ogiltigt belopp: '+titles[k]);
  if(v.net_cents!=null&&v.vat_cents!=null&&v.total_cents!=null&&Math.abs(v.net_cents+v.vat_cents-v.total_cents)>1)issues.push('Momsberäkningen stämmer inte med totalbeloppet.');
  if(v.currency!=null&&v.currency!=='SEK')issues.push('Endast SEK stöds i registret.');
  if(v.organization_number&&!validOrganization(v.organization_number))issues.push('Ogiltigt organisationsnummer.');
  return issues;
}
let active=0;
export async function runDocumentProcess(bytes,mime_type,preview=false){
  if(active>=2)throw Object.assign(new Error('Dokumenttolkning pågår. Försök igen om en stund.'),{status:429});
  active++;
  try{
    return await new Promise((resolve,reject)=>{
      const worker=fork(new URL('./invoice-worker.js',import.meta.url),[],{serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=256'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},windowsHide:true});
      const timer=setTimeout(()=>{worker.kill();reject(Error('timeout'));},90000);
      worker.once('message',value=>{clearTimeout(timer);resolve(value);});
      worker.once('error',()=>{clearTimeout(timer);reject(Error('worker'));});
      worker.once('exit',()=>{clearTimeout(timer);reject(Error('worker'));});
      worker.send({bytes,mime_type,preview});
    });
  }finally{active--;}
}
export async function extractInvoice(bytes,mime_type,metadata={}){
  try{
    const result=await runDocumentProcess(bytes,mime_type);
    if(result.error)throw Error('unreadable');
    return interpretInvoice(result.text,{...metadata,method:result.method,ocrConfidence:result.confidence});
  }catch(e){
    if(e.status===429)throw e;
    return {...interpretInvoice('',metadata),level:'red',issues:['Dokumentet kunde inte läsas. Kontrollera originalet och fyll i uppgifterna manuellt.']};
  }
}
