import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';

// This evidence can only retain or withhold digits already present in OCR text.
// It is not a bank-account verification or permission for automatic registration.
export const OCR_BANKGIRO_MIN_CONFIDENCE=90;
const MAX_TEXT=150000,MAX_PAGES=10,MAX_RECORDS=32,MAX_WORDS=16,MAX_LINE=500;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pageText=value=>String(value).normalize('NFKC').replace(/\r/g,'').trim();
const lineText=value=>String(value).normalize('NFKC').replace(/[ \t]+/g,' ').trim();
const label=/(?<![\p{L}\p{N}/_-])(?:bankgirokonto|bankgiro|bg)(?=[\s.:#]|$)/giu;
const exactLine=/^(?:bankgirokonto|bankgiro|bg)[ \t]*[:.#]?[ \t]*(\d{3,4})(?:[ \t]*[-\u2010-\u2015\u2212][ \t]*|[ \t]+)(\d{4})$/iu;
const explicitSibling=/[ \t]+(?:ocr(?:[ \t-]?(?:nummer|nr|referens))?|betalningsreferens|faktura[ \t]*(?:nummer|nr)|kund[ \t]*(?:nummer|nr)|fakturadatum|förfallo(?:datum|dag)|plusgiro|postgiro|iban|bic|swift)[ \t]*:[ \t]*\S[^\r\n]*$/iu;
const valueOf=line=>{
  const text=lineText(line);if(text.length>MAX_LINE||/[\r\n]/.test(text))return null;
  const sibling=text.match(explicitSibling);
  // A known, explicitly delimited next field can end a complete Bankgiro
  // value. Keep the full row/words in the evidence: their binding, confidence
  // and the document-wide census of every Bankgiro label still apply.
  const match=(sibling?text.slice(0,sibling.index):text).match(exactLine);
  return match?match[1]+'-'+match[2]:null;
};
export const ocrInputHash=value=>bytesToHex(sha256(typeof value==='string'?utf8ToBytes(value):value));

function safeWords(words,text){
  if(!Array.isArray(words)||!words.length||words.length>MAX_WORDS)return null;
  const result=[];
  for(const word of words){
    if(!object(word)||typeof word.text!=='string'||!word.text.length||word.text.length>60||!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>100)return null;
    result.push({text:word.text,confidence:word.confidence});
  }
  return lineText(result.map(word=>lineText(word.text)).join(' '))===lineText(text)?result:null;
}

/** Keep only the bounded, input-bound public shape. Unknown payload properties
 * never cross the worker boundary or become identity/lease fields. */
export function checkedOcrBankgiroEvidence(text,inputSha256,evidence){
  try{
    if(typeof text!=='string'||text.length>MAX_TEXT||!hex(inputSha256)||!object(evidence)||evidence.version!==1||evidence.inputSha256!==inputSha256||evidence.textSha256!==ocrInputHash(text))return null;
    const sourcePages=text.split('\f');
    if(sourcePages.length>MAX_PAGES||!Array.isArray(evidence.pages)||evidence.pages.length!==sourcePages.length)return null;
    const pages=[];let records=0;
    for(let index=0;index<sourcePages.length;index++){
      const source=pageText(sourcePages[index]),lines=source.split('\n'),entry=evidence.pages[index];
      if(!object(entry)||entry.page!==index+1||entry.textSha256!==ocrInputHash(source)||!Array.isArray(entry.bankgiro)||entry.bankgiro.length>MAX_RECORDS)return null;
      const bankgiro=[],seen=new Set();
      for(const row of entry.bankgiro){
        if(++records>MAX_RECORDS||!object(row)||!Number.isSafeInteger(row.line)||row.line<0||row.line>=lines.length||seen.has(row.line)||typeof row.text!=='string'||row.text.length>MAX_LINE||row.text!==lineText(lines[row.line])||typeof row.value!=='string'||row.value!==valueOf(row.text))return null;
        const words=safeWords(row.words,row.text);if(!words)return null;
        seen.add(row.line);bankgiro.push({line:row.line,text:row.text,value:row.value,words});
      }
      pages.push({page:index+1,textSha256:entry.textSha256,bankgiro});
    }
    return {version:1,inputSha256,textSha256:evidence.textSha256,pages};
  }catch{return null;}
}

/** Produce evidence from the same page result that supplied data.text. Repeated
 * rows require a one-to-one correspondence; missing/ambiguous word data is not
 * replaced by the page's aggregate confidence. */
export function collectOcrBankgiroPage(text,blocks,page=1){
  const source=pageText(text),empty={page,textSha256:ocrInputHash(source),bankgiro:[]};
  if(source.length>MAX_TEXT||!Number.isSafeInteger(page)||page<1||page>MAX_PAGES||!Array.isArray(blocks)||blocks.length>1000)return empty;
  const recognized=new Map();let count=0;
  try{
    for(const block of blocks){
      if(!Array.isArray(block?.paragraphs)||block.paragraphs.length>1000)return empty;
      for(const paragraph of block.paragraphs){
        if(!Array.isArray(paragraph?.lines)||paragraph.lines.length>10000)return empty;
        for(const row of paragraph.lines){
          if(++count>10000||typeof row?.text!=='string')return empty;
          const normalized=lineText(row.text);
          if(!valueOf(normalized)||normalized.length>MAX_LINE)continue;
          const matches=recognized.get(normalized)||[];matches.push(row);recognized.set(normalized,matches);
        }
      }
    }
    const sourceLines=source.split('\n'),wanted=new Map();
    for(const raw of sourceLines){const normalized=lineText(raw);if(valueOf(normalized))wanted.set(normalized,(wanted.get(normalized)||0)+1);}
    const used=new Map(),bankgiro=[];
    for(let line=0;line<sourceLines.length;line++){
      const normalized=lineText(sourceLines[line]),value=valueOf(normalized);if(!value)continue;
      const rows=recognized.get(normalized)||[];
      if(rows.length!==wanted.get(normalized))continue;
      const at=used.get(normalized)||0;used.set(normalized,at+1);
      const words=safeWords(rows[at].words,normalized);if(!words)continue;
      if(bankgiro.length>=MAX_RECORDS)return empty;
      bankgiro.push({line,text:normalized,value,words});
    }
    return {...empty,bankgiro};
  }catch{return empty;}
}

export function bindOcrBankgiroEvidence(inputSha256,text,pages){
  return checkedOcrBankgiroEvidence(text,inputSha256,{version:1,inputSha256,textSha256:ocrInputHash(text),pages});
}

const held=(code,reason)=>({accepted:false,code,reason});
export function assessOcrBankgiro(text,inputSha256,evidence,value){
  const checked=checkedOcrBankgiroEvidence(text,inputSha256,evidence);
  if(!checked)return held('OCR_BANKGIRO_SOURCE_UNPROVEN','Bankgiro saknar ordunderlag som hör till detta original och denna OCR-text. Kontrollera siffrorna i originalet.');
  const pages=text.split('\f');let occurrences=0;
  for(let index=0;index<pages.length;index++){
    const lines=pageText(pages[index]).split('\n'),proof=checked.pages[index];
    for(let line=0;line<lines.length;line++){
      const normalized=lineText(lines[line]),labels=[...normalized.matchAll(label)];if(!labels.length)continue;
      if(++occurrences>MAX_RECORDS||labels.length!==1||valueOf(normalized)!==value)return held('OCR_BANKGIRO_AMBIGUOUS','Bankgirots etikett och siffror kan inte kopplas entydigt till en OCR-rad. Kontrollera samtliga bankgiron i originalet.');
      const row=proof.bankgiro.find(row=>row.line===line);
      if(!row||row.value!==value)return held('OCR_BANKGIRO_WORDS_MISSING','Bankgiro saknar fullständigt OCR-ordunderlag för varje märkt förekomst. Kontrollera siffrorna i originalet.');
      const confidence=Math.min(...row.words.map(word=>word.confidence));
      if(confidence<OCR_BANKGIRO_MIN_CONFIDENCE)return held('OCR_BANKGIRO_LOW_CONFIDENCE',`Bankgiro har osäkert OCR-ordunderlag på sida ${index+1} (${Math.floor(confidence)} %). Kontrollera siffrorna i originalet.`);
    }
  }
  return occurrences?{accepted:true,code:'OCR_BANKGIRO_WORDS_SUPPORTED',reason:''}:held('OCR_BANKGIRO_LABEL_MISSING','Bankgiro saknar en uttrycklig etikett med styrkt OCR-ordunderlag. Kontrollera originalet.');
}
