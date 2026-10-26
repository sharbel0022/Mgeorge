import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Update only public legal-document routes in the existing Sites source checkout.
// The invoice application, authentication, data bindings and secrets stay in place.
const expectedProject='appgprj_6adf2f7f7e848191b64192161886b528';
const target=process.argv[2];
if(!target||process.argv.length!==3)throw new Error('Använd: node scripts/sync-sites-legal.mjs <Sites-källkodskatalog>');
const checkout=resolve(target);
const manifest=JSON.parse(readFileSync(join(checkout,'.openai','hosting.json'),'utf8'));
if(manifest.project_id!==expectedProject||!existsSync(join(checkout,'app','layout.tsx')))throw new Error('Katalogen är inte källkoden till rätt MG Fakturakoll-webbplats.');
const root=fileURLToPath(new URL('../',import.meta.url));
const documents={};
for(const slug of ['integritetspolicy','anvandarvillkor']){
  const html=readFileSync(join(root,'public',slug+'.html'),'utf8');
  if(!html.includes('<html lang="sv">')||!html.includes('Utkast'))throw new Error('Det svenska informationsutkastet saknas: '+slug);
  documents[slug]=html;
  const folder=join(checkout,'app',slug);
  mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'route.ts'),`import documents from '@/lib/legal-documents.json';

// Public information page: no workspace lookup or user identity is required.
export function GET() {
  return new Response(documents['${slug}'], {headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }});
}
`);
}
writeFileSync(join(checkout,'lib','legal-documents.json'),JSON.stringify(documents,null,2)+'\n');
console.log('Synkroniserade /integritetspolicy och /anvandarvillkor till MG Fakturakolls Sites-källkod.');
