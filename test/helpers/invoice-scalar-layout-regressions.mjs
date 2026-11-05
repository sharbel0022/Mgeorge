import test from 'node:test';
import assert from 'node:assert/strict';

// Diagnostic regressions after the independent holdout. These are new synthetic
// texts, not a new blind corpus or a replacement for its failed first result.
const context={direction:'supplier',direction_confident:true};
const invoice=`Leverantör: Syntetiska Testbolaget AB
Organisationsnummer: 556016-0680
Fakturanummer: REG-942
Fakturadatum: 2026-08-03
Förfallodatum: 2026-09-02
Netto: 4 000,00 SEK
Moms: 1 000,00 SEK
Att betala: 5 000,00 SEK
Betalningsreferens: REG-942`;

export function invoiceScalarLayoutRegressions(interpretInvoice,prefix){
  const read=text=>interpretInvoice(text,context);
  for(const [name,dates] of [
    ['ISO','Fakturadatum: 2026-08-03 Förfallodatum: 2026-09-02'],
    ['Swedish dots','Fakturadatum: 03.08.2026 Förfallodatum: 02.09.2026'],
    ['Swedish slashes','Fakturadatum: 03/08/2026 Förfallodatum: 02/09/2026'],
    ['spaced digits','Fakturadatum: 2 0 2 6 - 0 8 - 0 3\tFörfallodatum: 2 0 2 6 - 0 9 - 0 2'],
  ])test(`${prefix}: inline ${name} dates keep their label boundary`,()=>{
    const text=invoice.replace('Fakturadatum: 2026-08-03\nFörfallodatum: 2026-09-02',dates),r=read(text);
    assert.equal(r.fields.issued_at.value,'2026-08-03');assert.equal(r.fields.due_at.value,'2026-09-02');assert.equal(r.text_excerpt,text);
  });
  for(const suffix of ['XYZ',' 99','/17'])test(`${prefix}: date suffix ${suffix} is not silently truncated`,()=>{
    const r=read(invoice.replace('Fakturadatum: 2026-08-03','Fakturadatum: 2026-08-03'+suffix));
    assert.equal(r.fields.issued_at.value,null);assert.notEqual(r.level,'green');
  });
  for(const header of ['Benämning Antal Belopp exkl. moms','Beskrivning Antal Belopp exklusive moms','Description Quantity Net amount'])test(`${prefix}: incomplete line-item header ${header} cannot poison a printed net summary`,()=>{
    const text=invoice.replace('Netto:',header+'\nArbete enligt beställning 2 4 000,00\nNetto:'),r=read(text);
    assert.equal(r.fields.net_cents.value,400000);assert.equal(r.fields.vat_cents.value,100000);assert.equal(r.fields.total_cents.value,500000);
    assert.equal(r.details.table_status,'incomplete');assert.notEqual(r.level,'green');assert.equal(r.text_excerpt,text);
  });
  for(const summary of ['Netto\n\n4 000,00 SEK\nMoms\n1 000,00 SEK\nAtt betala\n5 000,00 SEK','Netto 4 000,00 SEK\nMoms 1 000,00 SEK\nAtt betala 5 000,00 SEK'])test(`${prefix}: bare monetary summaries end an incomplete table`,()=>{
    const text=invoice.replace('Netto: 4 000,00 SEK\nMoms: 1 000,00 SEK\nAtt betala: 5 000,00 SEK','Benämning Antal Belopp exkl. moms\nArbete enligt beställning 2 4 000,00\n'+summary),r=read(text);
    assert.equal(r.fields.net_cents.value,400000);assert.equal(r.fields.vat_cents.value,100000);assert.equal(r.fields.total_cents.value,500000);assert.notEqual(r.level,'green');
  });
  test(`${prefix}: actual invalid or conflicting net summaries remain in the full census`,()=>{
    for(const extra of ['Belopp exkl. moms: oläsligt','Netto: 9 000,00 SEK']){
      const r=read(invoice+'\n'+extra);assert.equal(r.fields.net_cents.value,null);assert.notEqual(r.level,'green');
    }
  });
  test(`${prefix}: an explicit invoice-number label can identify an OCR title without admitting a native document`,()=>{
    const r=read(invoice);assert.equal(r.fields.kind.value,'other');assert.equal(r.level,'red');assert.equal(r.fields.invoice_number.value,'REG-942');
    const scan=interpretInvoice(invoice,{...context,method:'ocr',ocrConfidence:99});assert.equal(scan.fields.kind.value,'invoice');assert.equal(scan.fields.kind.evidence,'Fakturanummer');assert.notEqual(scan.level,'green');assert.ok(scan.fields.kind.confidence<=.85);
  });
  for(const title of ['Offert','Quotation','Påminnelse','Betalningspåminnelse','Orderbekräftelse','Payment reminder'])test(`${prefix}: ${title} is not promoted by a referenced invoice number`,()=>{
    const r=read(title+'\n'+invoice);assert.equal(r.fields.kind.value,'other');assert.notEqual(r.level,'green');
  });
  for(const title of ['Dokumenttyp: Offert','Dokumenttyp: Påminnelse','Leveransbekräftelse','Bekräftelse','Offertnummer: Q-417'])test(`${prefix}: explicit non-invoice type ${title} prevents new type inference`,()=>{
    for(const options of [context,{...context,method:'ocr',ocrConfidence:99}]){
      const r=interpretInvoice(title+'\n'+invoice,options);assert.equal(r.fields.kind.value,'other');assert.notEqual(r.level,'green');
    }
  });
  for(const extra of ['Dokumenttyp: Offert','Beskrivning Antal Belopp exkl. moms\nTjänst 1 4 000,00\nDokumenttyp: Offert','Beskrivande text.\n'.repeat(1500)+'Dokumenttyp: Offert'])test(`${prefix}: competing type is retained across scalar/table/display filtering`,()=>{
    const r=interpretInvoice(invoice+'\n'+extra,{...context,method:'ocr',ocrConfidence:99});assert.equal(r.fields.kind.value,'other');assert.notEqual(r.level,'green');
  });
  for(const value of ['00012345','0067890123','-00012345'])test(`${prefix}: a zero-padded OCR integer without currency is an ambiguous amount`,()=>{
    const text=invoice.replace('Att betala: 5 000,00 SEK','Att betala: '+value),r=interpretInvoice(text,{...context,method:'ocr',ocrConfidence:99});
    assert.equal(r.fields.total_cents.value,null);assert.equal(r.level,'red');assert.equal(r.text_excerpt,text);
    assert.notEqual(interpretInvoice(text,context).fields.total_cents.value,null,'Native scalar grammar is unchanged');
  });
  for(const [value,cents] of [['12345',1234500],['00123 SEK',12300],['SEK 00123',12300],['00123,50',12350],['0,50',50],['0',0]])test(`${prefix}: OCR amount ${value} keeps explicit currency/decimal or ordinary integer evidence`,()=>{
    const text=invoice.replace('Netto: 4 000,00 SEK','Netto: '+value),r=interpretInvoice(text,{...context,method:'ocr',ocrConfidence:99});assert.equal(r.fields.net_cents.value,cents);
  });
  for(const [title,kind] of [['Kreditfaktura','credit'],['Kvitto','receipt']])test(`${prefix}: ${title} retains precedence over invoice-number evidence`,()=>{
    assert.equal(read(title+'\n'+invoice).fields.kind.value,kind);
  });
  test(`${prefix}: an invalid invoice identity does not establish a missing document title`,()=>{
    const r=read(invoice.replace('REG-942','?'));assert.equal(r.fields.kind.value,'other');assert.notEqual(r.level,'green');
  });
}
