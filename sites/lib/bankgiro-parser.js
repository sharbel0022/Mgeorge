function decodeXML(s){
  return s.replace(/&([^;]+);/g,(_,name)=>{
    const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(Object.hasOwn(known,name))return known[name];
    const num=/^#x[\da-f]+$/i.test(name)?parseInt(name.slice(2),16):/^#\d+$/.test(name)?Number(name.slice(1)):NaN;
    if(!Number.isInteger(num)||num<=0||num>0x10ffff||num>=0xd800&&num<=0xdfff)throw new Error('Ogiltig XML-entitet');
    return String.fromCodePoint(num);
  });
}
// A bounded, non-resolving XML reader. Local names support both default and
// prefixed ISO 20022 namespaces; parent/child paths never match descendants by accident.
function xmlTree(xml){
  if(typeof xml!=='string'||xml.length>15*1024*1024)throw new Error('Bankfilen är för stor');
  if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml))throw new Error('XML med DTD eller externa referenser tillåts inte');
  const root={name:'#root',children:[],text:''},stack=[root];let pos=0,count=0;
  while(pos<xml.length){
    if(xml.startsWith('<!--',pos)){const end=xml.indexOf('-->',pos+4);if(end<0)throw new Error('Ofullständig XML-kommentar');pos=end+3;continue;}
    if(xml.startsWith('<?',pos)){const end=xml.indexOf('?>',pos+2);if(end<0)throw new Error('Ofullständig XML-deklaration');pos=end+2;continue;}
    if(xml.startsWith('<![CDATA[',pos)){const end=xml.indexOf(']]>',pos+9);if(end<0||stack.length===1)throw new Error('Ogiltig XML');stack.at(-1).text+=xml.slice(pos+9,end);pos=end+3;continue;}
    if(xml[pos]!=='<'){
      let end=xml.indexOf('<',pos);if(end<0)end=xml.length;const value=xml.slice(pos,end);
      if(stack.length===1&&value.replace(/^\ufeff/,'').trim())throw new Error('Text utanför XML-dokumentet');
      stack.at(-1).text+=decodeXML(value);pos=end;continue;
    }
    let end=pos+1,quote='';
    for(;end<xml.length;end++){const c=xml[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===xml.length)throw new Error('Ofullständig XML-tagg');
    const token=xml.slice(pos,end+1);pos=end+1;
    const closing=token.match(/^<\/([A-Za-z_][\w.:-]*)\s*>$/);
    if(closing){if(stack.length===1||stack.at(-1).qualified!==closing[1])throw new Error('Felaktig XML-struktur');stack.pop();continue;}
    const opening=token.match(/^<([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/);
    if(!opening)throw new Error('Ogiltig XML-tagg');
    const attributes={};let rest=opening[2];
    while(rest.trim()){
      const match=rest.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/);
      if(!match||Object.hasOwn(attributes,match[1]))throw new Error('Ogiltiga XML-attribut');
      attributes[match[1]]=decodeXML(match[2].slice(1,-1));rest=rest.slice(match[0].length);
    }
    const node={name:opening[1].split(':').at(-1),qualified:opening[1],attributes,children:[],text:''};
    stack.at(-1).children.push(node);count++;
    if(count>150000||stack.length>80)throw new Error('XML-strukturen är för stor eller för djup');
    if(!opening[3])stack.push(node);
  }
  if(stack.length!==1||root.children.length!==1)throw new Error('Ofullständigt XML-dokument');
  return root.children[0];
}
const children=(node,name)=>(node?.children||[]).filter(x=>x.name===name);
function path(node,...names){for(const name of names)node=children(node,name)[0];return node;}
const value=(node,...names)=>path(node,...names)?.text.trim()||'';
function descendants(node,name){return node.children.flatMap(x=>x.name===name?[x]:descendants(x,name));}
const stable=s=>s&&!/^(NOTPROVIDED|NONREF|N\/A|NONE|NULL|UNKNOWN)$/i.test(s)?s:'';
function cents(s){if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Bankfilen innehåller ett ogiltigt belopp.');const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0||n>100_000_000_000)throw Error('Ogiltigt betalningsbelopp.');return n;}
function day(s){s=s.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Betalningsdatum saknas eller är ogiltigt.');return s;}
/** Same bounded parser runs in preview and on the server against the retained original. */
export function parseBankgiroXML(text,name='Bankgiro.xml'){
 const doc=xmlTree(text),namespace=Object.values(doc.attributes).find(v=>/camt\.(053|054)\./.test(v));
 if(doc.name!=='Document'||!namespace)throw Error('Välj en ISO 20022-fil av typen camt.053 eller camt.054.');
 const rows=[];
 for(const report of [...descendants(doc,'Stmt'),...descendants(doc,'Ntfctn')]){
  const account=value(report,'Acct','Id','IBAN')||value(report,'Acct','Id','Othr','Id');
  for(const entry of children(report,'Ntry')){
   if((value(entry,'Sts','Cd')||value(entry,'Sts'))!=='BOOK')throw Error('Filen måste innehålla bokförda transaktioner (BOOK).');
   if(value(entry,'RvslInd')==='true')throw Error('Återföringar behöver granskas separat.');
   const amt=path(entry,'Amt'),direction=value(entry,'CdtDbtInd');
   if(amt?.attributes.Ccy!=='SEK'||!['CRDT','DBIT'].includes(direction))throw Error('Belopp, SEK-valuta eller betalningsriktning saknas.');
   const sign=direction==='CRDT'?1:-1,amount=cents(amt.text.trim())*sign,date=day(value(entry,'BookgDt','Dt')||value(entry,'BookgDt','DtTm'));
   const parentReference=stable(value(entry,'AcctSvcrRef'))||stable(value(entry,'NtryRef')),details=descendants(entry,'TxDtls'),key=`entry-${rows.length}`;
   const base={date,amount,party:'',payerReference:'',bankReference:parentReference,parentBankReference:parentReference,description:value(entry,'AddtlNtryInf'),currency:'SEK',account,source:name,externalId:parentReference?`entry:${parentReference}`:'',kind:'batch',verified:false,key,specification:true,format:String(namespace),settlementDate:value(entry,'ValDt','Dt'),recipientBankgiro:'',payerBankgiro:'',organizationNumber:''};
   const count=descendants(entry,'NbOfTxs').map(x=>Number(x.text.trim()));
   if(count.some(n=>!Number.isInteger(n)||n<1)||count.length&&count.reduce((n,c)=>n+c,0)!==details.length)throw Error('Specifikationen är ofullständig: antal betalningar stämmer inte.');
   if(!details.length){rows.push({...base,specification:false});continue;}
   const parsed=details.map((tx,n)=>{
    const a=path(tx,'AmtDtls','TxAmt','Amt')||path(tx,'AmtDtls','InstdAmt','Amt')||path(tx,'Amt');
    if(details.length>1&&!a)throw Error('Specifikationen är ofullständig: individuellt belopp saknas.');
    if(a&&a.attributes.Ccy!=='SEK'||value(tx,'CdtDbtInd')&&value(tx,'CdtDbtInd')!==direction)throw Error('Kontrollera valuta och riktning i betalningsspecifikationen.');
    const party=path(tx,'RltdPties',sign>0?'Dbtr':'Cdtr'),partyNode=path(party,'Pty')||party;
    const referenceParts=[
     ...descendants(tx,'CdtrRefInf').map(x=>({value:stable(value(x,'Ref')),source:'RmtInf/Strd/CdtrRefInf/Ref',kind:'structured'})),
     ...children(path(tx,'RmtInf'),'Ustrd').map(x=>({value:stable(x.text.trim()),source:'RmtInf/Ustrd',kind:'message'})),
     ...descendants(tx,'RfrdDocInf').map(x=>({value:stable(value(x,'Nb')),source:'RmtInf/Strd/RfrdDocInf/Nb',kind:'document'}))
    ].filter(p=>p.value);
    const references=[...new Set(referenceParts.map(p=>p.value))];
    const payerReference=references.join('; ');
    if(referenceParts.length>20||payerReference.length>300)throw Error('För många eller för långa betalningsreferenser. Granska bankoriginalet.');
    const id=stable(value(tx,'Refs','AcctSvcrRef'))||stable(value(tx,'Refs','TxId'));
    const own=path(tx,'RltdPties',sign>0?'CdtrAcct':'DbtrAcct'),other=path(tx,'RltdPties',sign>0?'DbtrAcct':'CdtrAcct');
    const bg=acct=>/BGNR|BANKGIRO/i.test(value(acct,'Id','Othr','SchmeNm','Prtry')||value(acct,'Id','Othr','SchmeNm','Cd'))?value(acct,'Id','Othr','Id'):'';
    return {...base,key:`${key}-${n}`,parentKey:details.length>1?key:undefined,amount:a?cents(a.text.trim())*sign:amount,party:value(partyNode,'Nm'),referenceParts,payerReference:stable(payerReference),bankReference:id||parentReference,externalId:id?`transaction:${id}`:'',kind:'payment',recipientBankgiro:bg(own),payerBankgiro:bg(other),organizationNumber:value(partyNode,'Id','OrgId','Othr','Id'),specification:true};
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
 const rows=[];let row=[],cell='',quoted=false;
 for(let n=0;n<text.length;n++){const c=text[n];if(c==='"'){if(quoted&&text[n+1]==='"'){cell+='"';n++;}else quoted=!quoted;}else if(c===sep&&!quoted){row.push(cell.trim());cell='';}else if(c==='\n'&&!quoted){row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV-filen innehåller ett ofullständigt citattecken.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const headers=rows.shift()?.map(v=>v.toLocaleLowerCase('sv-SE').replace(/\s+/g,' ').trim())||[];
 const col=(...names)=>headers.findIndex(h=>names.includes(h)),idx={date:col('datum','betalningsdatum','bokföringsdatum','bokforingsdatum'),amount:col('belopp','inbetalningsbelopp'),party:col('avsändare','avsändarens namn','avsandare','betalare'),payerReference:col('betalningsreferens','betalningsreferens / ocr','ocr','ocr-nummer'),payerBankgiro:col('bankgironummer/avinummer','bankgironummer / avinummer','avsändarens bankgironummer','avinummer'),recipientBankgiro:col('mottagarens bankgiro','mottagarbankgiro'),account:col('mottagarkonto','mottagarens konto','konto','iban'),bankReference:col('bankreferens','insättningsreferens','insättnings-id'),externalId:col('betalnings-id','transaktions-id'),currency:col('valuta'),organizationNumber:col('organisationsnummer','organisationsnr')};
 if(idx.date<0||idx.amount<0||idx.party<0||idx.payerReference<0)throw Error('Bankgiro-CSV behöver kolumnerna datum, belopp, avsändare och betalningsreferens.');
 if(rows.length<1||rows.length>1000)throw Error('Välj 1–1 000 betalningar.');
 return rows.map((r,n)=>{const v=k=>idx[k]>=0?r[idx[k]]||'':'';const cur=v('currency').toUpperCase();if(cur!=='SEK')throw Error(`Rad ${n+2}: valuta saknas eller stöds inte. Ange SEK från originalunderlaget.`);let d=v('date');if(/^\d{2}[/.]\d{2}[/.]\d{4}$/.test(d))d=d.slice(6)+'-'+d.slice(3,5)+'-'+d.slice(0,2);const raw=v('amount').replace(/[\s\u00a0]/g,'').replace(',','.');return {date:day(d),amount:cents(raw),party:v('party'),payerReference:stable(v('payerReference')),payerBankgiro:v('payerBankgiro'),recipientBankgiro:v('recipientBankgiro'),account:v('account'),bankReference:v('bankReference'),parentBankReference:v('bankReference'),externalId:v('externalId'),organizationNumber:v('organizationNumber'),currency:'SEK',description:'Bankgiro betalningsspecifikation',source:name,kind:'payment',verified:false,specification:true,format:'Bankgiro CSV'};});
}
export function parseSpecificationBytes(bytes,name){
 if(bytes.byteLength<1||bytes.byteLength>15_000_000)throw Error('Välj en fil på högst 15 MB.');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
 if(/\.xml$/i.test(name))return parseBankgiroXML(text,name);
 if(/\.csv$/i.test(name))return parseBankgiroCSV(text,name);
 throw Error('Välj camt.054 XML eller Bankgiro CSV. Bilder och PDF behöver en betalningsspecifikation från banken.');
}

