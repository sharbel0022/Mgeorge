import {createHash} from 'node:crypto';
import {text as invoiceText} from '../fixtures.js';

export const digest=value=>createHash('sha256').update(value).digest('hex');
export const sourceBytes=Buffer.from('Synthetic invoice image original; no real account or customer');
export const inputSha256=digest(sourceBytes);
export const bankgiroText=invoiceText;

// Hand-built transport fixtures, independent of the production producer.
export function packet(text=bankgiroText,{confidence=95,value='123-4567',inputHash=inputSha256}={}){
  const pages=text.split('\f').map((part,index)=>{
    const page=part.trim(),lines=page.split('\n');
    return {page:index+1,textSha256:digest(page),bankgiro:lines.flatMap((line,n)=>line.startsWith('Bankgiro:')?[{line:n,text:line,value,words:[{text:'Bankgiro:',confidence:96},{text:line.slice('Bankgiro: '.length),confidence}]}]:[])};
  });
  return {version:1,inputSha256:inputHash,textSha256:digest(text),pages};
}
const changed=(id,mutate)=>{const evidence=packet();mutate(evidence);return {id,text:bankgiroText,evidence,inputSha256,expected:null};};
export const bankgiroEvidenceCases=[
  {id:'exact-high-confidence',text:bankgiroText,evidence:packet(),inputSha256,expected:'123-4567'},
  {id:'exact-boundary-90',text:bankgiroText,evidence:packet(bankgiroText,{confidence:90}),inputSha256,expected:'123-4567'},
  {id:'legitimate-four-digit-prefix',text:bankgiroText.replace('123-4567','1223-4567'),evidence:packet(bankgiroText.replace('123-4567','1223-4567'),{value:'1223-4567'}),inputSha256,expected:'1223-4567'},
  {id:'missing-evidence',text:bankgiroText,evidence:undefined,inputSha256,expected:null},
  {id:'missing-expected-input',text:bankgiroText,evidence:packet(),inputSha256:undefined,expected:null},
  {id:'word-confidence-89',text:bankgiroText,evidence:packet(bankgiroText,{confidence:89}),inputSha256,expected:null},
  {id:'word-confidence-zero-despite-global-99',text:bankgiroText,evidence:packet(bankgiroText,{confidence:0}),inputSha256,expected:null},
  changed('other-original',evidence=>evidence.inputSha256='a'.repeat(64)),
  changed('other-ocr-text',evidence=>evidence.textSha256='a'.repeat(64)),
  changed('other-page-text',evidence=>evidence.pages[0].textSha256='a'.repeat(64)),
  changed('other-page-number',evidence=>evidence.pages[0].page=2),
  changed('duplicate-page',evidence=>evidence.pages.push(structuredClone(evidence.pages[0]))),
  changed('other-row',evidence=>evidence.pages[0].bankgiro[0].line--),
  changed('metadata-value-disagrees',evidence=>evidence.pages[0].bankgiro[0].value='1223-4567'),
  changed('metadata-text-disagrees',evidence=>evidence.pages[0].bankgiro[0].text='Bankgiro: 1223-4567'),
  changed('metadata-word-disagrees',evidence=>evidence.pages[0].bankgiro[0].words[1].text='1223-4567'),
  changed('missing-number-word',evidence=>evidence.pages[0].bankgiro[0].words.pop()),
  changed('unknown-label-word',evidence=>evidence.pages[0].bankgiro[0].words[0].text='Telefon:'),
  changed('uncertain-label-word',evidence=>evidence.pages[0].bankgiro[0].words[0].confidence=0),
  changed('missing-number-confidence',evidence=>delete evidence.pages[0].bankgiro[0].words[1].confidence),
  changed('out-of-range-number-confidence',evidence=>evidence.pages[0].bankgiro[0].words[1].confidence=101),
  changed('non-finite-number-confidence',evidence=>evidence.pages[0].bankgiro[0].words[1].confidence=NaN),
  changed('duplicate-row-proof',evidence=>evidence.pages[0].bankgiro.push(structuredClone(evidence.pages[0].bankgiro[0]))),
  changed('too-many-word-records',evidence=>evidence.pages[0].bankgiro[0].words=Array.from({length:33},()=>({text:'123-4567',confidence:99}))),
  changed('unknown-protocol-version',evidence=>evidence.version=99),
];
const duplicateText=bankgiroText+'\nBankgiro: 123-4567';
bankgiroEvidenceCases.push({id:'all-identical-duplicate-labels-proved',text:duplicateText,evidence:packet(duplicateText),inputSha256,expected:'123-4567'});
const duplicateMissing=packet(duplicateText);duplicateMissing.pages[0].bankgiro.pop();
bankgiroEvidenceCases.push({id:'duplicate-label-missing-proof',text:duplicateText,evidence:duplicateMissing,inputSha256,expected:null});
const duplicateLow=packet(duplicateText);duplicateLow.pages[0].bankgiro[1].words[1].confidence=0;
bankgiroEvidenceCases.push({id:'duplicate-label-low-confidence',text:duplicateText,evidence:duplicateLow,inputSha256,expected:null});
const twoPages=bankgiroText+'\f\nBankgiro: 123-4567';
bankgiroEvidenceCases.push({id:'all-pages-proved',text:twoPages,evidence:packet(twoPages),inputSha256,expected:'123-4567'});
const pageMissing=packet(twoPages);pageMissing.pages.pop();
bankgiroEvidenceCases.push({id:'second-page-missing-proof',text:twoPages,evidence:pageMissing,inputSha256,expected:null});
