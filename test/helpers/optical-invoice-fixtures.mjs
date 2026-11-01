import {image,pdf} from '../fixtures.js';

export const archiveFooter='Archived digital copy. This document was preserved by the synthetic document archive. Internal storage reference only.';
export const opticalInvoiceFacit={invoice_number:'0606',party:'Testbolaget AB',organization_number:'5560160680',issued_at:'2026-10-24',due_at:'2026-11-07',net_cents:300000,vat_cents:75000,total_cents:375000,reference:'0606',bankgiro:'123-4567',currency:'SEK'};

// Every byte is generated from our synthetic invoice, never customer originals.
export function rasterPdf({canvas=image(),textLayer='',textFontSize=10,pageSize=[595,842]}={}){
  const jpg=canvas.toBuffer('image/jpeg');
  const textStream=textLayer?`\nBT /F1 ${textFontSize} Tf 40 780 Td 18 TL\n`+textLayer.split('\n').map((line,n)=>(n?'T* ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+'\nET':'';
  const stream='q 595 0 0 595 0 200 cm /Im0 Do Q'+textStream;
  return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.join(' ')}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`,`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg.toString('latin1')}\nendstream`,`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
}
