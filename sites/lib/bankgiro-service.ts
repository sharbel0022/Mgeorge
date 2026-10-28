import {env} from 'cloudflare:workers';
import {db,readWorkspace} from './server';
import {parseSpecificationBytes} from './bankgiro-parser.js';
import {specificationPreview,type Command} from './domain';
import {connection,accounts} from './banking/store';
import {stableAccountKey} from './banking/transactions';

async function resolveAccounts(owner:string,rows:any[]){
 const conn=await connection(owner);if(!conn)return rows;
 const selected=JSON.parse(conn.selected_accounts),available=await accounts(conn);
 return rows.map(r=>{
  const raw=String(r.account||'').replace(/[\s-]/g,'').toUpperCase();if(!raw)return r;
  const matches=available.filter(a=>selected.includes(a.uid)&&a.currency==='SEK'&&[a.account_id?.iban,a.account_id?.other?.identification,...(a.all_account_ids||[]).filter(i=>['IBAN','BBAN','CPAN'].includes(i.scheme_name?.toUpperCase())).map(i=>i.identification)].some(x=>x&&x.replace(/[\s-]/g,'').toUpperCase()===raw));
  const key=matches.length===1?stableAccountKey(matches[0],{name:conn.bank_name,country:conn.country}):null;
  return key?{...r,recipientAccount:r.account,account:key}:r;
 });
}

export async function readBankgiroOriginal(owner:string,command:Command){
 const doc=await db().prepare('SELECT filename,mime,sha256 FROM documents WHERE id=? AND owner=?').bind(command.documentId,owner).first<{filename:string;mime:string;sha256:string}>();
 if(!doc||!['application/xml','text/csv'].includes(doc.mime))throw Error('Bankgirooriginalet saknas för ditt konto.');
 const obj=await env.BUCKET?.get(`${owner}/${command.documentId}`);if(!obj)throw Error('Originalfilen kunde inte hämtas.');
 const rows=await resolveAccounts(owner,parseSpecificationBytes(await obj.arrayBuffer(),doc.filename));
 return {...command,rows,hash:doc.sha256,name:doc.filename};
}
export async function bankgiroPreview(owner:string,file:File,targetId:string){
 const bytes=await file.arrayBuffer(),rows=await resolveAccounts(owner,parseSpecificationBytes(bytes,file.name)),{state,revision}=await readWorkspace(owner);
 const preview=specificationPreview(state,rows,targetId);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 return {rows,preview,revision,hash,duplicate:state.imports.some(i=>i.hash===hash)};
}
