// Hand-stated synthetic source/facit. Neither expectations nor identifiers are
// computed by the parser being tested.
export const evidenceContext={direction:'supplier',direction_confident:true};
export const evidenceInvoice=`Faktura
Fakturanummer: 000606
Leverantör: Testbolaget AB
Organisationsnummer: 556016-0680
Fakturadatum: 2026-10-24
Förfallodatum: 2026-11-07
Netto: 300,00 SEK
Moms: 62,00 SEK
Att betala: 362,00 SEK
OCR: 000018
Bankgiro: 123-4567`;
export const itemHeader='Beskrivning | Antal | À-pris | Netto | Moms % | Momsbelopp | Radbelopp';
export const itemRows=['Tjänst A | 2 | 100,00 | 200,00 | 25 % | 50,00 | 250,00','Tjänst B | 1 | 100,00 | 100,00 | 12 % | 12,00 | 112,00'];
export const evidenceTable=evidenceInvoice.replace('Netto: 300,00 SEK',itemHeader+'\n'+itemRows.join('\n')+'\nNetto: 300,00 SEK');

export function invoiceEvidenceTests(test,assert,interpretInvoice,sourceInvoiceNumbers){
  for(const role of ['Leverantör','Supplier'])test('a missing explicit '+role+' cannot disappear behind an earlier name',()=>{
    for(const suffix of ['', ' ', '???']){
      const r=interpretInvoice(evidenceInvoice+'\n'+role+':'+suffix,evidenceContext);
      assert.equal(r.fields.party.value,null);assert.notEqual(r.level,'green');
    }
  });
  test('a name over the supported limit cannot become a trusted 240-character prefix',()=>{
    const r=interpretInvoice(evidenceInvoice.replace('Testbolaget AB','A'.repeat(240)+' DIFFERENT ENTITY'),evidenceContext);
    assert.equal(r.fields.party.value,null);assert.notEqual(r.level,'green');
  });
  test('an empty party cannot borrow any accepted invoice scalar label as its name',()=>{
    for(const field of ['Faktura nr: 000606','Faktura nummer: 000606','Faktureringsdatum: 2026-10-24','Betalas senast: 2026-11-07','Oss tillhanda senast: 2026-11-07']){
      for(const separator of ['\n',' ']){
        const source=evidenceInvoice.replace('Leverantör: Testbolaget AB','Leverantör:'+separator+field);
        const r=interpretInvoice(source,evidenceContext);
        assert.equal(r.fields.party.value,null,field);assert.notEqual(r.level,'green');
      }
    }
  });
  test('a conflicting name remains unresolved even if the organization number agrees',()=>{
    const r=interpretInvoice(evidenceInvoice+'\nSupplier: Another Company AB',evidenceContext);
    assert.equal(r.fields.party.value,null);assert.notEqual(r.level,'green');
  });
  test('complete metadata suffixes cannot agree with a shorter original number',()=>{
    for(const token of ['000606.9','000606?99','000606/REV-2']){
      const filename='Faktura '+token+'.pdf';
      assert.deepEqual(sourceInvoiceNumbers(filename),[token]);
      const r=interpretInvoice(evidenceInvoice,{...evidenceContext,filename});
      assert.equal(r.fields.invoice_number.value,'000606');assert.equal(r.level,'red');
    }
  });
  test('explicit alphabetic metadata identities are compared without supplying missing fields',()=>{
    for(const filename of ['Invoice XYZ.pdf','Invoice number XYZ.pdf']){
      assert.deepEqual(sourceInvoiceNumbers(filename),['XYZ']);
      const r=interpretInvoice(evidenceInvoice.replace('Fakturanummer: 000606','Fakturanummer: ABC'),{...evidenceContext,filename});
      assert.equal(r.fields.invoice_number.value,'ABC');assert.equal(r.level,'red');
    }
    assert.equal(interpretInvoice(evidenceInvoice.replace('Fakturanummer: 000606',''),{...evidenceContext,filename:'Invoice number XYZ.pdf'}).fields.invoice_number.value,null);
  });
  test('metadata date export and embedded words do not masquerade as invoice identities',()=>{
    for(const filename of ['Invoice_date_2026-10-24.pdf','Invoice_Export_12345.pdf','notinvoice 0999.pdf','Invoice_ID_889977.pdf']){
      assert.deepEqual(sourceInvoiceNumbers(filename),[]);
      const r=interpretInvoice(evidenceInvoice,{...evidenceContext,filename});
      assert.equal(r.fields.invoice_number.value,'000606');assert.equal(r.level,'green',filename+': '+r.issues.join(' '));
    }
  });
  test('ordinary explicit leading zeros remain exact across document and metadata',()=>{
    const r=interpretInvoice(evidenceInvoice,{...evidenceContext,filename:'Invoice_no_000606.pdf'});
    assert.equal(r.level,'green');assert.equal(r.fields.invoice_number.value,'000606');
    assert.notEqual(interpretInvoice(evidenceInvoice,{...evidenceContext,filename:'Faktura 606.pdf'}).level,'green');
  });
  test('explicit foreign-currency amounts are read without enabling foreign-currency registration',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Netto: EUR 100.00').replace('Moms: 62,00 SEK','Moms: 25.00 EUR').replace('Att betala: 362,00 SEK','Att betala: EUR 125.00');
    const r=interpretInvoice(source,evidenceContext);
    assert.equal(r.fields.total_cents.value,12500);assert.equal(r.fields.net_cents.value,10000);assert.equal(r.fields.vat_cents.value,2500);assert.equal(r.fields.currency.value,'EUR');assert.notEqual(r.level,'green');
  });
  test('missing printed net or VAT requires review and is never inferred from the total',()=>{
    for(const remove of [['Netto: 300,00 SEK\n'],['Moms: 62,00 SEK\n'],['Netto: 300,00 SEK\n','Moms: 62,00 SEK\n']]){
      let source=evidenceInvoice;for(const line of remove)source=source.replace(line,'');
      for(const exemption of ['', '\nMomsfri']){
        const r=interpretInvoice(source+exemption,evidenceContext);assert.notEqual(r.level,'green');
        if(remove.some(line=>line.startsWith('Netto')))assert.equal(r.fields.net_cents.value,null);
        if(remove.some(line=>line.startsWith('Moms')))assert.equal(r.fields.vat_cents.value,null);
      }
    }
  });
  test('an explicitly printed zero VAT amount remains valid evidence',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Netto: 362,00 SEK').replace('Moms: 62,00 SEK','Moms: 0,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.equal(r.fields.vat_cents.value,0);assert.equal(r.level,'green',r.issues.join(' '));
  });
  test('explicit supplier and recipient organization labels remain in their source roles',()=>{
    const source=evidenceInvoice.replace('Organisationsnummer: 556016-0680','Leverantörens organisationsnummer: 556016-0680\nKund: Exempelkund AB\nKundens organisationsnummer: 556036-0793');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details,'structured source evidence is missing');
    assert.equal(r.level,'green',r.issues.join(' '));assert.equal(r.fields.party.value,'Testbolaget AB');assert.equal(r.fields.organization_number.value,'5560160680');
    assert.equal(r.details.supplier.name,'Testbolaget AB');assert.equal(r.details.supplier.organization_number,'5560160680');
    assert.equal(r.details.recipient.name,'Exempelkund AB');assert.equal(r.details.recipient.organization_number,'5560360793');
    assert.ok(r.details.recipient.evidence.some(e=>e.page===1&&e.line===6&&e.text==='Kundens organisationsnummer: 556036-0793'));
    const outgoing=interpretInvoice(source,{direction:'customer',direction_confident:true});
    assert.equal(outgoing.fields.party.value,'Exempelkund AB');assert.equal(outgoing.fields.organization_number.value,'5560360793');assert.equal(outgoing.level,'green');
  });
  test('organization numbers inside explicit party sections never cross roles',()=>{
    const source=evidenceInvoice.replace('Leverantör: Testbolaget AB\nOrganisationsnummer: 556016-0680','Leverantör\nTestbolaget AB\nOrg.nr: 556016-0680\nMottagare\nExempelkund AB\nOrg.nr: 556036-0793\nBetalningsuppgifter');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.fields.party.value,'Testbolaget AB');assert.equal(r.fields.organization_number.value,'5560160680');assert.equal(r.level,'green',r.issues.join(' '));
    assert.equal(r.details.recipient.organization_number,'5560360793');
  });
  test('a bare party section heading can precede an explicit same-role name label',()=>{
    for(const [heading,label,name,direction,role] of [
      ['Mottagare','Företags Namn','Exempelkunden AB','customer','recipient'],
      ['Supplier','Supplier name','Testbolaget AB','supplier','supplier'],
    ]){
      const source=evidenceInvoice.replace('Leverantör: Testbolaget AB\nOrganisationsnummer: 556016-0680\n','')+'\n'+heading+'\n'+label+': '+name+'\nOrg.nr: 556016-0680\n';
      const r=interpretInvoice(source,{direction,direction_confident:true});
      assert.equal(r.fields.party.value,name);assert.equal(r.fields.organization_number.value,'5560160680');assert.equal(r.level,'green',r.issues.join(' '));
      assert.equal(r.fields.party.evidence,label+': '+name);assert.equal(r.fields.organization_number.evidence,'Org.nr: 556016-0680');
      assert.deepEqual(r.details[role].evidence,[{page:1,line:11,text:label+': '+name},{page:1,line:12,text:'Org.nr: 556016-0680'}]);
    }
  });
  test('an explicitly empty party label cannot become a harmless section heading',()=>{
    for(const [heading,label,name,direction] of [
      ['Mottagare','Företags Namn','Exempelkunden AB','customer'],
      ['Leverantör','Supplier name','Testbolaget AB','supplier'],
    ]){
      const source=evidenceInvoice.replace('Leverantör: Testbolaget AB\nOrganisationsnummer: 556016-0680\n','')+'\n'+heading+':\n'+label+': '+name+'\nOrg.nr: 556016-0680\n';
      const r=interpretInvoice(source,{direction,direction_confident:true});
      assert.equal(r.fields.party.value,null);assert.notEqual(r.level,'green');
    }
  });
  test('an unassigned organization number with two party identities stays ambiguous',()=>{
    const source=evidenceInvoice.replace('Organisationsnummer: 556016-0680','Kund: Exempelkund AB').replace('Bankgiro: 123-4567','Bankgiro: 123-4567\nOrganisationsnummer: 556016-0680');
    const r=interpretInvoice(source,evidenceContext);
    assert.equal(r.fields.organization_number.value,null);assert.notEqual(r.level,'green');
  });
  test('a second unreadable explicitly owned organization number invalidates that role',()=>{
    const source=evidenceInvoice.replace('Organisationsnummer: 556016-0680','Leverantörens organisationsnummer: 556016-0680')+'\nSupplier organization number: ???';
    const r=interpretInvoice(source,evidenceContext);
    assert.equal(r.fields.organization_number.value,null);assert.notEqual(r.level,'green');
  });
  test('OCR checksum evidence remains separate from bank verification',()=>{
    const r=interpretInvoice(evidenceInvoice,evidenceContext);assert.ok(r.details);
    assert.deepEqual({...r.details.reference,evidence:[]},{kind:'ocr',value:'000018',checksum_valid:true,formal_verified:false,evidence:[]});
    assert.ok(r.details.reference.evidence.some(e=>e.page===1&&e.line===10&&e.text==='OCR: 000018'));
  });
  test('invalid OCR checksum requires review while preserving every original digit',()=>{
    for(const reference of ['0606','1','0'.repeat(26)]){
      const r=interpretInvoice(evidenceInvoice.replace('OCR: 000018','OCR: '+reference),evidenceContext);assert.ok(r.details);
      assert.equal(r.fields.reference.value,reference);assert.equal(r.details.reference.checksum_valid,false);assert.equal(r.details.reference.formal_verified,false);assert.notEqual(r.level,'green');
    }
  });
  test('a generic numeric payment reference is never subjected to formal OCR claims',()=>{
    const r=interpretInvoice(evidenceInvoice.replace('OCR: 000018','Betalningsreferens: 0606'),evidenceContext);assert.ok(r.details);
    assert.equal(r.level,'green');assert.equal(r.fields.reference.value,'0606');
    assert.deepEqual({...r.details.reference,evidence:[]},{kind:'payment_reference',value:'0606',checksum_valid:null,formal_verified:false,evidence:[]});
  });
  test('a known OCR modulus-10 example is accepted as a checksum only',()=>{
    const r=interpretInvoice(evidenceInvoice.replace('OCR: 000018','OCR: 12345682'),evidenceContext);assert.ok(r.details);
    assert.equal(r.details.reference.checksum_valid,true);assert.equal(r.details.reference.formal_verified,false);assert.equal(r.fields.reference.value,'12345682');
  });
  test('discount prose cannot switch off a contradictory row amount',()=>{
    for(const note of ['', '\nIngen rabatt', '\nNo discount applies', '\nRabatt lämnas på andra produkter']){
      const r=interpretInvoice(evidenceInvoice+'\nTjänst 2 st 100,00 kr 25 % 50,00 kr 249,00'+note,evidenceContext);
      assert.notEqual(r.level,'green');assert.ok(r.issues.some(issue=>/rad|moms/i.test(issue)));
    }
  });
  test('an explicitly printed row VAT percentage must agree with the printed VAT amount',()=>{
    const source=evidenceInvoice.replace('300,00 SEK','200,00 SEK').replace('62,00 SEK','5,00 SEK').replace('362,00 SEK','205,00 SEK')+'\nTjänst 2 st 100,00 kr 25 % 5,00 kr 205,00';
    const r=interpretInvoice(source,evidenceContext);assert.notEqual(r.level,'green');assert.ok(r.issues.some(issue=>/moms/i.test(issue)));
  });
  test('a fractional quantity in a headerless row cannot be read as its integer suffix',()=>{
    for(const quantity of ['1,5','1.5']){
      const source=evidenceInvoice.replace('300,00 SEK','500,00 SEK').replace('62,00 SEK','125,00 SEK').replace('362,00 SEK','625,00 SEK')+'\nProdukt '+quantity+' st 100,00 kr 25 % 125,00 kr 625,00';
      assert.notEqual(interpretInvoice(source,evidenceContext).level,'green');
    }
  });
  test('a correct fractional headerless row is validated using the entire quantity',()=>{
    for(const quantity of ['1,5','1.5']){
      const source=evidenceInvoice.replace('300,00 SEK','150,00 SEK').replace('62,00 SEK','37,50 SEK').replace('362,00 SEK','187,50 SEK')+'\nProdukt '+quantity+' st 100,00 kr 25 % 37,50 kr 187,50';
      const r=interpretInvoice(source,evidenceContext);assert.equal(r.level,'green',r.issues.join(' '));
    }
  });
  test('a malformed quantity or extra monetary suffix in a headerless row stays unresolved',()=>{
    for(const row of ['Produkt 1,5,2 st 100,00 kr 25 % 50,00 kr 250,00','Produkt 2 st 100,00 kr 25 % 50,00 kr 250,00.9','Produkt 2 st 100,00 kr 25 % 50,00 kr 250,00 300,00']){
      assert.notEqual(interpretInvoice(evidenceInvoice+'\n'+row,evidenceContext).level,'green');
    }
  });
  test('internally consistent headerless rows must also agree with the document sums',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Tjänst 2 st 100,00 kr 25 % 50,00 kr 250,00\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.notEqual(r.level,'green');assert.ok(r.issues.some(issue=>/rad|summa/i.test(issue)));
  });
  test('all supported headerless rows participate in the sum without creating missing source fields',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Tjänst A 2 st 100,00 kr 25 % 50,00 kr 250,00\nTjänst B 1 st 100,00 kr 12 % 12,00 kr 112,00\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.equal(r.level,'green',r.issues.join(' '));
    assert.equal(r.fields.net_cents.value,30000);assert.equal(r.fields.vat_cents.value,6200);assert.equal(r.fields.total_cents.value,36200);
  });
  test('explicit Swedish mixed-rate rows preserve printed values and reconcile against totals',()=>{
    const r=interpretInvoice(evidenceTable,evidenceContext);assert.ok(r.details);
    assert.equal(r.level,'green',r.issues.join(' '));assert.equal(r.details.table_status,'complete');assert.deepEqual(r.details.vat_rates,[12,25]);
    assert.deepEqual(r.details.line_items.map(({evidence,...row})=>row),[
      {description:'Tjänst A',quantity:2,unit_price_cents:10000,net_cents:20000,vat_rate:25,vat_cents:5000,total_cents:25000},
      {description:'Tjänst B',quantity:1,unit_price_cents:10000,net_cents:10000,vat_rate:12,vat_cents:1200,total_cents:11200},
    ]);
    assert.deepEqual(r.details.line_items[0].evidence,{page:1,line:8,text:itemRows[0]});
    assert.equal(r.text_excerpt,evidenceTable);
  });
  test('explicit English quantity unit and VAT headings use the same source-bound row contract',()=>{
    const source=evidenceTable.replace(itemHeader,'Description | Quantity | Unit price | Net amount | VAT % | VAT amount | Line total');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'complete');assert.equal(r.details.line_items[1].vat_cents,1200);assert.equal(r.level,'green',r.issues.join(' '));
  });
  test('a four-column net table is complete without manufacturing omitted VAT and gross cells',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Beskrivning | Antal | À-pris | Netto\nTjänst A | 2 | 100,00 | 200,00\nTjänst B | 1 | 100,00 | 100,00\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'complete');assert.equal(r.level,'green',r.issues.join(' '));
    assert.equal(r.details.line_items[0].net_cents,20000);assert.equal(r.details.line_items[0].vat_cents,null);assert.equal(r.details.line_items[0].vat_rate,null);assert.equal(r.details.line_items[0].total_cents,null);
    assert.deepEqual(r.details.vat_rates,[]);
  });
  test('a declared but empty net cell differs from an entirely omitted VAT column',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Beskrivning | Antal | À-pris | Netto\nTjänst A | 2 | 100,00 |\nTjänst B | 1 | 100,00 | 100,00\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'incomplete');assert.equal(r.details.line_items[0].net_cents,null);assert.notEqual(r.level,'green');
  });
  test('a five-column net and rate table must agree with the explicit document VAT',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Beskrivning | Antal | À-pris | Netto | Moms %\nTjänst A | 3 | 100,00 | 300,00 | 25 %\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'conflict');assert.notEqual(r.level,'green');
    assert.equal(r.details.line_items[0].vat_cents,null);assert.equal(r.details.line_items[0].total_cents,null);
  });
  test('a five-column net and rate table checks VAT without writing inferred row amounts',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Beskrivning | Antal | À-pris | Netto | Moms %\nTjänst A | 2 | 100,00 | 200,00 | 25 %\nTjänst B | 1 | 100,00 | 100,00 | 12 %\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'complete');assert.equal(r.level,'green',r.issues.join(' '));
    assert.equal(r.details.line_items[0].vat_cents,null);assert.equal(r.details.line_items[1].total_cents,null);assert.deepEqual(r.details.vat_rates,[12,25]);
  });
  test('currency printed in monetary cells cannot disappear when document fields are isolated from rows',()=>{
    for(const cells of ['Tjänst A | 3 | 100,00 EUR | 300,00 EUR','Tjänst A | 3 | 100,00 SEK | 300,00 EUR']){
      const source=evidenceInvoice.replace('Netto: 300,00 SEK','Beskrivning | Antal | À-pris | Netto\n'+cells+'\nNetto: 300,00 SEK');
      const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
      assert.equal(r.details.table_status,'conflict');assert.notEqual(r.level,'green');
    }
  });
  test('matching explicit cell currencies are verified without treating description words as currency',()=>{
    const source=evidenceInvoice.replace('Netto: 300,00 SEK','Beskrivning | Antal | À-pris | Netto\nEUR-systemets support | 3 | 100,00 SEK | 300,00 SEK\nNetto: 300,00 SEK');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'complete');assert.equal(r.fields.currency.value,'SEK');assert.equal(r.level,'green',r.issues.join(' '));
  });
  test('labels inside table descriptions cannot replace a document identity',()=>{
    const source=evidenceTable.replace('Tjänst A |','Fakturanummer: SERVICE-77 |');
    const r=interpretInvoice(source,evidenceContext);
    assert.equal(r.fields.invoice_number.value,'000606');assert.equal(r.level,'green',r.issues.join(' '));
    assert.equal(r.details.line_items[0].description,'Fakturanummer: SERVICE-77');
  });
  test('quantity with decimal comma is checked without inventing an integer quantity',()=>{
    const source=evidenceTable.replace('Tjänst A | 2 | 100,00 | 200,00','Tjänst A | 1,5 | 133,34 | 200,01').replace('50,00 | 250,00','50,00 | 250,01').replace('Netto: 300,00','Netto: 300,01').replace('Att betala: 362,00','Att betala: 362,01');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.line_items[0].quantity,1.5);assert.equal(r.details.line_items[0].net_cents,20001);assert.equal(r.level,'green',r.issues.join(' '));
  });
  for(const [name,row] of [
    ['wrong unit extension','Tjänst A | 2 | 100,00 | 199,00 | 25 % | 50,00 | 249,00'],
    ['wrong VAT rate','Tjänst A | 2 | 100,00 | 200,00 | 25 % | 5,00 | 205,00'],
    ['wrong gross amount','Tjänst A | 2 | 100,00 | 200,00 | 25 % | 50,00 | 249,00'],
    ['missing printed VAT amount','Tjänst A | 2 | 100,00 | 200,00 | 25 % | | 250,00'],
    ['multiple numeric values in one cell','Tjänst A | 2 | 100,00 200,00 | 200,00 | 25 % | 50,00 | 250,00'],
  ])test('an explicit table with '+name+' stays under review',()=>{
    const r=interpretInvoice(evidenceTable.replace(itemRows[0],row),evidenceContext);assert.ok(r.details);
    assert.notEqual(r.details.table_status,'complete');assert.notEqual(r.level,'green');
  });
  test('line sums cannot silently disagree with otherwise self-consistent document totals',()=>{
    const source=evidenceTable.replace('Netto: 300,00','Netto: 400,00').replace('Moms: 62,00','Moms: 87,00').replace('Att betala: 362,00','Att betala: 487,00');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'conflict');assert.notEqual(r.level,'green');
  });
  test('unsupported discount columns remain visible and cannot silently drop a row',()=>{
    const source=evidenceTable.replace(itemHeader,itemHeader+' | Rabatt').replace(itemRows[0],itemRows[0]+' | 10 %').replace(itemRows[1],itemRows[1]+' | 0 %');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'incomplete');assert.notEqual(r.level,'green');
  });
  test('an unknown row in a recognized table cannot be skipped to obtain a complete table',()=>{
    const source=evidenceTable.replace(itemRows[1],'??? oläslig artikelrad\n'+itemRows[1]);
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'incomplete');assert.notEqual(r.level,'green');
  });
  test('a recognizable table with collapsed column spacing stays incomplete instead of disappearing',()=>{
    const source=evidenceTable.replaceAll(' | ',' ');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'incomplete');assert.notEqual(r.level,'green');
  });
  test('a repeated table header across a declared page boundary keeps page evidence',()=>{
    const source=evidenceTable.replace(itemRows[1],'\fFakturanummer: 000606\n'+itemHeader+'\n'+itemRows[1]);
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'complete');assert.equal(r.details.line_items.length,2);assert.equal(r.details.line_items[1].evidence.page,2);assert.equal(r.details.line_items[1].evidence.line,3);assert.equal(r.level,'green',r.issues.join(' '));
  });
  test('an explicit same-invoice continuation caption can precede the repeated table header',()=>{
    const source=evidenceTable.replace(itemRows[1],'\f\nFaktura 000606, fortsättning sida 2 av 2\n'+itemHeader+'\n'+itemRows[1]);
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'complete');assert.equal(r.details.line_items.length,2);assert.equal(r.details.line_items[1].evidence.page,2);assert.equal(r.level,'green',r.issues.join(' '));
  });
  test('a continuation caption carrying a different identity cannot reconnect the table',()=>{
    const source=evidenceTable.replace(itemRows[1],'\fFaktura 000707, fortsättning sida 2 av 2\n'+itemHeader+'\n'+itemRows[1]);
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'conflict');assert.notEqual(r.level,'green');
  });
  test('page continuation with a different invoice number never borrows earlier table identity',()=>{
    const source=evidenceTable.replace(itemRows[1],'\fFakturanummer: 000707\n'+itemRows[1]);
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.fields.invoice_number.value,null);assert.equal(r.details.table_status,'conflict');assert.notEqual(r.level,'green');
  });
  test('page continuation without a repeated identity or header remains incomplete',()=>{
    const source=evidenceTable.replace(itemRows[1],'\f'+itemRows[1]);
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.table_status,'incomplete');assert.notEqual(r.level,'green');
  });
  test('a supported description continuation retains the source lines',()=>{
    const source=evidenceTable.replace(itemRows[0],'Tjänst A, löpande support\n | 2 | 100,00 | 200,00 | 25 % | 50,00 | 250,00');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.details.line_items[0].description,'Tjänst A, löpande support');assert.equal(r.details.table_status,'complete');assert.match(r.details.line_items[0].evidence.text,/\n/);assert.equal(r.level,'green',r.issues.join(' '));
  });
  test('credit details retain explicit negative amounts while ledger fields keep positive amounts',()=>{
    const source=evidenceTable.replace(/^Faktura/,'Kreditfaktura').replace(itemRows[0],'Tjänst A | 2 | -100,00 | -200,00 | 25 % | -50,00 | -250,00').replace(itemRows[1],'Tjänst B | 1 | -100,00 | -100,00 | 12 % | -12,00 | -112,00').replace('Netto: 300,00','Netto: -300,00').replace('Moms: 62,00','Moms: -62,00').replace('Att betala: 362,00','Att betala: -362,00');
    const r=interpretInvoice(source,evidenceContext);assert.ok(r.details);
    assert.equal(r.fields.kind.value,'credit');assert.equal(r.fields.total_cents.value,36200);assert.equal(r.details.line_items[0].net_cents,-20000);assert.equal(r.details.table_status,'complete');
  });
}
