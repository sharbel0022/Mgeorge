import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice} from '../src/invoice-extraction.js';
import {classifyDocument,documentConflicts,sourceInvoiceNumbers,isInlineDecoration} from '../src/document-triage.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeDocument,getSettings,saveSettings} from '../src/db.js';
import {analyzeDocument,approveDocument} from '../src/invoice-review.js';
import {fetchGmailInvoiceDocuments} from '../src/gmail.js';

const invoice=`Faktura
Fakturanummer: 0594
Leverantör: Syntetiska Exempelbolaget AB
Org.nr: 556016-0680
Fakturadatum: 2026-10-01
Förfallodatum: 2026-11-01
Att betala: 1 250,00 SEK
Moms: 250,00 SEK
Netto: 1 000,00 SEK
OCR: 0000594
Bankgiro: 123-4567`;
const metadata={direction:'supplier',direction_confident:true};

test('document quality: consistent explicit invoice evidence retains leading zeroes',()=>{
  const result=interpretInvoice(invoice,{...metadata,filename:'Faktura 0594.pdf',subject:'Faktura nr. 0594'});
  assert.equal(result.level,'green');
  assert.equal(result.fields.invoice_number.value,'0594');
  assert.equal(result.fields.reference.value,'0000594');
  assert.equal(result.fields.total_cents.value,125000);
});

for(const [field,line] of [
  ['fakturadatum','Fakturadatum: 2026-02-30'],
  ['förfallodatum','Förfallodatum: 2026-02-30'],
  ['organisationsnummer','Org.nr: 556016-0681'],
  ['fakturadatum','Fakturadatum: oläsligt'],
  ['förfallodatum','Förfallodatum: 2026-11-010'],
  ['organisationsnummer','Org.nr: 556016-06800'],
  ['Bankgiro','Bankgiro: 123-45670'],
])test(`document quality: an invalid additional ${field} blocks automatic eligibility`,()=>{
  for(const text of [invoice+'\n'+line,line+'\n'+invoice]){
    const result=interpretInvoice(text,metadata);
    assert.notEqual(result.level,'green');
    assert.ok(result.issues.some(issue=>issue.includes(field)));
    assert.ok(result.text_excerpt.includes(line));
  }
});

for(const value of ['1,250.00 SEK','1.250,001 SEK','1 250,00oops SEK','okänt SEK'])test(`document quality: malformed labelled total ${value} cannot be silently ignored`,()=>{
  const result=interpretInvoice(invoice+'\nAtt betala: '+value,metadata);
  assert.notEqual(result.level,'green');
  assert.ok(result.issues.some(issue=>issue.includes('totalbelopp')));
  assert.ok(result.text_excerpt.includes(value));
});

for(const [source,pattern] of [
  ['subject','Faktura nummer NUMBER'],
  ['subject','FakturanrNUMBER'],
  ['filename','Invoice_no_NUMBER.pdf'],
  ['filename','Faktura_nummer_NUMBER.png'],
])test(`document quality: ${source} label ${pattern} is compared exactly`,()=>{
  const equal=pattern.replace('NUMBER','0594'),different=pattern.replace('NUMBER','594');
  assert.deepEqual(sourceInvoiceNumbers(equal),['0594']);
  assert.equal(interpretInvoice(invoice,{...metadata,[source]:equal}).level,'green');
  const result=interpretInvoice(invoice,{...metadata,[source]:different});
  assert.equal(result.level,'red');
  assert.equal(result.fields.invoice_number.value,'0594');
  assert.ok(result.issues.some(issue=>issue.includes('Motstridigt fakturanummer')));
});

test('document quality: conflicting filename and subject remain explicit when PDF number is unreadable',()=>{
  assert.ok(documentConflicts({fields:{invoice_number:{value:null}}},{filename:'Faktura 0594.pdf',subject:'Faktura nummer 594'}).some(issue=>issue.includes('Motstridigt')));
});

