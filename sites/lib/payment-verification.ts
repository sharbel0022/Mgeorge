import {env} from 'cloudflare:workers';
import {db} from './server';
import {activeBankgiroLink,available,balance,bankgiroLinkCandidates,money,needsPaymentSpecification,paymentEvidenceConflict,paymentInvoiceAssessment,paymentLineage,paymentOriginalIssue,type State,type Transaction} from './domain';
import {bankPaymentView} from './payment-presentation';
import {exactReference,RECONCILIATION_RULE_VERSION} from './reconciliation-engine.js';
import {matchingReferenceValues} from './payment-references.js';
import {candidateDocuments} from './banking/invoice-candidates';
import {transactionDetailEvidence} from './banking/detail-evidence';
import {paymentOriginalAvailabilityIssue,reconciliationPreviewWithOriginals} from './reconciliation-evidence';
import {bankgiroAutomaticAccountIssue,bankgiroRetainedPreview} from './bankgiro-service';

export type VerificationStatus='passed'|'missing'|'blocked'|'review'|'manual'|'not_required';
export type PaymentVerificationStep={id:string;label:string;status:VerificationStatus;statusLabel:string;facts:{label:string;value:string}[];source:string;checkedAt:string;rule:string;reason:string;next:string};
export type PaymentVerification={transactionId:string;checkedAt:string;mode:'preview';changed:false;automaticEligible:boolean;bookedAllocationCount:number;steps:PaymentVerificationStep[]};
type CheckContext={checkedAt:string;originalIssue:string;detailIssue?:string;accountIssue:string;reportAccountIssue?:string;reportIssue:string;invoiceOriginalIssue:string;invoiceOriginalChecked:boolean;documents:any[];findings:any[]};
const missingInvoice='Originalfakturan saknas eller har inte kunnat integritetskontrolleras.';
const fact=(label:string,value:unknown)=>({label,value:String(value??'').trim()||'Saknas'});
const accountLabel=(value:string)=>value?'Konto •••• '+value.slice(-4):'Saknas';

/** Select existing records and explicit suggestions only; this creates no relationship. */
function subject(state:State,id:string,documents:any[]=[]){
 const transaction=state.transactions.find(t=>t.id===id);if(!transaction)throw Error('Bankhändelsen finns inte för ditt konto.');
 const lineage=paymentLineage(state,transaction),ais=lineage.ancestors.find(t=>t.evidence==='bank_api'||!!t.bankDataVersion),link=activeBankgiroLink(state,id);
 const related=transaction.specification?state.transactions.filter(t=>t.specification&&t.importId===transaction.importId&&t.specificationGroup===transaction.specificationGroup):state.transactions.filter(t=>t.parentId===id&&t.specification&&!t.ignored);
 const reportCandidates=bankgiroLinkCandidates(state,transaction),reportRows=link?.rows.length?link.rows:related;
 const view=bankPaymentView(state,transaction),assessment=paymentInvoiceAssessment(state,transaction);
 const hintRows=reportRows.length?reportRows:reportCandidates.length===1?reportCandidates[0].rows:[];
 const hintReference=view.reference.value||(hintRows.length===1?hintRows[0].payerReference:'');
 const registered=hintReference?state.invoices.filter(i=>!i.voided&&i.direction===(transaction.amount>0?'receivable':'payable')&&[i.number,i.ocr].some(value=>value&&exactReference(hintReference,value))):[];
 const allocations=state.allocations.filter(a=>a.active&&a.transactionId===id),allocatedIds=[...new Set(allocations.map(a=>a.invoiceId))];
 const invoice=allocatedIds.length===1?state.invoices.find(i=>i.id===allocatedIds[0]):allocatedIds.length?undefined:assessment.invoice||(registered.length===1?registered[0]:undefined);
 const candidates=transaction.amount>0?candidateDocuments(documents).filter(c=>hintReference&&exactReference(hintReference,c.number)):[];
 const linkedRow=link?.rows.length===1?link.rows[0]:undefined,detail=transaction.bankDetails;
 // bankPayer/cleanParty display a coerced, trimmed value. Compare that same
 // value when selecting its source, including malformed persisted JSON types.
 const usesDetailPayer=!!detail?.party&&view.payerKnown&&view.payer===String(detail.party||'').trim()&&!(linkedRow&&view.payer===String(linkedRow.party||'').trim());
 const usesDetailReference=!!view.reference.value&&!!detail&&(!!detail.payerReference||!!detail.referenceEvidence)&&!(linkedRow&&view.reference.value===linkedRow.payerReference);
 return {transaction,lineage,ais,link,reportRows,reportCandidates,view,hintRows,hintReference,registered,invoice,allocations,allocatedIds,candidates,usesDetailPayer,usesDetailReference};
}

