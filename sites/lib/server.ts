import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { emptyState, type State } from "./domain";
export const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
export async function identity(req?:Request){const user=await getChatGPTUser();if(!user)throw new Error("AUTH_REQUIRED");if(req&&req.method!=='GET'){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new Error("ORIGIN_DENIED");}return user;}
export function db(){if(!env.DB)throw new Error("Databasen är inte tillgänglig. Försök igen om en stund.");return env.DB;}
export async function readWorkspace(owner:string){const row=await db().prepare('SELECT revision, payload FROM workspaces WHERE owner = ?').bind(owner).first<{revision:number,payload:string}>();return row?{revision:row.revision,state:JSON.parse(row.payload) as State}:{revision:0,state:emptyState()};}
/** Ownership, size and exact-byte integrity are shared by invoice and bank originals. */
async function readOriginalBytes(owner:string,documentId:string,maxBytes:number,bank:boolean){
 const doc=await db().prepare('SELECT filename,mime,sha256,size FROM documents WHERE id=? AND owner=?').bind(documentId,owner).first<{filename:string;mime:string;sha256:string;size:number}>();
 if(!doc)throw Error(bank?'Välj ett sparat bankoriginal i XLSX-, CSV- eller camt XML-format.':'Originalet saknas för den aktuella ägaren.');
 if(bank&&!(doc.mime==='text/csv'&&/\.csv$/i.test(doc.filename)||doc.mime==='application/xml'&&/\.xml$/i.test(doc.filename)||doc.mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'&&/\.xlsx$/i.test(doc.filename)))throw Error('Välj ett sparat bankoriginal i XLSX-, CSV- eller camt XML-format.');
 if(!Number.isSafeInteger(doc.size)||doc.size<1||doc.size>15_000_000||!/^[a-f0-9]{64}$/.test(doc.sha256))throw Error(bank?'Bankoriginalets storlek är ogiltig.':'Originalets storlek eller kontrollsumma är ogiltig.');
 if(doc.size>maxBytes)throw Error(bank?'Bankoriginalen överskrider kontrollens säkerhetsgräns. Granska underlagen i mindre omgångar.':'Originalen överskrider kontrollens säkerhetsgräns. Granska underlagen i mindre omgångar.');
 const object=await env.BUCKET?.get(`${owner}/${documentId}`);if(!object||object.size!==doc.size)throw Error(bank?'Bankoriginalet saknas eller har ändrad storlek.':'Originalet saknas eller har ändrad storlek.');
 const bytes=await object.arrayBuffer();if(bytes.byteLength!==doc.size)throw Error(bank?'Bankoriginalets storlek stämmer inte.':'Originalets storlek stämmer inte.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==doc.sha256)throw Error(bank?'Bankoriginalets kontrollsumma stämmer inte. Ingen import har gjorts.':'Originalets kontrollsumma stämmer inte. Ingen import har gjorts.');
 return {...doc,bytes};
}
/** The same owned, byte-checked bank original is required at import and allocation. */
export async function readBankOriginalBytes(owner:string,documentId:string,maxBytes=15_000_000){return readOriginalBytes(owner,documentId,maxBytes,true);}
/** A reviewed register entry never certifies availability of its invoice original. */
export async function readInvoiceOriginalBytes(owner:string,documentId:string,maxBytes=15_000_000){return readOriginalBytes(owner,documentId,maxBytes,false);}
/** Bank facts come from retained bytes. An owned document ID alone is not evidence. */
export async function readBankFileOriginal(owner:string,command:Record<string,any>){
 const doc=await readBankOriginalBytes(owner,command.documentId),bytes=doc.bytes;
 if(/\.xlsx$/i.test(doc.filename))throw Error('Importera Excelrapporten via Importera Bankgirofil så att rapportens kontroller och granskningsspärrar används.');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
 const {parseCSV,guessMapping,mapCSV,parseCAMT}=await import('./imports');
 let rows,mapping=undefined;
 if(doc.mime==='application/xml')rows=parseCAMT(text,doc.filename);
 else{const parsed=parseCSV(text);mapping=command.mapping??guessMapping(parsed.headers);rows=mapCSV(parsed,mapping,doc.filename);}
 return {...command,rows:rows.map(row=>({...row,verified:false})),hash:doc.sha256,name:doc.filename,mapping,trustedBankImport:false,trustedBankFileImport:true};
}
export function failure(error:unknown){const message=error instanceof Error?error.message:'Åtgärden misslyckades.';if(message==='AUTH_REQUIRED')return response({error:'Logga in med ChatGPT för att öppna dina sparade uppgifter.',signIn:'/signin-with-chatgpt?return_to=%2F'},401);if(message==='ORIGIN_DENIED')return response({error:'Åtgärden måste göras från systemets egen sida.'},403);if(/SQLITE|D1_|R2_|constraint|syntax error|no such table/i.test(message))return response({error:'Uppgifterna kunde inte sparas. Försök igen, eller kontakta administratören.'},500);return response({error:message},400);}
