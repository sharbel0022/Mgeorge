import {read,utils,SSF} from 'xlsx';
import {Inflate} from 'fflate';
import {extractPaymentReferences} from './payment-references.js';
import {normalizePayerEvidence,payerField} from './payer-evidence.js';

const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MAX_BYTES=15_000_000,MAX_EXPANDED=24_000_000,MAX_ENTRY=8_000_000;
const fail=message=>{throw Error(message);};
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const blank=cell=>cell===undefined||cell.v===undefined||cell.v===null||cell.v==='';
const text=cell=>blank(cell)?'':String(cell.v).trim();
const label=cell=>normalize(text(cell));
const signature=(view,pos,value)=>pos>=0&&pos+4<=view.byteLength&&view.getUint32(pos,true)===value;
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function checkExtra(view,start,length){
 const end=start+length;if(end>view.byteLength)fail('XLSX-arkivets extrafält är skadat.');
 for(let pos=start;pos<end;){if(pos+4>end)fail('XLSX-arkivets extrafält är skadat.');const id=view.getUint16(pos,true),size=view.getUint16(pos+2,true);if(id===1||pos+4+size>end)fail('ZIP64 eller ogiltiga extrafält stöds inte för bankrapporten.');pos+=4+size;}
}
function validateInflation(data,method,size,expectedCRC){
 let produced=0,crc=0xffffffff,finalized=false;
 const accept=(chunk,final)=>{produced+=chunk.length;if(produced>size||produced>MAX_ENTRY)fail('XLSX-filens faktiska uppackade storlek överskrider gränsen.');for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8);finalized||=final;};
 try{
  if(method===0)accept(data,true);
  else{const stream=new Inflate(accept);for(let pos=0;pos<data.length;pos+=256)stream.push(data.subarray(pos,Math.min(data.length,pos+256)),pos+256>=data.length);}
 }catch{fail('XLSX-filens komprimering eller uppackade storlek är ogiltig.');}
 if(!finalized||produced!==size||((crc^0xffffffff)>>>0)!==expectedCRC)fail('XLSX-filens kontrollsumma eller faktiska storlek stämmer inte.');
}

/** Bound the ZIP before invoking the XLSX library, including declared expansion.
 * Nothing is extracted to disk and external links/macros are never followed. */