/** An explanation of existing verifiers, never an alternative allocation engine. */
export function buildPaymentVerification(state:State,id:string,checks:CheckContext):PaymentVerification{
 const {transaction:t,lineage,ais,link,reportRows,reportCandidates,view,hintRows,hintReference,registered,invoice,allocations,allocatedIds,candidates,usesDetailPayer,usesDetailReference}=subject(state,id,checks.documents);
 const steps:PaymentVerificationStep[]=[];
 const add=(id:string,label:string,status:VerificationStatus,statusLabel:string,source:string,rule:string,reason:string,next:string,facts:PaymentVerificationStep['facts']=[])=>steps.push({id,label,status,statusLabel,source,rule,reason,next,facts,checkedAt:checks.checkedAt});
 const originalIssue=lineage.issue||checks.originalIssue,detailIssue=(usesDetailPayer||usesDetailReference)?checks.detailIssue||'':'',conflict=paymentEvidenceConflict(state,t),bankSource=lineage.ancestors.some(row=>['bank_api','bank_file','bankgiro_file'].includes(row.evidence||''));
 const finding=checks.findings.find(f=>f.transaction_id===id&&f.safe&&f.invoice_id===invoice?.id),safeCandidate=!!finding;
 const originalOK=bankSource&&!originalIssue&&!detailIssue&&!checks.reportIssue&&!conflict;
 const accountIssue=checks.accountIssue||checks.reportAccountIssue||'',accountOK=!!t.account&&!accountIssue;
 const direct=!needsPaymentSpecification(t)&&!t.specification&&!link;
 const parent=t.parentId?state.transactions.find(row=>row.id===t.parentId):reportRows.some(row=>row.parentId===t.id)?t:undefined;
 const group=parent?state.transactions.filter(row=>row.parentId===parent.id&&!row.ignored&&!row.duplicateOf):reportRows;
 const commonId=!!parent&&!!parent.bankReference&&group.length>0&&group.every(row=>row.specification&&row.specificationStatus==='linked'&&row.account===parent.account&&row.currency===parent.currency&&row.date===parent.date&&row.parentBankReference===parent.bankReference&&row.specificationCount===group.length&&row.specificationTotal===parent.amount)&&group.reduce((sum,row)=>sum+row.amount,0)===parent.amount;
 const sourceDescription=link?'Manuellt sammanbundna bankoriginal':reportRows.length?'Bankens individuella rapportoriginal':'Bankens transaktionsoriginal';

 add('received','Banktransaktion mottagen',ais?.bankData?'passed':bankSource?'review':'missing',ais?.bankData?'Mottagen':bankSource?'Annat bankoriginal':'Saknas',ais?.source||t.source||'Ingen bankkälla','received-bank-record-v1',ais?.bankData?'Ett bevarat AIS-svar finns. Integritet och aktuell kontoåtkomst kontrolleras separat.':bankSource?'Posten har ett filunderlag. Ett separat AIS-original har inte verifierats här.':'Ingen maskinverifierbar bankkälla är kopplad till posten.',ais?.bankData?'Kontrollera de följande stegen.':'Lägg till behörigt bankunderlag före avstämning.',[fact('Datum',t.date),fact('Bokfört belopp',money(t.amount)),fact('Valuta',t.currency),fact('Bankens externa ID',ais?.bankReference||t.bankReference)]);
 add('report','Bankgirooriginal mottaget',reportRows.length?(checks.reportIssue?'blocked':'passed'):reportCandidates.length?'review':direct?'not_required':'missing',reportRows.length?(checks.reportIssue?'Behöver verifieras':'Mottaget'):reportCandidates.length?'Mottaget · samband saknas':direct?'Direkt bankunderlag':'Saknas',reportRows.length?'Bevarad betalningsspecifikation':reportCandidates.length?'Separat granskningsunderlag':'Bankens transaktionsoriginal','retained-report-v1',checks.reportIssue||(reportRows.length?'En individuell rapport är kopplad till denna post. Originalintegritet och relationens typ visas separat.':reportCandidates.length?'En rapport kan passa datum och belopp. Det bevisar inte att den hör till insättningen.':direct?'Posten är individuell i det befintliga bankunderlaget. Separat Bankgirorapport är inte ett generellt krav för denna typ.':'Samlingsinsättningen saknar en verifierad individuell rapport.'),reportRows.length?'Kontrollera originalintegritet och samma insättning.':reportCandidates.length?'Granska rapportoriginal, mottagarkonto och stabil bankidentitet.':direct?'Kontrollera betalare och referens i bankoriginalet.':'Hämta individuella betalningsuppgifter via behörig kanal.',[fact('Antal kopplade betalningar',reportRows.length),fact('Rapportens summa',reportRows.length?money(reportRows.reduce((n,row)=>n+row.amount,0)):''),fact('Möjliga separata rapporter',reportCandidates.length),fact('Mottagarens Bankgiro',hintRows[0]?.recipientBankgiro)]);
 add('original','Originalintegritet',originalOK?'passed':'blocked',originalOK?'Intakt i denna kontroll':'Blockerad',sourceDescription,'owned-original-sha256-and-replay-v1',originalIssue||detailIssue||checks.reportIssue||(conflict?'Bankoriginalen innehåller motstridiga uppgifter.':originalOK?'Bevarad bankrepresentation och dess kvitto samt berörda ägda filoriginal har kontrollerats. En kontrollsumma bevisar inte ensam bankens autenticitet.':'Bankens originalkälla kan inte verifieras.'),originalOK?'Bevara originalen och deras ankomstkvitton.':'Återställ eller granska det bevarade originalet; ersätt det inte med fri text.',[fact('AIS-kvittoprofil',ais?.bankDataVersion),fact('AIS-kontrollsumma',ais?.bankDataSha256),fact('Rapportens kontrollsumma',reportRows[0]?.bankFileProof?.sha256)]);
 add('account','Mottagarkonto',accountOK?'passed':'blocked',accountOK?'Verifierat i aktuellt medgivande':'Saknas / blockerat','Ägarens aktiva bankmedgivande och kontoresurs','active-owned-selected-sek-account-v1',accountIssue||(accountOK?'Kontot motsvarar entydigt ett valt SEK-konto i ägarens aktuella produktionsmedgivande. Detta bevisar inte i sig Bankgironumrets relation till kontot.':'Mottagarkonto saknas.'),accountOK?'Kontrollera rapportens uttryckliga mottagarkonto.':'Komplettera bankens kontoresurs eller styrkt kontoalias; ingen kontoöversättning gissas.',[fact('Mottagarkonto',accountLabel(t.account)),fact('AIS-konto i aktuellt medgivande',checks.accountIssue?'Kräver kontroll':'Ja'),fact('Rapportens mottagarkonto',hintRows[0]?.recipientAccount?accountLabel(hintRows[0].recipientAccount):''),fact('Valuta',t.currency)]);
 const depositOK=commonId&&originalOK&&accountOK;
 add('deposit','Samma insättning',link?'manual':depositOK?'passed':direct?'not_required':commonId?'blocked':'missing',link?'Manuell relation':depositOK?'Gemensamt bank-ID':direct?'En bankkälla':commonId?'Blockerad':'Samband saknas',link?'Separat administratörsbeslut':commonId?'AIS- och rapportoriginal':'Ingen bekräftad originalrelation','stable-bank-identity-or-explicit-source-review-v1',link?'Administratören har beslutat att underlagen hör samman. Relationen är inte bankverifierad identitet och auktoriserar ingen fakturaallokering.':depositOK?'Gemensamt stabilt bank-ID, konto, valuta och komplett rapportbelopp stöder kopplingen.':direct?'Ingen koppling mellan två bankkällor behövs för den här individuella bankposten.':commonId?'Ett gemensamt ID finns, men original- eller kontokontrollen är blockerad.':'Datum och belopp räcker inte för att identifiera samma insättning från två källor.',link?'Kontrollera kund och faktura separat. Återta underlagsbeslutet om det är fel.':depositOK||direct?'Fortsätt med betalare, referens och faktura.':'Anskaffa bankens uttryckliga rapport-/insättningsrelation eller gör separat behörig originalgranskning.',[fact('AIS bank-ID',parent?.bankReference||ais?.bankReference),fact('Rapportens bank-ID',t.parentBankReference||reportRows[0]?.parentBankReference),fact('Manuellt beslut',link?.createdAt),fact('Kontrollanteckning',link?.note)]);
 add('payer','Betalare',detailIssue&&usesDetailPayer?'blocked':view.payerKnown?(originalOK?'passed':'review'):'missing',detailIssue&&usesDetailPayer?'Detaljoriginal kräver kontroll':view.payerKnown?'Namn finns i bankunderlag':'Okänd',usesDetailPayer?'Bankens separata detaljoriginal':link?'Kopplat Bankgirooriginal':sourceDescription,'preserved-bank-payer-v1',detailIssue&&usesDetailPayer?detailIssue:view.payerKnown?'Bankens avsändaruppgift visas separat från fakturakunden. Ett namn är inte ensamt bevis för kundrelation.':'Banken har inte lämnat verifierbara individuella betalaruppgifter för denna bankpost.',view.payerKnown?'Jämför kundidentiteten och eventuell styrkt tredjepartsrelation.':'Hämta individuellt bankoriginal; fakturakunden får inte ersätta bankens avsändare.',[fact('Bankens avsändare',view.payerKnown?view.payer:''),fact('Separat manuellt namn',t.verification?.party),fact('Ej kopplat rapportnamn',!link&&!reportRows.length&&hintRows.length===1?hintRows[0].party:''),fact('Identifierartyp',t.payerEvidence?.organizationNumber?'Svenskt organisationsnummer':'Ingen verifierad organisationsidentifierare')]);
 const reference=view.reference,referenceSource=link?.rows.length===1?link.rows[0]:t,referenceEvidence=usesDetailReference?t.bankDetails?.referenceEvidence||t.referenceEvidence:referenceSource.referenceEvidence,invalidReference=!!referenceEvidence?.candidates.some(c=>c.validity==='checksum_invalid');
 const referenceValues=matchingReferenceValues(referenceEvidence,referenceSource.payerReference),referenceOwners=new Set(state.invoices.filter(i=>!i.voided&&referenceValues.some(value=>[i.number,i.ocr].some(actual=>actual&&exactReference(value,actual)))).map(i=>i.id));
 const contradictoryReferences=referenceValues.length>1&&!state.invoices.some(i=>referenceValues.every(value=>[i.number,i.ocr].some(actual=>actual&&exactReference(value,actual))));
 const referenceBlocked=!!detailIssue&&usesDetailReference||invalidReference||!!referenceEvidence?.incomplete||referenceOwners.size>1||contradictoryReferences;
 add('reference','Betalningsreferens',referenceBlocked?'blocked':reference.value?'passed':'missing',detailIssue&&usesDetailReference?'Detaljoriginal kräver kontroll':invalidReference?'Ogiltig OCR':referenceBlocked?'Motstridiga referenser':reference.value?reference.kind==='ocr'?'OCR':reference.kind==='invoice'?'Fakturareferens':'Betalningsreferens':'Saknas',usesDetailReference?'Bankens separata detaljoriginal':link?'Kopplat Bankgirooriginal':sourceDescription,'typed-preserved-reference-v1',detailIssue&&usesDetailReference?detailIssue:invalidReference?'Bankreferensen innehåller en ogiltig OCR-kontrollsiffra.':referenceBlocked?'Referenskällorna är ofullständiga eller motstridiga och behöver granskas tillsammans.':reference.value?'Exakt bankreferens med inledande nollor bevaras. En generell referens klassificeras inte som formell OCR.':'Ingen individuell referens är verifierad för bankposten.',referenceBlocked?'Kontrollera originalreferensen och företagets verkliga OCR-avtal.':reference.value?'Sök exakt fakturareferens och kontrollera kund och saldo separat.':'Läs referensen från individuellt original före fakturakoppling.',[fact('Referens',reference.value),fact('Formell bank-OCR',referenceBlocked?'':reference.ocr),fact('Separat manuell referens',t.verification?.payerReference),fact('Ej kopplad rapportreferens',!link&&!reportRows.length&&hintRows.length===1?hintRows[0].payerReference:'')]);
 const ambiguous=registered.length>1||allocatedIds.length>1||!invoice&&candidates.length>1;
 const invoiceOK=!!invoice&&invoice.reviewed&&checks.invoiceOriginalChecked&&!checks.invoiceOriginalIssue&&!ambiguous;
 const invoiceStatus=ambiguous?'blocked':invoice?invoiceOK?'passed':'review':candidates.length?'review':'missing';
 const candidateOriginalOK=candidates.length===1&&checks.invoiceOriginalChecked&&!checks.invoiceOriginalIssue;
 add('invoice','Faktura',invoiceStatus,ambiguous?'Konflikt':invoice?invoiceOK?'Registrerad · original intakt':'Registrerad · original kräver kontroll':candidates.length?candidateOriginalOK?'Original hittat · ej registrerad':'Underlagsförslag · ej registrerad':'Saknas','Ägarens fakturaregister och bevarade fakturaunderlag','registered-invoice-and-owned-original-v1',ambiguous?'Flera registerposter eller original kan avse referensen. Ingen entydig faktura har verifierats.':invoice?checks.invoiceOriginalIssue||(!checks.invoiceOriginalChecked?missingInvoice:invoice.reviewed?'Registeruppgifterna är markerade granskade och det ägda fakturaoriginalets integritet har kontrollerats. Originalets affärsuppgifter måste fortsatt vara korrekt granskade.':'Registeruppgifterna kräver granskning.'):candidates.length?candidateOriginalOK?'Ett ägt, intakt original och dess tidigare tolkade nummer kan avse referensen. Ingen registerpost skapas av denna kontroll.':checks.invoiceOriginalIssue||'Tidigare tolkat underlagsförslag finns, men själva originalet har inte integritetskontrollerats.':'Ingen entydig faktura finns i registret eller bland de lästa originalförslagen.',ambiguous?'Granska möjliga dubbletter och fakturaidentitet.':invoice?invoiceOK?'Kontrollera kundrelation, belopp och bokat saldo.':'Öppna och granska originalfakturan.':'Registrera ett befintligt original genom ordinarie original- och motpartskontroll.',[fact('Fakturanummer',invoice?.number||candidates.map(c=>c.number).join(', ')),fact('Registerkund',invoice?.party),fact('Original bifogat',invoice?.documentId?'Ja':'Nej'),fact('Sökreferens från separat granskningsunderlag',!reference.value?hintReference:'')]);
 add('customer','Kundrelation',safeCandidate&&!link?'passed':'review',safeCandidate&&!link?'Stämmer enligt matchningsregeln':'Kräver granskning','Befintlig matchningsanalys och separata kundrelationer',RECONCILIATION_RULE_VERSION,safeCandidate&&!link?'Den befintliga motorn har godtagit betalare och kundrelation för ett säkert fakturaförslag. Detta är en regelbedömning, inte en ny bankidentifiering.':link?'Underlagsrelationen bevisar inte att betalaren är fakturakunden eller en godkänd tredjepartsbetalare.':allocations.length?'En allokering finns registrerad. Den är inte ensam bevis för en självständigt verifierad kundrelation.':'Ingen säker aktuell kund- eller tredjepartsrelation har styrkts i denna kontroll.',safeCandidate&&!link?'Granska fakturaoriginalet före ett separat beslut.':'Verifiera kundidentitet eller dokumentera behörig tredjepartsrelation separat.',[fact('Bankens avsändare',view.payerKnown?view.payer:''),fact('Fakturakund',invoice?.party)]);
 const remaining=invoice?balance(state,invoice):undefined,unallocated=available(state,t),amountMatch=remaining!==undefined&&remaining>0&&unallocated===remaining;
 add('amount','Fakturabelopp och saldo',invoice&&!ambiguous?'passed':'missing',invoice?remaining===0?'Redan slutreglerad':amountMatch?'Belopp stämmer':unallocated<remaining!?'Delbetalning möjlig':'Överbetalning / avvikelse':'Faktura saknas','Befintliga fakturor, aktiva allokeringar och krediter','integer-ore-recorded-balance-v1',invoice?'Beloppen beräknas från bokade allokeringar och krediter. Förslag och originalrelationer ändrar inget saldo.':'Utan verifierad registerpost kan fakturans saldo inte beräknas.',invoice?remaining===0?'Skapa ingen ny betalning mot en redan slutreglerad faktura.':'Granska delbetalning eller överskott och besluta separat.':'Registrera och granska rätt faktura först.',[fact('Fakturabelopp',invoice?money(invoice.total):''),fact('Bokat återstående saldo',remaining!==undefined?money(remaining):''),fact('Ofördelad bankbetalning',money(unallocated)),fact('Aktiva allokeringar',allocations.length)]);
 const blocked=!originalOK||!accountOK||conflict||!!t.ignored||!!t.duplicateOf||!!state.bankEvidenceHold;
 const automaticEligible=!blocked&&safeCandidate&&invoiceOK&&!link&&!referenceBlocked;
 add('reconciliation','Avstämning',blocked?'blocked':allocations.length?'passed':automaticEligible?'review':'review',blocked?'Blockerad':allocations.length?'Registrerad':automaticEligible?'Förslag · separat beslut krävs':'Kräver granskning','Läsande originalkontrollerad avstämningsförhandsgranskning',RECONCILIATION_RULE_VERSION,blocked?'Kontrollen är blockerad. Eventuella registrerade saldon och allokeringar bevaras; inga nya ekonomiska skrivningar görs.':allocations.length?'Aktiva allokeringar finns redan registrerade. Kontrollen ändrar eller återtar inte dessa.':automaticEligible?'Den befintliga motorn föreslår en säker matchning. Den här läsningen skapar ingen allokering.':'Alla krav för en säker matchning har inte verifierats. Betalningen stannar i granskning.',blocked?'Åtgärda de saknade eller motstridiga underlagen ovan.':allocations.length?'Granska historiken. Återtag är ett separat administratörsbeslut.':'Låt administratören granska underlagen och fatta ett separat godkännandebeslut.',[fact('Föreslaget belopp',finding?money(finding.amount_cents):''),fact('Registrerade allokeringar',allocations.length),fact('Ekonomiska skrivningar i kontrollen','0')]);
 return {transactionId:id,checkedAt:checks.checkedAt,mode:'preview',changed:false,automaticEligible,bookedAllocationCount:allocations.length,steps};
}

