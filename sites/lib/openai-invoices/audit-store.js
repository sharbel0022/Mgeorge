/**
 * Server-side persistence using the existing, owner-protected audit journal.
 * Reservations are immutable and never refunded automatically: a lost response
 * may still have been billed. No network call is made by this module.
 */
const RESERVATION='invoice.ai.reserved';
const RESULT='invoice.ai.result';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw Error('AI_RESERVATION_INVALID');};
const validKey=key=>{if(!hash(key))fail();};
const json=value=>{const encoded=JSON.stringify(value);if(typeof encoded!=='string'||encoded.length>98_304)fail();return encoded;};
function context({owner,authorize=()=>{},now=()=>new Date()}={}){
  if(typeof owner!=='string'||!owner.trim()||owner.length>200||typeof authorize!=='function'||typeof now!=='function')fail();
  return {owner,authorize,now};
}
function reservation(input,ctx){
  if(!input||!hash(input.key)||!hash(input.sha256)||typeof input.documentId!=='string'||!input.documentId.trim()||input.documentId.length>200||
    typeof input.profileVersion!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(input.profileVersion)||
    !Number.isSafeInteger(input.reservedMicroUsd)||input.reservedMicroUsd<1||input.reservedMicroUsd>10_000_000||
    !Number.isSafeInteger(input.dailyBudgetMicroUsd)||input.dailyBudgetMicroUsd<1||input.dailyBudgetMicroUsd>100_000_000)fail();
  const date=ctx.now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail();
  const at=date.toISOString(),day=at.slice(0,10),end=new Date(date.getTime());end.setUTCDate(end.getUTCDate()+1);
  const value={schemaVersion:1,owner:ctx.owner,key:input.key,documentId:input.documentId,sha256:input.sha256,profileVersion:input.profileVersion,reservedMicroUsd:input.reservedMicroUsd,day};
  return {id:'invoice-ai-reserve:'+input.key,at,start:day+'T00:00:00.000Z',end:end.toISOString().slice(0,10)+'T00:00:00.000Z',encoded:json(value)};
}
function cached(row,key,owner,column){
  if(!row)return null;
  try{const value=JSON.parse(row[column]);if(value.schemaVersion!==1||value.owner!==owner||value.key!==key||!value.result||typeof value.result!=='object'||Array.isArray(value.result))throw Error();return value.result;}
  catch{throw Error('AI_RECEIPT_INVALID');}
}
function resultValue(key,result,ctx){
  validKey(key);if(!result||typeof result!=='object'||Array.isArray(result))fail();
  return json({schemaVersion:1,owner:ctx.owner,key,result});
}
// Unknown/corrupt reservations exhaust the cap rather than becoming free spend.
const sumExpression=column=>'SUM(CASE WHEN json_valid('+column+') THEN CASE WHEN json_type('+column+",'$.reservedMicroUsd')='integer' AND json_extract("+column+",'$.reservedMicroUsd')>0 THEN json_extract("+column+",'$.reservedMicroUsd') ELSE ? END ELSE ? END)";

export function createNodeAuditStore(database,options){
  const ctx=context(options),column='details';
  return Object.freeze({
    async load(key){
      validKey(key);await ctx.authorize();
      const row=database.prepare('SELECT details FROM audit_events WHERE id=? AND action=?').get('invoice-ai-result:'+key,RESULT);
      await ctx.authorize();return cached(row,key,ctx.owner,column);
    },
    async reserve(input){
      const r=reservation(input,ctx);await ctx.authorize();
      const changed=database.prepare(
        'INSERT INTO audit_events(id,action,details,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM audit_events WHERE id=?) AND COALESCE((SELECT '+sumExpression(column)+' FROM audit_events WHERE action=? AND created_at>=? AND created_at<?),0)+?<=?'
      ).run(r.id,RESERVATION,r.encoded,r.at,r.id,input.dailyBudgetMicroUsd+1,input.dailyBudgetMicroUsd+1,RESERVATION,r.start,r.end,input.reservedMicroUsd,input.dailyBudgetMicroUsd);
      await ctx.authorize();
      if(Number(changed.changes)===1)return {status:'reserved'};
      const exists=database.prepare('SELECT details FROM audit_events WHERE id=? AND action=?').get(r.id,RESERVATION);
      if(exists){try{if(JSON.parse(exists.details).owner!==ctx.owner)throw Error();}catch{throw Error('AI_RECEIPT_INVALID');}}
      return {status:exists?'existing':'budget_exhausted'};
    },
    async record(key,result){
      const encoded=resultValue(key,result,ctx);await ctx.authorize();
      const changed=database.prepare(
        'INSERT OR IGNORE INTO audit_events(id,action,details,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=? AND action=? AND json_valid(details) AND json_extract(details,?)=?)'
      ).run('invoice-ai-result:'+key,RESULT,encoded,ctx.now().toISOString(),'invoice-ai-reserve:'+key,RESERVATION,'$.owner',ctx.owner);
      await ctx.authorize();return Number(changed.changes)===1;
    }
  });
}

export function createD1AuditStore(database,options){
  const ctx=context(options),column='detail';
  return Object.freeze({
    async load(key){
      validKey(key);await ctx.authorize();
      const row=await database.prepare('SELECT detail FROM audit_events WHERE owner=? AND id=? AND action=?').bind(ctx.owner,'invoice-ai-result:'+key,RESULT).first();
      await ctx.authorize();return cached(row,key,ctx.owner,column);
    },
    async reserve(input){
      const r=reservation(input,ctx);await ctx.authorize();
      const changed=await database.prepare(
        'INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,0,?,?,? WHERE NOT EXISTS(SELECT 1 FROM audit_events WHERE owner=? AND id=?) AND COALESCE((SELECT '+sumExpression(column)+' FROM audit_events WHERE owner=? AND action=? AND created_at>=? AND created_at<?),0)+?<=?'
      ).bind(r.id,ctx.owner,RESERVATION,r.encoded,r.at,ctx.owner,r.id,input.dailyBudgetMicroUsd+1,input.dailyBudgetMicroUsd+1,ctx.owner,RESERVATION,r.start,r.end,input.reservedMicroUsd,input.dailyBudgetMicroUsd).run();
      await ctx.authorize();
      if(Number(changed.meta?.changes)===1)return {status:'reserved'};
      const exists=await database.prepare('SELECT id FROM audit_events WHERE owner=? AND id=? AND action=?').bind(ctx.owner,r.id,RESERVATION).first();
      return {status:exists?'existing':'budget_exhausted'};
    },
    async record(key,result){
      const encoded=resultValue(key,result,ctx);await ctx.authorize();
      const changed=await database.prepare(
        'INSERT OR IGNORE INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,0,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE owner=? AND id=? AND action=?)'
      ).bind('invoice-ai-result:'+key,ctx.owner,RESULT,encoded,ctx.now().toISOString(),ctx.owner,'invoice-ai-reserve:'+key,RESERVATION).run();
      await ctx.authorize();return Number(changed.meta?.changes)===1;
    }
  });
}
