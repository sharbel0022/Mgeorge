import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {randomBytes} from 'node:crypto';import {resolve,join} from 'node:path';
const file=resolve('.env');let content=readFileSync(file,'utf8');
const value=name=>content.match(new RegExp('^'+name+'=(.*)$','m'))?.[1]?.trim().replace(/^"|"$/g,'')||'';
const folder=value('MG_BACKUP_DIRECTORY')||join(process.env.LOCALAPPDATA||process.env.HOME,'MGFakturakoll','backups'),key=value('MG_BACKUP_KEY')||randomBytes(32).toString('hex');
if(!/^[a-f0-9]{64}$/i.test(key))throw Error('Existing backup key is invalid; it was preserved.');
mkdirSync(folder,{recursive:true,mode:0o700});
for(const [name,v]of [['MG_BACKUP_KEY',key],['MG_BACKUP_DIRECTORY',folder]]){const line=name+'='+v;content=new RegExp('^'+name+'=.*$','m').test(content)?content.replace(new RegExp('^'+name+'=.*$','m'),()=>line):content.trimEnd()+'\n'+line+'\n';}
writeFileSync(file,content,{mode:0o600});console.log('Local encrypted backup configuration saved; existing integration keys preserved.');
