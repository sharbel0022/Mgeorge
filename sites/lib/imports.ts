import {extractPaymentReferences} from './payment-references.js';
import {parseBankgiroXML} from './bankgiro-parser.js';
import {imageText,pdfInvoiceText} from './local-ocr';
import {parseMoney,validDate,today,suspectedBankCollection,PAYMENT_SPECIFICATION_REQUIRED} from './domain';
export type BankRow={referenceEvidence?:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;bankData?:Record<string,unknown>;date:string;amount:number;party:string;payerReference:string;bankReference:string;description:string;source:string;currency:string;externalId?:string;account?:string;kind:string;verified:boolean;key?:string;parentKey?:string};
export function parseCSV(text:string){
 if(typeof text!=='string'||text.length>15_000_000)throw Error('CSV-filen får vara högst 15 MB.');
 const clean=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'),lines=clean.split('\n');
 const headerIndex=lines.findIndex(l=>/(datum|date)/i.test(l)&&/(belopp|amount|insättning|uttag)/i.test(l));
 const source=headerIndex>0?lines.slice(headerIndex).join('\n'):clean;
 const first=source.split('\n')[0],delimiter=[';','\t',','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closedQuote=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];if(c==='"'){
   if(quoted){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closedQuote=true;}}
   else{if(cell.trim()||closedQuote)throw Error('CSV-filen innehåller ett felplacerat citattecken.');quoted=true;cell='';}
  }else if(c===delimiter&&!quoted){row.push(cell.trim());cell='';closedQuote=false;}
  else if(c==='\n'&&!quoted){row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';closedQuote=false;}
  else{if(closedQuote&&!/[\t\r ]/.test(c))throw Error('CSV-filen innehåller text efter ett avslutat citattecken.');cell+=c;}
 }
 if(quoted)throw new Error('CSV-filen innehåller ett ofullständigt citattecken.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 if(rows.length<2)throw new Error('Ingen tabell med rubriker och bankhändelser hittades.');
 if(rows.length>1001)throw new Error('Välj högst 1 000 bankhändelser per import.');
 if(rows.some(r=>r.length!==rows[0].length))throw Error('CSV-radernas kolumnantal stämmer inte med rubrikerna.');
 const names=rows[0].map(h=>h.normalize('NFKC').trim().toLocaleLowerCase('sv-SE'));if(new Set(names).size!==names.length)throw Error('CSV-filen innehåller tvetydiga kolumnrubriker.');
 return{headers:rows[0],rows:rows.slice(1),delimiter};
}
export function normalizeDate(raw:string){const s=raw.trim();if(validDate(s))return s;const match=/^(\d{2})[/.\-](\d{2})[/.\-](\d{4})$/.exec(s);if(match){const iso=`${match[3]}-${match[2]}-${match[1]}`;if(validDate(iso))return iso;}throw new Error(`Datumet "${s}" kunde inte läsas. Använd ÅÅÅÅ-MM-DD.`);}
export type Mapping={date:number;amount:number;party:number;payerReference:number;bankReference:number;description:number;currency:number;externalId:number};
const CSV_HEADERS:Record<keyof Mapping,RegExp>={
 date:/^(transaktionsdatum|betalningsdatum|bokföringsdatum|bokforingsdatum|datum|date|booking date)$/i,
 amount:/^(belopp|inbetalningsbelopp|amount|summa)$/i,
 party:/^(betalare|namn|avsändare|avsändarens namn|avsandare|mottagare|motpart|payer|name)$/i,
 payerReference:/^(ocr|ocr[- .]?(?:nummer|number|referens)|betalningsreferens(?:\s*\/\s*ocr)?|fakturanummer|payer.?reference)$/i,
 bankReference:/^(bankreferens|referens|reference|bank.?reference)$/i,
 description:/^(text|beskrivning|transaktionstyp|meddelande|description|typ)$/i,
 currency:/^(valuta|currency)$/i,
 externalId:/^(transaktions.?id|transaction.?id|entry.?id)$/i
};
export function guessMapping(headers:string[]):Mapping{
 return Object.fromEntries(Object.entries(CSV_HEADERS).map(([key,pattern])=>{const found=headers.map((h,n)=>pattern.test(h.trim())?n:-1).filter(n=>n>=0);if(found.length>1)throw Error('CSV-filen har tvetydiga kolumner för '+key+'.');return[key,found[0]??-1];})) as Mapping;
}
export function mapCSV(parsed:ReturnType<typeof parseCSV>,mapping:Mapping,name:string):BankRow[]{
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).some(k=>!Object.hasOwn(CSV_HEADERS,k)))throw Error('Ogiltig kolumnmappning.');
 const used:number[]=[];for(const key of Object.keys(CSV_HEADERS) as (keyof Mapping)[]){const index=mapping[key];if(!Number.isInteger(index)||index< -1||index>=parsed.headers.length)throw Error('Kolumnmappningen ligger utanför bankfilen.');if(index>=0){if(used.includes(index))throw Error('Varje bankuppgift behöver en separat kolumn.');used.push(index);if(!CSV_HEADERS[key].test(parsed.headers[index].trim()))throw Error(`Kolumnen ”${parsed.headers[index]}” kan inte användas som ${key}. Kontrollera bankens rubriker.`);}}
 if(mapping.date<0||mapping.amount<0)throw new Error('Välj kolumner för datum och belopp.');
 if(mapping.currency<0)throw Error('Bankfilen saknar valutakolumn. SEK måste framgå av originalunderlaget.');
 const accountColumns=parsed.headers.map((h,n)=>/^(?:mottagarkonto|mottagarens konto|konto|bankkonto|iban)$/i.test(h.trim())?n:-1).filter(n=>n>=0);if(accountColumns.length>1)throw Error('Bankfilen har flera möjliga mottagarkonton. Granska originalet.');
 if(mapping.payerReference>=0&&mapping.payerReference===mapping.bankReference)throw new Error('Bankreferens och OCR ska ha olika kolumner.');
 return parsed.rows.map((r,index)=>{const v=(k:keyof Mapping)=>mapping[k]>=0?(r[mapping[k]]??'').trim():'';try{const currency=v('currency');if(currency.toUpperCase()!=='SEK')throw new Error('Valutan måste uttryckligen vara SEK i bankoriginalet.');const amount=parseMoney(v('amount')),party=v('party'),referenceEvidence=extractPaymentReferences({columns:parsed.headers.map((name,n)=>({[name]:r[n]??''}))}),payerReference=v('payerReference')||referenceEvidence.selected?.value||'',description=v('description'),collective=suspectedBankCollection(amount,description,party,payerReference);return{referenceEvidence,date:normalizeDate(v('date')),amount,party,payerReference,bankReference:v('bankReference'),account:accountColumns.length?r[accountColumns[0]].trim():undefined,description:collective?`${PAYMENT_SPECIFICATION_REQUIRED} ${description}`:description,externalId:v('externalId'),currency:'SEK',source:name,kind:collective?'batch':'unknown',verified:false};}catch(e){throw new Error(`Rad ${index+2}: ${(e as Error).message}`);}});
}
// Use the same bounded, namespace-aware parser for preview and retained originals.
export function parseCAMT(text:string,name:string):BankRow[]{return parseBankgiroXML(text,name).map(row=>row.specification===false?{...row,kind:suspectedBankCollection(row.amount,row.description,row.party,row.payerReference)?'batch':'unknown'}:row);}
export async function sha256(file:File){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function pdfText(bytes:ArrayBuffer){return (await pdfInvoiceText(bytes)).text;}
export function extractInvoiceText(text:string){
 const find=(pattern:RegExp)=>text.match(pattern)?.[1]?.trim()??'';
 const number=find(/(?:fakturanummer|faktura\s*nr|invoice\s*(?:number|no\.?))\s*[:#]?\s*([A-Z0-9][A-Z0-9\/-]*)/i);
 const amount=find(/(?:att\s*betala|summa\s*att\s*betala|belopp\s*att\s*betala|total\s*due|amount\s*due)\s*[:]?\s*(?:SEK\s*)?([\d \u00a0.,]+)(?:\s*(?:kr|SEK))?/i);
 const issued=find(/(?:fakturadatum|invoice\s*date)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}[/.]\d{2}[/.]\d{4})/i);
 const due=find(/(?:förfallodatum|förfaller|betalas\s*senast|due\s*date)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}[/.]\d{2}[/.]\d{4})/i);
 const ocr=find(/(?:OCR(?:\s*nummer)?|betalningsreferens)\s*:?\s*([\d][\d \-]{2,})/i);
 const bankgiro=find(/(?:bankgiro|bankgironummer|bankgiro\s*nr)\s*:?\s*([\d]{3,4}-[\d]{4})/i);
 const foreignCurrency=/\b(EUR|USD|GBP|NOK|DKK|CHF|JPY|CAD|AUD)\b|[€£$]/i.test(text);
 let total='';try{if(amount&&!foreignCurrency)total=(parseMoney(amount)/100).toFixed(2);}catch{}
 return{number,total,issued:issued?normalizeDate(issued):'',due:due?normalizeDate(due):'',ocr:ocr.trim(),bankgiro,reviewed:false,note:'',foreignCurrency};
}
export async function readInvoiceFile(file:File,ownEmail:string){
 const ext=file.name.split('.').pop()?.toLowerCase();let text='',email='',party='',direction='payable',warning='',source=file.name,ocr=false,confidence=0;
 if(ext==='pdf'){const result=await pdfInvoiceText(await file.arrayBuffer());text=result.text;ocr=result.ocr;confidence=result.confidence;if(!text.trim())warning='PDF-filen verkar vara skannad. Fyll i uppgifterna manuellt från originalet.';}
 else if(ext==='eml'){
  const PostalMime=(await import('postal-mime')).default,mail=await PostalMime.parse(await file.arrayBuffer(),{maxNestingDepth:30,maxRfc822NestingDepth:3});
  const sender=(mail.from as any)?.address??'',outgoing=sender.toLowerCase()===ownEmail.toLowerCase();direction=outgoing?'receivable':'payable';
  const person=outgoing?mail.to?.[0]:mail.from;email=(person as any)?.address??'';party=(person as any)?.name??'';
  text=mail.text??'';if(!text&&mail.html){const doc=new DOMParser().parseFromString(mail.html,'text/html');doc.querySelectorAll('script,style').forEach(e=>e.remove());text=doc.body.textContent??'';}
  const attachments=mail.attachments.filter(a=>a.mimeType==='application/pdf');
  if(attachments.length===1)try{text+='\n'+await pdfText(attachments[0].content as ArrayBuffer);}catch{warning='PDF-bilagan kunde inte tolkas. Kontrollera originalmejlet.';}
  if(attachments.length>1)warning='Mejlet innehåller flera PDF-bilagor. Importera varje faktura separat så att beloppen inte blandas ihop.';
  source=`Mejl: ${mail.subject??file.name}`;if(mail.messageId)source+=' · '+mail.messageId;
  warning=[warning,'Avsändaren kan vara en vidarebefordrare. Kontrollera rätt kund eller leverantör.'].filter(Boolean).join(' ');
 }else if(ext==='txt')text=await file.text();else if(['png','jpg','jpeg','webp'].includes(ext||'')){const result=await imageText(file);text=result.text;ocr=true;confidence=result.confidence;}else warning='Läs originalet och fyll i uppgifterna manuellt.';
 const fields=extractInvoiceText(text);if(fields.foreignCurrency)warning='Underlaget innehåller en annan valuta än SEK. Beloppet har inte fyllts i. Den här versionen hanterar endast fakturor i SEK. '+warning;
 return{fields:{...fields,email,party,direction,source:source.slice(0,300)},text:text.slice(0,50000),warning,ocr,confidence};
}
export function downloadFile(filename:string,text:string,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export function csvCell(value:unknown){let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
