import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { emptyState, type State } from "./domain";
export const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
export async function identity(req?:Request){const user=await getChatGPTUser();if(!user)throw new Error("AUTH_REQUIRED");if(req&&req.method!=='GET'){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new Error("ORIGIN_DENIED");}return user;}
export function db(){if(!env.DB)throw new Error("Databasen är inte tillgänglig. Försök igen om en stund.");return env.DB;}
export async function readWorkspace(owner:string){const row=await db().prepare('SELECT revision, payload FROM workspaces WHERE owner = ?').bind(owner).first<{revision:number,payload:string}>();return row?{revision:row.revision,state:JSON.parse(row.payload) as State}:{revision:0,state:emptyState()};}
/** Bank facts come from retained bytes. An owned document ID alone is not evidence. */
export async function readBankFileOriginal(owner:string,command:Record<string,any>){
 const doc=await db().prepare('SELECT filename,mime,sha256,size FROM documents WHERE id=? AND owner=?').bind(command.documentId,owner).first<{filename:string;mime:string;sha256:string;size:number}>();
 if(!doc||!(doc.mime==='text/csv'&&/\.csv$/i.test(doc.filename)||doc.mime==='application/xml'&&/\.xml$/i.test(doc.filename)))throw Error('Välj ett sparat bankoriginal i CSV- eller camt XML-format.');
 if(!Number.isSafeInteger(doc.size)||doc.size<1||doc.size>15_000_000)throw Error('Bankoriginalets storlek är ogiltig.');
 const object=await env.BUCKET?.get(`${owner}/${command.documentId}`);if(!object||object.size!==doc.size)throw Error('Bankoriginalet saknas eller har ändrad storlek.');
 const bytes=await object.arrayBuffer();if(bytes.byteLength!==doc.size)throw Error('Bankoriginalets storlek stämmer inte.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==doc.sha256)throw Error('Bankoriginalets kontrollsumma stämmer inte. Ingen import har gjorts.');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
 const {parseCSV,guessMapping,mapCSV,parseCAMT}=await import('./imports');
 let rows,mapping=undefined;
 if(doc.mime==='application/xml')rows=parseCAMT(text,doc.filename);
 else{const parsed=parseCSV(text);mapping=command.mapping??guessMapping(parsed.headers);rows=mapCSV(parsed,mapping,doc.filename);}
 return {...command,rows:rows.map(row=>({...row,verified:false})),hash,name:doc.filename,mapping,trustedBankImport:false,trustedBankFileImport:true};
}
export function failure(error:unknown){const message=error instanceof Error?error.message:'Åtgärden misslyckades.';if(message==='AUTH_REQUIRED')return response({error:'Logga in med ChatGPT för att öppna dina sparade uppgifter.',signIn:'/signin-with-chatgpt?return_to=%2F'},401);if(message==='ORIGIN_DENIED')return response({error:'Åtgärden måste göras från systemets egen sida.'},403);if(/SQLITE|D1_|R2_|constraint|syntax error|no such table/i.test(message))return response({error:'Uppgifterna kunde inte sparas. Försök igen, eller kontakta administratören.'},500);return response({error:message},400);}
