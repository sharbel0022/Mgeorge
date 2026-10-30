import {createCanvas} from '@napi-rs/canvas';
import {pdf} from '../fixtures.js';

// Entirely synthetic invoices. Values are stated explicitly in each original;
// fixtures never infer an invoice identity from a payment amount or OCR value.
export const context={direction:'supplier',direction_confident:true,original_filename:'syntetiskt-underlag.pdf',subject:'Syntetiskt underlag',from:'supplier@example.test'};
export const invoiceText=`Faktura
Fakturanummer: 0606
Leverantör: Testbolaget AB
Organisationsnummer: 556016-0680
Fakturadatum: 2026-10-24
Förfallodatum: 2026-11-07
Netto: 3 000,00 kr
Moms: 750,00 kr
Att betala: 3 750,00 SEK
OCR: 000018
Bankgiro: 123-4567`;

export const invoiceHeader=(heading,values)=>invoiceText.replace('Fakturanummer: 0606',heading+'\n'+values).replace('\nOCR: 000018','');
export const columnInvoice=invoiceHeader('Fakturanummer    OCR','0606    000018');
export const missingNumber=invoiceText.replace('Fakturanummer: 0606','Fakturanummer:');
export const adjacentOcr=invoiceText.replace('Fakturanummer: 0606','Fakturanummer:\nOCR: 000018').replace(/\nOCR: 000018(?=\nBankgiro)/,'');
export const hyphenDates=invoiceText.replace('2026-10-24','24-10-2026').replace('2026-11-07','7-11-2026');
export const ambiguousHeaderCases=[
 {name:'punctuated OCR and invoice columns',text:invoiceHeader('OCR:    Fakturanummer:','000018    0606')},
 {name:'abbreviated dotted invoice heading',text:invoiceHeader('OCR    Fakturanr.','000018    0606')},
 {name:'three column headings do not establish identity',text:invoiceHeader('Kundnummer    OCR    Fakturanummer','0303    000018    0606')},
 {name:'customer heading between invoice and OCR columns',text:invoiceHeader('Fakturanummer    Kundnummer    OCR','0606    0303    000018')},
 {name:'page heading between invoice and OCR columns',text:invoiceHeader('Fakturanummer    Sida    OCR','0606    1    000018')},
 {name:'invoice and OCR heading list across lines',text:invoiceHeader('OCR\nFakturanummer','000018\n0606')},
 {name:'punctuated heading list across lines',text:invoiceHeader('OCR:\nFakturanummer:','000018\n0606')},
 {name:'spaced slash between OCR and invoice headings',text:invoiceHeader('OCR / Fakturanummer','000018    0606')},
 {name:'unspaced slash between OCR and invoice headings',text:invoiceHeader('OCR/Fakturanummer','000018    0606')},
 {name:'pipe between OCR and invoice headings',text:invoiceHeader('OCR | Fakturanummer','000018    0606')},
 {name:'semicolon between OCR and invoice headings',text:invoiceHeader('OCR; Fakturanummer','000018    0606')},
];
export const percentVat=invoiceText.replace('Netto: 3 000,00 kr','Netto: 1 000,00 kr').replace('Moms: 750,00 kr','Moms 25 %: 250,00 kr').replace('Att betala: 3 750,00 SEK','Att betala: 1 025,00 SEK');