/** Recheck the exact source used in presentation, independently from the AIS receipt. */
async function detailOriginalIssue(owner:string,target:Transaction){
 const missing='Bankens separata detaljoriginal saknas eller kan inte verifieras. Betalare och referens från detaljmetadata kräver granskning.';
 try{
  const documentId=target.bankDetails?.documentId;if(!documentId)return missing;
  const doc=await db().prepare('SELECT mime,size,sha256 FROM documents WHERE id=? AND owner=?').bind(documentId,owner).first<{mime:string;size:number;sha256:string}>();
  if(!doc||doc.mime!=='application/json'||!Number.isSafeInteger(doc.size)||doc.size<1||doc.size>15_000_000||!/^[a-f0-9]{64}$/.test(doc.sha256))return missing;
  const object=await env.BUCKET?.get(`${owner}/${documentId}`);if(!object||object.size!==doc.size)return missing;
  const bytes=await object.arrayBuffer();if(bytes.byteLength!==doc.size)return missing;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==doc.sha256)return missing;
  const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(original?.source!=='Enable Banking transaction details'||original.account!==target.account||original.bankReference!==target.bankReference)return 'Det separata detaljoriginalets konto eller bank-ID motsvarar inte denna bankpost.';
  const expected=transactionDetailEvidence(target,original.listed,original.detail);
  if((['party','payerReference','referenceSchema','referenceEvidence','payerEvidence'] as const).some(field=>JSON.stringify(target.bankDetails?.[field])!==JSON.stringify(expected[field])))return 'Visad betalare eller referensevidens stämmer inte med det bevarade separata detaljoriginalet.';
  return '';
 }catch{return missing;}
}

