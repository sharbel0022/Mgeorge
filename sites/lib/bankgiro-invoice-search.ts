import {db,readWorkspace} from './server';
import {paymentInvoiceAssessment,normalizeOCR} from './domain';
import {gmailSync} from './gmail-service';
import {readInvoiceFields} from './banking/invoice-candidates';

export async function searchBankgiroInvoice(owner:string,transactionId:string,fetchMore=true){
 const {state}=await readWorkspace(owner),t=state.transactions.find(t=>t.id===transactionId);
 if(!t)throw Error('Betalningen finns inte för ditt konto.');
 const assessment=paymentInvoiceAssessment(state,t);if(assessment.invoice)return {invoiceId:assessment.invoice.id,candidates:[],note:'En faktura med referensen finns i registret. Kontrollera kunden och originalet.'};
 const paymentReference=t.bankDetails?.payerReference||t.payerReference,reference=normalizeOCR(paymentReference);if(!reference||!(t.specification&&t.specificationStatus==='linked'||t.bankDetails?.status==='identified'))return {candidates:[],note:'Verifiera betalningsspecifikationen och referensen innan fler underlag hämtas.'};
 const find=async()=>{
  const result=await db().prepare("SELECT s.document_id,d.filename,s.extraction,j.extraction job_extraction FROM gmail_sources s JOIN documents d ON d.id=s.document_id AND d.owner=s.owner LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=? AND s.status<>'rejected' ORDER BY s.created_at DESC LIMIT 1000").bind(owner).all<any>();
  return result.results.filter(r=>[r.extraction,r.job_extraction].some(raw=>{const v=readInvoiceFields(raw);return [v.number,v.invoice_number,v.ocr,v.reference].some(x=>typeof x==='string'&&normalizeOCR(x)===reference);})).map(r=>({documentId:r.document_id,filename:r.filename}));
 };
 let candidates=await find(),note='Sökt bland redan hämtade Gmail-underlag.';
 const c=await db().prepare('SELECT last_attempt,status FROM gmail_connections WHERE owner=?').bind(owner).first<any>();
 if(!candidates.length&&fetchMore&&c?.status==='connected'&&(!c.last_attempt||Date.now()-Date.parse(c.last_attempt)>=900_000)){
  try{const response=await gmailSync(undefined,true,paymentReference);const result=await response.json() as any;note=response.ok?'Ytterligare Gmail-underlag hämtade med befintligt medgivande.':'Gmail kunde inte hämta mer underlag. Granska Gmail-anslutningen.';candidates=await find();if(result.more)note+=' Fler underlag kan finnas; fortsätt hämtningen i Gmail.';}catch{note='Gmail kunde inte hämta mer underlag. Befintliga original finns kvar.';}
 }else if(!candidates.length)note+=!c?' Gmail är inte anslutet.':' Nästa hämtning följer befintlig 15-minutersgräns.';
 return {candidates,note:candidates.length?note+' Möjliga original hittades; granska dem före registrering.':note+' Betalare identifierad – faktura '+paymentReference+' saknas i registret.'};
}
