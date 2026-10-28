import {extractPaymentReferences} from './payment-references.js';

import {readCamtDocument as xmlTree,xmlChildren as children,xmlPath as path,xmlValue as value,camtRemittanceNodes,camtAmount,camtDate,camtReportEvidence,validateCamtBatches,decodeCamtBytes} from './camt-xml.js';
function remittanceEvidence(node){
 const convert=n=>n.children.length?Object.fromEntries([...new Set(n.children.filter(c=>c.namespace===n.namespace).map(c=>c.name))].map(name=>[name,children(n,name).map(convert)])):n.text.trim();
 const OCR=camtRemittanceNodes(node,'CdtrRefInf').filter(n=>/^(?:SE)?OCR$/i.test(value(n,'Tp','CdOrPrtry','Prtry')||value(n,'Tp','CdOrPrtry','Cd'))).map(n=>value(n,'Ref'));
 return extractPaymentReferences({RmtInf:children(node,'RmtInf').map(convert),OCR,AddtlTxInf:value(node,'AddtlTxInf')});
}
const maskedAccount=acct=>{const id=value(acct,'Id','IBAN')||value(acct,'Id','Othr','Id');return id?'•••• '+id.replace(/[\s-]/g,'').slice(-4):'';};
const stable=s=>s&&!/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(s)?s:'';
function cents(s){if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Bankfilen innehåller ett ogiltigt belopp.');const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0||n>100_000_000_000)throw Error('Ogiltigt betalningsbelopp.');return n;}
function day(input,dateTime=false){
 const format=dateTime?/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)?$/:/^\d{4}-\d{2}-\d{2}$/;
 const s=input.slice(0,10);if(!format.test(input)||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Betalningsdatum saknas eller är ogiltigt.');return s;
}
/** Same bounded parser runs in preview and on the server against the retained original. */
export function parseBankgiroXML(text,name='Bankgiro.xml'){
 const doc=xmlTree(text),namespace=doc.namespace;

 const rows=[];
 const reports=namespace.includes('camt.053.')?children(path(doc,'BkToCstmrStmt'),'Stmt'):children(path(doc,'BkToCstmrDbtCdtNtfctn'),'Ntfctn');
 for(const report of reports){
  const account=value(report,'Acct','Id','IBAN')||value(report,'Acct','Id','Othr','Id');
  for(const entry of children(report,'Ntry')){
   if((value(entry,'Sts','Cd')||value(entry,'Sts'))!=='BOOK')throw Error('Filen måste innehålla bokförda transaktioner (BOOK).');
   const reversal=path(entry,'RvslInd');
   if(reversal&&!['false','0'].includes(reversal.text.trim()))throw Error('Återföringar eller ogiltig återföringsflagga behöver granskas separat.');
   const amt=path(entry,'Amt'),direction=value(entry,'CdtDbtInd');
   if(amt?.attributes.Ccy!=='SEK'||!['CRDT','DBIT'].includes(direction))throw Error('Belopp, SEK-valuta eller betalningsriktning saknas.');
   const sign=direction==='CRDT'?1:-1,amount=cents(amt.text.trim())*sign,date=camtDate(entry,'BookgDt',true),reportEvidence=camtReportEvidence(doc,report,entry);
   const parentReference=stable(value(entry,'AcctSvcrRef'))||stable(value(entry,'NtryRef')),details=children(entry,'NtryDtls').flatMap(x=>children(x,'TxDtls')),key=`entry-${rows.length}`;
   const base={date,amount,party:'',payerReference:'',bankReference:parentReference,parentBankReference:parentReference,description:value(entry,'AddtlNtryInf'),currency:'SEK',account,source:name,externalId:parentReference?`entry:${parentReference}`:'',kind:'batch',verified:false,key,specification:true,format:String(namespace),settlementDate:reportEvidence.valueDate,reportEvidence,recipientBankgiro:'',payerBankgiro:'',organizationNumber:''};
   validateCamtBatches(entry);
   if(!details.length){rows.push({...base,specification:false});continue;}
   const parsed=details.map((tx,n)=>{
    const reversal=path(tx,'RvslInd');if(reversal&&!['false','0'].includes(reversal.text.trim()))throw Error('Återförd betalningsdetalj eller ogiltig återföringsflagga behöver separat granskning.');
    const a=camtAmount(tx);
    if(details.length>1&&!a)throw Error('Specifikationen är ofullständig: individuellt belopp saknas.');
    if(a&&a.attributes.Ccy!=='SEK'||value(tx,'CdtDbtInd')&&value(tx,'CdtDbtInd')!==direction)throw Error('Kontrollera valuta och riktning i betalningsspecifikationen.');
    const party=path(tx,'RltdPties',sign>0?'Dbtr':'Cdtr'),partyNode=path(party,'Pty')||party;
    const referenceParts=[
     ...camtRemittanceNodes(tx,'CdtrRefInf').map(x=>({value:stable(value(x,'Ref')),source:'RmtInf/Strd/CdtrRefInf/Ref',kind:'structured'})),
     ...children(path(tx,'RmtInf'),'Ustrd').map(x=>({value:stable(x.text.trim()),source:'RmtInf/Ustrd',kind:'message'})),
     ...camtRemittanceNodes(tx,'RfrdDocInf').map(x=>({value:stable(value(x,'Nb')),source:'RmtInf/Strd/RfrdDocInf/Nb',kind:'document'}))
    ].filter(p=>p.value);
    const references=[...new Set(referenceParts.map(p=>p.value))],referenceEvidence=remittanceEvidence(tx);
    const payerReference=referenceEvidence.selected?.value||references.join('; ');
    if(referenceParts.length>20||references.join('; ').length>300)throw Error('För många eller för långa betalningsreferenser. Granska bankoriginalet.');
    const id=stable(value(tx,'Refs','AcctSvcrRef'))||stable(value(tx,'Refs','TxId'));
    const own=path(tx,'RltdPties',sign>0?'CdtrAcct':'DbtrAcct'),other=path(tx,'RltdPties',sign>0?'DbtrAcct':'CdtrAcct');
    const bg=acct=>/BGNR|BANKGIRO/i.test(value(acct,'Id','Othr','SchmeNm','Prtry')||value(acct,'Id','Othr','SchmeNm','Cd'))?value(acct,'Id','Othr','Id'):'';
    return {...base,key:`${key}-${n}`,parentKey:details.length>1?key:undefined,amount:a?cents(a.text.trim())*sign:amount,party:value(partyNode,'Nm'),referenceParts,referenceEvidence,payerReference:stable(payerReference),bankReference:id||parentReference,externalId:id?`transaction:${id}`:'',kind:'payment',recipientBankgiro:bg(own),payerBankgiro:bg(other),payerAccount:maskedAccount(other),remittanceMessage:children(path(tx,'RmtInf'),'Ustrd').map(x=>x.text.trim()).join('\n'),organizationNumber:value(partyNode,'Id','OrgId','Othr','Id')||value(partyNode,'Id','OrgId','AnyBIC'),specification:true};
   });
   if(parsed.reduce((n,r)=>n+r.amount,0)!==amount)throw Error('Specifikationen är ofullständig: summan av betalningarna stämmer inte med insättningen.');
   if(details.length>1)rows.push(base);rows.push(...parsed);
  }
 }
 if(!rows.length||rows.length>1000)throw Error('Välj en fil med 1–1 000 bankhändelser.');return rows;
}
export function parseBankgiroCSV(text,name='Bankgiro.csv'){
 const lines=text.replace(/^\ufeff/,'').split(/\r?\n/),start=lines.findIndex(l=>/datum/i.test(l)&&/belopp/i.test(l));
 if(start<0)throw Error('CSV-filen saknar datum- och beloppskolumner.');
 text=lines.slice(start).join('\n');const first=lines[start],sep=[';','\t',','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[];let row=[],cell='',quoted=false,closedQuote=false;
 for(let n=0;n<text.length;n++){
  const c=text[n];
  if(c==='"'){
   if(quoted){if(text[n+1]==='"'){cell+='"';n++;}else{quoted=false;closedQuote=true;}}
   else{if(cell.trim()||closedQuote)throw Error('CSV-filen innehåller ett felplacerat citattecken.');quoted=true;cell='';}
  }else if(c===sep&&!quoted){row.push(cell.trim());cell='';closedQuote=false;}
  else if(c==='\n'&&!quoted){row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';closedQuote=false;}
  else{if(closedQuote&&!/[\t\r ]/.test(c))throw Error('CSV-filen innehåller text efter ett avslutat citattecken.');cell+=c;}
 }
 if(quoted)throw Error('CSV-filen innehåller ett ofullständigt citattecken.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const headers=rows.shift()?.map(v=>v.toLocaleLowerCase('sv-SE').replace(/\s+/g,' ').trim())||[];
 const col=(...names)=>{const found=headers.map((h,n)=>names.includes(h)?n:-1).filter(n=>n>=0);if(found.length>1)throw Error('CSV-filen har tvetydiga kolumner för '+names[0]+'.');return found[0]??-1;},idx={date:col('datum','betalningsdatum','bokföringsdatum','bokforingsdatum'),amount:col('belopp','inbetalningsbelopp'),party:col('avsändare','avsändarens namn','avsandare','betalare'),payerReference:col('betalningsreferens','betalningsreferens / ocr','ocr','ocr-nummer'),payerBankgiro:col('bankgironummer/avinummer','bankgironummer / avinummer','avsändarens bankgironummer','avinummer'),recipientBankgiro:col('mottagarens bankgiro','mottagarbankgiro'),account:col('mottagarkonto','mottagarens konto','konto','iban'),bankReference:col('bankreferens','insättningsreferens','insättnings-id'),externalId:col('betalnings-id','transaktions-id'),currency:col('valuta'),organizationNumber:col('organisationsnummer','organisationsnr')};
 if(idx.date<0||idx.amount<0||idx.party<0||idx.payerReference<0)throw Error('Bankgiro-CSV behöver kolumnerna datum, belopp, avsändare och betalningsreferens.');
 if(rows.length<1||rows.length>1000)throw Error('Välj 1–1 000 betalningar.');
 if(rows.some(r=>r.length!==headers.length))throw Error('CSV-radernas kolumnantal stämmer inte med rubrikerna.');
 return rows.map((r,n)=>{const v=k=>idx[k]>=0?r[idx[k]]||'':'';const cur=v('currency').toUpperCase();if(cur!=='SEK')throw Error(`Rad ${n+2}: valuta saknas eller stöds inte. Ange SEK från originalunderlaget.`);let d=v('date');if(/^\d{2}[/.]\d{2}[/.]\d{4}$/.test(d))d=d.slice(6)+'-'+d.slice(3,5)+'-'+d.slice(0,2);const raw=v('amount').replace(/[\s\u00a0]/g,'').replace(',','.');return {date:day(d),amount:cents(raw),party:v('party'),payerReference:stable(v('payerReference')),payerBankgiro:v('payerBankgiro'),recipientBankgiro:v('recipientBankgiro'),account:v('account'),bankReference:v('bankReference'),parentBankReference:v('bankReference'),externalId:v('externalId'),organizationNumber:v('organizationNumber'),currency:'SEK',description:'Bankgiro betalningsspecifikation',source:name,kind:'payment',verified:false,specification:true,format:'Bankgiro CSV'};});
}
export function parseSpecificationBytes(bytes,name){
 if(bytes.byteLength<1||bytes.byteLength>15_000_000)throw Error('Välj en fil på högst 15 MB.');
 if(/\.xml$/i.test(name))return parseBankgiroXML(decodeCamtBytes(bytes),name);
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
 if(/\.csv$/i.test(name))return parseBankgiroCSV(text,name);
 throw Error('Välj camt.054 XML eller Bankgiro CSV. Bilder och PDF behöver en betalningsspecifikation från banken.');
}

