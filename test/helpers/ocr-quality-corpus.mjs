// Synthetic, independently annotated benchmark. No production parser, LLM,
// customer original or inferred arithmetic is used to construct expected values.
// Shared literals make the ordinary fields explicit once; every changed answer
// below is a hand-written literal, never calculated from a parser result.
export const corpusVersion='mgeorge-ocr-quality-corpus-v1';
export const context={direction:'supplier',direction_confident:true};
export const scalarFieldNames=['invoice_number','party','organization_number','issued_at','due_at','total_cents','vat_cents','net_cents','reference','bankgiro','direction','kind','currency'];

const baseFields={invoice_number:'000606',party:'Testbolaget AB',organization_number:'5560160680',issued_at:'2026-10-24',due_at:'2026-11-07',total_cents:375000,vat_cents:75000,net_cents:300000,reference:'000018',bankgiro:'123-4567',direction:'supplier',kind:'invoice',currency:'SEK'};
const base=`Faktura
Fakturanummer: 000606
Leverantör: Testbolaget AB
Organisationsnummer: 556016-0680
Kund: Café Exempel AB
Fakturadatum: 2026-10-24
Förfallodatum: 2026-11-07
Netto: 3 000,00 kr
Moms: 750,00 kr
Att betala: 3 750,00 SEK
OCR: 000018
Bankgiro: 123-4567`;
const english=`Invoice
Invoice number: EN-0007
Supplier: Northwind Demo Ltd
Organisation number: 556016-0680
Customer: Example Clinic AB
Invoice date: 24.10.2026
Due date: 07.11.2026
Net amount: 1000.00
VAT: 250.00
Amount due: 1250.00 SEK
Payment reference: INV/0007
Bankgiro: 123-4567`;
const englishFields={invoice_number:'EN-0007',party:'Northwind Demo Ltd',organization_number:'5560160680',issued_at:'2026-10-24',due_at:'2026-11-07',total_cents:125000,vat_cents:25000,net_cents:100000,reference:'INV/0007',bankgiro:'123-4567',direction:'supplier',kind:'invoice',currency:'SEK'};
const roles=`Faktura
Fakturanummer: 000606
Leverantör: Testbolaget AB
Organisationsnummer: 556016-0680
Kund: Café Exempel AB
Organisationsnummer: 556036-0793
Fakturadatum: 2026-10-24
Förfallodatum: 2026-11-07
Netto: 3 000,00 kr
Moms: 750,00 kr
Att betala: 3 750,00 SEK
OCR: 000018
Bankgiro: 123-4567`;
const partyDetails={supplier:{name:'Testbolaget AB',organization_number:'5560160680'},recipient:{name:'Café Exempel AB',organization_number:'5560360793'}};
const header='Beskrivning | Antal | À-pris | Netto | Moms % | Momsbelopp | Radbelopp';
const englishHeader='Description | Quantity | Unit price | Net amount | VAT % | VAT amount | Line total';
const rowA={description:'Konsulttid',quantity:2,unit_price_cents:150000,net_cents:300000,vat_rate:25,vat_cents:75000,total_cents:375000};
const record=(id,family,text,{fields={},details,requireReview=false,metadata={},note=''}={})=>({id,family,subset:'text',text,metadata:{...context,...metadata},gold:{fields:{...baseFields,...fields},...(details?{details}:{})},requireReview,note});

