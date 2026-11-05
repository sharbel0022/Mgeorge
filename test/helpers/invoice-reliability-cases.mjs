// Invented text only: no customer, production or provider documents.
export const reliabilityContext={direction:'supplier',direction_confident:true,filename:'synthetic-invoice.pdf',subject:'Synthetic invoice'};
const base=`Faktura
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
const expected={invoice_number:'0606',party:'Testbolaget AB',organization_number:'5560160680',issued_at:'2026-10-24',due_at:'2026-11-07',total_cents:375000,vat_cents:75000,net_cents:300000,reference:'000018',bankgiro:'123-4567',direction:'supplier',kind:'invoice',currency:'SEK'};
const english=base.replace(/^Faktura\n/,'Invoice\n').replace('Fakturanummer:','Invoice number:').replace('Leverantör:','Supplier:').replace('Organisationsnummer:','Organization number:').replace('Fakturadatum:','Invoice date:').replace('Förfallodatum:','Due date:').replace('Netto:','Net:').replace('Moms:','VAT:').replace('Att betala:','Total:');
const header='Description | Qty | Unit price | Net | VAT rate | VAT amount | Line total';
const row1='Synthetic service A | 1 | 1000.00 | 1000.00 | 25 % | 250.00 | 1250.00';
const row2='Synthetic service B | 2 | 1000.00 | 2000.00 | 25 % | 500.00 | 2500.00';
const table=base.replace('Netto: 3 000,00 kr\nMoms: 750,00 kr\nAtt betala: 3 750,00 SEK',`${header}\n${row1}\n${row2}\nNetto  3 000,00 kr\nMoms  750,00 kr\nAtt betala  3 750,00 SEK`);
const multipage=english.replace('Net: 3 000,00 kr\nVAT: 750,00 kr\nTotal: 3 750,00 SEK',`${header}\n${row1}\nPage 1 of 2\fInvoice number: 0606\n${header}\n${row2}\nNet  3000.00\nVAT amount  750.00\nTotal  3750.00 SEK`);
const exact=(id,text,extra={})=>({id,text,expected:{...expected},expectedLevel:'green',...extra});
const hold=(id,text,overrides={},extra={})=>({id,text,expected:{...expected,...overrides},mustHold:true,...extra});
export const reliabilityCases=[
 exact('swedish-control',base),
 exact('english-net-total',english),
 exact('english-grouped-decimals',english.replace('3 000,00','3,000.00').replace('750,00','750.00').replace('3 750,00','3,750.00')),
 exact('english-vat-amount',english.replace('VAT:','VAT amount:')),
 exact('vat-rate-prose-is-not-amount',base+'\nVAT rate: 25 %'),
 exact('swedish-table-summary-without-colon',table,{tableStatus:'complete',rowCount:2}),
 exact('english-multipage-table',multipage,{tableStatus:'complete',rowCount:2}),
 hold('missing-net-is-not-derived',base.replace('Netto: 3 000,00 kr\n',''),{net_cents:null}),
 hold('vat-rate-does-not-supply-missing-vat',base.replace('Moms: 750,00 kr','VAT rate: 25 %'),{vat_cents:null}),
 hold('conflicting-english-total',base+'\nTotal: 3751.00 SEK',{total_cents:null}),
 hold('malformed-english-grouping',base.replace('3 750,00','3,75.00'),{total_cents:null}),
 hold('vat-arithmetic-mismatch',base.replace('750,00 kr','740,00 kr'),{vat_cents:74000}),
 hold('multipage-identity-conflict',multipage.replace('\fInvoice number: 0606','\fInvoice number: 0607'),{invoice_number:null},{tableStatus:'conflict'}),
 hold('invoice-and-ocr-columns-ambiguous',base.replace('Fakturanummer: 0606','Fakturanummer    OCR\n0606    000018').replace('\nOCR: 000018',''),{invoice_number:null,reference:null}),
 hold('ocr-remains-manual-review',base,{}, {context:{method:'ocr',ocrConfidence:99},maxConfidence:.85}),
];
export function reliabilityTests(test,assert,interpretInvoice){
 for(const fixture of reliabilityCases)test(fixture.id,()=>{
  const result=interpretInvoice(fixture.text,{...reliabilityContext,...fixture.context});
  for(const [field,value] of Object.entries(fixture.expected))assert.deepEqual(result.fields[field].value,value,`${field}: ${result.issues.join('; ')}`);
  if(fixture.mustHold)assert.notEqual(result.level,'green',result.issues.join('; '));
  else assert.equal(result.level,fixture.expectedLevel,result.issues.join('; '));
  if(fixture.tableStatus)assert.equal(result.details.table_status,fixture.tableStatus);
  if(fixture.rowCount)assert.equal(result.details.line_items.length,fixture.rowCount);
  assert.equal(result.details.reference.formal_verified,false);
  if(fixture.maxConfidence)assert.ok(Object.entries(result.fields).filter(([key])=>key!=='direction').every(([,field])=>field.confidence<=fixture.maxConfidence));
 });
}

// Boundary regressions are kept separate from the fixed 15-case measurement.
export function reliabilityBoundaryTests(test,assert,interpretInvoice){
 test('Swedish tax summaries preserve grouped English amounts across blank lines',()=>{
  const text=base.replace('Netto: 3 000,00 kr','Summa exklusive moms:\n\n3,000.00 SEK').replace('Moms: 750,00 kr','VAT amount:\n\n750.00 SEK').replace('Att betala: 3 750,00 SEK','Summa inklusive moms:\n\n3,750.00 SEK');
  const result=interpretInvoice(text,reliabilityContext);
  for(const [field,value]of Object.entries(expected))assert.deepEqual(result.fields[field].value,value,field);
  assert.equal(result.level,'green',result.issues.join('; '));
 });
 test('paragraph recovery cannot turn English payment terms into net money',()=>{
  const text=english.replace('Net: 3 000,00 kr','Payment terms:\nNet\n\n30').replace('VAT: 750,00 kr','VAT amount: 7.50 SEK').replace('Total: 3 750,00 SEK','Total: 37.50 SEK');
  const result=interpretInvoice(text,reliabilityContext);
  assert.equal(result.fields.net_cents.value,null);
  assert.equal(result.fields.total_cents.value,3750);
  assert.notEqual(result.level,'green');
 });
 test('English totals do not allow a later paragraph to supply the invoice identity',()=>{
  const result=interpretInvoice(english.replace('Invoice number: 0606','Invoice number:\n\nPaymentInstructions'),reliabilityContext);
  assert.equal(result.fields.invoice_number.value,null);
  assert.equal(result.fields.total_cents.value,375000);
  assert.notEqual(result.level,'green');
 });
 for(const name of ['Total Consulting AB','Net Consulting AB'])test('literal supplier name '+name,()=>{
  const result=interpretInvoice(base.replace('Testbolaget AB',name),reliabilityContext);
  assert.equal(result.fields.party.value,name);
  assert.equal(result.level,'green',result.issues.join('; '));
 });
 for(const [heading,amount] of [['Net','3000.00'],['Total','3750.00 SEK']])test('missing supplier does not borrow English '+heading+' heading',()=>{
  const result=interpretInvoice(base.replace('Leverantör: Testbolaget AB','Supplier:\n'+heading+'\n'+amount),reliabilityContext);
  assert.equal(result.fields.party.value,null);
  assert.notEqual(result.level,'green');
 });
 for(const [terms,net] of [['Net 30',30],['Net: 30',30],['Net\n30',30],['Net 60',60],['Net 90',90]])test('payment terms cannot supply a net amount: '+terms.replace('\n',' / '),()=>{
  const text=base.replace('Netto: 3 000,00 kr','Payment terms:\n'+terms).replace('Moms: 750,00 kr',`Moms: ${(net/4).toFixed(2)} kr`).replace('Att betala: 3 750,00 SEK',`Att betala: ${(net*1.25).toFixed(2)} SEK`).replace('2026-11-07','2026-11-23');
  const result=interpretInvoice(text,reliabilityContext);
  assert.equal(result.fields.net_cents.value,null);
  assert.notEqual(result.level,'green');
 });
 test('inline English amounts retain supplier and net amount boundaries',()=>{
  const text=base.replace('Leverantör: Testbolaget AB','Supplier: Testbolaget AB; Net amount: 3000; VAT amount: 750.00; Total: 3750.00 SEK');
  const result=interpretInvoice(text,reliabilityContext);
  assert.equal(result.fields.party.value,'Testbolaget AB');
  assert.equal(result.level,'green',result.issues.join('; '));
 });
 for(const name of ['Net','Total'])test('table description '+name+' remains a checked row',()=>{
  const text=table.replace('Synthetic service A',name).replace('1 | 1000.00 | 1000.00','1 | 900.00 | 1000.00');
  const result=interpretInvoice(text,reliabilityContext);
  assert.equal(result.details.line_items.length,2);
  assert.equal(result.details.line_items[0].description,name);
  assert.equal(result.details.table_status,'conflict');
  assert.notEqual(result.level,'green');
 });
}
