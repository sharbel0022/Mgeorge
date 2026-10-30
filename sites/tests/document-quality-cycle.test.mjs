import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {classifyDocument,documentConflicts,sourceInvoiceNumbers,isInlineDecoration} from '../lib/document-triage.js';

// Load the real browser parser with its real domain module in Node's isolated test runtime.
const code=readFileSync(new URL('../lib/invoice-fields.js',import.meta.url),'utf8')
  .replace("'./domain'",JSON.stringify(new URL('../lib/domain.ts',import.meta.url).href))
  .replace("'./document-triage.js'",JSON.stringify(new URL('../lib/document-triage.js',import.meta.url).href));
const {interpretInvoice}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
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
  assert.equal(classifyDocument({text}).exclude_from_invoice_queue,false);
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

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
class DocumentD1{
  constructor(sql){this.sql=sql;}
  prepare(query){const sql=this.sql;return{
    args:[],bind(...args){this.args=args;return this;},
    async first(){return sql.prepare(query).get(...this.args)||null;},
    async all(){return {results:sql.prepare(query).all(...this.args)};},
    async run(){return this.execute();},
    execute(){const result=sql.prepare(query).run(...this.args);return {meta:{changes:Number(result.changes)}};}
  };}
  async batch(items){this.sql.exec('BEGIN');try{const result=items.map(item=>item.execute());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
async function processingFixture(t){
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(file=>/^\d{4}.*\.sql$/.test(file)).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const key='__document_quality_'+crypto.randomUUID().replaceAll('-',''),f={sql,d1:new DocumentD1(sql),owner:'synthetic-document-owner',pdfCalls:0,bytes:Buffer.from('%PDF-synthetic-original')};
  f.env={DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'owner@example.test',BUCKET:{get:async()=>({size:f.bytes.length,arrayBuffer:async()=>f.bytes})}};
  globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  const reference='globalThis['+JSON.stringify(key)+']';
  const domainUrl=new URL('../lib/domain.ts',import.meta.url).href;
  const server=data('import {emptyState} from '+JSON.stringify(domainUrl)+';const f='+reference+';export const db=()=>f.d1;export const response=(body,status=200)=>Response.json(body,{status});export const identity=async()=>({userId:f.owner,email:"owner@example.test"});export async function readWorkspace(owner){const row=await f.d1.prepare("SELECT revision,payload FROM workspaces WHERE owner=?").bind(owner).first();return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};}');
  let source=ts.transpileModule(readFileSync(new URL('../lib/document-processing.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const imports={
    'cloudflare:workers':data('export const env='+reference+'.env;'),
    './server':server,'./domain':domainUrl,
    './banking/security':new URL('../lib/banking/security.ts',import.meta.url).href,
    './invoice-fields.js':data(code),
    './server-pdf':data('export async function serverPdfText(){'+reference+'.pdfCalls++;return {text:'+JSON.stringify(invoice)+',method:"pdf",confidence:100};}'),
    './customer-messages':data('export async function reconcileAndPrepare(){}'),
  };
  for(const [name,url] of Object.entries(imports))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
  f.processing=await import(data(source));await f.processing.processingSettings({userId:f.owner,email:'owner@example.test'});
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',f.bytes)).toString('hex'),at=new Date().toISOString();
  sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run('doc',f.owner,'Faktura 0594.pdf','application/pdf',f.bytes.length,hash,at);
  sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(f.owner,'source','doc',JSON.stringify({...metadata,from:'supplier@example.test',subject:'Faktura 0594',original_filename:'Faktura 0594.pdf'}),at);
  sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Syntetiska Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic reviewed original',at);
  return f;
}

test('document quality: verified Sites original can still register once',async t=>{
  const f=await processingFixture(t);
  await f.processing.processDocuments(f.owner);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'registered');
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
  await f.processing.processDocuments(f.owner);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
});

for(const mismatch of ['bytes','missing hash','size'])test('document quality: Sites original '+mismatch+' mismatch cannot produce trusted PDF evidence',async t=>{
  const f=await processingFixture(t);
  if(mismatch==='bytes')f.bytes=Buffer.from('%PDF-synthetic-corrupt!');
  if(mismatch==='missing hash')f.sql.prepare("UPDATE documents SET sha256=''").run();
  if(mismatch==='size')f.sql.prepare('UPDATE documents SET size=size+1').run();
  await f.processing.processDocuments(f.owner);
  assert.equal(f.pdfCalls,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
  assert.notEqual(f.sql.prepare('SELECT state FROM document_jobs').get().state,'registered');
});

test('document quality: Sites Gmail retains uncertain supported attachments and skips only inline decoration',async t=>{
  const env=data('export const env={GOOGLE_CLIENT_ID:"synthetic-client",GOOGLE_CLIENT_SECRET:"synthetic-secret",GMAIL_ACCOUNT:"synthetic@example.test"};');
  const source=readFileSync(new URL('../lib/gmail-adapter.js',import.meta.url),'utf8')
    .replace("'cloudflare:workers'",JSON.stringify(env))
    .replace("'./document-triage.js'",JSON.stringify(new URL('../lib/document-triage.js',import.meta.url).href));
  const {fetchGmailInvoiceDocuments}=await import(data(source));
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
