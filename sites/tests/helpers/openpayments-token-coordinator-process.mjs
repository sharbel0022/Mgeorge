// Synthetic subprocess fixture. No network operation or actual provider secret.
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createCompanySyncDatabase} from '../../../src/company-sync-database.js';
import {createOpenPaymentsTokenCoordinator} from '../../lib/banking/openpayments/token-coordinator.js';
if(process.env.NODE_ENV!=='test')throw Error('Synthetic test process only');
const [path,keyHex,mode]=process.argv.slice(2),key=Buffer.from(keyHex,'hex'),db=new DatabaseSync(path);
db.exec('PRAGMA busy_timeout=5000');
const codec={async seal(binding,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(binding)));const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');},async unseal(binding,value){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(Buffer.from(JSON.stringify(binding)));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());}};
const coordinator=createOpenPaymentsTokenCoordinator({database:createCompanySyncDatabase(db),codec,configuration:{environment:'SANDBOX',clientId:'synthetic-distributed-app',clientSecret:'synthetic-secret',credentialGeneration:'g1',features:['bank_discovery']},transportIdentity:'a'.repeat(64),assertCurrent:()=>{}});
const receipt=await coordinator.access(async({assertBeforeSend})=>{
 await assertBeforeSend();db.prepare('INSERT INTO synthetic_token_posts DEFAULT VALUES').run();
 if(mode==='crash')process.exit(27);
 await new Promise(resolve=>setTimeout(resolve,100));return{value:'synthetic-process-token',seconds:3600};
});
process.stdout.write(receipt.value);db.close();
