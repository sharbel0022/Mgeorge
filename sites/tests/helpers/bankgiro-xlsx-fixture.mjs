import {utils,write} from 'xlsx';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

// Synthetic data, with the metadata, summary, total and merged payer column
// observed in the bank's deposit report. No customer original is checked in.
export const syntheticPayment={party:'Testbageriet AB',reference:'0017',payerBankgiro:'987-6543',amount:12345};
export function makeBankgiroWorkbook(options={}){
 const blocks=options.blocks||[options],data=[],merges=[];
 for(const [index,block]of blocks.entries()){
  const date=block.date??'2026-10-20',recipientBankgiro=block.recipientBankgiro??'1234-5678',sequence=block.sequence??String(41+index),payments=block.payments??[{...syntheticPayment}],total=payments.reduce((n,p)=>n+p.amount,0),offset=data.length+(block.shiftRows||0);
  while(data.length<offset)data.push([]);
  const money=n=>(n/100).toFixed(2).replace('.',',');
  const rows=[['','','Skapad av banken','',''],[],['Insättningsuppgift'],['Datum',block.account?'Bankkontonummer':'','Bankgironummer','Mottagare'],[date,block.account||'',recipientBankgiro,'Exempelbolaget AB'],['','','','Testgatan 1'],['','','','12345 Teststad'],['','','','Sverige'],[],['Belopp insatt på konto'],['Antal','Belopp','','Betalningstyp',`Löpnummer ${sequence}`],[String(block.declaredCount??payments.length),(block.summaryAmount??total)/100,'','Elektronisk'],['',0,'','Avi'],[String(block.totalCount??block.declaredCount??payments.length),money(block.totalAmount??total),'TOTALT'],[],['Insättningar'],['Sorterad på belopp','','','',`${block.detailCount??payments.length} st`],['Avsändare','','Betalningsreferens','Bankgironummer/\nAvinummer','Belopp'],...payments.map(p=>[p.party,'',p.reference,p.payerBankgiro,p.amount/100]),[],['© Bankgirot']];
  data.push(...rows);
  for(const r of [0,9,15,16,17,...payments.map((_,n)=>18+n)])merges.push({s:{r:offset+r,c:0},e:{r:offset+r,c:1}});
  for(const r of [3,4,5,6,7])merges.push({s:{r:offset+r,c:3},e:{r:offset+r,c:4}});
 }
 const sheet=utils.aoa_to_sheet(data);sheet['!merges']=merges;
 const wb=utils.book_new();utils.book_append_sheet(wb,sheet,'Insättningsuppgift');
 if(options.mutate)options.mutate(wb,utils);
 return wb;
}
export function makeBankgiroXLSX(options={}){
 const bytes=new Uint8Array(write(makeBankgiroWorkbook(options),{type:'array',bookType:'xlsx',compression:true}));
 if(!options.legacyCells)return bytes;
 const files=unzipSync(bytes);
 for(const name of Object.keys(files))if(/^xl\/worksheets\/sheet\d+\.xml$/.test(name)){
  const xml=strFromU8(files[name]),cells=new Map([...xml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)].map(m=>[m[1],m[0].replace(/\s+r="[A-Z]+\d+"/,'')]));
  const last=Math.max(...[...cells.keys()].map(address=>utils.decode_cell(address).r));
  const data=Array.from({length:last+1},(_,r)=>'<row>'+Array.from({length:5},(_,c)=>cells.get(utils.encode_cell({r,c}))||'<c t="str"><v></v></c>').join('')+'</row>').join('');
  files[name]=strToU8(xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData>'+data+'</sheetData>'));
 }
 files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace('Extension="xml" ContentType="application/xml"','Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"').replace(/<Override PartName="\/xl\/workbook.xml"[^>]*\/>/,''));
 return zipSync(files,{level:6});
}
