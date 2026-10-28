import {identity,response,failure} from '@/lib/server';
import {backupRpc,runOwnerBackup} from '@/lib/backups';
export const dynamic='force-dynamic';
export async function GET(){try{return await backupRpc();}catch(e){return failure(e);}}
export async function POST(req:Request){try{const user=await identity(req),body=(await req.text()).trim();if(body&&body!=='{}')throw Error('Backupen accepterar inga klientstyrda ägaruppgifter.');return response(await runOwnerBackup(user.userId));}catch(e){return failure(e);}}
