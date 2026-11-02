import {createCanvas} from '@napi-rs/canvas';
import {pdf} from '../fixtures.js';

export const fragmentedFacit={invoice_number:'0606',party:'Testbolaget AB',organization_number:'5560160680',issued_at:'2026-10-24',due_at:'2026-11-07',net_cents:40000,vat_cents:10000,total_cents:50000,reference:'000018',bankgiro:'123-4567',currency:'SEK'};
const fragments=[['Faktura'],['Faktura','nummer: ','06','06'],['Leverantör: ','Testbolaget',' ','AB'],['Organisationsnummer: 556016-0680'],['Kund: Café Exempel AB'],['Fakturadatum: ','2026-','10-24'],['Förfallodatum: 2026-11-07'],['Netto: 400,00 SEK'],['Moms: 100,00 SEK'],['Att betala: ','5','00,00 SEK'],['OCR: ','0000','18'],['Bankgiro: 123-4567']];

// Font switches force real PDF text-item boundaries without adding word gaps.
// All identities and numbers are generated synthetic fixture values.
export function fragmentedInvoicePdf({logo=false,separateAmounts=false,separateIdentifiers=false,reverseAmounts=false}={}){
  const esc=value=>value.replace(/[()\\]/g,'\\$&');
  const lines=fragments.map((parts,n)=>{
    const start=`BT /F1 14 Tf 1 0 0 1 40 ${780-n*22} Tm `;
    if((separateAmounts&&n===9)||(separateIdentifiers&&n===1)){
      const columns=n===9?[{x:140,text:'500,00 SEK'},{x:360,text:'600,00 SEK'}]:[{x:180,text:'0606'},{x:360,text:'0707'}];if(reverseAmounts)columns.reverse();
      return start+`(${n===9?'Att betala: ':'Fakturanummer: '}) Tj `+columns.map(({x,text})=>`1 0 0 1 ${x} ${780-n*22} Tm (${text}) Tj`).join(' ')+' ET';
    }
    return start+parts.map((part,i)=>`/${i%2?'F2':'F1'} 14 Tf (${esc(part)}) Tj`).join(' ')+' ET';
  });
  const image=createCanvas(40,40),ctx=image.getContext('2d');ctx.fillStyle='blue';ctx.fillRect(0,0,40,40);const jpg=image.toBuffer('image/jpeg');
  const stream=(logo?'q 30 0 0 30 500 780 cm /Im0 Do Q\n':'')+lines.join('\n');
  return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im0 7 0 R >> >> /Contents 6 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`,`<< /Type /XObject /Subtype /Image /Width 40 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg.toString('latin1')}\nendstream`]);
}
