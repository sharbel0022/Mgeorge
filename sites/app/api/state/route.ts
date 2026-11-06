import {reconcileWithOriginals,assertPaymentOriginal,writePaymentState} from '@/lib/reconciliation-evidence';
import {reconcileAndPrepare} from '@/lib/customer-messages';
import { db, identity, readWorkspace, readBankFileOriginal, response, failure } from "@/lib/server";
import { applyCommand, BankImportEvidenceError, bankImportEvidenceError, prepareBankImportFailure, emptyState, now, uid, type Command, type State } from "@/lib/domain";
import {readBankgiroOriginal} from '@/lib/bankgiro-service';
import {searchBankgiroInvoice} from '@/lib/bankgiro-invoice-search';
export const dynamic='force-dynamic';

// Audit accepted business changes, never the arbitrary client envelope. Original
// documents and rejected bank-conflict evidence have their own retained records.
function acceptedAuditCommand(command:Command,before:State,after:State){
 const type=command.type;
 const added=<T extends {id:string}>(previous:T[],current:T[])=>{const ids=new Set(previous.map(item=>item.id));return current.filter(item=>!ids.has(item.id));};
 switch(type){
  case'invoice.save':return{type,invoice:after.invoices.find(item=>item.id===command.invoice?.id)||added(before.invoices,after.invoices)[0]};
  case'settings.save':return{type,settings:{name:after.company.name,email:after.company.email,...(Object.hasOwn(command,'invoiceReferencePolicies')?{invoiceReferencePolicies:after.company.invoiceReferencePolicies}:{})}};
  case'transactions.import':case'bankgiro.import':{
   const previous=new Set(before.imports.map(item=>item.id));
   return{type,rowCount:Array.isArray(command.rows)?command.rows.length:0,
    imports:after.imports.filter(item=>!previous.has(item.id)||command.hash&&item.hash===command.hash).map(({id,hash,documentId,count})=>({id,hash,documentId,count})),
    ...(after.transactions.some(item=>item.id===command.targetId)?{targetId:command.targetId}:{})};
  }
  case'transaction.split':{const rows=added(before.transactions,after.transactions);return{type,id:command.id,rowCount:rows.length,transactionIds:rows.map(item=>item.id)};}
  case'transaction.verify':{
   const item=after.transactions.find(item=>item.id===command.id);
   return{type,id:item?.id,verification:item?.verification,confirmDistinct:command.confirmDistinct===true};
  }
  case'transaction.ignore':case'transaction.unverify':case'transaction.unsplit':{
   const item=after.transactions.find(item=>item.id===command.id);
   return{type,id:item?.id,ignored:item?.ignored,verified:item?.verified,...(type==='transaction.unsplit'?{transactionIds:after.transactions.filter(row=>row.parentId===item?.id&&row.ignored).map(row=>row.id)}:{})};
  }
  case'match.create':return{type,allocation:added(before.allocations,after.allocations).find(item=>item.invoiceId===command.invoiceId&&item.transactionId===command.transactionId),referenceCorrection:command.referenceCorrection===true};
  case'match.undo':{
   const item=after.allocations.find(item=>item.id===command.id);
   return{type,id:item?.id,invoiceId:item?.invoiceId,transactionId:item?.transactionId,note:after.transactions.find(row=>row.id===item?.transactionId)?.automaticMatchHold?.reason,reversedAt:item?.reversedAt};
  }
  case'credit.add':return{type,credit:added(before.credits,after.credits)[0]};
  case'credit.undo':{const item=after.credits.find(item=>item.id===command.id);return{type,id:item?.id,active:item?.active};}
  case'invoice.reconcile':{const item=after.invoices.find(item=>item.id===command.id);return{type,id:item?.id,reconciledAt:item?.reconciledAt,reconciliationNote:item?.reconciliationNote};}
  case'invoice.void':{const item=after.invoices.find(item=>item.id===command.id);return{type,id:item?.id,voided:item?.voided};}
  case'bankgiro.link':{
   const item=after.bankgiroLinks?.find(item=>!item.revokedAt&&item.transactionId===command.transactionId&&item.specificationIds.includes(command.specificationId));
   return{type,...(item?{id:item.id,transactionId:item.transactionId,specificationIds:item.specificationIds,note:item.note,dateDifferenceNote:item.dateDifferenceNote,createdAt:item.createdAt}:{})};
  }
  case'bankgiro.unlink':{const item=after.bankgiroLinks?.find(item=>item.id===command.id);return{type,id:item?.id,note:item?.revocationNote,revokedAt:item?.revokedAt};}
  default:return{type};
 }
}

