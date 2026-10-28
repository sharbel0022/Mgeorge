// Shared, bounded XML reader for the supported generic ISO profiles. This is
// deliberately not an XSD or Swedbank MIG validator; unknown profiles fail closed.
const reportChildren=['Id','ElctrncSeqNb','LglSeqNb','CreDtTm','FrToDt','CpyDplctInd','RptgSrc','Acct','RltdAcct','Intrst','Bal','TxsSummry','Ntry','AddtlStmtInf','AddtlNtfctnInf'];
const allowed={
 BkToCstmrStmt:['GrpHdr','Stmt'],BkToCstmrDbtCdtNtfctn:['GrpHdr','Ntfctn'],Stmt:reportChildren,Ntfctn:reportChildren,
 Ntry:['NtryRef','Amt','CdtDbtInd','RvslInd','Sts','BookgDt','ValDt','AcctSvcrRef','Avlbty','BkTxCd','ComssnWvrInd','AddtlInfInd','AmtDtls','Chrgs','TechInptChanl','Intrst','CardTx','NtryDtls','AddtlNtryInf'],
 NtryDtls:['Btch','TxDtls'],Btch:['MsgId','PmtInfId','NbOfTxs','TtlAmt','CdtDbtInd'],
 TxDtls:['Refs','Amt','AmtDtls','Avlbty','CdtDbtInd','RvslInd','BkTxCd','Chrgs','Intrst','RltdPties','RltdAgts','Purp','RltdRmtInf','RmtInf','RltdDts','RltdPric','RltdQties','FinInstrmId','Tax','RtrInf','CorpActn','SfkpgAcct','CshDpst','CardTx','AddtlTxInf','SplmtryData'],
 Refs:['MsgId','AcctSvcrRef','PmtInfId','InstrId','EndToEndId','UETR','TxId','MndtId','ChqNb','ClrSysRef','AcctOwnrTxId','AcctSvcrTxId','MktInfrstrctrTxId','PrcgId','Prtry'],
 RltdRmtInf:['RmtId','RmtLctnDtls','RmtLctnMtd','RmtLctnElctrncAdr','RmtLctnPstlAdr'],RmtLctnDtls:['Mtd','ElctrncAdr','PstlAdr'],
 BookgDt:['Dt','DtTm'],ValDt:['Dt','DtTm'],RmtInf:['Strd','Ustrd'],Strd:['RfrdDocInf','RfrdDocAmt','CdtrRefInf','Invcr','Invcee','AddtlRmtInf','TaxRmt','GrnshmtRmt'],CdtrRefInf:['Tp','Ref'],AmtDtls:['TxAmt','InstdAmt']
};
const scalarFields=new Set(['Amt','TtlAmt','CdtDbtInd','RvslInd','Nm','Ref','Nb','AcctSvcrRef','NtryRef','TxId','EndToEndId','IBAN','Dt','DtTm','Ustrd','NbOfTxs']);
// Only interpreted remittance structures enter the recursive reference extractor.
// Other ISO remittance blocks need explicit support before becoming bank proof.
const remittanceFields={RmtInf:['Strd','Ustrd'],Strd:['RfrdDocInf','CdtrRefInf','AddtlRmtInf'],RfrdDocInf:['Tp','Nb','RltdDt'],CdtrRefInf:['Tp','Ref'],Tp:['CdOrPrtry','Issr'],CdOrPrtry:['Cd','Prtry'],Ustrd:[],AddtlRmtInf:[],Nb:[],RltdDt:[],Ref:[],Issr:[],Cd:[],Prtry:[]};
const supported=new Set(['053.001.02','054.001.02','053.001.08','054.001.08'].map(v=>'urn:iso:std:iso:20022:tech:xsd:camt.'+v));
const xmlChar=n=>n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff;
function decodeXML(s){
 if(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(s))throw Error('Ogiltig XML-entitet.');
 return s.replace(/&([^;]+);/g,(_,name)=>{
  const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(Object.hasOwn(known,name))return known[name];
  const n=/^#x[\da-f]+$/i.test(name)?parseInt(name.slice(2),16):/^#\d+$/.test(name)?Number(name.slice(1)):NaN;
  if(!Number.isInteger(n)||!xmlChar(n))throw Error('Ogiltig XML-entitet.');return String.fromCodePoint(n);
 });
}
export function readCamtDocument(xml){
 if(typeof xml!=='string'||xml.length>15*1024*1024)throw Error('Bankfilen är för stor.');
 if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml))throw Error('XML med DTD eller externa referenser tillåts inte.');
 const declaredEncoding=xml.match(/^\ufeff?<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1];
 if(declaredEncoding&&!/^utf-?8$/i.test(declaredEncoding))throw Error('XML-kodningen stöds inte. Använd bankens UTF-8-original.');
 for(const c of xml)if(!xmlChar(c.codePointAt(0)))throw Error('Ogiltigt tecken i XML.');
 const root={name:'#root',children:[],text:'',namespaces:{xml:'http://www.w3.org/XML/1998/namespace'}},stack=[root];let pos=0,count=0;
 while(pos<xml.length){
  if(xml.startsWith('<!--',pos)){const end=xml.indexOf('-->',pos+4);if(end<0||xml.slice(pos+4,end).includes('--'))throw Error('Ogiltig XML-kommentar.');pos=end+3;continue;}
  if(xml.startsWith('<?',pos)){const end=xml.indexOf('?>',pos+2);if(end<0||pos!==0&&!/^\ufeff$/.test(xml.slice(0,pos))||!/^<\?xml\s/.test(xml.slice(pos,end)))throw Error('Ogiltig XML-deklaration.');pos=end+2;continue;}
  if(xml.startsWith('<![CDATA[',pos)){const end=xml.indexOf(']]>',pos+9);if(end<0||stack.length===1)throw Error('Ogiltig XML.');stack.at(-1).text+=xml.slice(pos+9,end);pos=end+3;continue;}
  if(xml[pos]!=='<'){
   let end=xml.indexOf('<',pos);if(end<0)end=xml.length;const v=xml.slice(pos,end);
   if(v.includes(']]>')||stack.length===1&&v.replace(/^\ufeff/,'').trim())throw Error('Text utanför XML-dokumentet.');
   stack.at(-1).text+=decodeXML(v);pos=end;continue;
  }
  let end=pos+1,quote='';for(;end<xml.length;end++){const c=xml[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
  if(end===xml.length)throw Error('Ofullständig XML-tagg.');const token=xml.slice(pos,end+1);pos=end+1;
  const closing=token.match(/^<\/([A-Za-z_][\w.:-]*)\s*>$/);
  if(closing){if(stack.length===1||stack.at(-1).qualified!==closing[1])throw Error('Felaktig XML-struktur.');stack.pop();continue;}
  const opening=token.match(/^<([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/);if(!opening)throw Error('Ogiltig XML-tagg.');
  const attributes={};let rest=opening[2];
  while(rest.trim()){
   const m=rest.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"<]*"|'[^'<]*')/);
   if(!m||Object.hasOwn(attributes,m[1]))throw Error('Ogiltiga XML-attribut.');attributes[m[1]]=decodeXML(m[2].slice(1,-1));rest=rest.slice(m[0].length);
  }
  const qualified=opening[1],parts=qualified.split(':');if(parts.length>2)throw Error('Ogiltigt XML-namn.');
  const namespaces={...stack.at(-1).namespaces};for(const [key,uri]of Object.entries(attributes))if(key==='xmlns'||key.startsWith('xmlns:'))namespaces[key==='xmlns'?'':key.slice(6)]=uri;
  if(namespaces.xml!=='http://www.w3.org/XML/1998/namespace')throw Error('Ogiltig XML-namnrymd.');
  const expandedAttributes=new Set();
  for(const key of Object.keys(attributes).filter(key=>key!=='xmlns'&&!key.startsWith('xmlns:'))){
   const parts=key.split(':');if(parts.length>2||parts.length===2&&!namespaces[parts[0]])throw Error('Odeklarerad XML-attributnamnrymd.');
   const expanded=parts.length===2?`${namespaces[parts[0]]}:${parts[1]}`:`:${key}`;
   if(expandedAttributes.has(expanded))throw Error('Upprepade XML-attribut.');expandedAttributes.add(expanded);
  }
  const prefix=parts.length===2?parts[0]:'';if(prefix&&!namespaces[prefix])throw Error('Odeklarerad XML-namnrymd.');
  const node={name:parts.at(-1),qualified,namespace:namespaces[prefix]||'',namespaces,attributes,children:[],text:''};stack.at(-1).children.push(node);count++;
  if(count>150000||stack.length>80)throw Error('XML-strukturen är för stor eller för djup.');if(!opening[3])stack.push(node);
 }
 if(stack.length!==1||root.children.length!==1)throw Error('Ofullständigt XML-dokument.');const doc=root.children[0];
 if(doc.name!=='Document'||!supported.has(doc.namespace))throw Error('ISO 20022-namnrymd eller meddelandeversion stöds inte. Använd en stödd camt.053/.054 .02 eller .08.');
 const container=doc.namespace.includes('camt.053.')?'BkToCstmrStmt':'BkToCstmrDbtCdtNtfctn',report=container==='BkToCstmrStmt'?'Stmt':'Ntfctn';
 const walk=(node,inRemittance=false)=>{
  inRemittance||=node.name==='RmtInf';
  if(!inRemittance&&['CdtrRefInf','RfrdDocInf'].includes(node.name))throw Error('XML-referens ligger utanför den stödda betalningsstrukturen.');
  if(node.namespace!==doc.namespace)throw Error('Främmande eller saknad XML-namnrymd i bankunderlaget.');
  if(node.children.length&&node.text.trim())throw Error('Tvetydig XML: blandad text och struktur i '+node.name+'.');
  const accepted=inRemittance?remittanceFields[node.name]:node.name==='Document'?[container]:allowed[node.name];
  if(inRemittance&&!accepted)throw Error('Okänd XML-struktur i betalningsreferensen. Granska bankoriginalet.');
  if(accepted&&node.children.some(c=>!accepted.includes(c.name)))throw Error('Okänd XML-struktur i '+node.name+'. Granska bankoriginalet.');
  // Returns/corrections and extensions need their own bank-agreed semantics.
  if(['RtrInf','SplmtryData'].includes(node.name))throw Error('XML med återföringsinformation eller okänd utökning behöver separat granskning.');
  if(scalarFields.has(node.name)&&node.children.length)throw Error('Okänd XML-struktur i bankfältet '+node.name+'.');
  const singletons=new Set();for(const child of node.children)if(child.name!=='Ustrd'&&scalarFields.has(child.name)){if(singletons.has(child.name))throw Error('Tvetydig XML: flera '+child.name+'-fält i samma bankuppgift.');singletons.add(child.name);}
  if(['BookgDt','ValDt'].includes(node.name)&&node.children.length!==1)throw Error('Tvetydigt datumval i XML.');
  if(node.name==='Id'&&node.children.some(c=>c.name==='IBAN')&&node.children.some(c=>c.name==='Othr'))throw Error('Tvetydiga kontoidentiteter i XML.');
  if(['Dbtr','Cdtr'].includes(node.name)&&node.children.some(c=>c.name==='Nm')&&node.children.some(c=>c.name==='Pty'))throw Error('Tvetydig betalaridentitet i XML.');
  if(inRemittance&&node.name==='CdOrPrtry'&&(node.children.length!==1||!node.children[0].text.trim()))throw Error('Tvetydig XML-referenstyp.');
  for(const c of node.children)walk(c,inRemittance);
 };walk(doc);
 if(doc.children.length!==1)throw Error('Tvetydig XML: flera meddelandestrukturer.');
 const envelope=xmlPath(doc,container);if(!envelope||!xmlChildren(envelope,report).length)throw Error('ISO 20022-rapportstruktur saknas.');
 return doc;
}
export const xmlChildren=(node,name)=>(node?.children||[]).filter(x=>x.name===name&&x.namespace===node.namespace);
export function xmlPath(node,...names){for(const name of names){const matches=xmlChildren(node,name);if(matches.length>1){if(name==='Othr'&&node?.name==='OrgId')return undefined;throw Error('Tvetydig XML: flera '+name+'-fält i samma bankuppgift.');}node=matches[0];}return node;}
export const xmlValue=(node,...names)=>xmlPath(node,...names)?.text.trim()||'';
export function xmlDescendants(node,name){return(node?.children||[]).flatMap(x=>x.name===name?[x]:xmlDescendants(x,name));}
export function camtRemittanceNodes(node,name){return xmlChildren(xmlPath(node,'RmtInf'),'Strd').flatMap(strd=>name==='CdtrRefInf'?[xmlPath(strd,name)].filter(Boolean):xmlChildren(strd,name));}
export function camtAmount(node){
 const choices=[xmlPath(node,'AmtDtls','TxAmt','Amt'),xmlPath(node,'AmtDtls','InstdAmt','Amt'),xmlPath(node,'Amt')].filter(Boolean);
 if(choices.length>1)throw Error('Tvetydiga individuella XML-belopp. Granska bankoriginalet.');return choices[0];
}
export function camtDate(node,field,required=false){
 const date=xmlPath(node,field);if(!date){if(required)throw Error('Bokföringsdatum saknas.');return '';}
 const raw=xmlValue(date,'Dt')||xmlValue(date,'DtTm'),isTime=!!xmlPath(date,'DtTm');
 const pattern=isTime?/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)?$/:/^\d{4}-\d{2}-\d{2}$/;
 const day=raw.slice(0,10),time=Date.parse(day+'T12:00:00Z');
 if(!pattern.test(raw)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==day)throw Error('Ogiltigt datum i bankunderlaget.');return day;
}
export function camtReportEvidence(doc,report,entry){
 const header=xmlPath(doc,doc.namespace.includes('camt.053.')?'BkToCstmrStmt':'BkToCstmrDbtCdtNtfctn','GrpHdr');
 // These are claimed identities in the retained file, not proof of its sender.
 const accountCurrency=xmlValue(report,'Acct','Ccy');if(accountCurrency&&accountCurrency!=='SEK')throw Error('Rapportkontots valuta är inte SEK.');
 return {profile:'generic-iso-2026-10-28.1',namespace:doc.namespace,messageId:xmlValue(header,'MsgId'),reportId:xmlValue(report,'Id'),createdAt:xmlValue(header,'CreDtTm'),accountServicer:xmlValue(report,'Acct','Svcr','FinInstnId','BICFI')||xmlValue(report,'Acct','Svcr','FinInstnId','BIC'),entryReference:xmlValue(entry,'AcctSvcrRef')||xmlValue(entry,'NtryRef'),valueDate:camtDate(entry,'ValDt')};
}
export function validateCamtBatches(entry){
 const declared=[];
 for(const group of xmlChildren(entry,'NtryDtls')){
  const batch=xmlPath(group,'Btch');if(!batch)continue;const details=xmlChildren(group,'TxDtls'),count=xmlPath(batch,'NbOfTxs');
  if(count){const raw=count.text.trim();if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)throw Error('Ogiltigt antal betalningar i XML.');if(Number(raw)!==details.length)throw Error('Specifikationen är ofullständig: antal betalningar stämmer inte.');declared.push(Number(raw));}
  const direction=xmlValue(batch,'CdtDbtInd');if(direction&&direction!==xmlValue(entry,'CdtDbtInd'))throw Error('Motstridiga betalningsriktningar i XML-batch.');
  const total=xmlPath(batch,'TtlAmt');if(total){
   const amount=n=>{if(n?.attributes.Ccy!=='SEK'||!/^\d+(?:\.\d{1,2})?$/.test(n.text.trim()))throw Error('Ogiltigt belopp eller valuta i XML-batch.');const [a,b='']=n.text.trim().split('.'),sum=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(sum))throw Error('För stort belopp i XML-batch.');return sum;};
   if(details.some(d=>!camtAmount(d))||details.reduce((n,d)=>n+amount(camtAmount(d)),0)!==amount(total))throw Error('Specifikationen är ofullständig: batchens totalbelopp stämmer inte.');
  }
 }
 return declared;
}
export function decodeCamtBytes(bytes){
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('XML-originalets UTF-8-kodning är skadad eller stöds inte. Ingen import har gjorts.');}
}
