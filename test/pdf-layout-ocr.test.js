import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInvoice,runDocumentProcess} from '../src/invoice-extraction.js';
import {positionedInvoicePdf,hiddenLayerInvoicePdf,continuedInvoicePdf,tableInvoicePdf,paintedInvoicePdf,pagesPdf,layoutContext,layoutInvoiceText} from './helpers/pdf-layout-ocr.mjs';
import {pdfPageNeedsOpticalText} from '../src/pdf-text.js';
import {OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';

test('visually identical inline invoice labels retain their identities after content-stream permutation',async()=>{
  const normal=positionedInvoicePdf(),permuted=positionedInvoicePdf({order:[0,3,2,1]});
  assert.deepEqual((await runDocumentProcess(normal,'application/pdf',true)).preview,(await runDocumentProcess(permuted,'application/pdf',true)).preview);
  for(const bytes of [normal,permuted]){
    const result=await extractInvoice(bytes,'application/pdf',layoutContext);
    assert.equal(result.method,'pdf');assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.fields.reference.value,'000018');
    assert.equal(result.level,'green',JSON.stringify(result.issues));
  }
});

for(const order of [[0,1,2,3],[0,3,2,1]])test('vertical identity columns never borrow a value from a different column: '+order.join(','),async()=>{
  const result=await extractInvoice(positionedInvoicePdf({columns:true,order}),'application/pdf',layoutContext);
  assert.ok(result.fields.invoice_number.value===null||result.fields.invoice_number.value==='0606');
  assert.ok(result.fields.reference.value===null||result.fields.reference.value==='000018');
  if(result.fields.invoice_number.value===null||result.fields.reference.value===null)assert.notEqual(result.level,'green');
});

test('invisible native text over a scan cannot replace the visible invoice identity',async()=>{
  const plain=hiddenLayerInvoicePdf({hidden:false}),hidden=hiddenLayerInvoicePdf();
  assert.deepEqual((await runDocumentProcess(plain,'application/pdf',true)).preview,(await runDocumentProcess(hidden,'application/pdf',true)).preview);
  const result=await extractInvoice(hidden,'application/pdf',layoutContext);
  assert.equal(result.method,'ocr');assert.equal(result.fields.invoice_number.value,'0606');assert.notEqual(result.level,'green');
  assert.ok(result.fields.invoice_number.confidence<=.85);
});

test('native PDF extraction preserves an explicit boundary between pages',async()=>{
  const result=await runDocumentProcess(continuedInvoicePdf(),'application/pdf');
  assert.equal(result.method,'pdf');assert.equal(result.text.split('\f').length,2);
  assert.match(result.text.split('\f')[1],/fortsättning sida 2 av 2/);
});

const routedItems=layoutInvoiceText.split('\n').map((str,i)=>({str,width:str.length*5,transform:[10,0,0,10,40,780-i*20]}));
for(const [name,args]of [
  ['paintImageXObjectRepeat',['synthetic-image',200,200,new Float32Array([0,0,200,200])]],
  ['paintInlineImageXObjectGroup',[{width:1400,height:1400},[{transform:[595,0,0,595,0,200],x:0,y:0,w:1400,h:1400}]]],
  ['paintImageMaskXObjectGroup',[[{width:1400,height:1400,transform:[595,0,0,595,0,200]}]]],
  ['paintImageMaskXObjectRepeat',[{width:1400,height:1400},595,0,0,595,new Float32Array([0,200])]],
])test('an unbounded optimized raster footprint cannot confer native text trust: '+name,()=>{
  assert.equal(pdfPageNeedsOpticalText(routedItems,layoutInvoiceText,{fnArray:[OPS[name]],argsArray:[args]},OPS,595*842),true);
});

test('a mosaic of individually small raster tiles retains optical provenance',()=>{
  const fnArray=[],argsArray=[];
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){
    fnArray.push(OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore);
    argsArray.push([], [145,0,0,190,x*145,y*190],['synthetic-tile',100,100],[]);
  }
  assert.equal(pdfPageNeedsOpticalText(routedItems,layoutInvoiceText,{fnArray,argsArray},OPS,595*842),true);
});

for(const continued of [false,true])test('real PDF table geometry preserves row values'+(continued?' and continued page evidence':''),async()=>{
  const result=await extractInvoice(tableInvoicePdf({continued}),'application/pdf',layoutContext);
  assert.equal(result.method,'pdf');assert.equal(result.details.table_status,'complete');assert.equal(result.details.line_items.length,2);
  assert.deepEqual(result.details.line_items.map(row=>[row.description,row.quantity,row.unit_price_cents,row.net_cents]),[['Tjänst A',2,10000,20000],['Tjänst B',1,10000,10000]]);
  assert.equal(result.fields.total_cents.value,36200);
  assert.equal(result.details.line_items[1].evidence.page,continued?2:1);
});

for(const variant of ['white','clipped','covered'])test('native painting cannot promote a visually blank invoice: '+variant,async()=>{
  const bytes=paintedInvoicePdf(variant);
  assert.deepEqual((await runDocumentProcess(bytes,'application/pdf',true)).preview,(await runDocumentProcess(pagesPdf(['']),'application/pdf',true)).preview);
  const result=await extractInvoice(bytes,'application/pdf',layoutContext);
  assert.equal(result.method,'ocr');assert.equal(result.fields.invoice_number.value,null);assert.notEqual(result.level,'green');
});
