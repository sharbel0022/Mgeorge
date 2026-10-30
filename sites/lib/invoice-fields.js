import {classifyDocument,documentConflicts} from './document-triage.js';
import {parseMoney} from './domain';
const invoiceNumberLabel='(?:faktura[ \\t]*(?:nummer|nr|no)|invoice[ \\t]*(?:number|no))(?=[\\s.:#-]|\\d|$)';
const validInvoiceIdentifier=value=>/^[\p{L}\p{N}][\p{L}\p{N}/_-]{0,79}$/u.test(value)&&!/^(?:ocr(?:[- /]?(?:nummer|referens))?|faktura(?:nummer|nr)?|fakturadatum|förfallo(?:datum|dag)|förfaller|invoice|date|leverantör|utställare|säljare|supplier|seller|kund|customer|netto|moms|vat|bankgiro|bg|totalbelopp|att)$/iu.test(value);
// Only explicitly labelled values are normalized. Original text remains evidence.
function normalizeInvoiceLayout(input){
  const original=String(input||'').normalize('NFKC').replace(/\r/g,'').slice(0,150000);
  const warnings=[];
  let text=original.replace(/(faktura\s*(?:nummer|nr)|invoice\s*(?:number|no))([ \t.:#-]*)([0-9][0-9 \t]*)(?=\n|$)/gi,(_,label,sep,value)=>label+sep+value.replace(/[ \t]/g,''));
  text=text.replace(/((?:fakturadatum|förfallo(?:datum|dag)|förfaller|due\s*date|invoice\s*date)[ \t:.]*)([\d \t]+[/.\-][\d \t]+[/.\-][\d \t]+)/gi,(_,label,value)=>label+value.replace(/[ \t]/g,''));
  text=text.replace(/([,.])[ \t]+(?=\d{2}\b)/g,'$1');
  // PDF drawing order can differ from the visible column order. Text alone
  // cannot assign two numeric values to invoice/OCR headings with certainty.
  const numberColumn='(?:faktura[ \\t]*(?:nummer|nr|no)|invoice[ \\t]*(?:number|no))',ocrColumn='OCR(?:[- /]?(?:nummer|referens))?';
  const otherColumn='(?:kund[ \\t]*(?:nummer|nr)|customer[ \\t]*(?:number|no)|sida|page|fakturadatum|invoice[ \\t]*date|förfallo(?:datum|dag)|due[ \\t]*date)';
  const header=new RegExp('(?<![\\p{L}\\p{N}_-])(?:('+numberColumn+')|('+ocrColumn+')|'+otherColumn+')(?=[^\\p{L}\\p{N}_-]|-(?:\\s|$)|$)','giu');
  let ambiguousInvoiceColumns=false,previousEnd=-1,hasNumber=false,hasOcr=false;
  for(const label of text.matchAll(header)){
    // Punctuation, wrapped headings and intervening known headings do not
    // establish value order. An actual value ends this run of headings.
    if(previousEnd<0||!/^[\s\p{P}\p{S}]*$/u.test(text.slice(previousEnd,label.index))){hasNumber=false;hasOcr=false;}
    hasNumber ||= Boolean(label[1]);hasOcr ||= Boolean(label[2]);previousEnd=label.index+label[0].length;
    if(hasNumber&&hasOcr){ambiguousInvoiceColumns=true;warnings.push('Fakturanummer och OCR i kolumner kan inte skiljas åt entydigt. Kontrollera originalets kolumner.');break;}
  }
  // An undiscounted unit price plus VAT must agree with its displayed line total.
  for(const line of text.split('\n')){
    const m=line.match(/\b(\d+)[ \t]+(?:st|styck|pcs)[ \t]+([\d \t]+[,.]\d{2})[ \t]*(?:kr|SEK)[ \t]+([\d \t]+)[ \t]*%[ \t]+([\d \t]+[,.]\d{2})[ \t]*(?:kr|SEK)[ \t]+([\d \t]+[,.]\d{2})/i);
    if(m&&!/rabatt|discount/i.test(text)){
      const n=s=>Math.round(Number(s.replace(/[ \t]/g,'').replace(',','.'))*100),qty=Number(m[1]),unit=n(m[2]),vat=n(m[4]),gross=n(m[5]);
      if(Number.isSafeInteger(unit)&&Number.isSafeInteger(gross)&&Math.abs(qty*unit+vat-gross)>1)warnings.push('Radpris, moms och radbelopp stämmer inte överens. Kontrollera originalet.');
    }
  }
  return {text,original,warnings,ambiguousInvoiceColumns};
}

export const fieldNames=['invoice_number','party','organization_number','issued_at','due_at','total_cents','vat_cents','net_cents','reference','bankgiro','direction','kind','currency'];
const titles={invoice_number:'fakturanummer',party:'kund eller leverantör',organization_number:'organisationsnummer',issued_at:'fakturadatum',due_at:'förfallodatum',total_cents:'totalbelopp',vat_cents:'moms',net_cents:'belopp exklusive moms',reference:'OCR eller referens',bankgiro:'Bankgiro',direction:'fakturatyp',kind:'dokumenttyp',currency:'valuta'};
export function validDate(value){
  let s=String(value||'').trim();const m=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if(m)s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s?s:null;
}
function invoiceDate(value){
  // A labelled Swedish D-M-YYYY date is normalized before the existing calendar
  // validation. This does not change the manual-registration validator.
  const match=String(value).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return validDate(match?`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`:value);
}
export function validOrganization(value){
  const s=String(value||'').replace(/[-\s]/g,'');if(!/^\d{10}$/.test(s)||Number(s[2])<2)return false;
  return [...s].reduce((sum,c,i)=>{const n=Number(c)*(i%2?1:2);return sum+Math.floor(n/10)+n%10;},0)%10===0;
}
export function interpretInvoice(text,{direction=null,direction_confident=false,method='pdf',ocrConfidence=0,filename='',subject='',company_organization_number=''}={}){
  const layout=normalizeInvoiceLayout(text);text=layout.text;
  text=text.replace(/Fakturadatum[ \t]+Fakturanummer[ \t]*\n[ \t]*(\d{4}-\d{2}-\d{2})[ \t]+([A-Za-z0-9/_-]+)/gi,(_,date,number)=>`Fakturadatum: ${date}\nFakturanummer: ${number}`);
  const fields=Object.fromEntries(fieldNames.map(k=>[k,{value:null,confidence:0,evidence:null,warning:null}])),issues=[...layout.warnings];
  const confidence=method==='ocr'?Math.min(.85,Math.max(0,ocrConfidence/100)):.96;
  const set=(key,value,evidence,score=confidence)=>{fields[key]={value,confidence:value==null?0:score,evidence:evidence?.slice(0,300)||null,warning:score<.9?'Kräver kontroll':null};};
  const grab=(key,re,convert=s=>s.trim(),labels=null)=>{
    const matches=[...text.matchAll(re)],converted=matches.map(m=>convert(m[1]));
    // A valid occurrence cannot erase another labelled but unreadable value.
    const matchedPositions=new Set(matches.map(m=>m.index));
    if(converted.some(v=>v==null)||labels&&[...text.matchAll(labels)].some(m=>!matchedPositions.has(m.index))){
      issues.push(`Ogiltigt värde för ${titles[key]}. Kontrollera samtliga märkta värden i originalet.`);
      return;
    }
    const values=converted.filter(v=>v!=null);
    const distinct=[...new Set(values)];
    if(distinct.length===1)set(key,distinct[0],matches[0][0]);
    else if(distinct.length>1)issues.push(`Motstridiga värden för ${titles[key]}; dokumentet kan innehålla flera fakturor.`);
    else if(matches.length)issues.push(`Ogiltigt värde för ${titles[key]}.`);
  };
  // Validate the entire token, including every labelled occurrence. Never
  // silently truncate an identifier or ignore an unreadable second value.
  grab('invoice_number',new RegExp(invoiceNumberLabel+'\\s*[.:#-]*\\s*(\\S+)','giu'),value=>validInvoiceIdentifier(value)?value:null,new RegExp(invoiceNumberLabel,'gi'));
  grab('issued_at',/(?:fakturadatum|faktureringsdatum|invoice\s*date)\s*[:.]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})(?![\p{L}\p{N}./_-])/giu,invoiceDate,/(?:fakturadatum|faktureringsdatum|invoice\s*date)/gi);
  grab('due_at',/(?:förfallodatum|förfallodag|förfaller|oss\s*tillhanda\s*senast|betalas\s*senast|due\s*date)\s*[:.]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})(?![\p{L}\p{N}./_-])/giu,invoiceDate,/(?:förfallodatum|förfallodag|förfaller|oss\s*tillhanda\s*senast|betalas\s*senast|due\s*date)/gi);
  // A percentage is a rate, never an explicitly stated monetary amount.
  const amount='(-?(?:\\d{1,3}(?:\\.\\d{3})+,\\d{1,2}|\\d[\\d \\t\\u00a0]*(?:[.,]\\d{1,2})?))(?![\\p{L}\\p{N}.,/_-]|\\s*%)(?:[ \\t]*(?:SEK|kr))?';
  const money=s=>{try{return parseMoney(s);}catch{return null;}};
  const totalLabel='(?:att betala|summa att betala|totalsumma|totalbelopp|amount due|totalt inklusive moms|totalt inkl\\.? moms)';
  const vatLabel='(?:^|\\n)[ \\t]*(?:total moms|moms(?:belopp)?|VAT)';
  const netLabel='(?:belopp före moms|belopp exklusive moms|summa exkl\\.? moms|(?:^|\\n)[ \\t]*(?:totalt netto|netto(?:belopp)?|net amount))';
  grab('total_cents',new RegExp(totalLabel+'\\s*[:.]?\\s*(?:SEK\\s*)?'+amount,'giu'),money,new RegExp(totalLabel,'gi'));
  grab('vat_cents',new RegExp(vatLabel+'\\s*[:.]?\\s*'+amount,'giu'),money,new RegExp(vatLabel,'gi'));
  grab('net_cents',new RegExp(netLabel+'\\s*[:.]?\\s*'+amount,'giu'),money,new RegExp(netLabel,'gi'));
  grab('reference',/(?:OCR(?:[- /]?(?:nummer|referens))?|betalningsreferens|payment reference)\s*[:.]?\s*([\p{L}\p{N}][\p{L}\p{N} /_-]{0,119})/giu);
  if(layout.ambiguousInvoiceColumns){set('invoice_number',null,null,0);set('reference',null,null,0);}
  grab('bankgiro',/\b(?:bankgirokonto|bankgiro|bg)\s*[:.]?\s*(\d{3,4}[ -]\d{4})(?![\p{L}\p{N}/_-])/giu,s=>s.replace(/ /g,'-'),/\b(?:bankgirokonto|bankgiro|bg)\b/gi);
  if(fields.invoice_number.value&&validDate(fields.invoice_number.value)){issues.push('Fakturanumret ser ut som ett datum. Kontrollera originalets kolumner.');set('invoice_number',null,fields.invoice_number.evidence,0);}
  const wholeText=text;
  if(direction==='customer'&&/(?:^|\n)[ \t]*Mottagare[ \t]*\n/i.test(text))text=text.split(/(?:^|\n)[ \t]*Mottagare[ \t]*\n/i).slice(1).join('\n').split(/Tilläggsinformation|Betalningsuppgifter/i)[0];
  grab('organization_number',/(?:org(?:anisations)?\.?\s*(?:nr|nummer)|organisation number)\s*[:.]?\s*(\d{6}[-– ]?\d{4})(?![\p{L}\p{N}/_-])/giu,s=>validOrganization(s.replace(/–/g,'-'))?s.replace(/[-– ]/g,''):null,/(?:org(?:anisations)?\.?\s*(?:nr|nummer)|organisation number)/gi);
  const partyLabel=direction==='customer'?'kund|fakturamottagare|företags\\s*namn|customer|bill to':'leverantör|utställare|säljare|supplier|seller';
  grab('party',new RegExp('(?:^|\\n)[ \\t]*(?:'+partyLabel+')\\s*:[ \\t]*([^\\n]{2,240})','gi'));
  text=wholeText;
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
  const fatal=values.total_cents==null||values.invoice_number==null||!['invoice','credit'].includes(kind)||issues.some(s=>/Motstridiga|Momsberäkningen|Radpris|flera fakturor|Flera valutor|läsbar text/.test(s));
  const metadataIssues=documentConflicts({fields},{filename,subject,direction,company_organization_number});
  issues.push(...metadataIssues);
  const classification=classifyDocument({filename,text:layout.original,extraction:{fields}});
  const level=metadataIssues.length||classification.exclude_from_invoice_queue?'red':fatal?'red':issues.length||missing.length||required.some(k=>fields[k].confidence<.9)?'yellow':'green';
  return {version:3,method,fields,level,classification,issues:[...new Set(issues)],text_excerpt:layout.original.slice(0,20000),extracted_at:new Date().toISOString()};
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
