import {reconcileWithOriginals,assertPaymentOriginal} from '@/lib/reconciliation-evidence';
import {reconcileAndPrepare} from '@/lib/customer-messages';
import { db, identity, readWorkspace, readBankFileOriginal, response, failure } from "@/lib/server";
import { applyCommand, emptyState, now, uid } from "@/lib/domain";
import {readBankgiroOriginal} from '@/lib/bankgiro-service';
import {searchBankgiroInvoice} from '@/lib/bankgiro-invoice-search';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await identity();const data=await readWorkspace(user.userId);const audit=await db().prepare('SELECT id, revision, action, detail, created_at FROM audit_events WHERE owner = ? ORDER BY revision DESC LIMIT 100').bind(user.userId).all();return response({...data,audit:audit.results,user:{displayName:user.displayName}});}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 const user=await identity(req),text=await req.text();if(text.length>1_500_000)return response({error:'Importen är för stor. Dela upp filen.'},413);
 const body=JSON.parse(text);if(!Number.isSafeInteger(body.revision)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(body.requestId))return response({error:'Ogiltig förfrågan.'},400);
 const old=await readWorkspace(user.userId);if(old.state.receipts.includes(body.requestId))return response({...old,message:'Åtgärden är redan sparad.'});
 if(old.revision!==body.revision)return response({error:'Uppgifterna ändrades i ett annat fönster. Uppdatera sidan innan du försöker igen.'},409);
 const command=body.command;if(command&&typeof command==='object'){delete command.trustedBankImport;delete command.trustedBankFileImport;delete command.bankFileProof;}const documentId=command?.invoice?.documentId||command?.documentId;if(documentId){const doc=await db().prepare('SELECT id FROM documents WHERE id=? AND owner=?').bind(documentId,user.userId).first();if(!doc)throw new Error('Bilagan kunde inte hittas för ditt konto.');}
 if(command?.type==='bankgiro.import')Object.assign(command,await readBankgiroOriginal(user.userId,command));
 if(command?.type==='transactions.import'){
  if(command.documentId)Object.assign(command,await readBankFileOriginal(user.userId,command));
  else if(Array.isArray(command.rows))command.rows=command.rows.map((r:any)=>({...r,verified:false,specification:false,evidence:undefined}));
 }
 const current=['match.create','transaction.verify','transaction.split'].includes(command?.type)?await assertPaymentOriginal(user.userId,old.state,command.transactionId||command.id):old.state;
 const result=applyCommand(current,command);const automatic=await reconcileWithOriginals(user.userId,result.state);result.state=automatic.state;result.state.receipts=[...old.state.receipts.slice(-199),body.requestId];const payload=JSON.stringify(result.state);
 if(new TextEncoder().encode(payload).length>1_800_000)throw new Error('Registret är för stort för den här versionen. Exportera dina uppgifter innan vidare import.');
 const at=now();await db().prepare('INSERT OR IGNORE INTO workspaces (owner, revision, payload, updated_at) VALUES (?, 0, ?, ?)').bind(user.userId,JSON.stringify(emptyState()),at).run();
 const detail=JSON.stringify({message:result.message,command,automatic:automatic.decisions,requestId:body.requestId});
 const batch=await db().batch([
  db().prepare('INSERT INTO audit_events (id, owner, revision, action, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(uid(),user.userId,old.revision+1,command.type,detail,at,user.userId,old.revision),
  db().prepare('UPDATE workspaces SET payload=?, revision=revision+1, updated_at=? WHERE owner=? AND revision=?').bind(payload,at,user.userId,old.revision)
 ]);
 if(batch[1].meta.changes!==1)return response({error:'En annan ändring sparades samtidigt. Uppdatera sidan och försök igen.'},409);
 await reconcileAndPrepare(user.userId);
 if(command.type==='bankgiro.import'){
  const fresh=result.state.transactions.filter(t=>t.specification&&t.specificationStatus==='linked'&&!old.state.transactions.some(x=>x.id===t.id));
  for(const t of fresh.slice(0,5))try{await searchBankgiroInvoice(user.userId,t.id);}catch{/* Import is durable even if Gmail is unavailable. */}
  const latest=await readWorkspace(user.userId);return response({...latest,message:result.message});
 }
 return response({state:result.state,revision:old.revision+1,message:result.message});
 }catch(e){return failure(e);}}
