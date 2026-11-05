import {createCanvas} from '@napi-rs/canvas';
import {pdf} from '../fixtures.js';
import {rasterPdf} from './optical-invoice-fixtures.mjs';

// Frozen before the parser change. Source values are hand-annotated, including
// deliberately unreadable and conflicting documents; never inferred from OCR.
// This is an independent synthetic layout/format sample, not production data.
export const corpusVersion='document-labels-2026-11-05-v1';
export const scalarFieldNames=['invoice_number','party','organization_number','issued_at','due_at','total_cents','vat_cents','net_cents','reference','bankgiro','direction','kind','currency'];
const metadata={direction:'supplier',direction_confident:true};
const base={party:'Exempelverkstan AB',organization_number:'5599990099',issued_at:'2026-10-20',due_at:'2026-11-19',reference:'000026',bankgiro:'123-4567',direction:'supplier',kind:'invoice',currency:'SEK'};
const money=value=>(value/100).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const invoice=(fields,{net='Netto',total='Att betala',inline=false,wrapped=false,decimalPoints=false}={})=>{
  const amount=value=>decimalPoints?money(value).replaceAll(' ','.'):money(value);
  const summary=[`${net}:${wrapped?'\n':' '}${amount(fields.net_cents)} SEK`,`Moms: ${amount(fields.vat_cents)} SEK`,`${total}:${wrapped?'\n':' '}${amount(fields.total_cents)} SEK`];
  return `Faktura\nFakturanummer: ${fields.invoice_number}\nLeverantör: ${fields.party}\nOrganisationsnummer: ${fields.organization_number.slice(0,6)}-${fields.organization_number.slice(6)}\nKund: Syntetiska Kontoret AB\nFakturadatum: ${fields.issued_at}\nFörfallodatum: ${fields.due_at}\n${summary.join(inline?' | ':'\n')}\nOCR: ${fields.reference}\nBankgiro: ${fields.bankgiro}`;
};
const sample=(id,fields,layout={})=>({id,family:'explicit-tax-summary-labels',subset:'text',metadata,requireReview:false,text:invoice(fields,layout),gold:{fields}});

// Development examples use one invoice; the optical validation documents below
// have different amounts/identifiers, typography and arrangements.
const development={...base,invoice_number:'86140',net_cents:400000,vat_cents:100000,total_cents:500000};
export const labelDevelopmentCases=[
  sample('full-word-sums',development,{net:'Summa exklusive moms',total:'Summa inklusive moms'}),
  sample('abbreviated-sums',development,{net:'Summa exkl. moms',total:'Summa inkl. moms'}),
  sample('total-excluding-tax',development,{net:'Totalt exklusive moms',total:'Totalt inklusive moms'}),
  sample('amount-including-tax',development,{net:'Belopp exklusive moms',total:'Belopp inklusive moms'}),
  sample('same-line-summaries',development,{net:'Summa exklusive moms',total:'Summa inklusive moms',inline:true}),
  sample('wrapped-summaries',development,{net:'Summa exkl moms',total:'Summa inkl moms',wrapped:true}),
];
const control=sample('existing-label-control',development);
const negative=(id,text,overrides)=>({...control,id,family:'unsafe-summary-labels',requireReview:true,text,gold:{fields:{...development,...overrides}}});
export const labelSafetyCases=[
  negative('conflicting-gross-alias',control.text+'\nSumma inklusive moms: 5 100,00 SEK',{total_cents:null}),
  negative('conflicting-net-alias',control.text+'\nSumma exklusive moms: 3 900,00 SEK',{net_cents:null}),
  negative('invalid-gross-alias',control.text+'\nSumma inkl. moms: 5 000,00 SEK till godo',{total_cents:null}),
  negative('invalid-net-alias',control.text+'\nTotalt exklusive moms: 4 000,00 SEK samt frakt',{net_cents:null}),
  negative('bare-sum-is-not-a-gross-label',control.text.replace('Att betala:','Summa:'),{total_cents:null}),
  negative('subtotal-is-not-a-gross-label',control.text.replace('Att betala:','Delsumma inklusive moms:'),{total_cents:null}),
  negative('gross-must-not-be-derived',control.text.replace('Att betala: 5 000,00 SEK','Summa inklusive moms: oläsligt'),{total_cents:null}),
];
export const textCases=[...labelDevelopmentCases,control,...labelSafetyCases];

