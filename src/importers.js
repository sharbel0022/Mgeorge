/**
 * MG FAKTURAKOLL – BANKFILER / FORMAT
 * ANSVAR: Tolkar CSV och ISO 20022 camt.053/camt.054 och normaliserar datum, belopp, riktning och referenser. Samlade Bankgiroposter kräver säkra detaljuppgifter.
 * FLÖDE: Fil → importers.js → kontroll och förhandsgranskning i server.js → lagring i db.js.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

// Bank files are untrusted data. Never evaluate XML, resolve entities or infer
// individual payments from a collective entry without individual amounts.
export function parseMoney(value) {
  if(typeof value==='number') {
    const cents=Math.round(value*100);
    if(!Number.isFinite(value)||!Number.isSafeInteger(cents))throw new Error('Ogiltigt eller för stort belopp');
    return cents;
  }
  let s=String(value??'').trim().replace(/\s|\u00a0/g,'').replace(/kr|SEK/gi,'');
  if(!s)throw new Error('Tomt belopp');
  let negative=false;
  if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1);}
  if(s.startsWith('-')){negative=!negative;s=s.slice(1);}else if(s.startsWith('+'))s=s.slice(1);
  if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
  else if(s.includes(','))s=s.replace(',','.');
  else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw new Error('Ogiltigt belopp: '+value);
  const [whole,dec='']=s.split('.');const cents=Number(whole)*100+Number(dec.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents))throw new Error('För stort belopp');
  return negative?-cents:cents;
}
function normalizeDate(value){
  const s=String(value??'').trim();let date;
  if(/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2})/.test(s))date=s.slice(0,10);
  else {
    const m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if(m)date=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  const time=date?Date.parse(date+'T00:00:00Z'):NaN;
  if(!date||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date)throw new Error('Ogiltigt datum: '+s);
  return date;
}
function csvRows(text,delimiter){
  const rows=[];let cells=[],value='',quoted=false;
  text=String(text).replace(/^\ufeff/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){cells.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){cells.push(value);if(cells.some(x=>x.trim()))rows.push(cells);cells=[];value='';if(c==='\r'&&text[i+1]==='\n')i++;}
    else value+=c;
  }
  if(quoted)throw new Error('Felaktig CSV: oavslutade citattecken');
  cells.push(value);if(cells.some(x=>x.trim()))rows.push(cells);
  return rows;
}
const aliases={
  date:['bokföringsdatum','bokforingsdatum','datum','date','booking date','transaction date','transaktionsdatum'],
  amount:['belopp','amount','transaktionsbelopp','summa','change'],
  debit:['debet','ut','debit','withdrawal','utbetalning'],
  credit:['kredit','in','credit','deposit','inbetalning'],
  currency:['valuta','currency','ccy'],
  payer:['avsändare','avsandare','betalare','mottagare','namn','motpart','counterparty','payer'],
  payer_organization_number:['organisationsnummer','organisationsnr','orgnr','payer_organization_number'],
  reference:['ocr','referens','fakturareferens','betalningsreferens','betalningsreferens / ocr','meddelande','payment reference','referensnummer'],
  bank_reference:['bankreferens','bank reference','transaktionsid','transaktions-id','transaction id','id'],
  bankgiro:['bankgiro','bankgironummer','företagets bankgiro','foretagets bankgiro'],
  description:['text','beskrivning','information','description','detaljer','typ','transaktionstext']
};
function norm(v){return String(v).toLowerCase().trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ');}
function col(headers,key){return headers.findIndex(x=>aliases[key].some(a=>norm(a)===x));}
function sek(value){const currency=String(value||'SEK').toUpperCase();if(currency!=='SEK')throw new Error(`Valutan ${currency} stöds inte. Importera ett konto i SEK.`);return currency;}
export function parseCSV(text,account='Swedbank'){
  const first=String(text).split(/\r?\n/).find(x=>x.trim())||'';
  const delimiter=[';','\t',','].reduce((a,b)=>first.split(b).length>first.split(a).length?b:a,';');
  const rows=csvRows(text,delimiter);if(rows.length<2)throw new Error('Bankfilen saknar transaktioner');
  const headers=rows[0].map(norm);const idx={};for(const key of Object.keys(aliases))idx[key]=col(headers,key);
  if(idx.date<0||idx.amount<0&&(idx.credit<0||idx.debit<0))throw new Error('CSV måste innehålla datum och belopp (eller debet/kredit)');
  const items=[];
  for(const [index,row] of rows.slice(1).entries()){
    const g=k=>idx[k]>=0?String(row[idx[k]]??'').trim():'';
    if(!g('date')&&!g('amount')&&!g('credit')&&!g('debit'))continue;
    if(!g('date')||(!g('amount')&&!g('credit')&&!g('debit')))throw new Error(`Datum eller belopp saknas på CSV-rad ${index+2}`);
    let cents;
    if(g('amount'))cents=parseMoney(g('amount'));
    else {
      const credit=g('credit')?Math.abs(parseMoney(g('credit'))):0,debit=g('debit')?Math.abs(parseMoney(g('debit'))):0;
      if(credit&&debit)throw new Error(`Både debet och kredit finns på CSV-rad ${index+2}; kontrollera filen.`);
      cents=credit-debit;
    }
    if(!cents)continue;
    const description=g('description'),payer=g('payer'),reference=g('reference');
    const collective=requiresPaymentSpecification(description,payer,reference);
    items.push({account,booked_at:normalizeDate(g('date')),amount_cents:cents,currency:sek(g('currency')),payer,payer_organization_number:g('payer_organization_number'),reference,bank_reference:g('bank_reference'),bankgiro:g('bankgiro'),description,...(collective?aggregateFlags():{})});
  }
  return validateItems(items);
}
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
function reference(node){return value(node,'RmtInf','Strd','CdtrRefInf','Ref')||children(path(node,'RmtInf'),'Ustrd').map(x=>x.text.trim()).join(' ');}
function bankId(s){return /^(NOTPROVIDED|NONREF|N\/A)$/i.test(s)?'':s;}
function detailId(node){return bankId(value(node,'Refs','AcctSvcrRef'))||bankId(value(node,'Refs','TxId'))||bankId(value(node,'Refs','EndToEndId'));}
function amountNode(node){return path(node,'AmtDtls','TxAmt','Amt')||path(node,'AmtDtls','InstdAmt','Amt')||path(node,'Amt');}
function requiresPaymentSpecification(description,payer,ref){
  const collection=/samlad|batch|samlingspost/i.test(description);
  const bankgiro=/bankgiro|bg\s*inbetalning/i.test(`${description} ${payer}`);
  const genericPayer=!payer||/^(bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg)$/i.test(payer.trim());
  return collection||bankgiro&&(genericPayer||!ref);
}
function aggregateFlags(reason='Betalardetaljer saknas – importera betalningsspecifikation.'){
  return {is_aggregate:true,needs_review:1,review_reason:reason,warnings:[reason]};
}
function validateItems(items){if(items.length>1000)throw new Error('Högst 1 000 bankhändelser per import');if(!items.length)throw new Error('Inga bokförda bankhändelser hittades');return items;}
export function parseCAMT(xml,account='Swedbank'){
  const document=xmlTree(xml);
  if(document.name!=='Document'||!document.children.some(x=>['BkToCstmrStmt','BkToCstmrDbtCdtNtfct'].includes(x.name)))throw new Error('Endast ISO 20022 camt.053/054 stöds');
  const items=[];
  for(const entry of descendants(document,'Ntry')){
    const status=value(entry,'Sts','Cd')||value(entry,'Sts');if(status&&status!=='BOOK')continue;
    const direction=value(entry,'CdtDbtInd');if(!['CRDT','DBIT'].includes(direction))throw new Error('Bokföringsriktning saknas i XML-filen');
    const sign=direction==='DBIT'?-1:1;
    const date=normalizeDate(value(entry,'BookgDt','Dt')||value(entry,'BookgDt','DtTm')||value(entry,'ValDt','Dt')||value(entry,'ValDt','DtTm'));
    const entryAmount=path(entry,'Amt');if(!entryAmount)throw new Error('Belopp saknas i bankpost');
    const currency=sek(entryAmount.attributes.Ccy),total=Math.abs(parseMoney(entryAmount.text));
    if(!total)continue;
    const details=children(entry,'NtryDtls').flatMap(x=>children(x,'TxDtls'));
    const parentReference=bankId(value(entry,'AcctSvcrRef'))||bankId(value(entry,'NtryRef'));
    const description=value(entry,'AddtlNtryInf');
    const common={account,booked_at:date,amount_cents:total*sign,currency,payer:'',reference:'',bank_reference:parentReference,description};
    const batchCount=Number(value(entry,'NtryDtls','Btch','NbOfTxs')),knownBatch=batchCount>1;
    const amounts=details.map(amountNode);
    for(const amount of amounts)if(amount)sek(amount.attributes.Ccy||currency);
    // Child amounts are mandatory for splitting a collective entry. Preserve the
    // collective amount once when the bank omitted them or provided inconsistent sums.
    const invalidSplit=details.length>1&&(amounts.some(x=>!x)||amounts.reduce((s,x)=>s+Math.abs(parseMoney(x.text)),0)!==total);
    if(invalidSplit||knownBatch&&details.length!==batchCount){
      items.push({...common,...aggregateFlags('Samlad bankpost saknar fullständig betalningsspecifikation. Beloppet har behållits en gång.'),aggregate_parent_reference:parentReference});continue;
    }
    if(!details.length){
      const collective=knownBatch||/bankgiro|bg\s*inbetalning|samlad|batch/i.test(description);
      items.push({...common,...(collective?{...aggregateFlags(),aggregate_parent_reference:parentReference}:{})});continue;
    }
    const identifiers=new Set(),detailIds=details.map(detailId);
    for(const [index,detail] of details.entries()){
      const amount=amounts[index];if(amount)sek(amount.attributes.Ccy||currency);
      const cents=amount?Math.abs(parseMoney(amount.text)):total;
      if(details.length===1&&cents!==total)throw new Error('Betalningsbeloppet stämmer inte med bankpostens totalbelopp');
      const detailDirection=value(detail,'CdtDbtInd');if(detailDirection&&detailDirection!==direction)throw new Error('Motstridiga betalningsriktningar i XML-filen');
      const party=sign>0?'Dbtr':'Cdtr';
      const payer=value(detail,'RltdPties',party,'Nm')||value(detail,'RltdPties',party,'Pty','Nm');
      const ref=reference(detail),specific=detailIds[index];
      const uniqueSpecific=specific&&detailIds.filter(x=>x===specific).length===1;
      const groupReference=parentReference||specific;
      let id=(uniqueSpecific?specific:'')||(details.length===1?parentReference:groupReference?`${groupReference}:${ref||'post'}:${sign*cents}`:'');
      if(id&&identifiers.has(id))id+=`:del${index+1}`;
      identifiers.add(id);
      items.push({...common,amount_cents:cents*sign,payer,reference:ref,bank_reference:id,description:description||value(detail,'AddtlTxInf'),...(details.length>1?{parent_bank_reference:parentReference}:{})});
    }
  }
  return validateItems(items);
}
/** Väljer parser för det uppladdade bankformatet och omvandlar resultatet till gemensamma transaktionsfält. */
export function parseBankFile(name,base64,account='Swedbank'){
  if(!/^[\w\p{L}(). -]+\.(csv|xml)$/iu.test(String(name)))throw new Error('Välj CSV eller XML');
  if(typeof base64!=='string'||base64.length>20_000_000||!base64.length||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('Fil saknas eller är för stor eller felaktig');
  const bytes=Buffer.from(base64,'base64');if(bytes.length>15_000_000)throw new Error('Max 15 MB');
  const text=bytes.toString('utf8');
  return name.toLowerCase().endsWith('.xml')?parseCAMT(text,account):parseCSV(text,account);
}
export function normalizeBankApiTransaction(x,account){
  // Enable Banking requires a status. Never treat missing/unknown status as booked.
  if(!x||x.status!=='BOOK')return null;
  const amount=parseMoney(x.transaction_amount?.amount);if(!amount)return null;
  if(!['CRDT','DBIT'].includes(x.credit_debit_indicator))throw new Error('Banken returnerade en okänd betalningsriktning');
  const sign=x.credit_debit_indicator==='DBIT'?-1:1;
  const text=value=>typeof value==='string'?value.trim():'';
  const payer=text(sign>0?x.debtor?.name:x.creditor?.name);
  const remittance=Array.isArray(x.remittance_information)?x.remittance_information.map(text).filter(Boolean).join(' '):'';
  const ref=text(x.reference_number)||remittance;
  const description=[text(x.bank_transaction_code?.description),remittance,text(x.note)].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' · ');
  const ownSide=sign>0?'creditor':'debtor',additional=x[`${ownSide}_account_additional_identification`];
  const identifiers=[x[`${ownSide}_account`]?.other,...(Array.isArray(additional)?additional:additional?[additional]:[])];
  const bankgiro=text(identifiers.find(id=>/^(BGNR|BANKGIRO)$/i.test(text(id?.scheme_name)))?.identification);
  if(!text(x.transaction_amount?.currency))throw new Error('Banken returnerade en transaktion utan valuta');
  // Per the official Transaction schema, transaction_id is a transient detail
  // lookup ID. Only entry_reference is immutable across renewed bank sessions.
  return {account,booked_at:normalizeDate(x.booking_date||x.value_date),amount_cents:Math.abs(amount)*sign,currency:sek(x.transaction_amount.currency),payer,reference:ref,bank_reference:bankId(text(x.entry_reference)),provider_transaction_id:text(x.transaction_id),bankgiro,description,...(requiresPaymentSpecification(description,payer,text(x.reference_number))?aggregateFlags():{})};
}
