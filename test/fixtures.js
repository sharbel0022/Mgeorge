import {createCanvas} from '@napi-rs/canvas';
export const text=`Faktura
Fakturanummer: 0606
Leverantör: Testbolaget AB
Kund: Café Exempel AB
Organisationsnummer: 556016-0680
Fakturadatum: 2026-10-24
Förfallodatum: 2026-11-07
Netto: 3 000,00 kr
Moms: 750,00 kr
Att betala: 3 750,00 SEK
OCR: 0606
Bankgiro: 123-4567`;
export function pdf(objects){
  let content='%PDF-1.4\n',offsets=[0];for(let n=0;n<objects.length;n++){offsets.push(Buffer.byteLength(content,'latin1'));content+=`${n+1} 0 obj\n${objects[n]}\nendobj\n`;}
  const xref=Buffer.byteLength(content,'latin1');content+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content,'latin1');
}
export function textPdf(){const stream='BT /F1 14 Tf 40 780 Td 22 TL\n'+text.split('\n').map((line,n)=>(n?'T* ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+'\nET';return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`]);}
export function image(){const canvas=createCanvas(1400,1400),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,1400);ctx.fillStyle='black';ctx.font='32px Arial';text.split('\n').forEach((line,n)=>ctx.fillText(line,60,70+n*68));return canvas;}

