import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function loadInvoiceParsers(sourceRoot=process.cwd()){
 const root=resolve(sourceRoot);
 const node=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
 let source=readFileSync(join(root,'sites/lib/invoice-fields.js'),'utf8');
 for(const [name,path] of [['./domain','sites/lib/domain.ts'],['./document-triage.js','sites/lib/document-triage.js'],['./invoice-details.js','sites/lib/invoice-details.js'],['./ocr-bankgiro-evidence.js','sites/lib/ocr-bankgiro-evidence.js']])source=source.replaceAll("'"+name+"'",JSON.stringify(pathToFileURL(join(root,path)).href));
 const sites=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 return {node:node.interpretInvoice,sites:sites.interpretInvoice};
}
