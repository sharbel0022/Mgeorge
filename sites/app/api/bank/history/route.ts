import {db,identity,readWorkspace,response,failure} from '@/lib/server';
import {paymentHistoryEntry} from '@/lib/payment-history';
export const dynamic='force-dynamic';
/** Read-only keyset pagination. A global last-100 list is not a payment's history. */
export async function GET(req:Request){try{
 const user=await identity(),url=new URL(req.url),id=url.searchParams.get('transactionId')||'',before=url.searchParams.get('before');
 if(!id||id.length>100||before!==null&&(!/^[1-9]\d{0,15}$/.test(before)||!Number.isSafeInteger(Number(before))))return response({error:'Ogiltigt historikval.'},400);
 const workspace=await readWorkspace(user.userId);
 const transaction=workspace.state.transactions.find(t=>t.id===id);if(!transaction)return response({error:'Bankhändelsen finns inte.'},404);
 const allocations=workspace.state.allocations.filter(a=>a.transactionId===id),allocationIds=allocations.map(a=>a.id);
 const rows=await db().prepare(`WITH events AS (
  SELECT rowid AS sequence,id,action,detail,created_at,CASE WHEN json_valid(detail) THEN detail ELSE '{}' END AS evidence
  FROM audit_events WHERE owner=? AND rowid<?
 ) SELECT sequence,id,action,detail,created_at FROM events WHERE
  (action LIKE 'transaction.%' AND json_extract(evidence,'$.command.id')=?)
  OR (action IN ('transaction.split','transaction.unsplit') AND json_extract(evidence,'$.command.id')=?)
  OR (action='match.create' AND json_extract(evidence,'$.command.transactionId')=?)
  OR (action='match.undo' AND json_extract(evidence,'$.command.id') IN (SELECT value FROM json_each(?)))
  OR (action='bank.details' AND json_extract(evidence,'$.transactionId')=?)
  OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(evidence,'$.automatic')='array' THEN json_extract(evidence,'$.automatic') ELSE '[]' END) d WHERE json_extract(CASE WHEN d.type='object' THEN d.value ELSE '{}' END,'$.transaction_id')=? OR EXISTS (SELECT 1 FROM json_each(CASE WHEN d.type='object' AND json_type(d.value,'$.child_ids')='array' THEN json_extract(d.value,'$.child_ids') ELSE '[]' END) WHERE value=?))
  OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(evidence,'$.decisions')='array' THEN json_extract(evidence,'$.decisions') ELSE '[]' END) d WHERE json_extract(CASE WHEN d.type='object' THEN d.value ELSE '{}' END,'$.transaction_id')=? OR EXISTS (SELECT 1 FROM json_each(CASE WHEN d.type='object' AND json_type(d.value,'$.child_ids')='array' THEN json_extract(d.value,'$.child_ids') ELSE '[]' END) WHERE value=?))
  ORDER BY sequence DESC LIMIT 51`).bind(user.userId,before?Number(before):Number.MAX_SAFE_INTEGER,id,transaction.parentId||null,id,JSON.stringify(allocationIds),id,id,id,id,id).all<{sequence:number;id:string;action:string;detail:string;created_at:string}>();
 const page=rows.results.slice(0,50),entries=page.map(row=>paymentHistoryEntry(row,id,{parentId:transaction.parentId,allocations,invoices:workspace.state.invoices})).filter(Boolean);
 return response({entries,next:rows.results.length>50?String(page[page.length-1].sequence):null});
 }catch(e){return failure(e);}}
