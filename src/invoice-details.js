// Source-bound invoice detail evidence. No balances, registration decisions or
// missing amounts are computed here. A recognized but incomplete table is held.
const supplierLabel='(?:leverantör|utställare|säljare|supplier|seller)';
const recipientLabel='(?:kund|fakturamottagare|mottagare|företags[ \\t]*namn|customer|recipient|bill[ \\t]+to)';
const supplierOwner='(?:leverantörens|utställarens|säljarens|supplier(?:[’\u0027]s)?|seller(?:[’\u0027]s)?)';
const recipientOwner='(?:kundens|mottagarens|fakturamottagarens|customer(?:[’\u0027]s)?|recipient(?:[’\u0027]s)?)';
const orgLabel='(?:org(?:anisations)?\\.?[ \\t]*(?:nr|nummer)|org\\.?[ \\t]*number|organi[sz]ation[ \\t]+number)';
const entityLabel='(?:'+supplierLabel+'|'+recipientLabel+')';
const knownField=/^(?:faktura(?:nummer|nr|datum)|invoice(?:\s*(?:number|no|date))?|förfallo(?:datum|dag)|förfaller|due\s*date|betalningsuppgifter|tilläggsinformation|payment details|netto|net amount|moms|vat|att betala|amount due|totalbelopp|bankgiro|bg\b|ocr\b|betalningsreferens|payment reference|valuta|currency)/iu;
const boundaryLabel=new RegExp('(?:[ \\t]*[;|][ \\t]*|[ \\t]+)(?=(?:'+entityLabel+'|(?:'+supplierOwner+'|'+recipientOwner+')[ \\t]+'+orgLabel+'|'+orgLabel+'|fakturanummer|fakturanr|invoice number|fakturadatum|invoice date|förfallodatum|due date|netto|net(?:[ \\t]+amount)?|total(?:[ \\t]+amount)?|moms|(?:total[ \\t]+)?vat(?:[ \\t]+amount)?|att betala|amount due|bankgiro|ocr|betalningsreferens|payment reference|valuta|currency)[ \\t]*[:#])','iu');
const nameValue=value=>value.length>=2&&value.length<=240&&/\p{L}/u.test(value)&&!/[?\uFFFD]/u.test(value)&&!/^(?:oläslig[ta]?|okänd|unknown|unreadable|n\/?a|null)$/iu.test(value)?value:null;
const dedupeEvidence=items=>[...new Map(items.map(item=>[`${item.page}:${item.line}`,item])).values()];