export const textCases=[
  record('sv-standard-leading-zeroes','normal',base,{details:{supplier:{name:'Testbolaget AB',organization_number:'5560160680'},recipient:{name:'Café Exempel AB',organization_number:null},reference:{kind:'ocr',value:'000018',checksum_valid:true,formal_verified:false}}}),
  record('en-standard-generic-reference','normal',english,{fields:englishFields,details:{supplier:{name:'Northwind Demo Ltd',organization_number:'5560160680'},recipient:{name:'Example Clinic AB',organization_number:null},reference:{kind:'payment_reference',value:'INV/0007',checksum_valid:null,formal_verified:false}}}),
  record('sv-character-spaced-identifiers','identifiers',base.replace('Fakturanummer: 000606','Fakturanummer: 0 0 0 6 0 6').replace('OCR: 000018','OCR: 0 0 0 0 1 8')),
  record('sv-credit-negative-source-values','credit',base.replace('Faktura\n','Kreditfaktura\n').replace('Netto: 3 000,00','Netto: -3 000,00').replace('Moms: 750,00','Moms: -750,00').replace('Att betala: 3 750,00','Att betala: -3 750,00'),{fields:{kind:'credit'},note:'Existing scalar contract stores positive ledger amounts for credits; printed signs remain in original text.'}),
  record('en-foreign-currency','foreign-currency',english.replace('1250.00 SEK','1250.00 EUR'),{fields:{...englishFields,currency:'EUR'},requireReview:true,note:'Printed EUR values are factual; the current financial register supports SEK only.'}),
  record('sv-explicit-zero-vat','zero-values',base.replace('Netto: 3 000,00','Netto: 3 750,00').replace('Moms: 750,00','Moms: 0,00'),{fields:{net_cents:375000,vat_cents:0}}),
  record('sv-zero-total-requires-review','zero-values',base.replace('Netto: 3 000,00','Netto: 0,00').replace('Moms: 750,00','Moms: 0,00').replace('Att betala: 3 750,00','Att betala: 0,00'),{fields:{net_cents:0,vat_cents:0,total_cents:0},requireReview:true}),
  record('missing-invoice-number','missing-values',base.replace('Fakturanummer: 000606\n',''),{fields:{invoice_number:null},requireReview:true}),
  record('empty-invoice-number','missing-values',base.replace('Fakturanummer: 000606','Fakturanummer:'),{fields:{invoice_number:null},requireReview:true}),
  record('conflicting-invoice-numbers','conflicts',base+'\nFakturanummer: 000999',{fields:{invoice_number:null},requireReview:true}),
  record('metadata-filename-id-suffix','metadata',base,{metadata:{filename:'Fakturanummer 000606-REV2.pdf'},requireReview:true,note:'Metadata may veto approval, but may not replace the invoice value printed in the document.'}),
  record('metadata-subject-id-suffix','metadata',base,{metadata:{subject:'Fakturanummer 000606A'},requireReview:true}),
  record('metadata-cannot-fill-missing-id','metadata',base.replace('Fakturanummer: 000606\n',''),{fields:{invoice_number:null},metadata:{subject:'Fakturanummer 000606'},requireReview:true}),
  record('empty-supplier-name','party-roles',base.replace('Leverantör: Testbolaget AB','Leverantör:'),{fields:{party:null},requireReview:true}),
  record('valid-supplier-plus-empty-supplier','party-roles',base+'\nLeverantör:',{fields:{party:null},requireReview:true}),
  record('conflicting-supplier-names','party-roles',base+'\nLeverantör: Annat Testbolag AB',{fields:{party:null},requireReview:true}),
  record('missing-organization-number','organization-roles',base.replace('Organisationsnummer: 556016-0680\n',''),{fields:{organization_number:null},requireReview:true}),
  record('valid-org-plus-empty-org','organization-roles',base+'\nOrganisationsnummer:',{fields:{organization_number:null},requireReview:true}),
  record('supplier-and-recipient-orgs','organization-roles',roles,{details:partyDetails}),
  record('customer-direction-selects-recipient','organization-roles',roles,{fields:{party:'Café Exempel AB',organization_number:'5560360793',direction:'customer'},details:partyDetails,metadata:{direction:'customer'}}),
  record('same-supplier-conflicting-orgs','organization-roles',base+'\nLeverantör: Testbolaget AB\nOrganisationsnummer: 556036-0793',{fields:{organization_number:null},requireReview:true}),
  record('explicit-ocr-invalid-check-digit','identifiers',base.replace('OCR: 000018','OCR: 0606'),{fields:{reference:'0606'},details:{reference:{kind:'ocr',value:'0606',checksum_valid:false,formal_verified:false}},requireReview:true,note:'The printed numeric token is preserved, but its Luhn check digit is invalid. A generic payment reference would be a different assertion.'}),
  record('ambiguous-two-numeric-columns','identifiers',base.replace('Fakturanummer: 000606','Fakturanummer OCR\n000606 000018').replace('\nOCR: 000018',''),{fields:{invoice_number:null,reference:null},requireReview:true}),
  record('valid-ocr-plus-empty-ocr','identifiers',base+'\nOCR:',{fields:{reference:null},requireReview:true}),
  record('conflicting-document-totals','conflicts',base+'\nAtt betala: 4 000,00 SEK',{fields:{total_cents:null},requireReview:true}),
  record('document-arithmetic-conflict','arithmetic',base.replace('Moms: 750,00','Moms: 700,00'),{fields:{vat_cents:70000},requireReview:true,note:'Contradictory printed values are retained as facts; inconsistency requires review.'}),
  record('vat-rate-is-not-vat-money','arithmetic',base.replace('Moms: 750,00 kr','Moms: 25 %'),{fields:{vat_cents:null},requireReview:true}),
  record('invalid-calendar-date','dates',base.replace('Fakturadatum: 2026-10-24','Fakturadatum: 2026-02-30'),{fields:{issued_at:null},requireReview:true}),
  record('one-complete-swedish-row','line-items',base+'\n'+header+'\nKonsulttid | 2 | 1500,00 | 3000,00 | 25 % | 750,00 | 3750,00',{details:{line_items:[rowA],vat_rates:[25],table_status:'complete'}}),
  record('two-rows-mixed-vat-rates','line-items',base.replace('Moms: 750,00','Moms: 300,00').replace('Att betala: 3 750,00','Att betala: 3 300,00')+'\n'+header+'\nBöcker | 2 | 500,00 | 1000,00 | 6 % | 60,00 | 1060,00\nLivsmedel | 1 | 2000,00 | 2000,00 | 12 % | 240,00 | 2240,00',{fields:{vat_cents:30000,total_cents:330000},details:{line_items:[{description:'Böcker',quantity:2,unit_price_cents:50000,net_cents:100000,vat_rate:6,vat_cents:6000,total_cents:106000},{description:'Livsmedel',quantity:1,unit_price_cents:200000,net_cents:200000,vat_rate:12,vat_cents:24000,total_cents:224000}],vat_rates:[6,12],table_status:'complete'}}),
  record('one-complete-english-row','line-items',english+'\n'+englishHeader+'\nSupport | 2 | 500.00 | 1000.00 | 25 % | 250.00 | 1250.00',{fields:englishFields,details:{line_items:[{description:'Support',quantity:2,unit_price_cents:50000,net_cents:100000,vat_rate:25,vat_cents:25000,total_cents:125000}],vat_rates:[25],table_status:'complete'}}),
  record('row-vat-conflicts-with-rate','arithmetic',base+'\n'+header+'\nKonsulttid | 2 | 1500,00 | 3000,00 | 25 % | 650,00 | 3650,00',{requireReview:true}),
  record('no-discount-prose-does-not-bypass-rate-check','discounts',base.replace('Netto: 3 000,00','Netto: 200,00').replace('Moms: 750,00','Moms: 10,00').replace('Att betala: 3 750,00','Att betala: 210,00')+'\nIngen rabatt tillämpas.\n'+header+'\nArbete | 2 | 100,00 | 200,00 | 25 % | 10,00 | 210,00',{fields:{net_cents:20000,vat_cents:1000,total_cents:21000},requireReview:true}),
  record('explicit-discount-needs-supported-calculation','discounts',base.replace('Netto: 3 000,00','Netto: 2700,00').replace('Moms: 750,00','Moms: 675,00').replace('Att betala: 3 750,00','Att betala: 3375,00')+'\nRabatt: 10 %\n'+header+'\nKonsulttid | 2 | 1500,00 | 2700,00 | 25 % | 675,00 | 3375,00',{fields:{net_cents:270000,vat_cents:67500,total_cents:337500},requireReview:true,note:'Displayed amounts are known; a discount schema beyond this evaluator\'s supported row contract requires review.'}),
  record('two-pages-same-invoice-table-continued','multi-page',base+'\n'+header+'\nDel ett | 1 | 1000,00 | 1000,00 | 25 % | 250,00 | 1250,00\fFakturanummer: 000606\n'+header+'\nDel två | 1 | 2000,00 | 2000,00 | 25 % | 500,00 | 2500,00',{details:{line_items:[{description:'Del ett',quantity:1,unit_price_cents:100000,net_cents:100000,vat_rate:25,vat_cents:25000,total_cents:125000},{description:'Del två',quantity:1,unit_price_cents:200000,net_cents:200000,vat_rate:25,vat_cents:50000,total_cents:250000}],vat_rates:[25],table_status:'complete'}}),
  record('second-page-starts-another-invoice','multi-page',base+'\n'+header+'\nDel ett | 1 | 1000,00 | 1000,00 | 25 % | 250,00 | 1250,00\fFakturanummer: 000999\n'+header+'\nDel två | 1 | 2000,00 | 2000,00 | 25 % | 500,00 | 2500,00',{fields:{invoice_number:null},requireReview:true}),
  record('row-with-missing-vat-cell','partial-tables',base+'\n'+header+'\nKonsulttid | 2 | 1500,00 | 3000,00 | 25 % | | 3750,00',{details:{line_items:[{description:'Konsulttid',quantity:2,unit_price_cents:150000,net_cents:300000,vat_rate:25,vat_cents:null,total_cents:375000}]},requireReview:true}),
  record('row-total-cannot-fill-document-total','partial-tables',base.replace('Att betala: 3 750,00 SEK\n','')+'\nValuta: SEK\n'+header+'\nKonsulttid | 2 | 1500,00 | 3000,00 | 25 % | 750,00 | 3750,00',{fields:{total_cents:null},requireReview:true}),
  record('partial-second-row-never-dropped','partial-tables',base+'\n'+header+'\nDel ett | 1 | 1000,00 | 1000,00 | 25 % | 250,00 | 1250,00\nDel två | 1 | | | 25 % | |',{requireReview:true}),
  record('three-rows-zero-six-and-twentyfive-vat','line-items',base.replace('Netto: 3 000,00','Netto: 600,00').replace('Moms: 750,00','Moms: 87,00').replace('Att betala: 3 750,00','Att betala: 687,00')+'\n'+header+'\nMomsfritt | 1 | 100,00 | 100,00 | 0 % | 0,00 | 100,00\nBok | 1 | 200,00 | 200,00 | 6 % | 12,00 | 212,00\nTjänst | 1 | 300,00 | 300,00 | 25 % | 75,00 | 375,00',{fields:{net_cents:60000,vat_cents:8700,total_cents:68700},details:{line_items:[{description:'Momsfritt',quantity:1,unit_price_cents:10000,net_cents:10000,vat_rate:0,vat_cents:0,total_cents:10000},{description:'Bok',quantity:1,unit_price_cents:20000,net_cents:20000,vat_rate:6,vat_cents:1200,total_cents:21200},{description:'Tjänst',quantity:1,unit_price_cents:30000,net_cents:30000,vat_rate:25,vat_cents:7500,total_cents:37500}],vat_rates:[0,6,25],table_status:'complete'}}),
];

