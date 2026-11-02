// Source associations are review decisions. They never change bank originals,
// create payments, verify a counterparty or call the allocation engine.
import {randomUUID} from 'node:crypto';
import {audit} from './db.js';
import {parseBankFile,normalizeBankApiTransaction} from './importers.js';
import {digest,decryptObject} from './security.js';
import {reconciliationData} from './reconciliation.js';
import {bankFinancialReview} from './bank-evidence.js';
import {bankgiroDepositIdentity} from '../sites/lib/bankgiro-deposit-identity.js';
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const canonical=value=>String(value||'').replace(/^iban:/i,'').replace(/\s/g,'').toUpperCase();
const fail=message=>Object.assign(new Error(message),{status:409});
function required(value,label){if(typeof value!=='string'||!value.trim()||value.length>1500)throw fail(`${label} krävs (max 1500 tecken).`);return value.trim();}
function apiOriginal(db,t){
 if(!t||t.source!=='enablebanking'||t.api_identity_version!==1||!t.raw_bank_data_sha256)throw fail('Bokfört AIS-original med aktuell kontoidentitet krävs.');
 try{
  const raw=JSON.parse(t.raw_bank_data);if(digest(JSON.stringify(raw))!==t.raw_bank_data_sha256)throw Error();
  const parsed=normalizeBankApiTransaction(raw,t.account);
  // Use the same complete fact, reference, parent and conflict verification as
  // reconciliation. A source relation must never introduce a weaker receipt.
  const verified=reconciliationData(db).transactions.find(row=>row.id===t.id);
  if(!parsed||!verified?.original_verified||bankFinancialReview(verified)||parsed.description!==t.description||JSON.stringify(parsed.payer_evidence)!==JSON.stringify(JSON.parse(t.payer_evidence))||JSON.stringify(parsed.reference_evidence)!==JSON.stringify(JSON.parse(t.reference_evidence)))throw Error();
  if(t.parent_bank_reference||t.bank_reference&&db.prepare('SELECT id FROM bank_transactions WHERE id<>? AND account=? AND parent_bank_reference=? AND excluded=0 LIMIT 1').get(t.id,t.account,t.bank_reference))throw Error();
  return raw;
 }catch{throw fail('Bankoriginalet eller dess härledda uppgifter kan inte verifieras.');}
}
function ownedAccount(db,t,owner){
 if(!owner)throw fail('Inloggad ägare krävs.');
 const matches=[];
 for(const connection of db.prepare("SELECT * FROM bank_connections WHERE owner=? AND status='connected' AND selected_account_uid<>''").all(owner)){
  if(!(Date.parse(connection.valid_until)>Date.now()))continue;
  try{
   const available=decryptObject(connection.accounts_json);if(!Array.isArray(available))continue;
   const selected=available.filter(a=>a?.uid===connection.selected_account_uid);
   if(selected.length===1&&selected[0].currency==='SEK'&&canonical(selected[0].account_id?.iban)===canonical(t.account)&&/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(canonical(t.account)))matches.push({connection,selected:selected[0],available});
  }catch{}
 }
 if(matches.length===1)return matches[0];
 throw fail('Aktivt ägt bankmedgivande med exakt valt SEK-konto krävs.');
}
// Formatting separators may differ, but no digits are added, removed or inferred.
const aliasKey=value=>typeof value==='string'?value.replace(/[\s-]/g,'').toUpperCase():'';
function accountIdentifiers(resource){
 if(!resource||typeof resource!=='object')return [];
 const identifiers=[{scheme:'IBAN',value:resource.account_id?.iban,field:'account_id.iban'}];
 const other=resource.account_id?.other;if(other)identifiers.push({scheme:other.scheme_name,value:other.identification,field:'account_id.other'});
 if(Array.isArray(resource.all_account_ids))for(const [index,item] of resource.all_account_ids.entries())if(item&&typeof item==='object')identifiers.push({scheme:item.scheme_name,value:item.identification,field:`all_account_ids[${index}]`});
 return identifiers.map(item=>({...item,scheme:typeof item.scheme==='string'?item.scheme.toUpperCase():'',key:aliasKey(item.value)})).filter(item=>['IBAN','BBAN','CPAN'].includes(item.scheme)&&/^[A-Z0-9]{1,80}$/.test(item.key));
}
function reportAccountRelation(context,t,report){
 const key=aliasKey(report.account);
 if(report.rows.some(row=>row.account_evidence?.explicit_currency!==true))throw fail('Rapportoriginalet saknar uttrycklig valuta. Antagen SEK är inte verifierad valuta; komplettera bankunderlaget.');
 if(!key||report.rows.some(row=>aliasKey(row.account_evidence?.reported_account)!==key))throw fail('Rapportens uttryckliga mottagarkonto måste motsvara bankens valda konto eller ett entydigt banklevererat kontoalias.');
 const common={source:'provider_account_resource',connection_id:context.connection.id,account_uid:context.selected.uid,selected_account:canonical(t.account),reported_account:report.reported_account};
 const holders=context.available.filter(resource=>accountIdentifiers(resource).some(identifier=>identifier.key===key));
 const identifier=accountIdentifiers(context.selected).find(item=>item.key===key);
 if(holders.length!==1||holders[0]!==context.selected||!identifier)throw fail('Rapportens mottagarkonto saknar ett entydigt banklevererat kontoalias till ägarens aktuella valda konto.');
 // A primary IBAN is also ambiguous when another provider resource holds it.
 if(report.account===canonical(t.account)&&report.rows.every(row=>row.account_evidence.exact_match===true))return {...common,kind:'exact',scheme:'IBAN',field:'account_id.iban'};
 return {...common,kind:'provider_alias',scheme:identifier.scheme,field:identifier.field};
}
function reports(db,importId,account,owner){
 const original=db.prepare("SELECT * FROM import_jobs WHERE id=? AND source='bank_file' AND mime_type=? AND (owner='' OR owner=?)").get(importId,mime,owner);
 if(!original?.content||!original.content_sha256||digest(original.content)!==original.content_sha256)throw fail('Originalfilens SHA-256 eller ägare kan inte verifieras.');
 const rows=parseBankFile(original.name,Buffer.from(original.content).toString('base64'),account),groups=new Map();
 for(const row of rows){
  const report=row.account_evidence?.report||{},key=JSON.stringify([row.booked_at,report.recipientBankgiro,report.sequence,report.paymentCount,report.totalCents,row.account_evidence?.reported_account]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 return [...groups.values()].map(group=>{
  const row=group[0],report=row.account_evidence.report,total=group.reduce((sum,x)=>sum+x.amount_cents,0);
  if(!Number.isSafeInteger(total)||total<=0||Number(report.paymentCount)!==group.length||Number(report.totalCents)!==total||group.some(x=>x.currency!==row.currency||x.booked_at!==row.booked_at))throw fail('Rapportens totalsumma eller antal är ofullständigt.');
  const identity=[canonical(row.account_evidence.reported_account),row.booked_at,report.recipientBankgiro,report.sequence,group.length,total,group.map(x=>[x.payer,x.reference,x.payer_bankgiro,x.amount_cents]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))];
  return {import_id:original.id,name:original.name,report_key:digest(JSON.stringify(identity)),deposit_identity:bankgiroDepositIdentity(report,row.booked_at),sha256:original.content_sha256,rows:group,amount_cents:total,currency:row.currency,booked_at:row.booked_at,account:canonical(row.account_evidence.reported_account),reported_account:row.account_evidence.cells?.account?.rawValue??row.account_evidence.reported_account,recipient_bankgiro:report.recipientBankgiro,sequence:report.sequence,original_url:`/api/imports/${encodeURIComponent(original.id)}/original`};
 });
}
function compatible(db,t,report,owner){
 apiOriginal(db,t);const context=ownedAccount(db,t,owner);
 if(t.excluded||t.amount_cents<=0||t.amount_cents!==report.amount_cents||t.currency!==report.currency)throw fail('Bankpostens belopp, valuta eller status motsvarar inte hela rapporten.');
 report.account_relation=reportAccountRelation(context,t,report);
 const days=(Date.parse(t.booked_at+'T00:00:00Z')-Date.parse(report.booked_at+'T00:00:00Z'))/86400000;
 if(!Number.isInteger(days)||Math.abs(days)>3)throw fail('Datumskillnaden överstiger tre dagar. Granska annat bankunderlag.');
 const conflict=db.prepare("SELECT * FROM bank_specification_links WHERE revoked_at='' AND ((report_key=? AND transaction_id<>?) OR (transaction_id=? AND report_key<>?)) LIMIT 1").get(report.report_key,t.id,t.id,report.report_key);
 if(conflict)throw fail('Rapporten eller bankposten har redan en annan aktiv källkoppling.');
 // Re-exported content can change its fingerprint while naming the same bank
 // deposit. Retained originals also reserve legacy links without a schema rewrite.
 if(report.deposit_identity){
  const alreadyLinked=db.prepare("SELECT id FROM bank_specification_links WHERE owner=? AND transaction_id=? AND import_id=? AND report_key=? AND original_sha256=? AND revoked_at=''").get(owner,t.id,report.import_id,report.report_key,report.sha256);
  for(const link of db.prepare("SELECT * FROM bank_specification_links WHERE owner=? AND revoked_at='' AND transaction_id<>?").all(owner,t.id)){
   let previous;try{previous=reports(db,link.import_id,t.account,owner).find(item=>item.report_key===link.report_key&&item.sha256===link.original_sha256);}catch{}
   // An unrelated unavailable original can hold a new reservation, but must
   // not erase another source relation whose own original remains intact.
   if(!previous){if(alreadyLinked)continue;throw fail('En aktiv rapportkoppling kan inte kontrolleras mot sitt original. Granska den kopplingen innan en ny rapport reserveras.');}
   if(previous.deposit_identity===report.deposit_identity)throw fail('Samma insättning i Bankgirorapporten har redan en aktiv källkoppling till en annan bankpost. Granska och återta den relationen först.');
  }
 }
 return days;
}
function project(link,report){return {id:link.id,verification:'manual',verified_by:link.owner,created_at:link.created_at,evidence:link.evidence,date_difference_note:link.date_difference_note,import_id:link.import_id,report_key:link.report_key,sha256:link.original_sha256,original_url:report.original_url,reported_account:report.reported_account,account_relation:report.account_relation,payer:report.rows.length===1?report.rows[0].payer:'',reference:report.rows.length===1?report.rows[0].reference:'',payments:report.rows.map(row=>({payer:row.payer,reference:row.reference,amount_cents:row.amount_cents,booked_at:row.booked_at,bankgiro:row.bankgiro,payer_bankgiro:row.payer_bankgiro,reference_kind:'structured',payer_evidence:row.payer_evidence,reference_evidence:row.reference_evidence,account_evidence:row.account_evidence,cellProvenance:row.account_evidence?.cells})),bank_original_url:`/api/bank-transactions/${encodeURIComponent(link.transaction_id)}/original`};}
export function bankSpecificationCandidates(db,transactionId,owner){
 const t=db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(transactionId);if(!t)throw fail('Bankhändelsen saknas.');
 const active_links=db.prepare("SELECT id,owner,transaction_id,import_id,report_key,evidence,created_at FROM bank_specification_links WHERE transaction_id=? AND owner=? AND revoked_at='' ORDER BY created_at").all(transactionId,owner);
 let accountIssue='';try{ownedAccount(db,t,owner);}catch(error){if(!active_links.length)throw error;accountIssue=error.message;}
 const items=[];
 for(const original of db.prepare("SELECT id FROM import_jobs WHERE source='bank_file' AND mime_type=? AND (owner='' OR owner=?) ORDER BY created_at DESC").all(mime,owner)){
  try{for(const report of reports(db,original.id,t.account,owner)){
   // Amount and date only select review candidates. They never establish identity.
   const dayDifference=Math.abs(Date.parse(t.booked_at)-Date.parse(report.booked_at))/86400000;if(report.amount_cents!==t.amount_cents||dayDifference>3)continue;
   let reason='',days=0;try{days=compatible(db,t,report,owner);}catch(error){reason=error.message;}
   const active=db.prepare("SELECT * FROM bank_specification_links WHERE owner=? AND import_id=? AND report_key=? AND revoked_at=''").get(owner,report.import_id,report.report_key);
   items.push({...report,can_link:!reason,reason:reason||(report.account_relation?.kind==='provider_alias'?'Mottagarkontot stöds av ett uttryckligt kontoalias från banken. Kontrollera båda originalen före manuell koppling.':'Möjlig tillhörande Bankgirospecifikation – kontrollera båda originalen.'),date_difference_days:days,matching_bank_count:db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE excluded=0 AND account=? AND amount_cents=? AND currency=? AND booked_at=?').get(t.account,t.amount_cents,t.currency,t.booked_at).n,link:!reason&&active&&active.transaction_id===t.id?project(active,report):null});
  }}catch{/* Invalid originals remain retained in import history, never usable as candidates. */}
 }
 const valid=bankSpecificationPresentation(db,t.id,owner);
 return {items,active_links:active_links.map(link=>({...link,stale:valid?.id!==link.id||!!accountIssue,reason:accountIssue||(valid?.id!==link.id?'Den tidigare underlagskopplingen kan inte verifieras mot tillgängliga original. Granska och återta beslutet vid behov.':'')})),bank_original_url:`/api/bank-transactions/${encodeURIComponent(t.id)}/original`};
}
export function confirmBankSpecificationLink(db,input,owner,authorize=()=>{}){
 if(input.confirm!==true||input.originals_checked!==true||input.account_checked!==true)throw fail('Bekräfta att båda originalen och mottagarkontot har kontrollerats.');
 const evidence=required(input.evidence,'Kontrollanteckning');
 db.exec('BEGIN IMMEDIATE');
 try{
  authorize();const t=db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(input.transaction_id);if(!t)throw fail('Bankhändelsen saknas.');
  const report=reports(db,input.import_id,t.account,owner).find(r=>r.report_key===input.report_key);if(!report)throw fail('Den granskade rapporten finns inte i originalet.');
  const days=compatible(db,t,report,owner),dateNote=days?required(input.date_difference_note,'Dokumenterad datumskillnad'):'';
  const previous=db.prepare("SELECT * FROM bank_specification_links WHERE import_id=? AND report_key=? AND revoked_at=''").get(report.import_id,report.report_key);
  if(previous){if(previous.owner!==owner||previous.transaction_id!==t.id)throw fail('Originalet är kopplat till en annan bankpost eller ägare.');db.exec('COMMIT');return project(previous,report);}
  const id=randomUUID();db.prepare('INSERT INTO bank_specification_links(id,owner,transaction_id,import_id,report_key,original_sha256,evidence,date_difference_note) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,t.id,report.import_id,report.report_key,report.sha256,evidence,dateNote);
  // Legacy imports belong to the single-company Node workspace. The first
  // explicit original review binds that retained source to its administrator.
  db.prepare("UPDATE import_jobs SET owner=? WHERE id=? AND owner=''").run(owner,report.import_id);
  audit(db,'bank_specification_linked',{id,owner,transaction_id:t.id,import_id:report.import_id,report_key:report.report_key,original_sha256:report.sha256,evidence,date_difference_note:dateNote,verification:'manual',account_relation:report.account_relation,financial_records_created:0});
  const result=project(db.prepare('SELECT * FROM bank_specification_links WHERE id=?').get(id),report);db.exec('COMMIT');return result;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function revokeBankSpecificationLink(db,id,input,owner,authorize=()=>{}){
 const evidence=required(input.evidence,'Rättelseanteckning');db.exec('BEGIN IMMEDIATE');
 try{authorize();const link=db.prepare('SELECT * FROM bank_specification_links WHERE id=? AND owner=?').get(id,owner);if(!link)throw fail('Kopplingen saknas eller tillhör annan ägare.');
  if(!link.revoked_at){db.prepare("UPDATE bank_specification_links SET revoked_at=?,revoke_evidence=? WHERE id=?").run(new Date().toISOString(),evidence,id);audit(db,'bank_specification_link_revoked',{id,owner,transaction_id:link.transaction_id,import_id:link.import_id,evidence,financial_records_changed:0});}db.exec('COMMIT');return {revoked:true};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function bankSpecificationPresentation(db,transactionId,owner){
 const t=db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(transactionId);if(!t||!owner)return null;
 for(const link of db.prepare("SELECT * FROM bank_specification_links WHERE transaction_id=? AND owner=? AND revoked_at='' ORDER BY created_at").all(transactionId,owner)){
  try{const report=reports(db,link.import_id,t.account,owner).find(r=>r.report_key===link.report_key&&r.sha256===link.original_sha256);if(report){compatible(db,t,report,owner);return project(link,report);}}catch{}
 }
 return null;
}
export function bankApiOriginal(db,transactionId,owner){const t=db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(transactionId);if(!t)throw fail('Bankhändelsen saknas.');ownedAccount(db,t,owner);return apiOriginal(db,t);}
