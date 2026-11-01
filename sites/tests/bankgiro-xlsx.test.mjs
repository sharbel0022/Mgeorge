import test from 'node:test';
import assert from 'node:assert/strict';
import {utils,write} from 'xlsx';
import {unzipSync,zipSync} from 'fflate';
import {makeBankgiroXLSX,syntheticPayment} from './helpers/bankgiro-xlsx-fixture.mjs';
import {parseBankgiroXLSX} from '../lib/bankgiro-xlsx.js';

const parse=options=>parseBankgiroXLSX(makeBankgiroXLSX(options),'synthetic.xlsx');
test('XLSX reads observed metadata/summary/detail layout and preserves text references',()=>{
 const [r]=parse();assert.equal(r.party,'Testbageriet AB');assert.equal(r.payerReference,'0017');assert.equal(r.amount,12345);assert.equal(r.date,'2026-10-20');assert.equal(r.payerBankgiro,'987-6543');assert.equal(r.recipientBankgiro,'1234-5678');assert.equal(r.currency,'SEK');assert.equal(r.kind,'payment');assert.equal(r.account,'');assert.equal(r.verified,false);
 assert.equal(r.reportEvidence.reportId,'41');assert.equal(r.reportEvidence.valueDate,'2026-10-20');assert.equal(r.referenceEvidence.selected.kind,'structured');assert.equal(r.referenceEvidence.selected.validity,'unchecked');assert.equal(r.payerEvidence.name.value,r.party);assert.match(r.payerEvidence.name.source,/A19/);assert.equal(r.cellProvenance.reference.address,'C19');assert.equal(r.cellProvenance.amount.type,'n');
});
test('XLSX locates headings after inserted blank rows',()=>{assert.equal(parse({shiftRows:5})[0].cellProvenance.reference.address,'C24');});
test('XLSX actual export conventions: implicit row/cell addresses and default workbook content type',()=>{const [r]=parse({legacyCells:true});assert.equal(r.payerReference,'0017');assert.equal(r.amount,12345);assert.equal(r.cellProvenance.party.address,'A19');});
test('XLSX multiple payments and report blocks preserve each report identity',()=>{
 const rows=parse({blocks:[{payments:[syntheticPayment,{party:'Testbutiken AB',reference:'0008',payerBankgiro:'444-5555',amount:90000}]},{date:'2026-10-21',sequence:'42',payments:[{...syntheticPayment,reference:'0009'}]}]});
 assert.equal(rows.length,3);assert.equal(rows[1].amount,90000);assert.equal(rows[2].date,'2026-10-21');assert.equal(rows[2].reportEvidence.reportId,'42');assert.equal(rows[0].reportEvidence.paymentCount,'2');
});
test('XLSX explicit receiver account is preserved and never inferred from recipient BG',()=>{const [r]=parse({account:'SE3550000000054910000003'});assert.equal(r.account,'SE3550000000054910000003');assert.equal(r.recipientBankgiro,'1234-5678');});
test('XLSX Swedish text amounts use exact integer öre',()=>{const rows=parse({mutate:wb=>{wb.Sheets[wb.SheetNames[0]].E19={t:'s',v:'1 234,56'};wb.Sheets[wb.SheetNames[0]].B12={t:'s',v:'1\u00a0234,56'};wb.Sheets[wb.SheetNames[0]].B14={t:'s',v:'1 234,56'};}});assert.equal(rows[0].amount,123456);});
test('XLSX numeric reference uses explicit zero format without guessing',()=>{const [r]=parse({mutate:wb=>{wb.Sheets[wb.SheetNames[0]].C19={t:'n',v:17,z:'0000'};}});assert.equal(r.payerReference,'0017');assert.equal(r.cellProvenance.reference.rawValue,17);assert.equal(r.cellProvenance.reference.numberFormat,'0000');});
test('XLSX numeric general reference fails closed because leading zeros are unknown',()=>{assert.throws(()=>parse({mutate:wb=>{wb.Sheets[wb.SheetNames[0]].C19={t:'n',v:17,z:'General'};}}),/referens.*text|nollor/i);});
test('XLSX zero and explicit text format references preserve original evidence',()=>{assert.equal(parse({payments:[{...syntheticPayment,reference:'0000'}]})[0].payerReference,'0000');});
for(const [name,options,pattern]of [
 ['wrong total',{totalAmount:999},/summa|total/i],['wrong summary amount',{summaryAmount:999},/summa|total/i],['wrong count',{declaredCount:2},/antal/i],['wrong detail count',{detailCount:2},/antal/i],['wrong total count',{totalCount:2},/antal/i],['invalid recipient BG',{recipientBankgiro:'not-bankgiro'},/bankgiro/i],['invalid date',{date:'2026-02-30'},/datum/i],['missing date',{date:''},/datum/i],['missing sequence',{sequence:''},/löpnummer/i],['negative refund',{payments:[{...syntheticPayment,amount:-100}]},/belopp|åter/i],['zero amount',{payments:[{...syntheticPayment,amount:0}]},/belopp/i],['missing sender',{payments:[{...syntheticPayment,party:''}]},/avsändare/i],['missing reference',{payments:[{...syntheticPayment,reference:''}]},/referens/i],['missing sender BG',{payments:[{...syntheticPayment,payerBankgiro:''}]},/bankgiro|avinummer/i],['duplicate payment',{payments:[syntheticPayment,syntheticPayment]},/dubblett|dubbel/i],['duplicate report blocks',{blocks:[{sequence:'41'},{sequence:'41'}]},/dubblett|dubbel|löpnummer/i]
])test(`XLSX rejects ${name}`,()=>assert.throws(()=>parse(options),pattern));
test('XLSX formulas are rejected even with a cached apparent value',()=>{assert.throws(()=>parse({mutate:wb=>{wb.Sheets[wb.SheetNames[0]].E19.f='1+122.45';}}),/formel/i);});
test('XLSX unsafe reference number format and huge numeric identity fail closed',()=>{for(const v of [17,10000000000000000])assert.throws(()=>parse({mutate:wb=>{wb.Sheets[wb.SheetNames[0]].C19={t:'n',v,z:'0.00E+00'};}}),/referens|nollor/i);});
test('XLSX conflicting metadata, overlapping merged fields, and unknown payment rows fail closed',()=>{
 for(const mutate of [wb=>{wb.Sheets[wb.SheetNames[0]].B5={t:'s',v:'2026-10-21'};},wb=>{wb.Sheets[wb.SheetNames[0]]['!merges'].push({s:{r:18,c:2},e:{r:18,c:4}});},wb=>{const s=wb.Sheets[wb.SheetNames[0]];s.A20={t:'s',v:'Unknown extra row'};s.E20={t:'n',v:1};}])assert.throws(()=>parse({mutate}));
});
test('XLSX malformed archive, spoofed extension, encrypted/OLE and oversized bytes fail before rows',()=>{
 for(const bytes of [new Uint8Array(),new Uint8Array([80,75,3,4,1]),new TextEncoder().encode('not excel'),new Uint8Array(15_000_001)])assert.throws(()=>parseBankgiroXLSX(bytes,'test.xlsx'));
 assert.throws(()=>parseBankgiroXLSX(makeBankgiroXLSX(),'test.xls'));
});
test('XLSX hidden worksheets and unsupported additional worksheet layouts are rejected',()=>{
 assert.throws(()=>parse({mutate:wb=>{utils.book_append_sheet(wb,utils.aoa_to_sheet([['unknown data']]),'Other');}}),/arbetsblad|layout/i);
 assert.throws(()=>parse({mutate:wb=>{wb.Workbook={Sheets:[{Hidden:1}]};}}),/dold|arbetsblad/i);
 assert.throws(()=>parse({mutate:wb=>{const s=wb.Sheets[wb.SheetNames[0]];s['!rows']=[];s['!rows'][18]={hidden:true};}}),/dold/i);
 assert.throws(()=>parse({mutate:wb=>{const s=wb.Sheets[wb.SheetNames[0]];s['!cols']=[];s['!cols'][2]={hidden:true};}}),/dold/i);
});
test('XLSX Excel serial date is validated with workbook date system',()=>{const [r]=parse({mutate:wb=>{wb.Sheets[wb.SheetNames[0]].A5={t:'n',v:46315,z:'yyyy-mm-dd'};}});assert.equal(r.date,'2026-10-20');});
test('XLSX merging payer name leaves bank reference in its distinct source cell',()=>{const [r]=parse();assert.notEqual(r.cellProvenance.party.address,r.cellProvenance.reference.address);assert.equal(r.referenceEvidence.candidates.some(c=>c.kind==='ocr'),false);});
test('XLSX verifies actual inflated sizes and CRC before the workbook library',()=>{
 for(const forgedSize of [0,1]){
  const bytes=makeBankgiroXLSX(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let central=0;while(v.getUint32(central,true)!==0x02014b50)central++;const local=v.getUint32(central+42,true);v.setUint32(central+24,forgedSize,true);v.setUint32(local+22,forgedSize,true);
  assert.throws(()=>parseBankgiroXLSX(bytes,'bad.xlsx'),/storlek|komprimering/i);
 }
 const bytes=makeBankgiroXLSX(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let central=0;while(v.getUint32(central,true)!==0x02014b50)central++;const local=v.getUint32(central+42,true);v.setUint32(central+16,0,true);v.setUint32(local+14,0,true);assert.throws(()=>parseBankgiroXLSX(bytes,'crc.xlsx'),/kontrollsumma/i);
});
test('XLSX ZIP64 extra fields, macros and externally sourced files are rejected',()=>{
 const files=unzipSync(makeBankgiroXLSX());
 for(const extra of [1]){const entries=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,[bytes,{extra:{[extra]:new Uint8Array(16)}}]]));assert.throws(()=>parseBankgiroXLSX(zipSync(entries),'zip64.xlsx'),/ZIP64/i);}
 for(const name of ['xl/vbaProject.bin','xl/externalLinks/externalLink1.xml'])assert.throws(()=>parseBankgiroXLSX(zipSync({...files,[name]:new Uint8Array([1])}),'external.xlsx'),/makron|externa/i);
});
test('XLSX excessive merge work and overlapping merges are rejected',()=>{
 assert.throws(()=>parse({mutate:wb=>{const s=wb.Sheets[wb.SheetNames[0]];s['!merges']=Array.from({length:5001},()=>({s:{r:0,c:0},e:{r:0,c:1}}));}}),/sammanslagna/i);
 assert.throws(()=>parse({mutate:wb=>{const s=wb.Sheets[wb.SheetNames[0]];s['!merges'].push(s['!merges'][0]);}}),/sammanslagna/i);
});