const opticalFields={invoice_number:'0606',party:'Testbolaget AB',organization_number:'5560160680',issued_at:'2026-10-24',due_at:'2026-11-07',total_cents:375000,vat_cents:75000,net_cents:300000,reference:'000018',bankgiro:'123-4567',direction:'supplier',kind:'invoice',currency:'SEK'};
const opticalText=`Faktura
Fakturanummer: 0606
Leverantör: Testbolaget AB
Organisationsnummer: 556016-0680
Kund: Café Exempel AB
Fakturadatum: 2026-10-24
Förfallodatum: 2026-11-07
Netto: 3 000,00 kr
Moms: 750,00 kr
Att betala: 3 750,00 SEK
OCR: 000018
Bankgiro: 123-4567`;
const blankFields={invoice_number:null,party:null,organization_number:null,issued_at:null,due_at:null,total_cents:null,vat_cents:null,net_cents:null,reference:null,bankgiro:null,direction:'supplier',kind:'other',currency:null};
const optical=(id,subset,format,{fields={},requireReview=subset!=='pdf-native',note=''}={})=>({id,family:subset,subset,format,metadata:context,gold:{fields:{...opticalFields,...fields}},requireReview,note});
export const opticalCases=[
  optical('native-text-pdf','pdf-native','native'),
  optical('native-positioned-id-reference','pdf-native','positioned-natural',{fields:{reference:'000018'}}),
  optical('native-identical-visible-permuted-order','pdf-native','positioned-permuted',{fields:{reference:'000018'}}),
  optical('clear-png','raster','png'),
  optical('clear-jpeg','raster','jpeg'),
  optical('scanned-image-only-pdf','pdf-raster','scan'),
  optical('scanned-pdf-with-digital-footer','pdf-raster','scan-footer'),
  optical('blank-raster','raster','blank',{fields:blankFields}),
  optical('severely-pixelated-invoice','raster','pixelated',{note:'Gold retains the known original invoice facts. Deliberately unreadable pixels must reduce recall, even when manual review is the correct safe decision.'}),
];

