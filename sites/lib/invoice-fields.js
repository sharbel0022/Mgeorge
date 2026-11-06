import {classifyDocument,documentConflicts} from './document-triage.js';
import {extractInvoiceDetails,invoiceScalarText} from './invoice-details.js';
import {assessOcrBankgiro} from './ocr-bankgiro-evidence.js';
import {parseMoney} from './domain';
const invoiceNumberLabel='(?:faktura[ \\t]*(?:nummer|nr|no)|invoice[ \\t]*(?:number|no))(?=[\\s.:#-]|\\d|$)';
const validInvoiceIdentifier=value=>/^[\p{L}\p{N}][\p{L}\p{N}/_-]{0,79}$/u.test(value)&&!/^(?:ocr(?:[- /]?(?:nummer|referens))?|faktura(?:nummer|nr)?|fakturadatum|förfallo(?:datum|dag)|förfaller|invoice|date|leverantör|utställare|säljare|supplier|seller|kund|customer|netto|moms|vat|bankgiro|bg|totalbelopp|att)$/iu.test(value);
// Only explicitly labelled values are normalized. Original text remains evidence.
function normalizeInvoiceLayout(input){
  const original=String(input||'').normalize('NFKC').replace(/\r/g,'').slice(0,150000);
  const warnings=[],checkedRows=[];
  let text=invoiceScalarText(original);
  // Compact character-spaced digits without erasing the separator before a
  // sibling label. Trailing unknown content still goes through full validation.
  text=text.replace(/((?:fakturadatum|förfallo(?:datum|dag)|förfaller|due\s*date|invoice\s*date)[ \t:.]*)([\d \t]+[/.\-][\d \t]+[/.\-][\d \t]+)/gi,(_,label,value)=>label+value.trimEnd().replace(/[ \t]/g,'')+(value.match(/[ \t]+$/)?.[0]||''));
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
  // This older explicit "quantity st / price kr / rate % / VAT kr / total"
  // layout is validated as a whole line. Never begin at a decimal suffix.
  const rowQuantity='-?(?:\\d{1,3}(?: \\d{3})+|\\d+)(?:[.,]\\d{1,4})?';
  const rowMoney='-?(?:\\d{1,3}(?: \\d{3})+|\\d+)[,.]\\d{2}';
  const rowPattern=new RegExp('^(?:.*?[ \\t]+)?(?<![\\p{L}\\p{N},.+/-])('+rowQuantity+')[ \\t]+(?:st|styck|pcs)[ \\t]+('+rowMoney+')[ \\t]*(?:kr|SEK)[ \\t]+(\\d{1,3}(?:[.,]\\d{1,3})?)[ \\t]*%[ \\t]+('+rowMoney+')[ \\t]*(?:kr|SEK)[ \\t]+('+rowMoney+')(?:[ \\t]*(?:kr|SEK))?[ \\t]*$','iu');
  for(const line of text.split('\n')){
    const m=line.match(rowPattern);
    if(!m&&/\b(?:st|styck|pcs)\b/i.test(line)&&/\b(?:kr|SEK)\b/i.test(line)&&line.includes('%'))warnings.push('Artikelradens antal, pris eller moms kan inte läsas entydigt. Kontrollera hela raden.');
    if(m){
      const n=s=>Math.round(Number(s.replace(/[ \t]/g,'').replace(',','.'))*100),qty=Number(m[1].replace(/[ \t]/g,'').replace(',','.')),unit=n(m[2]),vat=n(m[4]),gross=n(m[5]);
      checkedRows.push({net_cents:Math.round(qty*unit),vat_cents:vat,total_cents:gross});
      if(Number.isSafeInteger(unit)&&Number.isSafeInteger(gross)&&Math.abs(qty*unit+vat-gross)>1)warnings.push('Radpris, moms och radbelopp stämmer inte överens. Kontrollera originalet.');
      const rate=Number(m[3].replace(',','.')),expectedVat=Math.round(qty*unit*rate/100);
      if(rate>100||!Number.isSafeInteger(expectedVat)||Math.abs(expectedVat-vat)>1)warnings.push('Radens momssats stämmer inte med det angivna momsbeloppet. Kontrollera originalet.');
    }
  }
  return {text,original,warnings,ambiguousInvoiceColumns,checkedRows};
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
export function interpretInvoice(text,{direction=null,direction_confident=false,method='pdf',ocrConfidence=0,filename='',subject='',company_organization_number='',ocrEvidence=null,ocrInputSha256=''}={}){
  const originalInput=String(text||''),layout=normalizeInvoiceLayout(text);text=layout.text;
  text=text.replace(/Fakturadatum[ \t]+Fakturanummer[ \t]*\n[ \t]*(\d{4}-\d{2}-\d{2})[ \t]+([A-Za-z0-9/_-]+)/gi,(_,date,number)=>`Fakturadatum: ${date}\nFakturanummer: ${number}`);
  const fields=Object.fromEntries(fieldNames.map(k=>[k,{value:null,confidence:0,evidence:null,warning:null}])),issues=[...layout.warnings];
  const scalarLabels=[];
  const confidence=method==='ocr'?Math.min(.85,Math.max(0,ocrConfidence/100)):.96;
  const set=(key,value,evidence,score=confidence)=>{fields[key]={value,confidence:value==null?0:score,evidence:evidence?.slice(0,300)||null,warning:score<.9?'Kräver kontroll':null};};
  const record=(key,matches,convert=s=>s.trim(),invalid=false)=>{
    const values=matches.map(m=>convert(m.value,m.label));
    if(invalid||values.some(value=>value==null)){
      issues.push(`Ogiltigt värde för ${titles[key]}. Kontrollera samtliga märkta värden i originalet.`);
      return;
    }
    const distinct=[...new Set(values)];
    if(distinct.length===1)set(key,distinct[0],matches[0].evidence);
    else if(distinct.length>1)issues.push(`Motstridiga värden för ${titles[key]}; dokumentet kan innehålla flera fakturor.`);
  };
  const grab=(key,re,convert=s=>s.trim(),labels=null)=>{
    const matches=[...text.matchAll(re)],positions=new Set(matches.map(m=>m.index));
    record(key,matches.map(m=>({value:m[1],evidence:m[0]})),convert,!!labels&&[...text.matchAll(labels)].some(m=>!positions.has(m.index)));
  };
  const referenceLabel='(?:OCR(?:[- /]?(?:nummer|referens))?|betalningsreferens|payment reference)';
  const issuedDateLabel='(?:fakturadatum|faktureringsdatum|invoice\\s*date)';
  const dueDateLabel='(?:förfallodatum|förfallodag|förfaller|oss\\s*tillhanda\\s*senast|betalas\\s*senast|due\\s*date)';
  // Only explicitly tax-qualified summaries identify net/gross amounts.
  // Reuse their grammar as sibling boundaries so inline fields stay separate.
  const taxSummaryPrefix='(?:summa|totalt|belopp)[ \\t]+';
  const grossTaxSummaryLabel=taxSummaryPrefix+'inkl(?:usive|\\.?)[ \\t]+moms';
  const netTaxSummaryLabel=taxSummaryPrefix+'exkl(?:usive|\\.?)[ \\t]+moms';
  const totalLabel='(?:att betala|summa att betala|totalsumma|totalbelopp|fakturabelopp|amount due|'+grossTaxSummaryLabel+')';
  // The explicit compound "Summa moms" has the same complete census inline
  // and at line start. Generic VAT/net words still need a colon inline.
  const vatLabel='(?:summa[ \\t]+moms|(?<=^|\\n)[ \\t]*(?:total moms|moms(?:belopp)?|VAT)|(?<!(?:före|exklusive|inklusive|inkl\\.?|exkl\\.?)[ \\t]+)(?:total moms|moms(?:belopp)?|VAT)(?=[ \\t]*:))';
  const netLabel='(?:belopp före moms|'+netTaxSummaryLabel+'|(?<=^|\\n)[ \\t]*(?:totalt netto|netto(?:belopp)?|net amount)|(?:totalt netto|netto(?:belopp)?|net amount)(?=[ \\t]*:))';
  // A following explicit field label separates values on the same line. Other
  // trailing content remains part of the value and must pass full validation.
  // Reuse the monetary census grammar exactly: a boundary must not discard an
  // occurrence that the field's own collector would never inspect.
  const siblingLabel='(?:'+invoiceNumberLabel+'|'+referenceLabel+'|'+issuedDateLabel+'|'+dueDateLabel+'|'+totalLabel+'|'+vatLabel+'|'+netLabel+'|bankgirokonto|bankgiro|bg|org(?:anisations)?\\.?[ \\t]*(?:nr|nummer)|organisation number|leverantör|utställare|säljare|supplier|seller|kund|customer|valuta|currency)';
  const sibling=new RegExp('(?:[ \\t]*[;|][ \\t]*|[ \\t]+)(?='+siblingLabel+'(?=[ \\t.:#]|$)|'+issuedDateLabel+'|'+dueDateLabel+')','iu');
  const grabFull=(key,label,convert)=>{
    const invoiceLabel=key==='invoice_number',currencyLabel=key==='currency',dateField=key==='issued_at'||key==='due_at';
    // Keep the old complete date-label census, including direct dates and
    // unreadable values. Identifier boundaries apply only to other fields.
    const suffix=invoiceLabel||dateField?'':currencyLabel?'(?=[\\s.:#-]|$)':'(?=[\\s.:#]|$)',separator=invoiceLabel||currencyLabel?'[:.#-]':'[:.#]';
    const re=new RegExp((dateField?'':'(?<![\\p{L}\\p{N}/_-])')+label+suffix+'[ \\t]*'+separator+'?[ \\t]*','giu'),matches=[];
    scalarLabels.push(new RegExp(re.source,'iu'));
    for(const match of text.matchAll(re)){
      let start=match.index+match[0].length;
      // Paragraph-gap recovery is only justified for explicit monetary
      // summaries. An identity, reference, account or date must stay on its
      // labelled line or the immediately adjacent line, never a later block.
      const monetaryField=['total_cents','vat_cents','net_cents'].includes(key);
      const blankLines=monetaryField?(text.slice(start).match(/^(?:\n[ \t]*)+/)?.[0]||''):(text[start]==='\n'?'\n':'');
      start+=blankLines.length;
      const end=text.indexOf('\n',start),line=text.slice(start,end<0?text.length:end);
      const boundary=line.search(sibling),value=(boundary<0?line:line.slice(0,boundary)).trim();
      // A bare alphabetic line could be a section heading. Keep it unassigned
      // instead of inventing an invoice identity; same-line IDs may be letters.
      const assigned=invoiceLabel&&blankLines&&!/[0-9]/.test(value)?'':value;
      matches.push({label:match[0],value:assigned,evidence:match[0]+blankLines+value});
    }
    record(key,matches,convert);
    return matches.length>0;
  };
  const compactDigits=value=>/^\d(?:[ \t]+\d)+$/.test(value)?value.replace(/[ \t]/g,''):value;
  // Only character-spaced digits are unambiguous. Two complete identifiers
  // must not be concatenated or reduced to a valid prefix.
  grabFull('invoice_number',invoiceNumberLabel,value=>{const token=compactDigits(value);return validInvoiceIdentifier(token)?token:null;});
  grabFull('issued_at',issuedDateLabel,invoiceDate);
  grabFull('due_at',dueDateLabel,invoiceDate);
  // A percentage is a rate, never an explicitly stated monetary amount.
  // Validate lexical groups before parseMoney removes whitespace. Several
  // integer columns or character-spaced amounts must not become one number.
  const amount='-?(?:\\d{1,3}(?:\\.\\d{3})+,\\d{1,2}|(?:\\d+|\\d{1,3}(?: \\d{3})+)(?:[.,]\\d{1,2})?)';
  const monetary=new RegExp('^(?:(?:SEK|EUR|USD|GBP|NOK|DKK)[ \\t]*)?('+amount+')(?:[ \\t]*(?:SEK|EUR|USD|GBP|NOK|DKK|kr))?$','iu');
  const money=s=>{
    const match=s.match(monetary);if(!match)return null;
    // A zero-padded, nonzero whole-number OCR token without an explicit
    // currency can be a neighbouring payment reference. Retain the raw text
    // for review instead of treating that ambiguous identifier as money.
    if(method==='ocr'&&/^-?0\d*[1-9]\d*$/.test(match[1].replaceAll(' ',''))&&!/[a-z]/i.test(s))return null;
    try{return parseMoney(match[1]);}catch{return null;}
  };
  grabFull('total_cents',totalLabel,money);
  grabFull('vat_cents',vatLabel,money);
  grabFull('net_cents',netLabel,money);
  grabFull('reference',referenceLabel,(value,label)=>{
    const token=compactDigits(value);
    if(/^OCR/i.test(label))return /^\d{1,120}$/.test(token)?token:null;
    return /^[\p{L}\p{N}][\p{L}\p{N}/_-]{0,119}$/u.test(token)?token:null;
  });
  if(layout.ambiguousInvoiceColumns){set('invoice_number',null,null,0);set('reference',null,null,0);}
  grabFull('bankgiro','(?:bankgirokonto|bankgiro|bg)',value=>{
    const match=value.match(/^(\d{3,4})(?:[ \t]*[-\u2010-\u2015\u2212][ \t]*|[ \t]+)(\d{4})$/u);
    return match?match[1]+'-'+match[2]:null;
  });
  if(method==='ocr'&&fields.bankgiro.value!==null){
    const proof=assessOcrBankgiro(originalInput,ocrInputSha256,ocrEvidence,fields.bankgiro.value);
    if(!proof.accepted){
      set('bankgiro',null,fields.bankgiro.evidence,0);
      fields.bankgiro.warning=proof.reason;issues.push(proof.reason);
    }
  }
  if(fields.invoice_number.value&&validDate(fields.invoice_number.value)){issues.push('Fakturanumret ser ut som ett datum. Kontrollera originalets kolumner.');set('invoice_number',null,fields.invoice_number.evidence,0);}
  if(['customer','supplier'].includes(direction))set('direction',direction,'Föreslagen från mejlets riktning',direction_confident?.94:.5);
  // Missing OCR titles may use a valid invoice-number label as provisional
  // evidence under the unchanged manual-review ceiling. Native documents do
  // not acquire a type this way. A competing document type anywhere in the
  // text (including a type/quotation-number label) blocks this inference.
  const otherDocumentType=/(?<![\p{L}\p{N}/_-])(?:offert(?:[ \t]*(?:nummer|nr|no))?|quotation|quote|påminnelse|betalningspåminnelse|(?:order|beställnings|betalnings|leverans)?bekräftelse|confirmation|payment[ \t]+(?:reminder|confirmation)|order[ \t]+confirmation)(?=[\s:.-]|$)/iu.test(layout.original);
  const numberedInvoice=method==='ocr'&&!otherDocumentType&&fields.invoice_number.value!==null?text.match(new RegExp('(?<![\\p{L}\\p{N}/_-])'+invoiceNumberLabel,'iu')):null;
  const typeEvidence=text.match(/kreditfaktura|credit\s*(?:invoice|note)/i)||text.match(/\bkvitto\b|\breceipt\b/i)||text.match(/\bfaktura\b|\binvoice\b|fakturanr/i)||numberedInvoice;
  const kind=typeEvidence?/kreditfaktura|credit\s*(?:invoice|note)/i.test(typeEvidence[0])?'credit':/\bkvitto\b|\breceipt\b/i.test(typeEvidence[0])?'receipt':'invoice':'other';
  set('kind',kind,typeEvidence?.[0]);
  // Explicit currency labels are a separate census. A valid inline SEK
  // token cannot erase an unreadable label or a known prefix followed by junk.
  const explicitCurrency=grabFull('currency','(?:valuta|currency)',value=>/^(?:SEK|EUR|USD|GBP|NOK|DKK)$/i.test(value)?value.toUpperCase():null);
  const currencies=[...new Set((text.match(/\b(?:SEK|EUR|USD|GBP|NOK|DKK)\b/gi)||[]).map(value=>value.toUpperCase()))];
  if(!explicitCurrency&&currencies.length===1)set('currency',currencies[0],currencies[0]);
  else if(!explicitCurrency&&!currencies.length&&/\bkr\b/i.test(text))set('currency','SEK','kr',.7);
  if(currencies.length>1){set('currency',null,null,0);issues.push('Flera valutor finns i underlaget.');}
  if(kind==='credit')for(const k of ['total_cents','net_cents','vat_cents'])if(fields[k].value!==null)fields[k].value=Math.abs(fields[k].value);
  if(layout.checkedRows.length)for(const key of ['net_cents','vat_cents','total_cents']){
    const sum=layout.checkedRows.reduce((total,row)=>total+row[key],0),printed=fields[key].value;
    if(!Number.isSafeInteger(sum)||printed!==null&&Math.abs((kind==='credit'?Math.abs(sum):sum)-printed)>1)issues.push('Motstridiga artikelrader och fakturasummor. Kontrollera alla tryckta rader och totalsummor.');
  }
  // Reuse the actual scalar-label grammar when bounding a party value. A new
  // accepted date/number label must never become the next-line party name.
  const scalarBoundary=value=>{let boundary=-1;for(const pattern of scalarLabels){const match=pattern.exec(value);if(match&&(boundary<0||match.index<boundary))boundary=match.index;}return boundary;};
  const scalarLabelColons=value=>{const positions=new Set();for(const pattern of scalarLabels)for(const match of value.matchAll(new RegExp(pattern.source,'giu'))){const colon=match[0].indexOf(':');if(colon>=0)positions.add(match.index+colon);}return positions;};
  const detail=extractInvoiceDetails(layout.original,{direction,validOrganization,money,scalarBoundary,scalarLabelColons,currency:fields.currency.value,invoice_number:fields.invoice_number.value,reference:fields.reference.value,credit:kind==='credit',summary:Object.fromEntries(['net_cents','vat_cents','total_cents'].map(key=>[key,fields[key].value]))});
  issues.push(...detail.issues);
  if(detail.currency_conflict)set('currency',null,null,0);
  set('party',detail.counterparty.name,detail.counterparty.name_evidence);
  set('organization_number',detail.counterparty.organization_number,detail.counterparty.organization_evidence);
  const values=Object.fromEntries(fieldNames.map(k=>[k,fields[k].value]));
  issues.push(...validateInvoiceValues(values));
  if(text.trim().length<40)issues.push('Dokumentet saknar tillräcklig läsbar text.');
  const required=['invoice_number','party','issued_at','due_at','total_cents','net_cents','vat_cents','direction','currency','organization_number'];
  const missing=required.filter(k=>values[k]==null);
  if(missing.length)issues.push('Saknade uppgifter: '+missing.map(k=>titles[k]).join(', '));
  const fatal=values.total_cents==null||values.invoice_number==null||!['invoice','credit'].includes(kind)||issues.some(s=>/Motstridiga|Momsberäkningen|Radpris|flera fakturor|Flera valutor|läsbar text/.test(s));
  const metadataIssues=documentConflicts({fields},{filename,subject,direction,company_organization_number});
  issues.push(...metadataIssues);
  const classification=classifyDocument({filename,text:layout.original,extraction:{fields}});
  const level=metadataIssues.length||classification.exclude_from_invoice_queue?'red':fatal?'red':issues.length||missing.length||required.some(k=>fields[k].confidence<.9)?'yellow':'green';
  return {version:3,method,fields,details:detail.details,level,classification,issues:[...new Set(issues)],text_excerpt:layout.original.slice(0,20000),extracted_at:new Date().toISOString()};
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
