import { createHash } from 'node:crypto';

export function parseMoney(value) {
  if(typeof value==='number' && Number.isFinite(value)) return Math.round(value*100);
  let s=String(value??'').trim().replace(/\s|\u00a0/g,'').replace(/kr|SEK/gi,'');
  if(!s)throw new Error('Tomt belopp');
  let negative=false;
  if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1);}
  if(s.startsWith('-')){negative=!negative;s=s.slice(1);}else if(s.startsWith('+'))s=s.slice(1);
  if(s.includes(',')&&s.includes('.')){
    s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
  } else if(s.includes(','))s=s.replace(',','.');
  else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw new Error('Ogiltigt belopp: '+value);
  const [whole,dec='']=s.split('.');const cents=Number(whole)*100+Number(dec.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents))throw new Error('För stort belopp');
  return negative?-cents:cents;
}
function normalizeDate(s){
  const t=String(s??'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(t))return t.slice(0,10);
  const m=t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  throw new Error('Ogiltigt datum: '+t);
}
function csvRows(text,delimiter){
  const rows=[];let cells=[],value='',quoted=false;
  text=String(text).replace(/^\ufeff/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
    } else if(c===delimiter&&!quoted){cells.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      cells.push(value);if(cells.some(x=>x.trim()))rows.push(cells);
      cells=[];value='';if(c==='\r'&&text[i+1]==='\n')i++;
    } else value+=c;
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
  payer:['avsändare','avsandare','betalare','mottagare','namn','motpart','counterparty','payer'],
  reference:['ocr','referens','fakturareferens','meddelande','payment reference','referensnummer'],
  bank_reference:['bankreferens','bank reference','transaktionsid','transaktions-id','transaction id','id'],
  description:['text','beskrivning','information','description','detaljer','typ','transaktionstext']
};
function norm(v){return String(v).toLowerCase().trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ');}
function col(headers,key){return headers.findIndex(x=>aliases[key].some(a=>norm(a)===x));}
export function parseCSV(text,account='Swedbank'){
  const first=text.split(/\r?\n/).find(x=>x.trim())||'';
  const delimiters=[';','\t',','];const delimiter=delimiters.reduce((a,b)=>(first.split(b).length>first.split(a).length?b:a),';');
  const rows=csvRows(text,delimiter);if(rows.length<2)throw new Error('Bankfilen saknar transaktioner');
  const headers=rows[0].map(norm);const idx={};for(const key of Object.keys(aliases))idx[key]=col(headers,key);
  if(idx.date<0||idx.amount<0&&(idx.credit<0||idx.debit<0))throw new Error('CSV måste innehålla datum och belopp (eller debet/kredit)');
  const items=[];
  for(const row of rows.slice(1)){
    const g=k=>idx[k]>=0?String(row[idx[k]]??'').trim():'';
    if(!g('date')||(!g('amount')&&!g('credit')&&!g('debit')))continue;
    let cents=g('amount')?parseMoney(g('amount')):g('credit')?Math.abs(parseMoney(g('credit'))):-Math.abs(parseMoney(g('debit')));
    if(cents===0)continue;
    items.push({account,booked_at:normalizeDate(g('date')),amount_cents:cents,currency:'SEK',payer:g('payer'),reference:g('reference'),bank_reference:g('bank_reference'),description:g('description')});
  }
  if(items.length>1000)throw new Error('Högst 1 000 bankhändelser per import');
  if(!items.length)throw new Error('Inga giltiga bankhändelser hittades');
  return items;
}
function chunks(xml,tag){
  const name=`(?:[A-Za-z_][\w-]*:)?${tag}`;
  const regex=new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`,'gi');
  return [...xml.matchAll(regex)].map(x=>x[1]);
}
function entity(s){return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
function tag(xml,name){return entity(chunks(xml,name)[0]?.replace(/<[^>]+>/g,'').trim()||'');}
function nested(xml,...names){let s=xml;for(const n of names){s=chunks(s,n)[0]||'';}return s;}
function firstPath(xml,...names){return entity(nested(xml,...names).replace(/<[^>]+>/g,'').trim());}
export function parseCAMT(xml,account='Swedbank'){
  if(xml.length>15*1024*1024)throw new Error('Bankfilen är för stor');
  if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml))throw new Error('XML med DTD eller externa referenser tillåts inte');
  if(!/<(?:\w+:)?Document\b/i.test(xml)||!/(BkToCstmrStmt|BkToCstmrDbtCdtNtfct)/.test(xml))throw new Error('Endast ISO 20022 camt.053/054 stöds');
  const entries=chunks(xml,'Ntry');const items=[];
  for(const entry of entries){
    const sign=tag(entry,'CdtDbtInd')==='DBIT'?-1:1;
    const date=firstPath(entry,'BookgDt','Dt')||firstPath(entry,'ValDt','Dt');
    if(!date)continue;
    const details=chunks(entry,'TxDtls');
    const parts=details.length?details:[entry];
    const fallbackAmount=firstPath(entry,'Amt');
    for(const detail of parts){
      const amount=firstPath(detail,'AmtDtls','TxAmt','Amt')||firstPath(detail,'AmtDtls','InstdAmt','Amt')||firstPath(detail,'Amt');
      const cents=parseMoney(amount||fallbackAmount);
      const innerSign=tag(detail,'CdtDbtInd')==='DBIT'?-1:sign;
      const debtor=firstPath(detail,'RltdPties','Dbtr','Nm');
      const creditor=firstPath(detail,'RltdPties','Cdtr','Nm');
      const payer=innerSign>0?debtor:creditor;
      const ref=firstPath(detail,'RmtInf','Strd','CdtrRefInf','Ref')||tag(nested(detail,'RmtInf'),'Ustrd');
      const bankReference=tag(detail,'AcctSvcrRef')||tag(entry,'AcctSvcrRef')||tag(detail,'EndToEndId');
      items.push({account,booked_at:normalizeDate(date),amount_cents:Math.abs(cents)*innerSign,currency:'SEK',payer,reference:ref,bank_reference:bankReference,description:tag(entry,'AddtlNtryInf')});
    }
  }
  if(items.length>1000)throw new Error('Högst 1 000 bankhändelser per import');
  if(!items.length)throw new Error('Inga bankhändelser hittades i XML-filen');
  return items;
}
export function parseBankFile(name,base64,account='Swedbank'){
  if(!/^[\w\p{L}(). -]+\.(csv|xml)$/iu.test(String(name)))throw new Error('Välj CSV eller XML');
  if(typeof base64!=='string'||base64.length>20_000_000)throw new Error('Fil saknas eller är för stor');
  const bytes=Buffer.from(base64,'base64');if(bytes.length>15_000_000)throw new Error('Max 15 MB');
  const text=bytes.toString('utf8');
  return name.toLowerCase().endsWith('.xml')?parseCAMT(text,account):parseCSV(text,account);
}
export function normalizeBankApiTransaction(x,account){
  if(x.status && x.status!=='BOOK')return null;
  const amount=parseMoney(x.transaction_amount?.amount);
  if(!amount)return null;
  const bankSign=x.credit_debit_indicator==='DBIT'?-1:1;
  return {account,booked_at:normalizeDate(x.booking_date||x.transaction_date||x.value_date),amount_cents:Math.abs(amount)*bankSign,currency:x.transaction_amount?.currency||'SEK',payer:bankSign>0?x.debtor?.name||'':x.creditor?.name||'',reference:x.reference_number||x.remittance_information?.join(' ')||'',bank_reference:x.transaction_id||x.entry_reference||'',description:x.note||''};
}
