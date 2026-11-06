import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {reconstructOcrLayout} from '../lib/ocr-layout.js';
import {word,allWords} from '../../test/helpers/ocr-layout-fixtures.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const suffix='\nFAKTURA\nLeverantör: Syntetiska Gränsverkstaden AB\nLeverantörens organisationsnummer: 556016-0680\nFakturanummer: TG-6832\nFakturadatum: 2026-06-03\nFörfallodatum: 2026-07-03\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK';
const headers=[
 ['additional description and quantity aliases','Artikeltext  Kvantitet  Netto'],
 ['unit price instead of quantity','Product | Unit price | Net amount'],
 ['VAT-rate column instead of quantity','Service\tVAT rate\tNetto'],
 ['incomplete header without a description column','Quantity\tNet amount'],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const [name,header]of headers)test(engine+' layout respects the existing parser header: '+name,()=>{
 const headerWords=header.split(/\s+/).map((token,index)=>word(token,index*120,0));
 const lines=[{text:header,words:headerWords},{text:'1 480,00',words:[word('1',200,100),word('480,00',250,100)]},{text:'Netto',words:[word('Netto',0,100)]}];
 const source={text:lines.map(line=>line.text).join('\n\n')+'\n',blocks:[{paragraphs:[{lines}]}]};
 const copy=structuredClone(source),original=allWords(source.blocks),actual=reconstructOcrLayout(source.text,source.blocks);
 assert.deepEqual(source,copy);assert.equal(actual.text,source.text);assert.equal(actual.blocks,source.blocks);assert.equal(actual.reconstructed,false);
 assert.deepEqual(allWords(actual.blocks),original);
 const parsed=parse(actual.text+suffix,{method:'ocr',ocrConfidence:96,direction:'supplier',direction_confident:true});
 assert.equal(parsed.details.table_status,'incomplete');assert.equal(parsed.fields.net_cents.value,null);assert.notEqual(parsed.level,'green');
});