async function invoiceOriginalIssue(owner:string,documentId:string){
 if(!documentId)return missingInvoice;
 try{
  const doc=await db().prepare('SELECT size,sha256 FROM documents WHERE id=? AND owner=?').bind(documentId,owner).first<{size:number;sha256:string}>();
  if(!doc||!Number.isSafeInteger(doc.size)||doc.size<1||doc.size>15_000_000||!/^[a-f0-9]{64}$/.test(doc.sha256))return missingInvoice;
  const object=await env.BUCKET?.get(`${owner}/${documentId}`);if(!object||object.size!==doc.size)return missingInvoice;
  const bytes=await object.arrayBuffer();if(bytes.byteLength!==doc.size)return missingInvoice;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  return hash===doc.sha256?'':'Fakturaoriginalets kontrollsumma stämmer inte. Granska det bevarade originalet.';
 }catch{return missingInvoice;}
}

/** GET-only service. Reads owned stored resources; no provider calls, writes or orchestration. */
export async function readPaymentVerification(owner:string,state:State,id:string){
 if(!owner)throw Error('AUTH_REQUIRED');
 const selected=subject(state,id),originalIssue=await paymentOriginalAvailabilityIssue(owner,state,id),accountIssue=await bankgiroAutomaticAccountIssue(owner,selected.transaction.account),detailIssue=selected.usesDetailPayer||selected.usesDetailReference?await detailOriginalIssue(owner,selected.transaction):'';
 let reportIssue='';const checkedReports=new Set<string>();
 for(const row of selected.reportRows){
  reportIssue=paymentOriginalIssue(state,row);if(reportIssue)break;
  const proof=JSON.stringify([row.bankFileProof?.documentId,row.bankFileProof?.sha256,row.parentId]);if(checkedReports.has(proof))continue;
  if(checkedReports.size>=32){reportIssue='Kontrollen omfattar för många original. Granska underlagen i mindre omgångar.';break;}
  checkedReports.add(proof);reportIssue=await paymentOriginalAvailabilityIssue(owner,state,row.id);if(reportIssue)break;
 }
 let reportAccountIssue='';
 const reportGroup=selected.reportRows.length?selected.reportRows:needsPaymentSpecification(selected.transaction)&&selected.reportCandidates.length===1?selected.reportCandidates[0].rows:[];
 if(needsPaymentSpecification(selected.transaction)&&!reportGroup.length&&selected.reportCandidates.length>1)reportAccountIssue='Flera rapportoriginal kan passa. Granska mottagarkonto och rapportidentitet innan en relation bekräftas.';
 if(reportGroup.length){
  const proof=reportGroup[0].bankFileProof;
  try{
   if(!proof)throw Error('Rapportoriginalets ägda filkoppling saknas.');
   const fresh=await bankgiroRetainedPreview(owner,proof.documentId,id);
   if(fresh.hash!==proof.sha256)throw Error('Rapportoriginalets kontrollsumma skiljer sig från den sparade observationen.');
   const groupKey=(row:any)=>row.parentKey||row.parentBankReference||row.bankReference||row.key||'csv',freshGroup=fresh.rows.filter((row:any)=>groupKey(row)===reportGroup[0].specificationGroup);
   if(!freshGroup.length)throw Error('Rapportens sparade betalningsgrupp kunde inte återfinnas i originalet.');
   reportAccountIssue=freshGroup.find((row:any)=>row.bankgiroAccountIssue)?.bankgiroAccountIssue||'';
  }catch(error){reportIssue=error instanceof Error?error.message:'Rapportoriginalet kunde inte kontrolleras.';reportAccountIssue='Rapportens uttryckliga mottagarkonto kunde inte verifieras mot det bevarade originalet.';}
 }
 const rows=await db().prepare("SELECT s.document_id,s.status,s.extraction,j.extraction job_extraction FROM gmail_sources s LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=? AND s.status<>'rejected' ORDER BY s.created_at DESC LIMIT 1000").bind(owner).all<any>();
 const details=subject(state,id,rows.results),documentId=details.invoice?.documentId||(details.candidates.length===1?details.candidates[0].documentId:''),invoiceIssue=await invoiceOriginalIssue(owner,documentId);
 const preview=await reconciliationPreviewWithOriginals(owner,state);
 return buildPaymentVerification(state,id,{checkedAt:new Date().toISOString(),originalIssue,detailIssue,accountIssue,reportAccountIssue,reportIssue,documents:rows.results,invoiceOriginalChecked:!!documentId&&!invoiceIssue,invoiceOriginalIssue:invoiceIssue,findings:preview.findings});
}
