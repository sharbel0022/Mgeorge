import {createD1AuditStore} from './audit-store.js';
import {enrichInvoiceForReview} from './integration.js';
import {extractOpenAiInvoice} from './adapter.js';
import {preflightOriginal} from './preflight.js';

export async function enrichSitesInvoice({database,owner,job,baseline,environment,loadBytes,adapter=extractOpenAiInvoice}){
  const authorize=async()=>{
    const current=await database.prepare("SELECT d.mime,d.sha256,d.size FROM document_jobs j JOIN documents d ON d.owner=j.owner AND d.id=j.document_id WHERE j.owner=? AND j.document_id=? AND j.lease=? AND j.state='processing' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND d.sha256=? AND d.size=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=j.owner AND s.document_id=j.document_id AND s.status='needs_review')").bind(owner,job.document_id,job.lease,job.sha256,job.size).first();
    if(!current)throw Error('AI_DOCUMENT_CHANGED');
    return current;
  };
  const store=createD1AuditStore(database,{owner,authorize});
  return enrichInvoiceForReview({
    baseline,owner,documentId:job.document_id,sha256:job.sha256,mime:job.mime,environment,store,authorize,adapter,
    loadOriginal:async()=>{
      const current=await authorize(),bytes=await loadBytes();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==job.sha256||bytes.length!==job.size||current.mime!==job.mime)throw Error('AI_ORIGINAL_CHANGED');
      return preflightOriginal(bytes,job.mime);
    },
  });
}