export function validateBankgiroXLSXArchive(input){
 const bytes=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
 if(!bytes||bytes.byteLength<22||bytes.byteLength>MAX_BYTES)fail('Välj en XLSX-fil på högst 15 MB.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(!signature(view,0,0x04034b50))fail('Filen är inte en giltig XLSX-arbetsbok.');
 let end=-1;for(let n=bytes.length-22;n>=Math.max(0,bytes.length-65557);n--)if(signature(view,n,0x06054b50)&&n+22+view.getUint16(n+20,true)===bytes.length){end=n;break;}
 if(end<0)fail('XLSX-filen är skadad eller ofullständig.');
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||!count||count>200||start+size!==end)fail('XLSX-arkivet har en otillåten struktur eller storlek.');
 const names=new Set(),ranges=[];let pos=start,expanded=0;
 for(let n=0;n<count;n++){
  if(!signature(view,pos,0x02014b50)||pos+46>end)fail('XLSX-arkivet är skadat.');
  const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),compressed=view.getUint32(pos+20,true),uncompressed=view.getUint32(pos+24,true),nameLength=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),local=view.getUint32(pos+42,true),next=pos+46+nameLength+extra+comment;
  if(next>end||nameLength<1||nameLength>256||view.getUint16(pos+34,true)||flags&~0x080e||![0,8].includes(method)||uncompressed===0&&compressed>0||uncompressed>MAX_ENTRY||(expanded+=uncompressed)>MAX_EXPANDED||uncompressed>Math.max(100_000,compressed*1000))fail('XLSX-arkivet är krypterat, för stort eller har osäker komprimering.');
  checkExtra(view,pos+46+nameLength,extra);
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+nameLength));}catch{fail('XLSX-arkivet har ett ogiltigt filnamn.');}
  if(names.has(name)||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/vbaProject|externalLinks|embeddings|connections\.xml|queryTables/i.test(name))fail('XLSX med dubbla filer, makron eller externa datakällor stöds inte.');names.add(name);
  if(!signature(view,local,0x04034b50)||local+30>start)fail('XLSX-arkivet är skadat.');
  const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),dataStart=local+30+localName+localExtra,dataEnd=dataStart+compressed;
  checkExtra(view,local+30+localName,localExtra);
  if(localName!==nameLength||dataEnd>start||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method||!bytes.subarray(local+30,local+30+localName).every((v,i)=>v===bytes[pos+46+i])||!(flags&8)&&(view.getUint32(local+18,true)!==compressed||view.getUint32(local+22,true)!==uncompressed))fail('XLSX-arkivets filuppgifter är motstridiga.');
  const expectedCRC=view.getUint32(pos+16,true);
  if(!(flags&8)&&view.getUint32(local+14,true)!==expectedCRC)fail('XLSX-arkivets kontrollsummor är motstridiga.');
  let localEnd=dataEnd;
  if(flags&8){const descriptor=signature(view,dataEnd,0x08074b50)?dataEnd+4:dataEnd;if(![0,compressed].includes(view.getUint32(local+18,true))||![0,uncompressed].includes(view.getUint32(local+22,true))||![0,expectedCRC].includes(view.getUint32(local+14,true))||descriptor+12>start||view.getUint32(descriptor,true)!==expectedCRC||view.getUint32(descriptor+4,true)!==compressed||view.getUint32(descriptor+8,true)!==uncompressed)fail('XLSX-arkivets databeskrivning är motstridig.');localEnd=descriptor+12;}
  validateInflation(bytes.subarray(dataStart,dataEnd),method,uncompressed,expectedCRC);
  if(ranges.some(([a,b])=>local<b&&localEnd>a))fail('XLSX-arkivet innehåller överlappande filer.');ranges.push([local,localEnd]);pos=next;
 }
 if(pos!==end||!names.has('[Content_Types].xml')||!names.has('xl/workbook.xml')||!names.has('xl/_rels/workbook.xml.rels'))fail('XLSX-arbetsbokens struktur saknas.');
 return bytes;
}