function linesOf(input){
  return String(input||'').slice(0,150000).replace(/\r\n?/g,'\n').split('\f').flatMap((page,p)=>page.split('\n').map((text,n)=>({page:p+1,line:n+1,text})));
}
function normalized(value){return String(value).normalize('NFKC').trim();}
function valueAfter(line,start,scalarBoundary){
  const rest=line.slice(start),known=rest.search(boundaryLabel),scalar=scalarBoundary(rest);
  const boundary=known<0?scalar:scalar<0?known:Math.min(known,scalar);
  return (boundary<0?rest:rest.slice(0,boundary)).trim();
}
function organizations(value,validOrganization){
  const match=value.match(/^(\d{6})(?:[ \t]*[-\u2010-\u2015\u2212][ \t]*|[ \t]+)?(\d{4})$/u);
  const result=match?match[1]+match[2]:null;
  return result&&validOrganization(result)?result:null;
}
function parseParties(lines,{direction,validOrganization,scalarBoundary=()=>-1},issues){
  const records={supplier:{names:[],organizations:[]},recipient:{names:[],organizations:[]}},unassigned=[];
  const namePattern=new RegExp('(?<![\\p{L}\\p{N}/_-])('+supplierLabel+'|'+recipientLabel+')(?:[ \\t]+(?:namn|name))?[ \\t]*:[ \\t]*','giu');
  const orgPattern=new RegExp('(?<![\\p{L}\\p{N}/_-])(?:(('+supplierOwner+')|('+recipientOwner+'))[ \\t]+)?'+orgLabel+'(?=[ \\t.:#]|$)[ \\t]*[:.#]?[ \\t]*','giu');
  const headingPattern=new RegExp('^('+supplierLabel+'|'+recipientLabel+')[ \\t]*:?$','iu');
  const isSupplier=value=>new RegExp('^'+supplierLabel+'$','iu').test(value);
  let section=null,page=0;
  for(let n=0;n<lines.length;n++){
    const source=lines[n],line=normalized(source.text);
    if(source.page!==page){page=source.page;section=null;}
    const names=[...line.matchAll(namePattern)].map(match=>({kind:'name',role:isSupplier(match[1])?'supplier':'recipient',index:match.index,end:match.index+match[0].length}));
    const orgs=[...line.matchAll(orgPattern)].map(match=>({kind:'organization',role:match[2]?'supplier':match[3]?'recipient':null,index:match.index,end:match.index+match[0].length}));
    const heading=line.match(headingPattern);
    if(heading&&!names.length){
      const role=isSupplier(heading[1])?'supplier':'recipient';
      const following=lines[n+1],next=following&&following.page===source.page&&following.line===source.line+1?normalized(following.text):'';
      const nextName=[...next.matchAll(namePattern)].find(match=>match.index===0);
      // A bare role heading can introduce a labelled name on the next line.
      // Colon labels already produced a name event and remain value-bearing.
      if(nextName&&(isSupplier(nextName[1])?'supplier':'recipient')===role){section=role;continue;}
      names.push({kind:'name',role,index:0,end:line.length});
    }
    const events=[...names,...orgs].sort((a,b)=>a.index-b.index);
    if(!events.length){if(knownField.test(line))section=null;continue;}
    for(let i=0;i<events.length;i++){
      const event=events[i];
      const raw=line.slice(event.end,i+1<events.length?events[i+1].index:line.length).replace(/[ \t;|]+$/u,'').trim();
      let value=valueAfter(raw,0,scalarBoundary),evidence=[source];
      if(!raw){
        const following=lines[n+1],next=following&&following.page===source.page&&following.line===source.line+1?normalized(following.text):'';
        if(next&&scalarBoundary(next)!==0&&!knownField.test(next)&&![...next.matchAll(namePattern)].length&&![...next.matchAll(orgPattern)].length&&!headingPattern.test(next)&&!next.includes('|')){value=next;evidence.push(following);}
      }
      if(event.kind==='name'){
        section=event.role;records[event.role].names.push({value:nameValue(value),evidence});
      }else{
        const record={value:organizations(value,validOrganization),evidence},role=event.role||section;
        if(role)records[role].organizations.push(record);else unassigned.push(record);
      }
    }
  }
  const namedRoles=Object.keys(records).filter(role=>records[role].names.length);
  if(unassigned.length){
    if(namedRoles.length===1)records[namedRoles[0]].organizations.push(...unassigned);
    else if(!namedRoles.length&&['supplier','customer'].includes(direction))records[direction==='customer'?'recipient':'supplier'].organizations.push(...unassigned);
    else issues.push('Organisationsnumrets roll är oklar mellan leverantör och mottagare. Kontrollera originalets identiteter.');
  }
  const resolve=(items,label)=>{
    if(!items.length)return null;
    if(items.some(item=>item.value===null)){issues.push(`Ogiltigt eller oläsligt värde för ${label}. Kontrollera samtliga märkta värden i originalet.`);return null;}
    const distinct=[...new Set(items.map(item=>item.value))];
    if(distinct.length!==1){issues.push(`Motstridiga värden för ${label}. Kontrollera originalets identiteter.`);return null;}
    return distinct[0];
  };
  const parties={};
  for(const role of ['supplier','recipient']){
    const name=resolve(records[role].names,role==='supplier'?'leverantörsnamn':'mottagarnamn');
    const organization_number=resolve(records[role].organizations,role==='supplier'?'leverantörens organisationsnummer':'mottagarens organisationsnummer');
    parties[role]={name,organization_number,evidence:dedupeEvidence([...records[role].names,...records[role].organizations].flatMap(item=>item.evidence))};
  }
  if(unassigned.length&&namedRoles.length>1){parties.supplier.organization_number=null;parties.recipient.organization_number=null;}
  const selectedRole=direction==='customer'?'recipient':'supplier';
  const counterparty={...parties[selectedRole],name_evidence:(records[selectedRole].names[0]?.evidence||[]).map(item=>item.text).join('\n'),organization_evidence:(records[selectedRole].organizations[0]?.evidence||[]).map(item=>item.text).join('\n')};
  return {parties,counterparty};
}

