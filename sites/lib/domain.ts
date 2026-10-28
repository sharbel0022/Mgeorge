import {exactReference} from './reconciliation-engine.js';
export type Invoice = {
 id: string; direction: "receivable" | "payable"; party: string; email: string; number: string; ocr: string;
 total: number; currency: "SEK"; issued: string; due: string; reviewed: boolean; voided: boolean;
 organizationNumber?:string;vat?:number|null;net?:number|null;reconciledAt?:string;reconciliationNote?:string;note: string; bankgiro: string; documentId: string; source: string; createdAt: string;
};
export type Transaction = {
 reportEvidence?:Record<string,string>;
 bankFileProof?:{version:'bank-file-original-v1';documentId:string;sha256:string;reviewedAt?:string};
 bankDetails?:{referenceEvidence?:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;status:'identified'|'missing'|'unsupported';checkedAt:string;party:string;payerReference:string;referenceSchema:string;reason:string;documentId:string;bankReferenceText:string};
 referenceEvidence?:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;bankData?:Record<string,unknown>;referenceParts?:{value:string;source:string;kind:string}[];specification?:boolean;specificationStatus?:'linked'|'review';specificationGroup?:string;specificationCount?:number;specificationTotal?:number;parentBankReference?:string;recipientBankgiro?:string;payerBankgiro?:string;payerAccount?:string;remittanceMessage?:string;settlementDate?:string;format?:string;recipientAccount?:string;
 id: string; date: string; amount: number; currency: "SEK"; party: string; payerReference: string; bankReference: string;
 description: string; source: string; externalId: string; account: string; kind: "payment" | "batch" | "unknown";
 evidence?:string;organizationNumber?:string;original?:{party:string;payerReference:string;description:string;amount:number;date:string;account:string;bankReference:string};verification?:{party:string;payerReference:string;note:string;at:string};verified: boolean; duplicateOf: string; ignored: boolean; parentId: string; importId: string; createdAt: string;
};
export type Allocation = {id:string;invoiceId:string;transactionId:string;amount:number;effect:"payment"|"refund";active:boolean;note:string;createdAt:string;reversedAt?:string};
export type Credit = {id:string;invoiceId:string;amount:number;number:string;note:string;date:string;active:boolean};
export type ImportRecord = {id:string;hash:string;account:string;name:string;count:number;createdAt:string;documentId?:string};
export type State = {schemaVersion:1;company:{name:string;email:string};invoices:Invoice[];transactions:Transaction[];allocations:Allocation[];credits:Credit[];imports:ImportRecord[];receipts:string[]};
export type Command = {type:string;[key:string]:any};
export const emptyState=():State=>({schemaVersion:1,company:{name:"M.George Vitvaror AB",email:"mg.vitvaror@gmail.com"},invoices:[],transactions:[],allocations:[],credits:[],imports:[],receipts:[]});
export const uid=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
export const now=()=>new Date().toISOString();
export function today(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Stockholm",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
export function money(ore:number){return new Intl.NumberFormat("sv-SE",{style:"currency",currency:"SEK",minimumFractionDigits:2,maximumFractionDigits:2}).format(ore/100);}
export function parseMoney(value:string|number):number{
 let s=String(value).trim().replace(/(?:SEK|kr)/gi,"").replace(/[\s\u00a0\u202f]/g,"").replace(/−/g,"-");
 if(/^\(.*\)$/.test(s))s="-"+s.slice(1,-1);
 if(s.includes(",")){if(!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/.test(s))throw new Error("Ogiltigt belopp. Använd till exempel 1 875,00.");s=s.replace(/\./g,"").replace(",",".");}
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))throw new Error("Ogiltigt belopp. Använd högst två decimaler.");
 const negative=s.startsWith("-"),[a,b=""]=s.replace(/^-/ ,"").split(".");
 const n=(Number(a)*100+Number(b.padEnd(2,"0")))*(negative?-1:1);
 if(!Number.isSafeInteger(n)||Math.abs(n)>100_000_000_000)throw new Error("Beloppet är för stort.");return n;
}
export function validDate(s:string,optional=false){if(optional&&!s)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+"T12:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
const str=(v:unknown,max=500)=>{if(typeof v!=="string"||v.length>max)throw new Error("Ett textfält saknas eller är för långt.");return v.trim();};
const cents=(v:unknown,positive=true)=>{if(!Number.isSafeInteger(v)||Math.abs(v as number)>100_000_000_000||(positive?(v as number)<=0:(v as number)===0))throw new Error("Beloppet måste vara giltigt och anges i hela ören.");return v as number;};
const date=(v:unknown,optional=false)=>{const s=str(v,10);if(!validDate(s,optional))throw new Error("Kontrollera datumet.");return s;};
const getInvoice=(s:State,id:string)=>{const i=s.invoices.find(i=>i.id===id);if(!i)throw new Error("Fakturan finns inte.");return i;};
const getTx=(s:State,id:string)=>{const t=s.transactions.find(t=>t.id===id);if(!t)throw new Error("Bankhändelsen finns inte.");return t;};
export function paid(s:State,id:string){return s.allocations.filter(a=>a.invoiceId===id&&a.active).reduce((n,a)=>n+a.amount*(a.effect==="refund"?-1:1),0);}
export function credited(s:State,id:string){return s.credits.filter(c=>c.invoiceId===id&&c.active).reduce((n,c)=>n+c.amount,0);}
export function balance(s:State,i:Invoice){return i.total-credited(s,i.id)-paid(s,i.id);}
export function available(s:State,t:Transaction){return Math.abs(t.amount)-s.allocations.filter(a=>a.transactionId===t.id&&a.active).reduce((n,a)=>n+a.amount,0);}
export function invoiceStatus(s:State,i:Invoice,at=today()):{key:string;label:string;tone:string}{
 if(i.voided)return{key:"voided",label:"Makulerad",tone:"neutral"};if(!i.reviewed)return{key:"review",label:"Granska faktura",tone:"amber"};
 const b=balance(s,i);if(b<0)return{key:"refund",label:"Återbetalning",tone:"purple"};
 if(b===0)return{key:"paid",label:credited(s,i.id)===i.total&&paid(s,i.id)===0?"Krediterad":"Betald",tone:"green"};
 if(paid(s,i.id)>0)return{key:"partial",label:i.due&&i.due<at?"Delbetald · förfallen":"Delbetald",tone:"blue"};
 if(!i.reconciledAt)return{key:"unreconciled",label:"Ej avstämd",tone:"amber"};
 if(i.due&&i.due<at)return{key:"overdue",label:paid(s,i.id)>0?"Delbetald · förfallen":"Obetald efter verifierad kontroll · förfallen",tone:"red"};
 if(paid(s,i.id)>0)return{key:"partial",label:"Delbetald",tone:"blue"};
 if(!i.due)return{key:"open",label:"Förfallodatum saknas",tone:"amber"};return{key:"open",label:i.due===at?"Förfaller idag":"Obetald efter verifierad kontroll",tone:"neutral"};
}
export const normalizeOCR=(s:string)=>s.replace(/[\s-]/g,"").toUpperCase();
const tokenMatch=exactReference;
export const PAYMENT_SPECIFICATION_REQUIRED='Betalardetaljer saknas – importera betalningsspecifikation.';
export const usablePaymentReference=(value:string)=>!!value.trim()&&!/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(value.trim());
export const individualParty=(value:string)=>!!value.trim()&&!/^(bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg|okänd(?: betalare)?|unknown)$/i.test(value.trim());
export const hasBankFileProof=(t:Transaction)=>t.bankFileProof?.version==='bank-file-original-v1'&&typeof t.bankFileProof.documentId==='string'&&!!t.bankFileProof.documentId&&/^[a-f0-9]{64}$/.test(t.bankFileProof.sha256);
export const needsBankFileValidation=(t:Transaction)=>t.evidence==='bank_file'&&!hasBankFileProof(t);
export const needsBankFileReview=(t:Transaction)=>t.evidence==='bank_file'&&(!hasBankFileProof(t)||!t.bankFileProof?.reviewedAt);
export function suspectedBankCollection(amount:number,description:string,party:string,structuredReference:string){
 const collective=/\bbatch\b|samlings|samlad|buntbetal|sammandrag/i.test(description);
 return collective||amount>0&&/bankgiro|bg\s*inbetalning/i.test(`${description} ${party}`)&&(!individualParty(party)||!usablePaymentReference(structuredReference));
}
export function needsPaymentSpecification(t:Transaction){return !t.parentId&&(t.kind==='batch'||suspectedBankCollection(t.amount,t.description,t.party,t.payerReference));}
const sameParty=(a:string,b:string)=>individualParty(a)&&a.normalize('NFKC').trim().toLocaleLowerCase('sv-SE')===b.normalize('NFKC').trim().toLocaleLowerCase('sv-SE');
const exactPaymentReference=(t:Transaction,i:Invoice)=>usablePaymentReference(t.payerReference)&&((!!i.ocr&&exactReference(t.payerReference,i.ocr))||tokenMatch(t.payerReference,i.number));
export function suggestions(s:State,t:Transaction){
 if(t.ignored||t.duplicateOf||!t.verified||t.kind!=="payment"||needsPaymentSpecification(t)||needsBankFileReview(t)||available(s,t)<=0)return[];
 const direction=t.amount>0?"receivable":"payable",all=s.invoices.filter(i=>i.reviewed&&!i.voided&&i.direction===direction&&(!i.issued||t.date>=i.issued));
 const references=all.filter(i=>exactPaymentReference(t,i));
 if(references.length)return references.map(i=>({invoice:i,amount:Math.min(Math.max(0,balance(s,i)),available(s,t)),strength:references.length===1?"strong":"ambiguous",reason:balance(s,i)<=0?"Referensen tillhör en reglerad faktura – möjlig dubbelbetalning":references.length>1?"Referensen stämmer med flera fakturor":i.ocr&&exactReference(t.payerReference,i.ocr)?"OCR stämmer":"Fakturanumret finns i betalningsreferensen"}));
 return all.filter(i=>balance(s,i)>0&&balance(s,i)===available(s,t)&&sameParty(t.party,i.party)).map(i=>({invoice:i,amount:Math.min(balance(s,i),available(s,t)),strength:"weak",reason:"Betalare och belopp stämmer – kontrollera underlaget"}));
}
export function canonicalBankAccount(value:string){
 const account=value.trim(),iban=account.replace(/^iban:/i,'').replace(/\s/g,'').toUpperCase();
 return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)?`iban:${iban}`:account;
}
const sameAccount=(a:string,b:string)=>canonicalBankAccount(a)===canonicalBankAccount(b);
const fromBankApi=(t:Transaction)=>t.source.startsWith('Enable Banking');
export function txFingerprint(t:Transaction){return[canonicalBankAccount(t.account),t.date,t.amount,t.currency,t.bankReference,t.payerReference,t.party,t.description].join("|");}
function possibleDuplicate(a:Transaction,b:Transaction){
 if(a.date!==b.date||a.amount!==b.amount||a.currency!==b.currency)return false;
 const apiA=fromBankApi(a),apiB=fromBankApi(b);
 // File imports may use a free-text account label. Keep overlapping API/file
 // entries for explicit duplicate review, never silently merge or discard them.
 if(apiA!==apiB)return true;
 if(!sameAccount(a.account,b.account))return false;
 // Review edits change descriptions and payer fields. Missing provider IDs must
 // therefore not make a previously reviewed API payment appear fresh next sync.
 if((apiA||apiB)&&(!a.externalId||!b.externalId))return true;
 return txFingerprint(a)===txFingerprint(b)||!!(a.bankReference&&a.bankReference===b.bankReference);
}
function cleanInvoice(raw:any,existing?:Invoice):Invoice{
 if(!raw||!['receivable','payable'].includes(raw.direction))throw new Error("Välj fakturatyp.");if(raw.currency&&raw.currency!=="SEK"||raw.foreignCurrency&&!raw.currencyConfirmed)throw new Error("Endast SEK stöds. Importera inte andra valutor som kronor.");
 const i:Invoice={id:existing?.id??uid(),direction:raw.direction,party:str(raw.party,200),email:str(raw.email??"",200),number:str(raw.number,100),ocr:str(raw.ocr??"",100),total:cents(raw.total),currency:"SEK",issued:date(raw.issued),due:date(raw.due??"",true),reviewed:raw.reviewed===true,voided:existing?.voided??false,note:str(raw.note??"",3000),bankgiro:str(raw.bankgiro??"",100),documentId:str(raw.documentId??"",100),source:str(raw.source??"Manuellt registrerad",300),createdAt:existing?.createdAt??now()};
 i.organizationNumber=str(raw.organizationNumber??existing?.organizationNumber??'',40);i.vat=raw.vat??existing?.vat??null;i.net=raw.net??existing?.net??null;i.reconciledAt=existing?.reconciledAt||'';i.reconciliationNote=existing?.reconciliationNote||'';
 if([i.vat,i.net].some(n=>n!=null&&(!Number.isSafeInteger(n)||n<0))||i.vat!=null&&i.net!=null&&i.vat+i.net!==i.total)throw new Error('Netto och moms måste stämma med fakturabeloppet.');
 if(!i.party||!i.number)throw new Error("Namn och fakturanummer behövs.");if(i.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email))throw new Error("Kontrollera e-postadressen.");if(i.due&&i.due<i.issued)throw new Error("Förfallodatum får inte vara före fakturadatum.");return i;
}
function cleanReportEvidence(raw:any):Record<string,string>|undefined{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
 return Object.fromEntries(['profile','namespace','messageId','reportId','createdAt','accountServicer','entryReference','valueDate'].map(key=>[key,str(raw[key]??'',300)]));
}
function cleanTransaction(raw:any):Transaction{
 if(!raw||raw.currency&&raw.currency!=="SEK")throw new Error("Endast bankhändelser i SEK stöds.");let kind=['payment','batch','unknown'].includes(raw.kind)?raw.kind:'unknown';
 const amount=cents(raw.amount,false),party=str(raw.party??"",200),payerReference=str(raw.payerReference??"",300),description=str(raw.description??"",1000);
 if(!raw.parentKey&&suspectedBankCollection(amount,description,party,payerReference))kind='batch';
 return{id:uid(),date:date(raw.date),amount,currency:"SEK",party,payerReference,bankReference:str(raw.bankReference??"",300),description,source:str(raw.source??"Manuellt registrerad",300),externalId:str(raw.externalId??"",300),account:canonicalBankAccount(str(raw.account??"Swedbank",100)),kind,verified:raw.verified===true&&kind==='payment',duplicateOf:"",ignored:false,parentId:"",importId:"",createdAt:now()};
}
/** A specification is never money a second time. Only exact bank evidence releases it. */
export function specificationPreview(s:State,rows:any[],targetId=''){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('Välj 1–1 000 betalningsrader.');
 const payments=rows.filter(r=>r.kind!=='batch'),groups=new Map<string,any[]>();
 for(const r of payments){const key=r.parentKey||r.parentBankReference||r.bankReference||r.key||'csv';groups.set(key,[...(groups.get(key)||[]),r]);}
 const plans=[...groups.values()].map(group=>{
  const first=group[0],total=group.reduce((n,r)=>n+cents(r.amount,false),0),ref=first.parentBankReference||first.bankReference;
  const candidates=s.transactions.filter(t=>!t.ignored&&!t.parentId&&needsPaymentSpecification(t)&&t.bankReference&&ref===t.bankReference&&first.account&&sameAccount(first.account,t.account)&&group.every(r=>r.date===t.date&&r.currency===t.currency&&sameAccount(r.account||'',t.account))&&t.amount===total);
  const parent=candidates.length===1?candidates[0]:undefined;
  let reason=!first.account?'Mottagarkonto saknas i filen.':!ref?'Insättningens bankidentifierare saknas.':!parent?'Konto, datum, bankidentifierare och totalsumma kan inte kopplas entydigt till en samlingspost.':targetId&&parent.id!==targetId?'Filen tillhör en annan bankhändelse.':parent.duplicateOf||s.allocations.some(a=>a.transactionId===parent.id&&a.active)?'Samlingsposten har en tidigare matchning eller dubblettspärr.':'';
  if(group.some(r=>!individualParty(r.party||'')))reason='En eller flera betalare saknas i specifikationen.';
  const existing=parent?s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored):[];
  const signature=(r:any)=>JSON.stringify([r.date,r.amount,r.currency,r.party,r.payerReference,r.bankReference]);
  if(new Set(group.map(signature)).size!==group.length||group.some((r,n)=>r.externalId&&group.some((other,m)=>m!==n&&other.externalId===r.externalId)))reason='Specifikationen innehåller möjliga dubbla betalningar. Granska bankoriginalets individuella identifierare.';
  const duplicate=existing.length===group.length&&existing.map(signature).sort().join('|')===group.map(signature).sort().join('|');
  if(existing.length&&!duplicate)reason='Samlingsposten har redan en annan betalningsspecifikation. Granska konflikten.';
  const overlap=parent&&s.transactions.some(t=>t.id!==parent.id&&!t.ignored&&!t.duplicateOf&&t.specificationStatus!=='review'&&!existing.some(e=>e.id===t.id)&&group.some(r=>t.date===r.date&&t.amount===r.amount&&t.currency===r.currency&&(r.externalId&&t.externalId===r.externalId||r.bankReference&&r.bankReference!==ref&&t.bankReference===r.bankReference||t.party===r.party&&t.payerReference===r.payerReference)));
  if(overlap)reason='Betalningen kan redan finnas via ett annat bankunderlag. Granska dubbletten.';
  return {rows:group,parentId:!reason?parent?.id:'',duplicate:!reason&&duplicate,total,status:reason?'review':'linked',reason:reason||'Konto, datum, bankidentifierare och totalsumma stämmer. Insättningen räknas en gång.'};
 });
 return {plans,payments:payments.length,total:payments.reduce((n,r)=>n+r.amount,0),linked:plans.filter(p=>p.status==='linked').length,review:plans.filter(p=>p.status==='review').length};
}
export function paymentInvoiceAssessment(s:State,t:Transaction){
 const view={...t,party:t.bankDetails?.party||t.party,payerReference:t.bankDetails?.payerReference||(needsPaymentSpecification(t)?'':t.payerReference)};
 const exact=s.invoices.filter(i=>!i.voided&&i.direction===(t.amount>0?'receivable':'payable')&&exactPaymentReference(view,i));
 const allocated=s.allocations.find(a=>a.active&&a.transactionId===t.id),invoice=allocated?s.invoices.find(i=>i.id===allocated.invoiceId):exact.length===1?exact[0]:undefined;
 return {invoice,status:allocated?'verified':exact.length>1?'ambiguous':invoice?'possible':'missing',message:allocated?'Betalningen är verifierad mot fakturan.':exact.length>1?'Flera fakturor kan passa. Granska kundidentiteten.':invoice?'Referensen finns. Kund och betalningsunderlag behöver stämma.':individualParty(view.party)?usablePaymentReference(view.payerReference)?`Betalare identifierad – ingen faktura med betalningsreferensen ${view.payerReference} hittades i registret.`:'Betalare identifierad – fakturakoppling saknas.':'Betalaren behöver identifieras.'};
}
export function economicTransactions(s:State){return s.transactions.filter(t=>!t.ignored&&!t.duplicateOf&&t.specificationStatus!=='review'&&!s.transactions.some(c=>c.parentId===t.id&&!c.ignored));}
export function applyCommand(current:State,command:Command):{state:State;message:string}{
 const s=structuredClone(current);let message="Sparat";
 switch(command.type){
 case'bankgiro.import':{
  if(!command.documentId||!command.hash)throw Error('Originalfilen måste sparas före import.');
  if(s.imports.some(i=>i.hash===command.hash)&&!s.transactions.some(t=>t.specificationStatus==='review'&&s.imports.find(i=>i.id===t.importId)?.hash===command.hash)){message='Filen har redan importerats. Inga nya betalningar skapades.';break;}
  const preview=specificationPreview(s,command.rows,command.targetId),record:ImportRecord={id:uid(),hash:str(command.hash,128),account:'Bankgiro',name:str(command.name,300),count:0,createdAt:now(),documentId:str(command.documentId,100)};
  for(const plan of preview.plans){
   if(plan.duplicate)continue;
   for(const raw of plan.rows){
    const t=cleanTransaction({...raw,kind:'payment',verified:false});
    if(Array.isArray(raw.referenceParts))t.referenceParts=raw.referenceParts.slice(0,20).map((p:any)=>({value:str(p.value,300),source:str(p.source,200),kind:str(p.kind,60)}));t.specification=true;t.specificationStatus=plan.status as 'linked'|'review';t.parentBankReference=str(raw.parentBankReference||'',300);t.recipientBankgiro=str(raw.recipientBankgiro||'',100);t.payerBankgiro=str(raw.payerBankgiro||'',100);t.settlementDate=str(raw.settlementDate||'',10);t.format=str(raw.format||'',100);t.organizationNumber=str(raw.organizationNumber||'',40);
    t.referenceEvidence=structuredClone(raw.referenceEvidence);t.payerAccount=str(raw.payerAccount||'',100);t.remittanceMessage=str(raw.remittanceMessage||'',1000);t.reportEvidence=cleanReportEvidence(raw.reportEvidence);
    t.specificationGroup=str(plan.rows[0].parentKey||plan.rows[0].parentBankReference||plan.rows[0].bankReference||plan.rows[0].key||'csv',300);t.specificationCount=plan.rows.length;t.specificationTotal=plan.total;
    t.recipientAccount=str(raw.recipientAccount||raw.account||'',100);t.original={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};
    t.parentId=plan.parentId||'';t.importId=record.id;t.evidence='bankgiro_file';t.kind='payment';t.verified=plan.status==='linked'&&individualParty(t.party);
    const duplicate=s.transactions.find(x=>x.specification&&x.date===t.date&&x.amount===t.amount&&x.party===t.party&&x.payerReference===t.payerReference&&x.bankReference===t.bankReference&&sameAccount(x.account,t.account));
    if(duplicate){if(duplicate.specificationStatus==='review'&&plan.status==='linked'){duplicate.parentId=t.parentId;duplicate.verified=t.verified;duplicate.specificationStatus='linked';duplicate.specificationGroup=t.specificationGroup;duplicate.specificationCount=t.specificationCount;duplicate.specificationTotal=t.specificationTotal;}continue;}
    s.transactions.push(t);record.count++;
   }
  }
  for(const plan of preview.plans.filter(p=>p.status==='linked'&&p.parentId)){
   const parent=getTx(s,plan.parentId!),children=s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored);
   if(children.reduce((sum,t)=>sum+t.amount,0)!==parent.amount)throw Error('Betalningsspecifikationen kan inte räknas fullständigt utan dubbletter. Ingen import gjordes.');
  }
  s.imports.push(record);message=`${record.count} betalningar importerade. ${preview.review} specifikationer behöver granskning.`;break;
 }
 case'invoice.save':{
  const old=command.invoice.id?getInvoice(s,command.invoice.id):undefined,item=cleanInvoice(command.invoice,old);
  const duplicate=s.invoices.find(i=>i.id!==item.id&&!i.voided&&i.direction===item.direction&&i.party.toLowerCase()===item.party.toLowerCase()&&i.number.toUpperCase()===item.number.toUpperCase());
  if(duplicate)throw new Error("Fakturanumret finns redan för den här kunden/leverantören. Öppna den befintliga fakturan.");
  if(old&&(s.allocations.some(a=>a.active&&a.invoiceId===old.id)||credited(s,old.id)>0)&&(item.total!==old.total||item.direction!==old.direction||item.party!==old.party||item.number!==old.number||item.reviewed!==old.reviewed))throw new Error("Fakturan har betalningar eller krediter. Ångra dessa först, eller registrera en kreditfaktura.");
  if(old)s.invoices[s.invoices.indexOf(old)]=item;else s.invoices.push(item);message=item.reviewed?"Fakturan är sparad och granskad":"Fakturan är sparad för granskning";break;
 }
 case'invoice.reconcile':{const i=getInvoice(s,command.id);const note=str(command.note??'',1500);if(command.confirm!==true||!note)throw new Error('Bekräfta kontrollen och ange bankunderlaget.');i.reconciledAt=now();i.reconciliationNote=note;message='Betalningsunderlaget är kontrollerat';break;}
 case'invoice.void':{const i=getInvoice(s,command.id);if(s.allocations.some(a=>a.invoiceId===i.id&&a.active)||credited(s,i.id)>0)throw new Error("Ångra betalningar och krediter innan makulering.");i.voided=!i.voided;message=i.voided?"Fakturan är makulerad":"Fakturan är återställd";break;}
 case'credit.add':{
  const i=getInvoice(s,command.invoiceId);if(!i.reviewed||i.voided)throw new Error("Granska fakturan först.");const amount=cents(command.amount);
  if(credited(s,i.id)+amount>i.total)throw new Error("Krediten är större än fakturans återstående krediterbara belopp.");const number=str(command.number,100);if(!number)throw new Error("Ange kreditfakturans nummer.");if(s.credits.some(c=>c.invoiceId===i.id&&c.number===number&&c.active))throw new Error("Kreditfakturan finns redan.");
  s.credits.push({id:uid(),invoiceId:i.id,amount,number,note:str(command.note??"",1000),date:date(command.date),active:true});message="Krediten är registrerad";break;
 }
 case'credit.undo':{const c=s.credits.find(c=>c.id===command.id&&c.active);if(!c)throw new Error("Krediten finns inte.");c.active=false;message="Krediten är återtagen";break;}
 case'transactions.import':{
  if(!Array.isArray(command.rows)||!command.rows.length||command.rows.length>1000)throw new Error("Importera 1–1 000 bankhändelser åt gången.");const hash=str(command.hash??"",128),account=canonicalBankAccount(str(command.account??"Swedbank",100));
  const trustedFile=command.trustedBankFileImport===true&&!!command.documentId&&/^[a-f0-9]{64}$/.test(hash),previous=trustedFile?s.imports.filter(i=>i.hash===hash||i.documentId===command.documentId):[];
  if(previous.length){
   // A repeat original can prove existing facts; it must never create more money.
   if(previous.length!==1)throw Error('Originalfilen har flera äldre importer. Granska dem tillsammans innan verifiering.');
   const existing=s.transactions.filter(t=>t.importId===previous[0].id),matched:Transaction[]=[],keys=new Map<string,string>();
   const parsed=command.rows.map((raw:any)=>cleanTransaction({...raw,account:typeof raw.account==='string'&&raw.account.trim()?raw.account:account}));
   if(existing.length!==parsed.length)throw Error('Originalet stämmer inte med alla äldre bankrader. Bevara posterna och granska originalet.');
   for(let n=0;n<parsed.length;n++){
    const row=parsed[n],found=existing.filter(t=>!matched.includes(t)&&t.externalId===row.externalId&&txFingerprint({...t,...t.original})===txFingerprint(row)&&!(row.kind==='batch'&&t.kind!=='batch'));
    if(found.length!==1)throw Error('Originalet stämmer inte entydigt med äldre betalar-, referens- eller beloppsuppgifter. Granska originalet.');
    matched.push(found[0]);if(command.rows[n].key)keys.set(command.rows[n].key,found[0].id);
   }
   if(matched.some((t,n)=>t.parentId!==(command.rows[n].parentKey?keys.get(command.rows[n].parentKey)||'missing':'')))throw Error('Originalets uppdelning stämmer inte med äldre bankrader. Granska originalet.');
   for(let n=0;n<matched.length;n++){const t=matched[n];t.evidence='bank_file';t.referenceEvidence=structuredClone(command.rows[n].referenceEvidence);t.reportEvidence=cleanReportEvidence(command.rows[n].reportEvidence);t.bankFileProof={version:'bank-file-original-v1',documentId:str(command.documentId,100),sha256:hash};}
   message='Bankoriginalet är kontrolläst igen. Befintliga betalningar och belopp är bevarade.';break;
  }
  if(hash&&s.imports.some(i=>i.hash===hash&&sameAccount(i.account,account)))throw new Error("Den här filen har redan importerats för kontot.");
  const record:ImportRecord={id:uid(),hash,account,name:str(command.name??"Manuell registrering",300),count:0,createdAt:now(),documentId:str(command.documentId??'',100)},keys=new Map<string,string>();let skipped=0;
  for(const raw of command.rows){
   const t=cleanTransaction({...raw,account:typeof raw.account==='string'&&raw.account.trim()?raw.account:account});t.importId=record.id;if(Array.isArray(raw.referenceParts))t.referenceParts=raw.referenceParts.slice(0,20).map((p:any)=>({value:str(p.value,300),source:str(p.source,200),kind:str(p.kind,60)}));t.organizationNumber=str(raw.organizationNumber??'',40);t.payerAccount=str(raw.payerAccount||'',100);t.remittanceMessage=str(raw.remittanceMessage||'',1000);
   t.original={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};
   if(command.trustedBankImport===true){t.referenceEvidence=structuredClone(raw.referenceEvidence);t.bankData=structuredClone(raw.bankData);t.evidence='bank_api';if(t.externalId&&t.kind!=='batch'&&individualParty(t.party)&&usablePaymentReference(t.payerReference)){t.kind='payment';t.verified=true;}}
   else if(trustedFile){t.evidence='bank_file';t.referenceEvidence=structuredClone(raw.referenceEvidence);t.reportEvidence=cleanReportEvidence(raw.reportEvidence);t.bankFileProof={version:'bank-file-original-v1',documentId:record.documentId!,sha256:hash};}
   if(raw.parentKey){const parentId=keys.get(raw.parentKey);if(!parentId)throw new Error("Betalningsspecifikationen saknar sin samlingspost.");if(!individualParty(t.party)||!usablePaymentReference(t.payerReference))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);t.parentId=parentId;}
   const stable=t.externalId?s.transactions.find(x=>sameAccount(x.account,t.account)&&x.externalId===t.externalId):undefined;
   if(stable){
    if(stable.ignored)throw new Error('Bankhändelsen finns redan som undantagen. Återställ den befintliga posten om den ska användas.');
    if(stable.amount!==t.amount||stable.date!==t.date||stable.currency!==t.currency||t.parentId&&stable.parentId!==t.parentId)throw new Error("Samma bank-ID har olika uppgifter eller tillhör en annan samlingspost. Kontrollera filerna före import.");
    if(command.trustedBankImport===true&&!stable.bankData){stable.bankData=t.bankData;stable.referenceEvidence=t.referenceEvidence;}
    if(t.kind==='batch'&&stable.kind!=='batch'){if(stable.parentId||stable.duplicateOf||s.allocations.some(a=>a.active&&a.transactionId===stable.id))throw new Error('Samlingsposten är redan matchad eller behöver dubblettkontroll. Ångra matchningen och kontrollera underlaget först.');stable.kind='batch';stable.verified=false;}
    skipped++;if(raw.key)keys.set(raw.key,stable.id);continue;
   }
   const similar=s.transactions.find(x=>x.id!==t.parentId&&x.specificationStatus!=='review'&&possibleDuplicate(x,t));
   if(similar){if(t.kind==='batch')throw new Error('En samlingspost liknar en tidigare bankhändelse. Granska den befintliga posten och dela vid behov upp den där. Ingen ny import gjordes.');t.duplicateOf=similar.id;t.verified=false;}
   if(raw.key)keys.set(raw.key,t.id);s.transactions.push(t);record.count++;
  }
  for(const parent of s.transactions.filter(t=>t.kind==='batch'&&!t.ignored)){const children=s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored);if(children.length&&(parent.duplicateOf||children.reduce((n,t)=>n+t.amount,0)!==parent.amount))throw new Error("Delbetalningarna stämmer inte med bankens samlingsbelopp eller samlingsposten är en möjlig dubblett. Ingen rad importerades.");}
  for(const i of s.invoices)if(!paid(s,i.id)&&record.count){i.reconciledAt='';i.reconciliationNote='';}
  s.imports.push(record);message=`${record.count} bankhändelser importerade${skipped?`, ${skipped} kända bank-ID:n hoppades över`:''}`;break;
 }
 case'transaction.verify':{
  const t=getTx(s,command.id);if(needsBankFileValidation(t))throw Error('Bankoriginalet behöver kontrolläsas igen. Importera samma originalfil för verifiering.');if(t.specificationStatus==='review')throw Error('Specifikationen behöver kopplas till bankens insättning före verifiering.');if(t.ignored)throw new Error("Den här posten kan inte bekräftas som en enskild betalning.");if(needsPaymentSpecification(t))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);if(t.duplicateOf&&!command.confirmDistinct)throw new Error("Kontrollera först om raden är en dubblett.");
  t.original??={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};
  t.party=str(command.party??t.party,200);t.payerReference=str(command.payerReference??t.payerReference,300);if(!individualParty(t.party)&&!usablePaymentReference(t.payerReference))throw new Error('Betalare eller fakturareferens saknas. Komplettera från bankunderlaget före bekräftelse.');const note=str(command.note??"",1000);if(!note)throw new Error("Beskriv hur du har kontrollerat betalningsuppgifterna.");t.verification={party:t.party,payerReference:t.payerReference,note,at:now()};if(t.evidence==='bank_file'&&t.bankFileProof)t.bankFileProof.reviewedAt=t.verification.at;t.evidence||='manual_verified';t.verified=true;t.kind='payment';t.duplicateOf='';message="Betalningsuppgifterna är bekräftade";break;
 }
 case'transaction.ignore':{const t=getTx(s,command.id);if(s.allocations.some(a=>a.transactionId===t.id&&a.active))throw new Error("Ångra matchningar först.");if(t.parentId||s.transactions.some(c=>c.parentId===t.id&&!c.ignored))throw new Error("Poster i en samlingsbetalning behöver hanteras tillsammans.");t.ignored=!t.ignored;message=t.ignored?"Bankhändelsen är undantagen":"Bankhändelsen är återställd";break;}
 case'transaction.unverify':{const t=getTx(s,command.id);if(t.kind==='batch'||s.allocations.some(a=>a.active&&a.transactionId===t.id))throw new Error('Ångra matchningar innan du korrigerar betalningsuppgifterna.');t.verified=false;message='Bankhändelsen är öppnad för ny granskning';break;}
 case'transaction.unsplit':{
  const parent=getTx(s,command.id),children=s.transactions.filter(t=>t.parentId===parent.id&&!t.ignored);if(!children.length)throw new Error('Ingen aktiv uppdelning finns.');
  if(children.some(t=>s.allocations.some(a=>a.active&&a.transactionId===t.id)))throw new Error('Ångra delbetalningarnas matchningar innan uppdelningen återtas.');
  for(const t of children)t.ignored=true;parent.kind='batch';parent.verified=false;message='Uppdelningen är återtagen. Importera eller registrera en korrekt betalningsspecifikation.';break;
 }
 case'transaction.split':{
  if(getTx(s,command.id).specificationStatus==='review')throw Error('Specifikationen behöver först kopplas till en verifierad bankinsättning.');
  const parent=getTx(s,command.id);if(parent.ignored||parent.parentId||parent.duplicateOf||s.allocations.some(a=>a.transactionId===parent.id&&a.active)||s.transactions.some(t=>t.parentId===parent.id&&!t.ignored))throw new Error("Posten är redan matchad, uppdelad eller behöver dubblettkontroll.");if(!Array.isArray(command.rows)||command.rows.length<1||command.rows.length>100)throw new Error("Lägg till betalningsrader från specifikationen.");
  const children=command.rows.map((raw:any)=>cleanTransaction({...raw,account:parent.account,date:parent.date,source:"Betalningsspecifikation: "+parent.bankReference,kind:"payment",verified:true}));
  if(children.some((t:Transaction)=>!individualParty(t.party)||!usablePaymentReference(t.payerReference)))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);
  if(children.some((t:Transaction)=>Math.sign(t.amount)!==Math.sign(parent.amount))||children.reduce((n:number,t:Transaction)=>n+t.amount,0)!==parent.amount)throw new Error("Summan av betalningsraderna måste stämma exakt med bankposten.");parent.kind='batch';parent.verified=false;for(const t of children){t.parentId=parent.id;t.evidence='verified_specification';t.original={party:t.party,payerReference:t.payerReference,description:t.description,amount:t.amount,date:t.date,account:t.account,bankReference:t.bankReference};const duplicate=s.transactions.find(x=>!x.ignored&&x.id!==parent.id&&possibleDuplicate(x,t));if(duplicate){t.duplicateOf=duplicate.id;t.verified=false;}s.transactions.push(t);}message="Samlingsbetalningen är uppdelad";break;
 }
 case'match.create':{
  const i=getInvoice(s,command.invoiceId),t=getTx(s,command.transactionId),amount=cents(command.amount),effect=command.effect==='refund'?'refund':'payment';
  if(needsBankFileReview(t))throw Error('Bankoriginalet behöver kontrolläsas och kontot bekräftas före matchning. Importera samma originalfil och granska bankuppgifterna.');
  if(!i.reviewed||i.voided||!t.verified||t.kind!=='payment'||t.ignored||t.duplicateOf)throw new Error("Granska fakturan och bankhändelsen innan matchning.");if(needsPaymentSpecification(t))throw new Error(PAYMENT_SPECIFICATION_REQUIRED);const expected=(i.direction==='receivable'?1:-1)*(effect==='refund'?-1:1);if(Math.sign(t.amount)!==expected)throw new Error("Betalningens riktning stämmer inte med fakturan.");
  if(!exactPaymentReference(t,i)&&!(sameParty(t.party,i.party)&&Math.abs(balance(s,i))===available(s,t))&&command.referenceCorrection!==true)throw new Error('Matchningen kräver exakt OCR/fakturareferens eller samma betalare och belopp. Beloppet ensamt styrker inte betalningen.');
  if(amount>available(s,t)||amount>balance(s,i)*(effect==='refund'?-1:1))throw new Error("Beloppet överstiger det som återstår. Uppdatera sidan och kontrollera beloppen.");const note=str(command.note??"",1000);if(!note)throw new Error("Ange vilket underlag som bekräftar matchningen.");
  i.reconciledAt=now();s.allocations.push({id:uid(),invoiceId:i.id,transactionId:t.id,amount,effect,active:true,note,createdAt:now()});message=effect==='refund'?"Återbetalningen är avstämd":"Betalningen är matchad";break;
 }
 case'match.undo':{const a=s.allocations.find(a=>a.id===command.id&&a.active);if(!a)throw new Error("Matchningen finns inte längre.");if(!str(command.note??"",1000))throw new Error("Ange varför matchningen ångras.");a.active=false;a.reversedAt=now();const i=getInvoice(s,a.invoiceId);i.reconciledAt='';i.reconciliationNote='';message="Matchningen är ångrad";break;}
 case'settings.save':{s.company={name:str(command.name,200),email:str(command.email,200)};if(!s.company.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.company.email))throw new Error("Ange företagsnamn och en giltig e-postadress.");break;}
 default:throw new Error("Okänd åtgärd.");
 }
 for(const i of s.invoices){if(paid(s,i.id)<0)throw new Error('Ångra kopplade återbetalningar innan den ursprungliga betalningen återtas.');if(credited(s,i.id)>i.total)throw new Error('Kreditbeloppet överstiger fakturans totalbelopp.');}
 for(const a of s.allocations.filter(a=>a.active)){const i=getInvoice(s,a.invoiceId),t=getTx(s,a.transactionId);if(i.voided||!i.reviewed||t.ignored||t.duplicateOf||!t.verified||t.kind!=='payment'||s.transactions.some(c=>c.parentId===t.id&&!c.ignored))throw new Error('En betalningsmatchning saknar giltigt underlag. Ångra matchningen först.');}
 for(const t of s.transactions){if(available(s,t)<0)throw new Error('Bankhändelsen skulle bli överfördelad.');const children=s.transactions.filter(c=>c.parentId===t.id&&!c.ignored);if(children.length&&(t.kind!=='batch'||t.ignored||t.duplicateOf||available(s,t)!==Math.abs(t.amount)||children.reduce((n,c)=>n+c.amount,0)!==t.amount||children.some(c=>Math.sign(c.amount)!==Math.sign(t.amount))))throw new Error('Samlingspostens underlag och delbetalningar är inte avstämda.');}
 if(s.invoices.length>5000||s.transactions.length>15000)throw new Error("Registret är fullt. Exportera underlaget och kontakta systemadministratören.");return{state:s,message};
}
export function demoState():State{
 let s=emptyState();s.company.name="M.George Vitvaror AB · demo";const day=today(),offset=(n:number)=>{let d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const rows=[['receivable','Exempelkund Andersson','1001',187500,-8],['receivable','Exempelkund Berg','1002',649500,5],['receivable','Exempelkund Lind','1003',320000,-3],['payable','Exempelleverantör Service','L-2026-10',420000,2],['payable','Exempelleverantör Transport','L-421',98000,-2]];
 for(const[direction,party,number,total,due]of rows)s=applyCommand(s,{type:'invoice.save',invoice:{direction,party,number,total,issued:offset(-25),due:offset(due as number),ocr:direction==='receivable'?String(number)+'9':'',reviewed:true,email:'',source:'Fiktivt exempel'}}).state;
 s=applyCommand(s,{type:'transactions.import',name:'Fiktiva exempel',rows:[{date:offset(-2),amount:187500,party:'Exempelkund Andersson',payerReference:'10019',kind:'payment',verified:true},{date:offset(-1),amount:100000,party:'Exempelkund Lind',payerReference:'10039',kind:'payment',verified:true},{date:offset(-5),amount:717916,description:'Bankgiro inbetalning',bankReference:'EXEMPEL-BG',kind:'unknown'}]}).state;
 s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:s.transactions[0].id,amount:187500,note:'Fiktivt exempel: OCR och belopp'}).state;
 s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[2].id,transactionId:s.transactions[1].id,amount:100000,note:'Fiktivt exempel: delbetalning'}).state;return s;
}