function money(cell,{zero=false}={}){
 let result;
 if(cell?.t==='n'){
  const n=cell.v*100;if(!Number.isFinite(n)||Math.abs(n-Math.round(n))>0.00001)fail('Bankrapporten innehåller ett ogiltigt belopp eller delar av ören.');result=Math.round(n);
 }else{
  const value=text(cell);
  if(!/^(?:\d+|\d{1,3}(?:[ \u00a0]\d{3})+)(?:[,.]\d{1,2})?$/.test(value))fail('Bankrapporten innehåller ett ogiltigt belopp.');
  const [whole,decimal='']=value.replace(/[ \u00a0]/g,'').replace(',','.').split('.');result=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 }
 if(!Number.isSafeInteger(result)||result<(zero?0:1)||result>100_000_000_000)fail('Ogiltigt betalningsbelopp. Återbetalningar behöver separat granskning.');return result;
}
function countValue(cell,{zero=false}={}){const value=text(cell);if(!/^\d{1,4}$/.test(value))fail('Antal betalningar saknas eller är ogiltigt.');const n=Number(value);if(n<(zero?0:1)||n>1000)fail('Antal betalningar måste vara 1–1 000.');return n;}
function reference(cell){
 if(blank(cell))fail('Betalningsreferens saknas. Granska bankoriginalet.');
 if(cell.t==='n'){
  const format=cell.z||'General';
  if(!Number.isSafeInteger(cell.v)||cell.v<0||!/^0{1,25}$/.test(format))fail('Betalningsreferensen måste vara text eller ha ett uttryckligt nollformat. Förlorade nollor får inte gissas.');
  return String(cell.v).padStart(format.length,'0');
 }
 if(!['s','str'].includes(cell.t)||text(cell).length>300)fail('Betalningsreferensen har ett ogiltigt cellformat.');return text(cell);
}
function dateValue(cell,date1904){
 let result=text(cell);
 if(cell?.t==='n'){
  if(!Number.isInteger(cell.v)||!SSF.is_date(cell.z||''))fail('Numeriskt datum saknar ett säkert Excel-datumformat.');
  const d=SSF.parse_date_code(cell.v,{date1904});if(!d||d.H||d.M||d.S)fail('Betalningsdatum är ogiltigt.');result=`${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
 }
 const swedish=result.match(/^(\d{2})[/.\-](\d{2})[/.\-](\d{4})$/);if(swedish)result=`${swedish[3]}-${swedish[2]}-${swedish[1]}`;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result+'T12:00:00Z'))||new Date(result+'T12:00:00Z').toISOString().slice(0,10)!==result)fail('Betalningsdatum saknas eller är ogiltigt.');return result;
}
function bankgiro(cell){const value=text(cell);if(!/^\d{3,4}-?\d{4}$/.test(value)||cell?.t==='n')fail('Mottagarens Bankgiro saknas eller är ogiltigt.');return value;}

/** A structural report validator, not proof of bank origin or account ownership.
 * The retained original must still pass the application's existing approval. */
export function parseBankgiroXLSX(input,name='Bankgiro.xlsx'){
 if(!/\.xlsx$/i.test(name))fail('Välj en Bankgirofil i XLSX-format.');
 const bytes=validateBankgiroXLSXArchive(input);let workbook;
 try{workbook=read(bytes,{type:'array',cellNF:true,cellText:false,cellStyles:true,cellDates:false,bookVBA:false,bookFiles:true,raw:true});}catch{fail('XLSX-arbetsboken är skadad eller stöds inte.');}
 if(!workbook.SheetNames?.length||workbook.SheetNames.length>20)fail('XLSX-filen saknar arbetsblad eller har för många arbetsblad.');
 const content=workbook.files?.['[Content_Types].xml']?.content;
 const contentTypes=content?new TextDecoder().decode(content):'';
 const workbookType=contentTypes.match(/<(?:[\w]+:)?Override\b[^>]*\bPartName=["']\/xl\/workbook\.xml["'][^>]*>/)?.[0]||contentTypes.match(/<(?:[\w]+:)?Default\b[^>]*\bExtension=["']xml["'][^>]*>/)?.[0]||'';
 if(!workbookType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'))fail('Arbetsboken är inte ett tillåtet XLSX-format.');
 const rows=[],reportIds=new Set();
 for(const [sheetIndex,sheetName]of workbook.SheetNames.entries()){
  const sheet=workbook.Sheets[sheetName];if(!sheet?.['!ref'])continue;
  if(workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden)fail('Dolda arbetsblad tillåts inte i bankrapporten.');
  if((sheet['!rows']||[]).some(row=>row?.hidden)||(sheet['!cols']||[]).some(column=>column?.hidden))fail('Dolda rader eller kolumner behöver separat granskning.');
  const range=utils.decode_range(sheet['!ref']);if(range.e.r>5000||range.e.c>63||Object.keys(sheet).length>40_000)fail('Arbetsbladet är för stort.');
  const get=(r,c)=>sheet[utils.encode_cell({r,c})];
  const allRow=r=>Array.from({length:range.e.c+1},(_,c)=>({r,c,cell:get(r,c)}));
  const meaningful=r=>allRow(r).filter(x=>!blank(x.cell));
  for(const [address,cell]of Object.entries(sheet))if(!address.startsWith('!')&&(cell.f||cell.F||cell.l||cell.t==='e'))fail('En formel, länk eller felcell behöver separat granskning.');
  const mergedCoordinates=new Set(),merges=sheet['!merges']||[];let mergedArea=0;if(merges.length>5000)fail('För många sammanslagna celler i bankrapporten.');
  for(const merge of merges){if(merge.s.r<0||merge.s.c<0||merge.e.r>range.e.r||merge.e.c>range.e.c||merge.e.r<merge.s.r||merge.e.c<merge.s.c||(mergedArea+=(merge.e.r-merge.s.r+1)*(merge.e.c-merge.s.c+1))>50_000)fail('Ogiltiga eller för stora sammanslagna celler.');let nonempty=0;for(let r=merge.s.r;r<=merge.e.r;r++)for(let c=merge.s.c;c<=merge.e.c;c++){const key=r*64+c;if(mergedCoordinates.has(key))fail('Överlappande sammanslagna celler är tvetydiga.');mergedCoordinates.add(key);if(!blank(get(r,c)))nonempty++;}if(nonempty>1)fail('Sammanslagna celler innehåller motstridiga uppgifter.');}
  const starts=[];for(let r=range.s.r;r<=range.e.r;r++)if(meaningful(r).some(x=>label(x.cell)==='insattningsuppgift'))starts.push(r);
  if(!starts.length)fail('Arbetsbladet har inte en stödd Swedbank Bankgiro-layout.');
  for(let block=0;block<starts.length;block++){
   const start=starts[block],end=starts[block+1]??range.e.r+1;
   const findRows=predicate=>{const result=[];for(let r=start;r<end;r++)if(predicate(allRow(r)))result.push(r);return result;};
   const only=(matches,message)=>matches.length===1?matches[0]:fail(message);
   const metadataRow=only(findRows(cols=>cols.some(x=>label(x.cell)==='datum')&&cols.some(x=>['bankgironummer','mottagarens bankgiro','mottagarbankgiro'].includes(label(x.cell)))),'Datum och mottagarbankgiro saknas eller är motstridiga.');
   const col=(r,labels)=>only(allRow(r).filter(x=>labels.includes(label(x.cell))).map(x=>x.c),'Tvetydiga kolumnrubriker i bankrapporten.');
   const dateColumn=col(metadataRow,['datum']),bgColumn=col(metadataRow,['bankgironummer','mottagarens bankgiro','mottagarbankgiro']);
   const below=(r,c,missing='Obligatoriska rapportuppgifter saknas.')=>{for(let n=r+1;n<Math.min(end,r+4);n++)if(!blank(get(n,c)))return {r:n,c,cell:get(n,c)};fail(missing);};
   const dateCell=below(metadataRow,dateColumn,'Betalningsdatum saknas.'),bgCell=below(metadataRow,bgColumn,'Mottagarens Bankgiro saknas.'),date=dateValue(dateCell.cell,!!workbook.Workbook?.WBProps?.date1904),recipientBankgiro=bankgiro(bgCell.cell);
   let account='',accountCell;const accountLabels=[];for(let r=start;r<end;r++)for(const x of allRow(r))if(['mottagarkonto','bankkontonummer','iban','mottagarens konto'].includes(label(x.cell)))accountLabels.push(x);
   if(accountLabels.length>1)fail('Motstridiga mottagarkonton.');if(accountLabels.length){const a=accountLabels[0];accountCell=a.r===metadataRow?below(a.r,a.c,'Mottagarkonto saknas.'):{r:a.r,c:a.c+1,cell:get(a.r,a.c+1)};account=text(accountCell.cell).replace(/[\s-]/g,'');if(!/^(?:SE\d{22}|\d{7,20})$/.test(account)||accountCell.cell?.t==='n')fail('Mottagarkontot är ogiltigt eller har osäkert numeriskt format.');}
   // The export places the recipient's postal address in merged cells to the
   // right of the Bankgiro column. Those cells are not additional bank IDs.
   const recipientAddress=x=>x.c>bgColumn&&(sheet['!merges']||[]).some(m=>m.s.r===x.r&&m.e.r===x.r&&m.s.c===x.c&&m.e.c>x.c)&&x.cell?.t==='s'&&text(x.cell).length<=200;
   if(dateCell.r!==bgCell.r||meaningful(dateCell.r).some(x=>![dateColumn,bgColumn,accountCell?.r===dateCell.r?accountCell.c:-1].includes(x.c)&&!recipientAddress(x)))fail('Rapporten innehåller motstridiga datum- eller Bankgirouppgifter.');
   const summaryHeader=only(findRows(cols=>cols.some(x=>label(x.cell)==='antal')&&cols.some(x=>label(x.cell)==='belopp')&&cols.some(x=>label(x.cell)==='betalningstyp')),'Rapportens antal och totalsumma saknas.');
   const countColumn=col(summaryHeader,['antal']),sumColumn=col(summaryHeader,['belopp']),typeColumn=col(summaryHeader,['betalningstyp']);
   const sequenceCells=[];for(let r=start;r<end;r++)for(const x of allRow(r))if(/^lopnummer(?:\s|$)/.test(label(x.cell)))sequenceCells.push(x);
   const sequenceCell=only(sequenceCells,'Löpnummer saknas eller är motstridigt.');
   let sequence=text(sequenceCell.cell).match(/^Löpnummer\s+(\d{1,10})$/i)?.[1];
   if(!sequence&&label(sequenceCell.cell)==='lopnummer')sequence=text(below(sequenceCell.r,sequenceCell.c,'Löpnummer saknas.').cell);
   if(!/^\d{1,10}$/.test(sequence||''))fail('Löpnummer saknas eller är ogiltigt.');
   const totalRow=only(findRows(cols=>cols.some(x=>label(x.cell)==='totalt')),'Rapportens totalsumma saknas eller är motstridig.');
   if(totalRow<=summaryHeader)fail('Rapportens sammanfattning har fel ordning.');
   const totalCell={r:totalRow,c:sumColumn,cell:get(totalRow,sumColumn)},countCell={r:totalRow,c:countColumn,cell:get(totalRow,countColumn)},total=money(totalCell.cell),count=countValue(countCell.cell);
   let summarySum=0,summaryCount=0,summaryTypes=new Set();
   for(let r=summaryHeader+1;r<totalRow;r++){
    if(!meaningful(r).length)continue;const type=label(get(r,typeColumn));
    if(!['elektronisk','avi'].includes(type)||summaryTypes.has(type))fail('Okänd eller upprepad betalningstyp i rapporten.');summaryTypes.add(type);
    const amount=money(get(r,sumColumn),{zero:true}),n=blank(get(r,countColumn))?0:countValue(get(r,countColumn),{zero:true});
    if((amount===0)!==(n===0))fail('Antal och belopp i sammanfattningen är motstridiga.');summarySum+=amount;summaryCount+=n;
   }
   if(summarySum!==total)fail('Summan i rapportens sammanfattning stämmer inte med totalsumman.');if(summaryCount!==count)fail('Antal i rapportens sammanfattning stämmer inte.');
   const detailHeader=only(findRows(cols=>cols.some(x=>label(x.cell)==='avsandare')&&cols.some(x=>label(x.cell)==='betalningsreferens')&&cols.some(x=>label(x.cell)==='belopp')),'Arbetsbladets betalningstabell saknas eller är tvetydig.');
   if(detailHeader<=totalRow)fail('Rapportens betalningstabell har fel ordning.');
   const columns={party:col(detailHeader,['avsandare']),reference:col(detailHeader,['betalningsreferens']),payerBankgiro:col(detailHeader,['bankgironummer/ avinummer','bankgironummer/avinummer','bankgironummer / avinummer']),amount:col(detailHeader,['belopp'])};
   const detailCounts=[];for(let r=totalRow+1;r<detailHeader;r++)for(const x of allRow(r))if(/^\d+ st$/i.test(text(x.cell)))detailCounts.push(x);
   if(detailCounts.length!==1||Number(text(detailCounts[0].cell).split(' ')[0])!==count)fail('Antal betalningar i detaljtabellen stämmer inte med rapporten.');
   const reportKey=`xlsx:${recipientBankgiro}:${date}:${sequence}`;if(reportIds.has(reportKey))fail('Dubblett: samma rapportblock förekommer flera gånger.');reportIds.add(reportKey);
   const source=x=>({sheet:sheetName,address:utils.encode_cell(x),type:x.cell?.t||'',rawValue:x.cell?.v??'',numberFormat:x.cell?.z||'General'});
   const parsed=[],identities=new Set();let footer=false;
   for(let r=detailHeader+1;r<end;r++){
    const populated=meaningful(r);if(!populated.length)continue;
    if(populated.length===1&&/^©\s*(?:\d{4}\s+)?Bankgirot$/i.test(text(populated[0].cell))){footer=true;continue;}
    if(footer&&populated.length===1&&(/^(?:Skapad av banken|Hclnr\s*:\s*\d+\s*\|\s*Datum\s*:\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/i.test(text(populated[0].cell))))continue;
    if(footer||populated.some(x=>!Object.values(columns).includes(x.c)))fail('Okänd eller motstridig rad i betalningstabellen.');
    const cells=Object.fromEntries(Object.entries(columns).map(([key,c])=>[key,{r,c,cell:get(r,c)}]));
    for(const merge of sheet['!merges']||[]){const hits=Object.values(cells).filter(x=>x.r>=merge.s.r&&x.r<=merge.e.r&&x.c>=merge.s.c&&x.c<=merge.e.c);if(hits.length>1)fail('Sammanslagna betalningsfält är tvetydiga.');}
    const party=text(cells.party.cell);if(!party||cells.party.cell?.t==='n'||party.length>200)fail('Avsändare saknas eller är ogiltig.');
    const payerReference=reference(cells.reference.cell),payerBankgiro=text(cells.payerBankgiro.cell);if(!/^\d{1,25}$|^\d{3,4}-\d{4}$/.test(payerBankgiro)||cells.payerBankgiro.cell?.t==='n')fail('Avsändarens Bankgiro/avinummer saknas eller är osäkert.');
    const amount=money(cells.amount.cell),identity=JSON.stringify([party,payerReference,payerBankgiro,amount]);if(identities.has(identity))fail('Dubblett: identiska individuella betalningar behöver granskas.');identities.add(identity);
    const cellProvenance=Object.fromEntries(Object.entries({...cells,date:dateCell,recipientBankgiro:bgCell,...(accountCell?{account:accountCell}:{}),sequence:sequenceCell,total:totalCell,count:countCell}).map(([key,x])=>[key,source(x)]));
    const prefix=`$.xlsx[${JSON.stringify(sheetName)}]`,referenceEvidence=extractPaymentReferences({betalningsreferens:payerReference},{sourcePrefix:`${prefix}.${cellProvenance.reference.address}`});
    const payerEvidence=normalizePayerEvidence({name:payerField(party,`${prefix}.${cellProvenance.party.address}`),identifiers:[]});
    const reportEvidence={profile:'Swedbank Bankgiro XLSX',namespace:NS,reportId:sequence,valueDate:date,recipientBankgiro,sequence,paymentCount:String(count),totalCents:String(total),sheet:sheetName,sourceCells:JSON.stringify(cellProvenance)};
    parsed.push({date,amount,party,payerReference,payerBankgiro,recipientBankgiro,account,currency:'SEK',bankReference:'',parentBankReference:'',externalId:'',organizationNumber:'',description:'Bankgiro betalningsspecifikation',source:name,kind:'payment',verified:false,specification:true,format:'Swedbank Bankgiro XLSX',settlementDate:date,key:`${reportKey}:${parsed.length}`,parentKey:reportKey,reportEvidence,cellProvenance,payerEvidence,referenceEvidence,referenceParts:[{value:payerReference,source:cellProvenance.reference.address,kind:'structured'}]});
   }
   if(parsed.length!==count)fail('Antal individuella betalningar stämmer inte med rapporten.');if(parsed.reduce((n,r)=>n+r.amount,0)!==total)fail('Summan av individuella betalningar stämmer inte med rapportens totalsumma.');
   rows.push(...parsed);if(rows.length>1000)fail('Välj högst 1 000 betalningar.');
  }
 }
 if(!rows.length)fail('XLSX-filen saknar individuella betalningar.');return rows;
}