function referenceDetails(lines,value,issues){
  const referencePattern=/(?<![\p{L}\p{N}/_-])(OCR(?:[- /]?(?:nummer|referens))?|betalningsreferens|payment reference)(?=[ \t.:#]|$)/giu;
  const occurrences=lines.flatMap(source=>[...normalized(source.text).matchAll(referencePattern)].map(match=>({kind:/^OCR/i.test(match[1])?'ocr':'payment_reference',source})));
  const kind=value!==null&&occurrences.length?(occurrences.some(item=>item.kind==='ocr')?'ocr':'payment_reference'):null;
  let checksum_valid=null;
  if(kind==='ocr'){
    checksum_valid=/^\d{2,25}$/.test(value)&&[...value].reverse().reduce((sum,c,i)=>{const n=Number(c)*(i%2?2:1);return sum+(n>9?n-9:n);},0)%10===0;
    if(!checksum_valid)issues.push('OCR-referensens längd eller kontrollsiffra är ogiltig. Kontrollera betalningsreferensen i originalet.');
  }
  return {kind,value:value??null,checksum_valid,formal_verified:false,evidence:dedupeEvidence(occurrences.map(item=>item.source))};
}

const columnNames={
  description:['beskrivning','benämning','artikel','artikeltext','description','item','product','service'],
  quantity:['antal','kvantitet','quantity','qty'],
  unit_price_cents:['à-pris','á-pris','à pris','á pris','a-pris','apris','enhetspris','styckpris','unit price','price per unit'],
  net_cents:['netto','nettobelopp','radnetto','net amount','net','line net'],
  vat_rate:['moms %','moms%','momssats','vat %','vat%','vat rate','tax rate'],
  vat_cents:['momsbelopp','moms kr','vat amount','tax amount'],
  total_cents:['radbelopp','radtotal','line total','gross','gross amount'],
};
const columnsByName=new Map(Object.entries(columnNames).flatMap(([key,names])=>names.map(name=>[name,key])));
const columnName=value=>normalized(value).toLowerCase().replace(/\s+/g,' ').replace(/:$/,'');
function splitCells(line,format=null){
  const delimiter=format?.delimiter||(line.includes('|')?'pipe':line.includes('\t')?'tab':'spaces');
  const cells=delimiter==='pipe'?line.split('|'):delimiter==='tab'?line.split('\t'):line.trim().split(/ {2,}/);
  const leading=format?.leading??(cells[0].trim()===''),trailing=format?.trailing??(cells.at(-1).trim()==='');
  if(leading&&cells[0]?.trim()==='')cells.shift();
  if(trailing&&cells.at(-1)?.trim()==='')cells.pop();
  return {cells:cells.map(cell=>cell.trim()),format:{delimiter,leading,trailing}};
}
function tableHeader(line){
  const split=splitCells(line),columns=split.cells.map(value=>columnsByName.get(columnName(value))||null);
  const recognizable=columns.filter(Boolean);
  // OCR may collapse every column gap to one space. Recognize the supported
  // heading family, but do not guess where its data cells begin and end.
  if(split.cells.length===1&&/^(?:beskrivning|benämning|artikel|description|item)[ \t]+(?:antal|quantity|qty)[ \t]+(?:[àáa][ -]?pris|enhetspris|styckpris|unit[ \t]+price)\b/iu.test(normalized(line)))return {...split,columns:[null],complete:false};
  if(recognizable.length<2||!recognizable.some(value=>['quantity','unit_price_cents','vat_rate'].includes(value)))return null;
  const complete=columns.every(Boolean)&&new Set(columns).size===columns.length&&['description','quantity','unit_price_cents','net_cents'].every(key=>columns.includes(key));
  return {...split,columns,complete};
}
const quantityValue=value=>/^-?\d+(?:[.,]\d{1,4})?$/.test(value)&&Number.isFinite(Number(value.replace(',','.')))&&Math.abs(Number(value.replace(',','.')))<=1_000_000_000?Number(value.replace(',','.')):null;
const rateValue=value=>{const match=value.match(/^(\d{1,3}(?:[.,]\d{1,3})?)[ \t]*%?$/);if(!match)return null;const n=Number(match[1].replace(',','.'));return n>=0&&n<=100?n:null;};
const rowKeys=['description','quantity','unit_price_cents','net_cents','vat_rate','vat_cents','total_cents'];
// Unpunctuated summaries must contain one complete monetary value; a table
// description beginning with Net/Total must not terminate and hide item rows.
const summaryMoney='-?(?:\\d{1,3}(?:,\\d{3})+\\.\\d{1,2}|\\d{1,3}(?:\\.\\d{3})+,\\d{1,2}|(?:\\d+|\\d{1,3}(?: \\d{3})+)(?:[.,]\\d{1,2})?)';
const tableSummary=new RegExp('^(?:netto(?:belopp)?|totalt netto|net(?:[ \\t]+amount)?|belopp före moms|(?:summa|totalt|belopp)[ \\t]+(?:inkl|exkl)(?:usive|\\.?)[ \\t]+moms|moms(?:belopp)?|total moms|(?:total[ \\t]+)?vat(?:[ \\t]+amount)?|att betala|summa att betala|totalbelopp|totalsumma|amount due|total(?:[ \\t]+amount)?)(?:[ \\t]*[:.#]|[ \\t]+(?:(?:SEK|EUR|USD|GBP|NOK|DKK)[ \\t]*)?'+summaryMoney+'(?:[ \\t]*(?:SEK|EUR|USD|GBP|NOK|DKK|kr))?[ \\t]*$)','iu');
const pageCaption=/^(?:sida|page)[ \t]+\d+(?:[ \t]*(?:av|of|\/)[ \t]*\d+)?$/iu;
const invoiceIdentity=/^(?:faktura[ \t]*(?:nummer|nr|no)|invoice[ \t]*(?:number|no))[ \t]*[:.#-]?[ \t]*([\p{L}\p{N}][\p{L}\p{N}/_-]*)$/iu;
const continuationIdentity=/^(?:faktura|invoice)[ \t]+([\p{L}\p{N}][\p{L}\p{N}/_-]*)[ \t]*[,;:]?[ \t]*(?:fortsättning|continued|continuation)[ \t]+(?:sida|page)[ \t]+\d+(?:[ \t]+(?:av|of)[ \t]+\d+|[ \t]*\/[ \t]*\d+)?$/iu;
const lineIdentity=line=>line.match(invoiceIdentity)||line.match(continuationIdentity);
function parseTable(lines,{invoice_number,summary,credit,money,currency},issues){
  const rows=[],covered=new Set(),cellCurrencies=new Set();let status='absent',header=null,active=false,page=0,allowed=true,pending=null,documentConflict=false,currencyConflict=false;
  const incomplete=()=>{if(status!=='conflict')status='incomplete';};
  const conflict=()=>{status='conflict';};
  const identityValues=[...new Set(lines.flatMap(source=>{const match=lineIdentity(normalized(source.text));return match?[match[1]]:[];}))];
  documentConflict=identityValues.length>1;
  for(let n=0;n<lines.length;n++){
    const source=lines[n],line=normalized(source.text);
    if(source.page!==page){if(pending){incomplete();pending=null;}page=source.page;allowed=!header;}
    if(!line||pageCaption.test(line))continue;
    const candidate=tableHeader(source.text);
    if(candidate){
      covered.add(`${source.page}:${source.line}`);
      if(pending){incomplete();pending=null;}
      if(status==='absent')status='complete';
      if(!candidate.complete||header&&JSON.stringify(candidate.columns)!==JSON.stringify(header.columns))incomplete();
      header=candidate;active=true;allowed=!documentConflict;
      if(documentConflict)conflict();
      continue;
    }
    const identity=lineIdentity(line);
    if(identity&&header){if(invoice_number&&identity[1]===invoice_number)allowed=true;else{documentConflict=true;allowed=false;conflict();}continue;}
    if(!header)continue;
    if(tableSummary.test(line)){if(pending){incomplete();pending=null;}active=false;continue;}
    const split=splitCells(source.text,header.format);
    if(split.cells.length===1&&knownField.test(line))continue;
    if(!active){if(split.cells.length>1)incomplete();continue;}
    covered.add(`${source.page}:${source.line}`);
    if(!allowed){incomplete();continue;}
    if(split.cells.length===1){
      if(pending)incomplete();
      if(nameValue(line)&&!/:/.test(line)){pending=source;continue;}
      incomplete();pending=null;continue;
    }
    if(rows.length>=500){incomplete();continue;}
    const row=Object.fromEntries(rowKeys.map(key=>[key,null]));row.evidence=source;
    if(split.cells.length!==header.columns.length){incomplete();rows.push(row);pending=null;continue;}
    for(let i=0;i<header.columns.length;i++){
      const key=header.columns[i],cell=split.cells[i];
      if(!key)continue;
      if(key==='description')row[key]=nameValue(cell);
      else if(key==='quantity')row[key]=quantityValue(cell);
      else if(key==='vat_rate')row[key]=rateValue(cell);
      else{
        for(const code of cell.match(/\b(?:SEK|EUR|USD|GBP|NOK|DKK)\b/giu)||[])cellCurrencies.add(code.toUpperCase());
        row[key]=money(cell);
      }
    }
    if(pending){
      if(!split.cells[header.columns.indexOf('description')]){row.description=nameValue(normalized(pending.text));row.evidence={page:pending.page,line:pending.line,text:pending.text+'\n'+source.text};}
      else incomplete();
      pending=null;
    }
    rows.push(row);
    if(cellCurrencies.size>1||currency&&[...cellCurrencies].some(code=>code!==currency)){currencyConflict=true;conflict();}
    if(header.columns.some(key=>!key||row[key]===null)){incomplete();continue;}
    const verify=(keys,expected,key)=>{if(keys.every(field=>row[field]!==null)&&(!Number.isSafeInteger(expected)||Math.abs(expected-row[key])>1))conflict();};
    verify(['quantity','unit_price_cents','net_cents'],Math.round(row.quantity*row.unit_price_cents),'net_cents');
    verify(['net_cents','vat_rate','vat_cents'],Math.round(row.net_cents*row.vat_rate/100),'vat_cents');
    verify(['net_cents','vat_cents','total_cents'],row.net_cents+row.vat_cents,'total_cents');
    verify(['net_cents','vat_rate','total_cents'],row.net_cents+Math.round(row.net_cents*row.vat_rate/100),'total_cents');
  }
  if(pending)incomplete();
  if(header&&!rows.length)incomplete();
  if(header&&documentConflict)conflict();
  if(status==='complete'){
    for(const key of ['net_cents','vat_cents','total_cents']){
      if(rows.some(row=>row[key]===null))continue;
      const sum=rows.reduce((total,row)=>total+row[key],0),expected=summary[key];
      if(expected===null||expected===undefined)continue;
      if(!Number.isSafeInteger(sum)||Math.abs((credit?Math.abs(sum):sum)-expected)>1)conflict();
    }
    // These are comparison values only. Omitted VAT/gross columns stay null in
    // the returned rows, even when net and rate allow a cross-check of totals.
    if(rows.every(row=>row.net_cents!==null&&row.vat_rate!==null)){
      const checkedVat=rows.reduce((total,row)=>total+Math.round(row.net_cents*row.vat_rate/100),0);
      const checkedGross=rows.reduce((total,row)=>total+row.net_cents,0)+checkedVat;
      for(const [key,checked] of [['vat_cents',checkedVat],['total_cents',checkedGross]]){
        if(summary[key]!=null&&(!Number.isSafeInteger(checked)||Math.abs((credit?Math.abs(checked):checked)-summary[key])>1))conflict();
      }
    }
  }
  if(status==='incomplete')issues.push('Artikeltabellen är ofullständig eller saknar entydiga kolumnrubriker. Kontrollera alla rader och sidfortsättningar.');
  if(status==='conflict')issues.push('Motstridiga artikelrader, momssatser eller rad-/fakturasummor. Kontrollera originalets samtliga rader.');
  if(currencyConflict)issues.push('Flera valutor eller motstridiga valutakoder finns i artikelradernas belopp. Kontrollera originalets valuta.');
  return {rows,status,covered,currencyConflict};
}

export function extractInvoiceDetails(input,options){
  const lines=linesOf(input),issues=[];
  const table=parseTable(lines,options,issues);
  const identityLines=lines.filter(source=>!table.covered.has(`${source.page}:${source.line}`));
  const {parties,counterparty}=parseParties(identityLines,options,issues);
  const reference=referenceDetails(identityLines,options.reference??null,issues);
  const hasUnresolvedDiscount=lines.some(({text})=>/\b(?:rabatt|discount)\b/iu.test(text)&&!/^\s*(?:ingen\s+rabatt|no\s+discount)\b/iu.test(text)&&!/^\s*(?:rabatt|discount)\s*:?\s*0(?:[,.]0+)?\s*(?:%|SEK|kr)?\s*$/iu.test(text));
  if(hasUnresolvedDiscount){issues.push('Rabattens effekt kan inte verifieras entydigt. Kontrollera artikelrader och totalsummor.');if(table.status==='complete')table.status='incomplete';}
  return {details:{version:1,supplier:parties.supplier,recipient:parties.recipient,reference,line_items:table.rows,vat_rates:[...new Set(table.rows.map(row=>row.vat_rate).filter(rate=>rate!==null))].sort((a,b)=>a-b),table_status:table.status},counterparty,issues,currency_conflict:table.currencyConflict,table_lines:table.covered};
}

// Table descriptions may contain words such as "invoice number". Keep them in
// their row evidence instead of treating them as document-level field labels.
export function invoiceScalarText(input){
  const lines=linesOf(input),{covered}=parseTable(lines,{invoice_number:null,summary:{},credit:false,money:()=>null},[]);
  const pages=[];
  for(const source of lines){pages[source.page-1]||=[];pages[source.page-1].push(covered.has(`${source.page}:${source.line}`)?'':source.text);}
  // A page boundary is stronger evidence than an OCR paragraph gap. Preserve
  // it so a missing labelled value cannot borrow a value on the next page.
  return pages.map(page=>page.join('\n')).join('\n\f\n');
}
