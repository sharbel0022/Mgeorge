import {createBackup,verifyBackup,restoreBackup} from '../src/backup.js';
const [action,first,second,...extra]=process.argv.slice(2);
try{
 if(extra.length||!first||!['create','verify','restore'].includes(action)||action!=='verify'&&!second)throw Error('Använd create <databas> <backup>, verify <backup> eller restore <backup> <ny databas>. Nyckeln läses från MG_BACKUP_KEY.');
 const result=action==='create'?createBackup(first,second,process.env.MG_BACKUP_KEY):action==='verify'?verifyBackup(first,process.env.MG_BACKUP_KEY):restoreBackup(first,second,process.env.MG_BACKUP_KEY);
 console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1;}