export async function GET(){try{const user=await identity();const data=await readWorkspace(user.userId);const audit=await db().prepare('SELECT id, revision, action, detail, created_at FROM audit_events WHERE owner = ? ORDER BY revision DESC LIMIT 100').bind(user.userId).all();return response({...data,audit:audit.results,user:{displayName:user.displayName}});}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 const user=await identity(req),text=await req.text();if(text.length>1_500_000)return response({error:'Importen är för stor. Dela upp filen.'},413);
 const body=JSON.parse(text);if(!Number.isSafeInteger(body.revision)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(body.requestId))return response({error:'Ogiltig förfrågan.'},400);
 const old=await readWorkspace(user.userId);if(old.state.receipts.includes(body.requestId))return response({...old,message:'Åtgärden är redan sparad.'});
 if(old.revision!==body.revision)return response({error:'Uppgifterna ändrades i ett annat fönster. Uppdatera sidan innan du försöker igen.'},409);
 let command=body.command;const metadataOnly=['bankgiro.link','bankgiro.unlink'].includes(command?.type);
 if(metadataOnly){const {prepareBankgiroLinkCommand}=await import('@/lib/bankgiro-service');command=await prepareBankgiroLinkCommand(user.userId,old.state,command);}
 if(command&&typeof command==='object'){delete command.trustedBankImport;delete command.trustedBankFileImport;delete command.bankFileProof;}const documentId=command?.invoice?.documentId||command?.documentId;if(documentId){const doc=await db().prepare('SELECT id FROM documents WHERE id=? AND owner=?').bind(documentId,user.userId).first();if(!doc)throw new Error('Bilagan kunde inte hittas för ditt konto.');}
 if(command?.type==='bankgiro.import')Object.assign(command,await readBankgiroOriginal(user.userId,command));
 if(command?.type==='transactions.import'){
  if(command.documentId)Object.assign(command,await readBankFileOriginal(user.userId,command));
  else if(Array.isArray(command.rows))command.rows=command.rows.map((r:any)=>({...r,verified:false,specification:false,evidence:undefined}));
 }
 const current=['match.create','transaction.verify','transaction.split'].includes(command?.type)?await assertPaymentOriginal(user.userId,old.state,command.transactionId||command.id):old.state;
 const manualAllocationIds=new Set<string>();
 let result:ReturnType<typeof applyCommand>,automatic:Awaited<ReturnType<typeof reconcileWithOriginals>>,payload:string;
 try{
  result=applyCommand(current,command);if(command?.type==='match.create')for(const allocation of result.state.allocations)if(allocation.active&&!current.allocations.some(old=>old.id===allocation.id))manualAllocationIds.add(allocation.id);automatic=metadataOnly?{state:result.state,decisions:[],findings:[]}:await reconcileWithOriginals(user.userId,result.state);result.state=automatic.state;result.state.receipts=[...old.state.receipts.slice(-199),body.requestId];payload=JSON.stringify(result.state);
  if(new TextEncoder().encode(payload).length>1_800_000){const message='Registret är för stort för den här versionen. Exportera dina uppgifter innan vidare import.';throw bankImportEvidenceError(old.state,result.state,message)||new Error(message);}
 }catch(error){
  if(!(error instanceof BankImportEvidenceError))throw error;
  const eventId=uid(),prepared=await prepareBankImportFailure(old.state,error.state,eventId),at=now();
  if(prepared.replayed)return response({error:error.message,state:old.state,revision:old.revision,evidenceRetained:true},400);
  const detail=JSON.stringify({message:error.message,requestId:body.requestId,command:{type:command.type,documentId:command.documentId,hash:command.hash,name:command.name},retained_conflicts:prepared.conflicts,compact_hold:prepared.compact});
  const saved=await db().batch([
   db().prepare('INSERT INTO audit_events (id, owner, revision, action, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(eventId,user.userId,old.revision+1,'bank.import_rejected',detail,at,user.userId,old.revision),
   db().prepare('UPDATE workspaces SET payload=?, revision=revision+1, updated_at=? WHERE owner=? AND revision=?').bind(prepared.payload,at,user.userId,old.revision)
  ]);
  if(saved[1].meta.changes!==1)return response({error:'En annan ändring sparades samtidigt. Uppdatera sidan och försök igen.'},409);
  return response({error:error.message,state:prepared.state,revision:old.revision+1,evidenceRetained:true},400);
 }
 const at=now();await db().prepare('INSERT OR IGNORE INTO workspaces (owner, revision, payload, updated_at) VALUES (?, 0, ?, ?)').bind(user.userId,JSON.stringify(emptyState()),at).run();
 const detail=JSON.stringify({message:result.message,command:acceptedAuditCommand(command,old.state,result.state),automatic:automatic.decisions,requestId:body.requestId});
 const batch=await writePaymentState(user.userId,old.revision,old.state,result.state,db(),[
  db().prepare('INSERT INTO audit_events (id, owner, revision, action, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(uid(),user.userId,old.revision+1,command.type,detail,at,user.userId,old.revision),
  db().prepare('UPDATE workspaces SET payload=?, revision=revision+1, updated_at=? WHERE owner=? AND revision=?').bind(payload,at,user.userId,old.revision)
 ],{manualAllocationIds});
 if(batch[1].meta.changes!==1)return response({error:'En annan ändring sparades samtidigt. Uppdatera sidan och försök igen.'},409);
 if(!metadataOnly)await reconcileAndPrepare(user.userId);
 if(command.type==='bankgiro.import'){
  const fresh=result.state.transactions.filter(t=>t.specification&&t.specificationStatus==='linked'&&!old.state.transactions.some(x=>x.id===t.id));
  for(const t of fresh.slice(0,5))try{await searchBankgiroInvoice(user.userId,t.id);}catch{/* Import is durable even if Gmail is unavailable. */}
  const latest=await readWorkspace(user.userId);return response({...latest,message:result.message});
 }
 return response({state:result.state,revision:old.revision+1,message:result.message});
 }catch(e){if(e&&typeof e==='object'&&'code' in e&&e.code==='BANK_CONSENT_CHANGED')return response({error:e instanceof Error?e.message:'Bankmedgivandet ändrades. Kör kontrollen igen.'},409);return failure(e);}}
