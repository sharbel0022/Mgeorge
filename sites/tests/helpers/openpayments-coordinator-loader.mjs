import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=new URL('../../lib/banking/openpayments-sites-token-coordinator.ts',import.meta.url);
let code=stripTypeScriptTypes(readFileSync(source,'utf8'),{mode:'transform'});
code=code.replace(/(['"])\.\/security\1/g,JSON.stringify(new URL('../../lib/banking/security.ts',import.meta.url).href));
code=code.replace(/(['"])(\.{1,2}\/[^'"]+\.js)\1/g,(_all,_quote,specifier)=>JSON.stringify(new URL(specifier,source).href));
export const sitesTokenCoordinatorUrl='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
