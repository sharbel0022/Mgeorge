/**
 * MG FAKTURAKOLL – LOKAL INSTALLATION
 * ANSVAR: Förbereder den lokala miljön och säker konfiguration utan att skriva över befintliga hemligheter och data.
 * FLÖDE: npm run setup → .env och lokala inställningar → npm start.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root=new URL('../',import.meta.url);
const envFile=new URL('.env',root);
function setup(){
  if(existsSync(envFile)){
    console.log('.env finns redan och har behållits. Starta med npm start.');
    return;
  }
  // A new encryption key cannot decrypt an existing installation. Never silently
  // replace lost configuration just because its .env file is missing.
  if(existsSync(new URL('data/mgeorge.sqlite',root))){
    console.error('En befintlig databas finns. Återställ installationens ursprungliga .env och BANK_DATA_KEY från din privata säkerhetskopia innan du startar. Ingen fil har ändrats.');
    process.exitCode=1;
    return;
  }
  const values={SESSION_SECRET:randomBytes(32).toString('hex'),BANK_DATA_KEY:randomBytes(32).toString('hex')};
  let text=readFileSync(new URL('.env.example',root),'utf8');
  for(const [name,value] of Object.entries(values)){
    if(!new RegExp(`^${name}=.*$`,'m').test(text))throw new Error(`Miljömallen saknar ${name}`);
    text=text.replace(new RegExp(`^${name}=.*$`,'m'),`${name}=${value}`);
  }
  writeFileSync(envFile,text,{encoding:'utf8',flag:'wx',mode:0o600});
  console.log(`Lokal konfiguration skapad: ${fileURLToPath(envFile)}`);
  console.log('Appen öppnas direkt utan lösenord. Anslutningsnycklarna sparas i den lokala .env-filen.');
  console.log('Starta med npm start och öppna http://localhost:3000.');
  console.log('Bank och Gmail aktiveras separat. .env och företagets databas ska aldrig läggas i Git.');
}
setup();
