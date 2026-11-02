// Retained C3 queue facts only. No provider call, lease, mutation or matching.
const terminal=new Set(['IMPORTED','REVIEW','DUPLICATE']);
const text=value=>typeof value==='string'&&value.length>0;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Bind each retained original to its own owner/source/scope/report identity.
 * Unlinked manual originals do not acquire a new source requirement. */
export function projectBankgiroSourceEvidence({owner,originals,sources,jobs}){
 if(!text(owner)||![originals,sources,jobs].every(Array.isArray))throw Error('BANKGIRO_SOURCE_SNAPSHOT_INCOMPLETE');
 const ownedJobs=jobs.filter(row=>row?.owner===owner),ownedSources=sources.filter(row=>row?.owner===owner);
 const reports=[],snapshot=[];
 for(const original of originals){
  const anchors=ownedJobs.filter(job=>text(original.documentId)&&job.document_id===original.documentId||text(original.importId)&&job.import_id===original.importId);
  let issue='';const hold=code=>{if(!issue)issue=code;};
  const dependencies=new Map(),authorities=new Map();
  for(const anchor of anchors){
   const identity=ownedJobs.filter(job=>job.source_id===anchor.source_id&&job.scope_id===anchor.scope_id&&job.report_id===anchor.report_id);
   for(const job of identity)dependencies.set(job.id,job);
   const current=ownedSources.filter(source=>source.source_id===anchor.source_id);
   for(const source of current)authorities.set(source.source_id,source);
   const source=current[0];
   if(current.length!==1||source.authorization_status!=='VERIFIED'||source.scope_id!==anchor.scope_id||source.authorization_generation!==anchor.authorization_generation)hold('BANKGIRO_SOURCE_AUTHORIZATION_CHANGED');
   if(![anchor.source_id,anchor.scope_id,anchor.report_id,anchor.authorization_generation,anchor.document_id].every(text)||!hash(original.sha256)||anchor.sha256!==original.sha256||original.intact===false||text(original.importId)&&anchor.import_id!==original.importId)hold('BANKGIRO_SOURCE_ORIGINAL_CONFLICT');
   if(identity.some(job=>!hash(job.sha256)||job.sha256!==original.sha256))hold('BANKGIRO_SOURCE_IDENTITY_CONFLICT');
   if(identity.some(job=>!terminal.has(job.status)||job.last_error))hold('BANKGIRO_SOURCE_REPORT_INCOMPLETE');
   if(source){
    let missing;try{missing=JSON.parse(source.missing_report_ids);}catch{}
    if(!Array.isArray(missing)||missing.some(id=>!text(id))||missing.length||source.last_error)hold('BANKGIRO_SOURCE_SNAPSHOT_INCOMPLETE');
   }
  }
  const report={documentId:original.documentId||'',importId:original.importId||'',issue};reports.push(report);
  snapshot.push({...report,sha256:original.sha256||'',jobs:[...dependencies.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id))),sources:[...authorities.values()].sort((a,b)=>String(a.source_id).localeCompare(String(b.source_id)))});
 }
 return {complete:true,reports,snapshot};
}

/** Read the complete owner census; project only identities linked to originals. */
export async function readBankgiroSourceEvidence(database,owner,originals){
 const [sources,jobs]=await Promise.all([
  database.prepare('SELECT * FROM bankgiro_ingest_sources WHERE owner=? ORDER BY source_id').bind(owner).all(),
  database.prepare('SELECT * FROM bankgiro_ingest_jobs WHERE owner=? ORDER BY id').bind(owner).all(),
 ]);
 return projectBankgiroSourceEvidence({owner,originals,sources:sources.results,jobs:jobs.results});
}
