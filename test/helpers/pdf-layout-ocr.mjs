import {image,pdf,text as fixtureText} from '../fixtures.js';

export const layoutInvoiceText=`Faktura
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
export const layoutContext={direction:'supplier',direction_confident:true,from:'supplier@example.test',subject:'Syntetiskt underlag'};
const escape=value=>String(value).replace(/[()\\]/g,'\\$&');
const draw=(value,x,y,transform='1 0 0 1')=>`BT /F1 12 Tf ${transform} ${x} ${y} Tm (${escape(value)}) Tj ET`;

export function pagesPdf(streams){
  const font=3+streams.length*2,objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${streams.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${streams.length} >>`];
  for(const [i,stream]of streams.entries())objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  return pdf(objects);
}

// Only content-stream order changes. Coordinates, text, font and visible pixels
// are identical; the two identifiers have independently specified meanings.
export function positionedInvoicePdf({order=[0,1,2,3],columns=false,rotated=false,mirrored=false,overlap=false}={}){
  const identity=columns?
    [draw('Fakturanummer:',40,750),draw('0606',40,730),draw('OCR:',300,750),draw('000018',300,730)]:
    [draw('Fakturanummer:',40,750),draw('0606',200,750),draw('OCR:',40,728),draw('000018',200,728)];
  if(rotated)identity[1]=draw('0606',200,750,'0 1 -1 0');
  if(mirrored)identity[1]=draw('0606',200,750,'1 0 0 -1');
  const body=layoutInvoiceText.split('\n').filter(line=>!/^(?:Faktura$|Fakturanummer:|OCR:)/i.test(line));
  const stream=[draw('Faktura',40,790),...order.map(i=>identity[i]),...(overlap?[draw('0999',200,750)]:[]),...body.map((line,i)=>draw(line,40,680-i*22))].join('\n');
  return pagesPdf([stream]);
}

export function continuedInvoicePdf(){
  const first=layoutInvoiceText.split('\n').map((line,i)=>draw(line,40,780-i*22)).join('\n');
  const second=['Faktura 0606, fortsättning sida 2 av 2','Specifikation av levererade tjänster enligt originalets första sida.','Detta är syntetiskt testunderlag med en uttrycklig sidgräns.'].map((line,i)=>draw(line,40,780-i*22)).join('\n');
  return pagesPdf([first,second]);
}

export function tableInvoicePdf({continued=false}={}){
  const prefix=layoutInvoiceText.split('\n').filter(line=>!/^(?:Netto:|Moms:|Att betala:)/.test(line)).map((line,i)=>draw(line,40,780-i*22));
  const cells=(values,y)=>values.map((value,i)=>draw(value,[40,240,320,450][i],y)).join('\n');
  const header=y=>cells(['Beskrivning','Antal','Enhetspris','Netto'],y);
  const summary=y=>['Netto: 300,00 SEK','Moms: 62,00 SEK','Att betala: 362,00 SEK'].map((line,i)=>draw(line,40,y-i*22)).join('\n');
  const first=[...prefix,header(570),cells(['Tjänst A','2','100,00','200,00'],548)];
  if(continued)return pagesPdf([first.join('\n'),[draw('Faktura 0606, fortsättning sida 2 av 2',40,790),header(750),cells(['Tjänst B','1','100,00','100,00'],728),summary(680)].join('\n')]);
  return pagesPdf([[...first,cells(['Tjänst B','1','100,00','100,00'],526),summary(480)].join('\n')]);
}

export function paintedInvoicePdf(variant){
  const body=layoutInvoiceText.split('\n').map((line,i)=>draw(line,40,780-i*22)).join('\n');
  const prefix={white:'1 1 1 rg\n',clipped:'0 0 1 1 re W n\n',dark:'0 0 0 rg 0 0 595 842 re f\n'}[variant]||'';
  const suffix=variant==='covered'?'\n1 1 1 rg 0 0 595 842 re f':'';
  return pagesPdf([prefix+body+suffix]);
}

// A complete native text layer must not supersede the visually unchanged scan.
export function hiddenLayerInvoicePdf({hidden=true,mode=3,opacity=null}={}){
  const canvas=image(),jpg=canvas.toBuffer('image/jpeg');
  const hiddenText=fixtureText.replace('Fakturanummer: 0606','Fakturanummer: 0999');
  const layer=hidden?`\nBT /F1 10 Tf ${mode} Tr ${opacity===null?'':'/GS0 gs '}40 780 Td 18 TL\n`+hiddenText.split('\n').map((line,i)=>(i?'T* ':'')+`(${escape(line)}) Tj`).join('\n')+'\nET':'';
  const stream='q 595 0 0 595 0 200 cm /Im0 Do Q'+layer;
  return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> /ExtGState << /GS0 7 0 R >> >> /Contents 5 0 R >>',`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg.toString('latin1')}\nendstream`,`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Type /ExtGState /ca ${opacity??1} /CA ${opacity??1} >>`]);
}
