// Owner-scoped, resumable encrypted snapshots. No payments or live restore writes.
type Database={prepare:(sql:string)=>any;batch:(statements:any[])=>Promise<any[]>};
type Bucket={get:(key:string)=>Promise<any>;put:(key:string,value:Uint8Array,options?:any)=>Promise<any>};
type Row=Record<string,any>;
export const BACKUP_TABLES=['workspaces','audit_events','documents','bank_applications','bank_connections','bank_sync_runs','gmail_connections','customer_contacts','customer_messages','reconciliation_findings','customer_deliveries','gmail_sources','gmail_runs','document_automation','document_jobs','document_extractions','invoice_counterparties','document_registrations','payment_control_runs','payment_control_requests'];
const encoder=new TextEncoder(),magic=encoder.encode('MGBK0001');
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))).map(b=>b.toString(16).padStart(2,'0')).join('');
const clock=()=>new Date().toISOString();
const scope=(owner:string,id:string,name:string)=>encoder.encode(JSON.stringify(['MG-Sites-backup-1',owner,id,name]));
function baseKey(key:string){if(!/^[a-f0-9]{64}$/i.test(key))throw Error('backup_key_unavailable');return Uint8Array.from(key.match(/../g)!,s=>parseInt(s,16));}
async function encryptionKey(key:string,salt:Uint8Array){const input=await crypto.subtle.importKey('raw',baseKey(key),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:salt as BufferSource,info:encoder.encode('MG Sites encrypted backup v1')},input,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function sealBackup(bytes:Uint8Array,key:string,owner:string,id:string,name:string){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),derived=await encryptionKey(key,salt);const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:scope(owner,id,name)},derived,bytes as BufferSource));const out=new Uint8Array(36+cipher.length);out.set(magic);out.set(salt,8);out.set(iv,24);out.set(cipher,36);return out;}
export async function unsealBackup(bytes:Uint8Array,key:string,owner:string,id:string,name:string){if(bytes.length<52||!magic.every((b,n)=>bytes[n]===b))throw Error('backup_format_invalid');return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(24,36),additionalData:scope(owner,id,name)},await encryptionKey(key,bytes.slice(8,24)),bytes.slice(36)));}
export function validateSnapshot(value:any,owner:string){
 if(value?.format!=='MG-Sites-backup-1'||value.owner!==owner||!Array.isArray(value.tables)||value.tables.length!==BACKUP_TABLES.length)throw Error('backup_snapshot_invalid');
 for(const table of value.tables){if(!BACKUP_TABLES.includes(table.name)||!Array.isArray(table.rows)||table.rows.some((r:Row)=>r.owner!==owner))throw Error('backup_owner_mismatch');}
 if(new Set(value.tables.map((t:Row)=>t.name)).size!==BACKUP_TABLES.length)throw Error('backup_snapshot_invalid');
 const workspace=value.tables.find((t:Row)=>t.name==='workspaces').rows;if(workspace.length>1)throw Error('backup_snapshot_invalid');
 for(const row of workspace){const state=JSON.parse(row.payload);if(!Array.isArray(state.invoices)||!Array.isArray(state.transactions)||!Array.isArray(state.allocations))throw Error('backup_snapshot_invalid');}
 const files=value.tables.find((t:Row)=>t.name==='documents').rows;
 if(files.some((f:Row)=>!/^[a-f0-9-]{36}$/i.test(f.id)||!Number.isSafeInteger(f.size)||f.size<0||f.size>15_000_000||!/^[a-f0-9]{64}$/i.test(f.sha256)))throw Error('backup_document_invalid');
 return value as {format:string;owner:string;createdAt:string;tables:{name:string;rows:Row[]}[]};
}
export function publicBackup(row:Row|null){return row?{id:row.id,day:row.day,status:row.state,files:row.total_docs,copied:row.cursor,bytes:row.bytes,created_at:row.created_at,verified_at:row.finished_at,verified_files:row.verification_cursor||0,verified_bytes:row.verified_bytes||0,verification_started_at:row.verification_started_at||'',verification_scope:row.verification_started_at?'manifest_pass':row.state==='complete'?'copy_readback':'pending',error:row.last_error||null,attempts:row.attempts}:null;}
export async function backupStatus(database:Database,owner:string){const latest=await database.prepare('SELECT * FROM backup_runs WHERE owner=? ORDER BY created_at DESC LIMIT 1').bind(owner).first();const complete=await database.prepare("SELECT * FROM backup_runs WHERE owner=? AND state='complete' ORDER BY finished_at DESC LIMIT 1").bind(owner).first();return{latest:publicBackup(latest),last_verified:publicBackup(complete)};}
async function readSnapshot(bucket:Bucket,row:Row,key:string,owner:string){const object=await bucket.get(row.snapshot_key);if(!object)throw Error('backup_snapshot_missing');const bytes=await unsealBackup(new Uint8Array(await object.arrayBuffer()),key,owner,row.id,'snapshot');if(await hash(bytes)!==row.snapshot_hash)throw Error('backup_snapshot_hash');return validateSnapshot(JSON.parse(new TextDecoder().decode(bytes)),owner);}
export async function backupStep(database:Database,bucket:Bucket,owner:string,key:string,at=new Date(),limit=5){
 baseKey(key);const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(at),createdAt=at.toISOString();
 await database.prepare("INSERT OR IGNORE INTO backup_runs(id,owner,day,state,created_at,updated_at) VALUES(?,?,?,'preparing',?,?)").bind(crypto.randomUUID(),owner,day,createdAt,createdAt).run();
 let row=await database.prepare('SELECT * FROM backup_runs WHERE owner=? AND day=?').bind(owner,day).first();
 if(!row)throw Error('backup_unavailable');if(row.state==='complete'||row.attempts>=3)return publicBackup(row);
 const lease=crypto.randomUUID(),until=new Date(Date.now()+180_000).toISOString();
 const locked=await database.prepare("UPDATE backup_runs SET attempts=attempts+CASE WHEN lease<>'' THEN 1 ELSE 0 END,verification_cursor=CASE WHEN lease<>'' OR state='failed' THEN 0 ELSE verification_cursor END,verified_bytes=CASE WHEN lease<>'' OR state='failed' THEN 0 ELSE verified_bytes END,verification_started_at=CASE WHEN lease<>'' OR state='failed' THEN '' ELSE verification_started_at END,lease=?,lease_until=?,updated_at=? WHERE owner=? AND id=? AND state<>'complete' AND attempts<3 AND (lease='' OR lease_until<?)").bind(lease,until,clock(),owner,row.id,clock()).run();
 if(locked.meta.changes!==1){const current=await database.prepare('SELECT * FROM backup_runs WHERE owner=? AND id=?').bind(owner,row.id).first();return{...publicBackup(current),...(current?.state!=='complete'&&current?.attempts<3?{busy:true}:{})};}
 // A previous worker may have checkpointed or finished after our first read.
 // Only state read under the newly acquired lease can drive this step.
 row=await database.prepare('SELECT * FROM backup_runs WHERE owner=? AND id=? AND lease=?').bind(owner,row.id,lease).first();
 if(!row)throw Error('backup_lease_lost');
 if(row.attempts>=3){await database.prepare("UPDATE backup_runs SET state='failed',last_error='backup_interrupted',lease='',lease_until='',updated_at=? WHERE owner=? AND id=? AND lease=?").bind(clock(),owner,row.id,lease).run();return publicBackup(await database.prepare('SELECT * FROM backup_runs WHERE owner=? AND id=?').bind(owner,row.id).first());}
 // An expired worker must not overwrite a newer worker's snapshot object.
 // Existing snapshots retain their original paths for backward compatibility.
 const prefix=row.snapshot_key?row.snapshot_key.slice(0,row.snapshot_key.lastIndexOf('/')):`backups/${encodeURIComponent(owner)}/${day}/${row.id}/${lease}`;
 async function checkpoint(assignments:string,...values:any[]){const saved=await database.prepare(`UPDATE backup_runs SET ${assignments} WHERE owner=? AND id=? AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(...values,owner,row!.id,lease).run();if(saved.meta.changes!==1)throw Error('backup_lease_lost');}
 async function renew(){await checkpoint('lease_until=?',new Date(Date.now()+180_000).toISOString());}
 async function verifyCopy(file:Row){
  const copy=await bucket.get(prefix+'/'+file.id+'.bin');if(!copy)throw Error('backup_copy_missing');
  let restored:Uint8Array;
  try{restored=await unsealBackup(new Uint8Array(await copy.arrayBuffer()),key,owner,row!.id,'document:'+file.id);}catch{throw Error('backup_copy_invalid');}
  if(restored.length!==file.size||await hash(restored)!==file.sha256)throw Error('backup_copy_hash_mismatch');
 }
 try{
  await renew();
  if(!row.snapshot_key){
   // One D1 batch provides a consistent database snapshot across all durable owner tables.
   const results=await database.batch(BACKUP_TABLES.map(name=>database.prepare(`SELECT * FROM ${name} WHERE owner=? LIMIT 5001`).bind(owner)));
   if(results.some(result=>!Array.isArray(result.results)||result.results.length>5000))throw Error('backup_snapshot_too_large');
   const snapshot=validateSnapshot({format:'MG-Sites-backup-1',owner,createdAt,tables:BACKUP_TABLES.map((name,n)=>({name,rows:name==='documents'?results[n].results.sort((a:Row,b:Row)=>a.id.localeCompare(b.id)):results[n].results}))},owner),plain=encoder.encode(JSON.stringify(snapshot));
   if(plain.length>12_000_000)throw Error('backup_snapshot_too_large');
   const snapshotKey=prefix+'/snapshot.bin',snapshotHash=await hash(plain);await bucket.put(snapshotKey,await sealBackup(plain,key,owner,row.id,'snapshot'),{httpMetadata:{contentType:'application/octet-stream'}});
   const total=snapshot.tables.find(t=>t.name==='documents')!.rows.length;
   await renew();
   await checkpoint("snapshot_key=?,snapshot_hash=?,total_docs=?,state='running',last_error='',updated_at=?",snapshotKey,snapshotHash,total,clock());
   row={...row,snapshot_key:snapshotKey,snapshot_hash:snapshotHash,total_docs:total,state:'running'};
  }
  const snapshot=await readSnapshot(bucket,row,key,owner),files=snapshot.tables.find(t=>t.name==='documents')!.rows;
  const bytesThrough=(cursor:number)=>files.slice(0,cursor).reduce((total,file)=>total+file.size,0);
  if(!Number.isSafeInteger(row.cursor)||row.cursor<0||row.cursor>files.length||row.total_docs!==files.length||row.bytes!==bytesThrough(row.cursor)||!Number.isSafeInteger(row.verification_cursor)||row.verification_cursor<0||row.verification_cursor>files.length||row.verified_bytes!==bytesThrough(row.verification_cursor)||(row.verification_cursor>0&&(!row.verification_started_at||row.cursor!==files.length)))throw Error('backup_checkpoint_invalid');
  const stepLimit=Number.isInteger(limit)?Math.max(1,Math.min(5,limit)):5;
  const copying=row.cursor<files.length;
  if(copying){
   for(const file of files.slice(row.cursor,row.cursor+stepLimit)){
    await renew();
    const source=await bucket.get(`${owner}/${file.id}`);if(!source)throw Error('backup_original_missing');
    const bytes=new Uint8Array(await source.arrayBuffer());if(bytes.length!==file.size||await hash(bytes)!==file.sha256)throw Error('backup_original_hash_mismatch');
    const name=`document:${file.id}`,path=prefix+'/'+file.id+'.bin';await bucket.put(path,await sealBackup(bytes,key,owner,row.id,name),{httpMetadata:{contentType:'application/octet-stream'}});
    await verifyCopy(file);
    row.cursor++;row.bytes+=bytes.length;
    await checkpoint("cursor=?,bytes=?,state='running',updated_at=?",row.cursor,row.bytes,clock());
   }
  }else{
   // Copy readback is historical evidence. Once copying is done, authenticate
   // the entire frozen manifest in a separate bounded pass before completion.
   // Failed or abandoned passes restart under the next lease; ordinary bounded
   // steps retain progress. R2 objects and D1 completion are not one transaction.
   if(!row.verification_started_at){row.verification_started_at=clock();await checkpoint("verification_started_at=?,state='verifying',last_error='',updated_at=?",row.verification_started_at,clock());}
   for(const file of files.slice(row.verification_cursor,row.verification_cursor+stepLimit)){
    await renew();await verifyCopy(file);
    row.verification_cursor++;row.verified_bytes+=file.size;
    await checkpoint("verification_cursor=?,verified_bytes=?,state='verifying',updated_at=?",row.verification_cursor,row.verified_bytes,clock());
   }
  }
  const complete=!copying&&row.verification_cursor===files.length&&row.verified_bytes===bytesThrough(files.length);
  await renew();
  await checkpoint('state=?,finished_at=?,last_error=?,lease=?,lease_until=?,updated_at=?',complete?'complete':row.cursor===files.length?'verifying':'running',complete?clock():'','','','',clock());
  return publicBackup(await database.prepare('SELECT * FROM backup_runs WHERE owner=? AND id=?').bind(owner,row.id).first());
 }catch(error){
  const code=error instanceof Error&&/^backup_[a-z_]+$/.test(error.message)?error.message:'backup_failed';
  await database.prepare("UPDATE backup_runs SET state='failed',attempts=attempts+1,last_error=?,lease='',lease_until='',updated_at=? WHERE owner=? AND id=? AND lease=?").bind(code,clock(),owner,row.id,lease).run();
  return publicBackup(await database.prepare('SELECT * FROM backup_runs WHERE owner=? AND id=?').bind(owner,row.id).first());
 }
}
