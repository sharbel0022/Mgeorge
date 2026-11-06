import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(process.env.PARTY_REVIEW_REPO || new URL('../fix-0f550950',import.meta.url).pathname);
const {interpretInvoice:nodeParser}=await import(pathToFileURL(resolve(repo,'src/invoice-extraction.js')).href);
const {loadInvoiceParser}=await import(pathToFileURL(resolve(repo,'sites/tests/helpers/invoice-module-loader.mjs')).href);
const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const {cases}=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'));
const selected=cases.filter(c=>c.group==='owner-census'||c.name==='parenthesized legal form');
const rows=[];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr'])for(const item of selected){
 const result=parse(item.text,{direction:item.direction,direction_confident:true,method,ocrConfidence:96});
 rows.push({case:item.name,engine,method,input:item.text,expected:{party:item.party,organization:item.organization,green:false},actual:{party:result.fields.party.value,organization:result.fields.organization_number.value,level:result.level,supplier:result.details.supplier,recipient:result.details.recipient,issues:result.issues}});
}
writeFileSync(new URL('../observed-findings-0f550950.json',import.meta.url),JSON.stringify({commit:'0f550950b99d41d932b91370b458e9b85abf9451',rows},null,2)+'\n');
for(const row of rows.filter(r=>r.engine==='Node'&&r.method==='pdf'))console.log(JSON.stringify({case:row.case,...row.actual,supplier:undefined,recipient:undefined}));
