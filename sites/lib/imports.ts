import {extractPaymentReferences} from './payment-references.js';
import {parseBankgiroXML} from './bankgiro-parser.js';
import {imageText,pdfInvoiceText} from './local-ocr';
import {interpretInvoice} from './invoice-fields.js';
import {parseMoney,validDate,today,suspectedBankCollection,PAYMENT_SPECIFICATION_REQUIRED} from './domain';
export type BankRow={payerEvidence?:ReturnType<typeof import('./payer-evidence.js').normalizePayerEvidence>;organizationNumber?:string;bankDataSha256?:string;bankDataVersion?:string;referenceEvidence?:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;bankData?:Record<string,unknown>;date:string;amount:number;party:string;payerReference:string;bankReference:string;description:string;source:string;currency:string;externalId?:string;account?:string;kind:string;verified:boolean;key?:string;parentKey?:string};
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
 // These headers identify the bank entry, never an invoice. Keep their own
 // fields and original column positions, without feeding IDs to OCR extraction.
 const bankIdColumns=new Set(parsed.headers.flatMap((header,n)=>CSV_HEADERS.bankReference.test(header.trim())||CSV_HEADERS.externalId.test(header.trim())?[n]:[]));
 return parsed.rows.map((r,index)=>{const v=(k:keyof Mapping)=>mapping[k]>=0?(r[mapping[k]]??'').trim():'';try{const currency=v('currency');if(currency.toUpperCase()!=='SEK')throw new Error('Valutan måste uttryckligen vara SEK i bankoriginalet.');const amount=parseMoney(v('amount')),party=v('party'),referenceEvidence=extractPaymentReferences({columns:parsed.headers.map((name,n)=>bankIdColumns.has(n)?{}:{[name]:r[n]??''})}),payerReference=v('payerReference')||referenceEvidence.selected?.value||'',description=v('description'),collective=suspectedBankCollection(amount,description,party,payerReference);return{referenceEvidence,date:normalizeDate(v('date')),amount,party,payerReference,bankReference:v('bankReference'),account:accountColumns.length?r[accountColumns[0]].trim():undefined,description:collective?`${PAYMENT_SPECIFICATION_REQUIRED} ${description}`:description,externalId:v('externalId'),currency:'SEK',source:name,kind:collective?'batch':'unknown',verified:false};}catch(e){throw new Error(`Rad ${index+2}: ${(e as Error).message}`);}});
}
// Use the same bounded, namespace-aware parser for preview and retained originals.
export function parseCAMT(text:string,name:string):BankRow[]{return parseBankgiroXML(text,name).map(row=>row.specification===false?{...row,kind:suspectedBankCollection(row.amount,row.description,row.party,row.payerReference)?'batch':'unknown'}:row);}
const bytesSha256=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
export async function sha256(file:File){return bytesSha256(await file.arrayBuffer());}
export async function pdfText(bytes:ArrayBuffer){return (await pdfInvoiceText(bytes)).text;}
type InvoiceTextContext={filename?:string;subject?:string;direction?:'customer'|'supplier';method?:'pdf'|'ocr';ocrConfidence?:number;ocrEvidence?:unknown;ocrInputSha256?:string};
function manualInvoiceInterpretation(text:string,context:InvoiceTextContext={}){
 // The JavaScript parser accepts these direction strings; its null default
 // does not describe that contract to TypeScript's inferred declaration.
 const parserContext:any={...context,direction:context.direction||'supplier',direction_confident:false};
 const extraction=interpretInvoice(text,parserContext);
 const value=(key:string)=>(extraction.fields as Record<string,{value:unknown}>)[key]?.value;
 const string=(key:string)=>value(key)==null?'':String(value(key));
 const foreignCurrency=/\b(EUR|USD|GBP|NOK|DKK|CHF|JPY|CAD|AUD)\b|[€£$]/i.test(text)||value('currency')!=null&&value('currency')!=='SEK';
 const amount=value('total_cents'),kind=value('kind');
 const total=!foreignCurrency&&!['credit','receipt'].includes(String(kind))&&typeof amount==='number'&&Number.isSafeInteger(amount)&&amount>0?(amount/100).toFixed(2):'';
 const warnings=[...extraction.issues];
 if(kind==='credit')warnings.push('Kreditfakturan behöver hanteras i kreditflödet. Ingen ny fakturaskuld föreslås.');
 if(kind==='receipt')warnings.push('Underlaget är ett kvitto. Kontrollera betalningen innan en fakturaskuld registreras.');
 const referenceOriginal=Object.fromEntries([['invoice_number',value('invoice_number')],['reference',value('reference')],['issuer_name',extraction.details?.supplier?.name]].filter(([,value])=>typeof value==='string'&&!!value));
 return {extraction,warnings,fields:{number:string('invoice_number'),total,issued:string('issued_at'),due:string('due_at'),ocr:string('reference'),referenceOriginal,bankgiro:string('bankgiro'),reviewed:false,note:'',foreignCurrency}};
}
export function extractInvoiceText(text:string,original?:ReturnType<typeof manualInvoiceInterpretation>['fields']['referenceOriginal']){const fields=manualInvoiceInterpretation(text).fields;return {...fields,referenceOriginal:original??fields.referenceOriginal};}
export async function readInvoiceFile(file:File,ownEmail:string){
 const ext=file.name.split('.').pop()?.toLowerCase();let text='',direction='payable',warning='',source=file.name,ocr=false,confidence=0,filename=file.name,subject='',ocrEvidence:unknown,ocrInputSha256='';
 if(ext==='pdf'){const bytes=await file.arrayBuffer();ocrInputSha256=await bytesSha256(bytes);const result=await pdfInvoiceText(bytes);text=result.text;ocr=result.ocr;confidence=result.confidence;ocrEvidence=result.ocrEvidence;if(!text.trim())warning='PDF-filen verkar vara skannad. Fyll i uppgifterna manuellt från originalet.';}
 else if(ext==='eml'){
  const PostalMime=(await import('postal-mime')).default,mail=await PostalMime.parse(await file.arrayBuffer(),{maxNestingDepth:30,maxRfc822NestingDepth:3});
  const sender=(mail.from as any)?.address??'',outgoing=sender.toLowerCase()===ownEmail.toLowerCase();direction=outgoing?'receivable':'payable';
  subject=mail.subject||'';
  const attachments=mail.attachments.filter(a=>a.mimeType==='application/pdf');
  if(attachments.length===1){
   // Mail headers/body are context. Do not mix their numbers with the retained
   // invoice attachment, or lose the decoder's optical provenance.
   filename=attachments[0].filename||file.name;
   try{const bytes=attachments[0].content as ArrayBuffer;ocrInputSha256=await bytesSha256(bytes);const result=await pdfInvoiceText(bytes);text=result.text;ocr=result.ocr;confidence=result.confidence;ocrEvidence=result.ocrEvidence;}catch{warning='PDF-bilagan kunde inte tolkas. Kontrollera originalmejlet.';}
  }else if(attachments.length===0){text=mail.text??'';if(!text&&mail.html){const doc=new DOMParser().parseFromString(mail.html,'text/html');doc.querySelectorAll('script,style').forEach(e=>e.remove());text=doc.body.textContent??'';}}
  if(attachments.length>1)warning='Mejlet innehåller flera PDF-bilagor. Importera varje faktura separat så att beloppen inte blandas ihop.';
  source=`Mejl: ${mail.subject??file.name}`;if(mail.messageId)source+=' · '+mail.messageId;
  warning=[warning,'Avsändaren kan vara en vidarebefordrare. Kontrollera rätt kund eller leverantör.'].filter(Boolean).join(' ');
 }else if(ext==='txt')text=await file.text();else if(['png','jpg','jpeg','webp'].includes(ext||'')){ocrInputSha256=await sha256(file);const result=await imageText(file);text=result.text;ocr=true;confidence=result.confidence;ocrEvidence=result.ocrEvidence;}else warning='Läs originalet och fyll i uppgifterna manuellt.';
 const interpreted=manualInvoiceInterpretation(text,{filename,subject,direction:direction==='receivable'?'customer':'supplier',method:ocr?'ocr':'pdf',ocrConfidence:confidence,ocrEvidence,ocrInputSha256}),{fields,extraction}=interpreted;
 warning=[warning,...interpreted.warnings,ocr?'OCR-tolkade uppgifter behöver kontrolleras mot originalet.':''].filter(Boolean).join(' ');
 if(fields.foreignCurrency)warning='Underlaget innehåller en annan valuta än SEK. Beloppet har inte fyllts i. Den här versionen hanterar endast fakturor i SEK. '+warning;
 const party=String(extraction.fields.party.value||'');
 // A contextual reparse must see the same bounded source text as its word
 // proof, including conflicts after the shorter display excerpt. Never rebind
 // an OCR proof to a truncated prefix to make it pass validation.
 return{fields:{...fields,email:'',party,direction,source:source.slice(0,300)},text:text.slice(0,50000),interpretationText:text.slice(0,150000),warning,ocr,confidence,ocrEvidence,ocrInputSha256,extraction};
}
export function downloadFile(filename:string,text:string,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export function csvCell(value:unknown){let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
