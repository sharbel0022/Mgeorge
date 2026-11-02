import {readFileSync} from 'node:fs';
import {gmailAdapterReliabilityTests} from '../../test/helpers/gmail-adapter-reliability.mjs';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const environment=data("export const env={GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GMAIL_ACCOUNT:'mg.vitvaror@gmail.com'};");
const source=readFileSync(new URL('../lib/gmail-adapter.js',import.meta.url),'utf8')
  .replace("'cloudflare:workers'",JSON.stringify(environment))
  .replace("'./document-triage.js'",JSON.stringify(new URL('../lib/document-triage.js',import.meta.url).href));
gmailAdapterReliabilityTests(await import(data(source+'\n//# sourceURL=gmail-adapter-reliability-sites.js')));