export const identityCases=[
 {name:'explicit separately labelled invoice and OCR',text:invoiceText,number:'0606',reference:'000018'},
 {name:'explicit inline values separate invoice and OCR headings',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: 0606 OCR: 000018').replace(/\nOCR: 000018(?=\nBankgiro)/,''),number:'0606',reference:'000018'},
 {name:'invoice and OCR columns need spatial review',text:columnInvoice,held:true,ambiguousColumns:true},
 {name:'reversed OCR and invoice columns need spatial review',text:invoiceHeader('OCR    Fakturanummer','000018    0606'),held:true,ambiguousColumns:true},
 {name:'column identifiers are never guessed from text order',text:invoiceHeader('Fakturanr    OCR-nummer','AB/00606    000018'),held:true,ambiguousColumns:true},
 {name:'separate next-line invoice number',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer:\n0606'),number:'0606',reference:'000018'},
 {name:'legitimate OCR-prefixed invoice identity',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: OCR-0606'),number:'OCR-0606',reference:'000018'},
 {name:'legitimate slashed invoice identity',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: AB/00606'),number:'AB/00606',reference:'000018'},
 {name:'legitimate slashed OCR-prefixed invoice identity',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: INV/OCR-0606'),number:'INV/OCR-0606',reference:'000018'},
 {name:'maximum supported identifier is complete',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: '+('A'.repeat(76)+'0606')),number:'A'.repeat(76)+'0606',reference:'000018'},
 {name:'missing value cannot consume the OCR label',text:adjacentOcr,held:true},
 {name:'missing value cannot consume a supplier label',text:missingNumber,held:true},
 {name:'an incomplete column pair stays unresolved',text:invoiceHeader('Fakturanummer    OCR','0606'),held:true,ambiguousColumns:true},
 {name:'an extra column value stays unresolved',text:invoiceHeader('Fakturanummer    OCR','0606    000018    0999'),held:true,ambiguousColumns:true},
 {name:'non-numeric OCR column stays unresolved',text:invoiceHeader('Fakturanummer    OCR','0606    UNKNOWN'),held:true,ambiguousColumns:true},
 {name:'combined invoice/OCR heading stays unresolved',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer/OCR: 000018'),held:true},
 {name:'long identifier cannot be truncated',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: '+('A'.repeat(76)+'0606-2')),held:true},
 {name:'unsupported punctuation cannot create an identifier prefix',text:invoiceText.replace('Fakturanummer: 0606','Fakturanummer: 2026.0606'),held:true},
 {name:'valid occurrence cannot erase an unreadable second invoice number',text:invoiceText+'\nFakturanummer: ??',held:true},
 {name:'valid occurrence cannot erase an overlong second invoice number',text:invoiceText+'\nFakturanummer: '+('A'.repeat(76)+'0606-2'),held:true},
 {name:'a conflicting direct number and column number remain held',text:columnInvoice+'\nFakturanummer: 0607',held:true},
 ...ambiguousHeaderCases.map(item=>({...item,held:true,ambiguousColumns:true})),
];

export const moneyCases=[
 {name:'spaced VAT percentage cannot masquerade as a monetary amount',text:percentVat},
 {name:'unspaced VAT percentage remains unresolved',text:percentVat.replace('25 %','25%')},
 {name:'decimal VAT percentage cannot masquerade as a monetary amount',text:percentVat.replace('25 %: 250,00','12,5 %: 125,00').replace('1 025,00','1 012,50')},
];

export const dateCases=[
 {name:'explicit Swedish hyphen dates',text:hyphenDates,issued:'2026-10-24',due:'2026-11-07'},
 {name:'padded Swedish hyphen dates',text:hyphenDates.replace('7-11-2026','07-11-2026'),issued:'2026-10-24',due:'2026-11-07'},
 {name:'leap day remains a real calendar date',text:invoiceText.replace('2026-10-24','29-02-2024').replace('2026-11-07','01-03-2024'),issued:'2024-02-29',due:'2024-03-01'},
 {name:'invalid leap day stays unknown',text:hyphenDates.replace('24-10-2026','29-02-2026'),held:'issued_at'},
 {name:'invalid month stays unknown',text:hyphenDates.replace('24-10-2026','24-13-2026'),held:'issued_at'},
 {name:'mixed date delimiters stay unknown',text:hyphenDates.replace('24-10-2026','24-10.2026'),held:'issued_at'},
 {name:'trailing year digits cannot be truncated',text:hyphenDates.replace('24-10-2026','24-10-20260'),held:'issued_at'},
 {name:'a valid date cannot erase another invalid labelled date',text:hyphenDates+'\nFörfallodatum: 31-11-2026',held:'due_at'},
];

function escapePdf(value){return value.replace(/[()\\]/g,'\\$&');}
export function invoicePdf(text,{fontSize=11,reverseColumnValueOrder=false}={}){
 const lines=text.split('\n'),commands=[];
 for(let n=0;n<lines.length;n++){
  const parts=lines[n].split(/ {3,}/).map((text,column)=>({text,column})),y=790-n*23;
  // Change content-stream order without changing either printed position.
  if(reverseColumnValueOrder&&parts.length===2&&parts.every(part=>/^\d+$/.test(part.text)))parts.reverse();
  for(const {text:part,column}of parts)commands.push(`BT /F1 ${fontSize} Tf 1 0 0 1 ${40+column*(parts.length>2?170:245)} ${y} Tm (${escapePdf(part)}) Tj ET`);
 }
 const stream=commands.join('\n');
 return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`]);
}

export function invoiceImage(text){
 const canvas=createCanvas(1500,1500),ctx=canvas.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,1500,1500);ctx.fillStyle='black';ctx.font='32px Arial';
 text.split('\n').forEach((line,n)=>line.split(/ {3,}/).forEach((part,column)=>ctx.fillText(part,60+column*650,70+n*72)));
 return canvas.toBuffer('image/png');
}
