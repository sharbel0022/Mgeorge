import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

export const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const require=createRequire(import.meta.url);
export const libUrl=name=>new URL('../../lib/'+name,import.meta.url).href;
export function invoiceParserUrl(){
  const source=readFileSync(new URL('../../lib/invoice-fields.js',import.meta.url),'utf8').replace(/(['"])(\.\/[^'"]+)\1/g,(_,quote,name)=>JSON.stringify(libUrl(name.slice(2)+(name==='./domain'?'.ts':''))));
  return dataModule(source);
}
export async function loadInvoiceParser(){return import(invoiceParserUrl());}
export async function loadInvoiceImports(overrides={}){
  const imports={'./invoice-fields.js':invoiceParserUrl(),'./domain':libUrl('domain.ts'),'./local-ocr':libUrl('local-ocr.ts'),'./bankgiro-parser.js':libUrl('bankgiro-parser.js'),'./payment-references.js':libUrl('payment-references.js'),'postal-mime':new URL(require.resolve('postal-mime'), 'file:').href,...overrides};
  let source=ts.transpileModule(readFileSync(new URL('../../lib/imports.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [name,url]of Object.entries(imports))for(const quote of ["'",'"'])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
  return import(dataModule(source));
}