test('document quality: invoice identifier letters and separators are never eaten as label prefixes',()=>{
  assert.deepEqual(sourceInvoiceNumbers('Invoice North-0594.pdf'),['NORTH-0594']);
  assert.deepEqual(sourceInvoiceNumbers('Invoice number AB_00594.pdf'),['AB_00594']);
  assert.deepEqual(sourceInvoiceNumbers('Fakturanummer AB/00594.pdf'),['AB/00594']);
});

for(const amount of ['1 250,00 SEK','oläsligt'])test(`document quality: terms heading with an explicit invoice number remains reviewable (${amount})`,()=>{
  const text='Allmänna villkor\nFakturanummer: 0594\nAtt betala: '+amount;
  const result=classifyDocument({text});
  assert.equal(result.exclude_from_invoice_queue,false);
});

test('document quality: clear terms and payroll still stay outside the invoice queue',()=>{
  assert.equal(classifyDocument({text:'Allmänna villkor\nBetalningsvillkor för framtida inköp.'}).exclude_from_invoice_queue,true);
  assert.equal(classifyDocument({text:'Lönebesked\nNettolön: 1000'}).exclude_from_invoice_queue,true);
});

for(const subject of ['Betalningspåminnelse för faktura 0594','Payment confirmation for invoice 0594','Receipt for invoice 0594','Lön oktober'])test('document quality: conflicting document context requires review: '+subject,()=>{
  const result=interpretInvoice(invoice,{...metadata,subject});
  assert.notEqual(result.level,'green');
  assert.ok(result.issues.some(issue=>/mejlrubrik|Mejlrubrik/.test(issue)));
});

test('document quality: an unreadable standalone logo-named scan remains reviewable',()=>{
  assert.equal(classifyDocument({filename:'logo.png',mime:'image/png',text:''}).exclude_from_invoice_queue,false);
  assert.equal(classifyDocument({filename:'logo.png',mime:'image/png',text:'',metadata:{inline_decoration:true}}).exclude_from_invoice_queue,true);
  assert.equal(isInlineDecoration({filename:'logo.png',mimeType:'image/png',headers:[{name:'Content-ID',value:'logo'},{name:'Content-Disposition',value:'attachment; filename=logo.png'}]}),false);
});

function registrationFixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-document-quality-cycle-')),db=openDatabase(join(folder,'synthetic.sqlite'));
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  let sequence=0;
  const document=()=>storeDocument(db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('synthetic-original-'+(++sequence)),metadata});
  const analyze=(doc,text)=>analyzeDocument(db,doc.id,{extract:async()=>interpretInvoice(text,metadata)});
  saveSettings(db,{...getSettings(db),auto_register_known:true});
  return {db,document,analyze};
}

