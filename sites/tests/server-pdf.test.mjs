import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';
function textPdf(){
  const text='Faktura\nFakturanummer: 0007\nLeverantor: Exempel AB\nFakturadatum: 2026-10-24\nNetto: 2500,00 SEK\nMoms: 625,00 SEK\nAtt betala: 3125,00 SEK';
  const stream='BT /F1 14 Tf 40 780 Td 22 TL\n'+text.split('\n').map((s,n)=>(n?'T* ':'')+'('+s+') Tj').join('\n')+'\nET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out='%PDF-1.4\n';const offsets=[];for(let n=0;n<objects.length;n++){offsets.push(out.length);out+=`${n+1} 0 obj\n${objects[n]}\nendobj\n`;}const xref=out.length;out+=`xref\n0 6\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);
}
test('actual Workerd extracts bounded PDF text without browser, child_process or outbound calls',async()=>{
  const bundled=await build({stdin:{contents:`import {serverPdfText} from './lib/server-pdf';export default {async fetch(req){try{return Response.json(await serverPdfText(new Uint8Array(await req.arrayBuffer())));}catch(e){return Response.json({error:e.message},{status:422});}}}`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['import','browser','default'],external:['node:*'],write:false,logLevel:'silent'});
  const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],outboundService:()=>{throw Error('No network in PDF parser');}});
  try{
    const r=await mf.dispatchFetch('https://test.example/',{method:'POST',body:textPdf()});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));assert.match(value.text,/0007/);assert.equal(value.method,'pdf');
    const large=await mf.dispatchFetch('https://test.example/',{method:'POST',body:new Uint8Array(5000001)});assert.equal((await large.json()).error,'local_ocr_required');
    const bad=await mf.dispatchFetch('https://test.example/',{method:'POST',body:'%PDF-invalid'});assert.equal(bad.status,422);
  }finally{await mf.dispose();}
});