// Separate frozen validation population: six readable rasters, two native PDFs,
// two scanned PDFs, two readable safety cases and two unreadable stress cases.
const validationRecords=[
  {id:'sum-full-png',fields:{...base,invoice_number:'94150',net_cents:240000,vat_cents:60000,total_cents:300000},layout:{net:'Summa exklusive moms',total:'Summa inklusive moms'},font:'32px DejaVu Sans',mimeType:'image/png'},
  {id:'sum-abbreviated-jpeg',fields:{...base,invoice_number:'94151',net_cents:672000,vat_cents:168000,total_cents:840000},layout:{net:'Summa exkl. moms',total:'Summa inkl. moms'},font:'32px DejaVu Serif',mimeType:'image/jpeg'},
  {id:'total-full-png',fields:{...base,invoice_number:'94152',net_cents:1234500,vat_cents:308625,total_cents:1543125},layout:{net:'Totalt exklusive moms',total:'Totalt inklusive moms',decimalPoints:true},font:'32px Arial',mimeType:'image/png'},
  {id:'amount-full-jpeg',fields:{...base,invoice_number:'94153',net_cents:80000,vat_cents:20000,total_cents:100000},layout:{net:'Belopp exklusive moms',total:'Belopp inklusive moms'},font:'30px DejaVu Sans',mimeType:'image/jpeg'},
  {id:'wrapped-tax-sums-png',fields:{...base,invoice_number:'94154',net_cents:161600,vat_cents:40400,total_cents:202000},layout:{net:'Summa exkl moms',total:'Summa inkl moms',wrapped:true},font:'30px Arial',mimeType:'image/png'},
  {id:'conventional-control-png',fields:{...base,invoice_number:'94155',net_cents:960000,vat_cents:240000,total_cents:1200000},layout:{},font:'32px DejaVu Sans',mimeType:'image/png'},
];
const readable=validationRecords.map(record=>({...sample(record.id,record.fields,record.layout),subset:'raster',requireReview:true,record}));
const native=[
  {...sample('native-inline-tax-summaries',{...base,invoice_number:'95160',net_cents:280000,vat_cents:70000,total_cents:350000},{net:'Summa exklusive moms',total:'Summa inklusive moms',inline:true}),subset:'pdf-native'},
  {...sample('native-wrapped-tax-summaries',{...base,invoice_number:'95161',net_cents:560000,vat_cents:140000,total_cents:700000},{net:'Summa exkl. moms',total:'Summa inkl. moms',wrapped:true}),subset:'pdf-native'},
];
const scanned=[
  {...sample('scanned-full-tax-summaries',{...base,invoice_number:'96170',net_cents:360000,vat_cents:90000,total_cents:450000},{net:'Summa exklusive moms',total:'Summa inklusive moms'}),subset:'pdf-raster',requireReview:true},
  {...sample('scanned-amount-tax-summaries',{...base,invoice_number:'96171',net_cents:640000,vat_cents:160000,total_cents:800000},{net:'Belopp exklusive moms',total:'Belopp inklusive moms'}),subset:'pdf-raster',requireReview:true},
];
const opticalSafety=[
  {...labelSafetyCases[0],id:'readable-conflicting-gross-png',subset:'raster'},
  {...labelSafetyCases[2],id:'readable-invalid-gross-png',subset:'raster'},
];
const unreadable=[
  {...readable[0],id:'destroyed-low-resolution-source',family:'unreadable-stress',note:'Known source gold is retained after destructive pixelation. Correct abstention still counts as missing fields.'},
  {...readable[0],id:'blank-raster',family:'unreadable-stress',text:'',gold:{fields:{...Object.fromEntries(scalarFieldNames.map(name=>[name,null])),direction:'supplier',kind:'other'}}},
];
export const opticalCases=[...readable,...native,...scanned,...opticalSafety,...unreadable].map(({record,...entry})=>entry);

function render(text,font='32px DejaVu Sans'){
  const canvas=createCanvas(1600,1600),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='black';ctx.font=font;
  text.split('\n').forEach((line,index)=>ctx.fillText(line,65,70+index*70));
  return canvas;
}
function nativePdf(text){
  // Inline summary needs a wide page to preserve every printed value.
  const stream='BT /F1 13 Tf 40 780 Td 25 TL\n'+text.split('\n').map((line,index)=>(index?'T* ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+'\nET';
  return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1100 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`]);
}
export async function buildOpticalInputs(){
  return opticalCases.map(entry=>{
    if(entry.subset==='pdf-native')return {...entry,mimeType:'application/pdf',bytes:nativePdf(entry.text)};
    const record=validationRecords.find(record=>record.id===entry.id),canvas=render(entry.text,record?.font);
    if(entry.id==='destroyed-low-resolution-source'){
      const tiny=createCanvas(24,24),small=tiny.getContext('2d'),ctx=canvas.getContext('2d');
      small.drawImage(canvas,0,0,24,24);ctx.imageSmoothingEnabled=false;ctx.drawImage(tiny,0,0,1600,1600);
    }
    const mimeType=entry.subset==='pdf-raster'?'application/pdf':record?.mimeType||'image/png';
    return {...entry,mimeType,bytes:mimeType==='application/pdf'?rasterPdf({canvas}):canvas.toBuffer(mimeType)};
  });
}