test('document quality: known supplier with changed Bankgiro remains reviewable without a new debt',async t=>{
  const f=registrationFixture(t),seed=f.document();
  await f.analyze(seed,invoice);approveDocument(f.db,seed.id,{confirm:true});
  const next=f.document(),result=await f.analyze(next,invoice.replace('0594','0595').replace('123-4567','999-9999'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
  assert.notEqual(result.level,'green');
  assert.ok(result.issues.some(issue=>/Bankgiro|Betalningskonto/.test(issue)));
  assert.equal(f.db.prepare('SELECT status FROM documents WHERE id=?').get(next.id).status,'needs_review');
});

test('document quality: a known supplier does not make missing VAT and net amounts verified',async t=>{
  const f=registrationFixture(t),seed=f.document();
  await f.analyze(seed,invoice);approveDocument(f.db,seed.id,{confirm:true});
  const next=f.document(),result=await f.analyze(next,invoice.replace('0594','0595').replace('Moms: 250,00 SEK\nNetto: 1 000,00 SEK\n',''));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
  assert.notEqual(result.level,'green');
});

test('document quality: an unaudited invoice identity cannot authorize automatic registration',async t=>{
  const f=registrationFixture(t);
  f.db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,organization_number,issued_at,due_at,total_cents,bankgiro) VALUES(?,?,?,?,?,?,?,?,?)').run('legacy','supplier','previous','Syntetiska Exempelbolaget AB','5560160680','2026-10-01','2026-11-01',125000,'123-4567');
  const next=f.document(),result=await f.analyze(next,invoice);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
  assert.notEqual(result.level,'green');
});

test('document quality: original corruption blocks extraction and retains the original row',async t=>{
  const f=registrationFixture(t),next=f.document();
  f.db.prepare('UPDATE documents SET content=? WHERE id=?').run(Buffer.from('changed-original'),next.id);
  let extractionCalls=0;
  const result=await analyzeDocument(f.db,next.id,{extract:async()=>{extractionCalls++;return interpretInvoice(invoice,metadata);}});
  assert.equal(extractionCalls,0);
  assert.equal(result.level,'red');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
});

test('document quality: every interpretation retains its evidence in audit history',async t=>{
  const f=registrationFixture(t),next=f.document();
  await f.analyze(next,invoice);
  await f.analyze(next,invoice.replace('0594','0595'));
  const history=f.db.prepare("SELECT details FROM audit_events WHERE action='document_extracted' ORDER BY rowid").all().map(row=>JSON.parse(row.details));
  assert.equal(history[0].extraction?.fields.invoice_number.value,'0594');
  assert.equal(history[1].extraction?.fields.invoice_number.value,'0595');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
});

test('document quality: Gmail retains uncertain supported attachments and skips only inline decoration',async t=>{
  const previous=Object.fromEntries(['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GMAIL_ACCOUNT'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GMAIL_ACCOUNT:'synthetic@example.test'});
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const attachments=[
    {id:'reminder',subject:'Betalningspåminnelse för faktura 0594',filename:'faktura.pdf',mimeType:'application/pdf'},
    {id:'receipt',subject:'Receipt',filename:'faktura.pdf',mimeType:'application/pdf'},
    {id:'payroll',subject:'Lön oktober',filename:'scan.pdf',mimeType:'application/pdf'},
    {id:'branding',subject:'Dokument',filename:'logo-invoice-0594.png',mimeType:'image/png'},
    {id:'filename',subject:'Dokument',filename:'payment-confirmation.pdf',mimeType:'application/pdf'},
    {id:'inline',subject:'Dokument',filename:'logo.png',mimeType:'image/png',headers:[{name:'Content-Disposition',value:'inline'}]},
  ];
  const downloads=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://gmail.googleapis.com');
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:'synthetic@example.test'});
    if(parsed.pathname.endsWith('/messages'))return Response.json({messages:attachments.map(({id})=>({id}))});
    const id=parsed.pathname.match(/\/messages\/([^/]+)/)?.[1],part=attachments.find(item=>item.id===id);assert.ok(part);
    if(parsed.pathname.includes('/attachments/')){downloads.push(id);const bytes=part.mimeType==='application/pdf'?Buffer.from('%PDF-synthetic-original'):Buffer.from([137,80,78,71,13,10,26,10,0]);return Response.json({data:bytes.toString('base64url')});}
    return Response.json({labelIds:['INBOX'],internalDate:'1792992000000',payload:{headers:[{name:'Subject',value:part.subject},{name:'From',value:'supplier@example.test'},{name:'To',value:'synthetic@example.test'}],parts:[{...part,partId:'1',body:{attachmentId:'attachment'}}]}});
  });
  const result=await fetchGmailInvoiceDocuments({access_token:'synthetic',scope:'https://www.googleapis.com/auth/gmail.readonly',expires_at:Date.now()+3600000});
  assert.deepEqual(result.documents.map(item=>item.metadata.message_id),['reminder','receipt','payroll','branding','filename']);
  assert.deepEqual(downloads,['reminder','receipt','payroll','branding','filename']);
  assert.ok(result.documents.every(item=>item.needs_review===true&&item.content_base64));
});
