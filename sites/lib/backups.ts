import {env} from 'cloudflare:workers';
import {db,identity,response} from './server';
import {backupStep,backupStatus} from './backup-engine';
const config=env as unknown as Record<string,string>;
export async function runOwnerBackup(owner:string){
 if(config.BACKUP_ENABLED!=='true')return{status:'disabled'};
 if(!env.BUCKET||!config.BACKUP_ENCRYPTION_KEY)throw Error('Backupkonfigurationen behöver kontrolleras.');
 return await backupStep(db(),env.BUCKET,owner,config.BACKUP_ENCRYPTION_KEY);
}
export async function backupRpc(run=false){const user=await identity();return response(run?await runOwnerBackup(user.userId):{enabled:config.BACKUP_ENABLED==='true',...await backupStatus(db(),user.userId)});}