// Called only by the runner. Byte generators are self-contained here, independent
// of both --source-root and mutable application-test fixtures. Every emitted
// PDF/image byte hash is reported. The local canvas dependency is versioned.
export async function buildOpticalInputs(){
  const {createCanvas}=await import('@napi-rs/canvas');
  const pdf=objects=>{
    let content='%PDF-1.4\n';const offsets=[];
    for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(content,'latin1'));content+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=Buffer.byteLength(content,'latin1');
    content+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(content,'latin1');
  };
  const textStream=(text,fontSize=14)=>`BT /F1 ${fontSize} Tf 40 780 Td 22 TL\n`+text.split('\n').map((line,i)=>(i?'T* ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+'\nET';
  const native=()=>{
    const stream=textStream(opticalText);
    return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`]);
  };
  const rasterPdf=(canvas,footer='')=>{
    const jpg=canvas.toBuffer('image/jpeg'),stream='q 595 0 0 595 0 200 cm /Im0 Do Q'+(footer?'\n'+textStream(footer,10):'');
    return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>',`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg.toString('latin1')}\nendstream`,`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
  };
  const positioned=(permuted=false)=>{
    const ids=[['Fakturanummer:',40,740],['0606',200,740],['OCR:',40,718],['000018',200,718]];
    const remainder=[['Faktura',40,790],['Leverantör: Testbolaget AB',40,680],['Organisationsnummer: 556016-0680',40,660],['Fakturadatum: 2026-10-24',40,640],['Förfallodatum: 2026-11-07',40,620],['Netto: 3000,00 kr',40,600],['Moms: 750,00 kr',40,580],['Att betala: 3750,00 SEK',40,560],['Bankgiro: 123-4567',40,540]];
    const ordered=[...(permuted?[ids[0],ids[3],ids[2],ids[1]]:ids),...remainder];
    const stream=ordered.map(([value,x,y])=>`BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${value.replace(/[()\\]/g,'\\$&')}) Tj ET`).join('\n');
    return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`]);
  };
  const clear=createCanvas(1400,1400),clearContext=clear.getContext('2d');
  clearContext.fillStyle='white';clearContext.fillRect(0,0,1400,1400);clearContext.fillStyle='black';clearContext.font='32px Arial';
  opticalText.split('\n').forEach((line,i)=>clearContext.fillText(line,60,70+i*68));
  const blank=createCanvas(1400,1400),blankContext=blank.getContext('2d');
  blankContext.fillStyle='white';blankContext.fillRect(0,0,1400,1400);
  const tiny=createCanvas(25,25);tiny.getContext('2d').drawImage(clear,0,0,25,25);
  const poor=createCanvas(1400,1400),poorContext=poor.getContext('2d');
  poorContext.imageSmoothingEnabled=false;poorContext.drawImage(tiny,0,0,1400,1400);
  const archiveFooter='Archived digital copy. This document was preserved by the synthetic document archive. Internal storage reference only.';
  const bytesByFormat={native:native(),'positioned-natural':positioned(),'positioned-permuted':positioned(true),png:clear.toBuffer('image/png'),jpeg:clear.toBuffer('image/jpeg'),scan:rasterPdf(clear),'scan-footer':rasterPdf(clear,archiveFooter),blank:blank.toBuffer('image/png'),pixelated:poor.toBuffer('image/png')};
  return opticalCases.map(sample=>({...sample,bytes:bytesByFormat[sample.format],mimeType:sample.format==='jpeg'?'image/jpeg':['png','blank','pixelated'].includes(sample.format)?'image/png':'application/pdf'}));
}
