import {dailyBackup} from '../src/backup.js';
import {writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
let result;
try{if(!process.env.MG_BACKUP_DIRECTORY)throw Error('backup_not_configured');result={...dailyBackup(resolve(process.env.DB_PATH||'data/mgeorge.sqlite'),process.env.MG_BACKUP_DIRECTORY,process.env.MG_BACKUP_KEY),checked_at:new Date().toISOString()};}
catch{result={verified:false,error:'backup_failed',checked_at:new Date().toISOString()};process.exitCode=1;}
if(process.env.MG_BACKUP_DIRECTORY)try{writeFileSync(join(process.env.MG_BACKUP_DIRECTORY,'backup-status.json'),JSON.stringify(result),{mode:0o600});}catch{process.exitCode=1;}
console.log(JSON.stringify(result));
