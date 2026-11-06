import {isInvoiceTableHeader} from './invoice-details.js';
import {planOcrSummaryCells} from './ocr-summary-layout.js';

const MAX_TEXT=150000,MAX_ROWS=2000,MAX_WORDS=6000,MAX_SEGMENTS=3000,MAX_COMPARISONS=1_000_000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const spaced=value=>String(value).replace(/[ \t]+/g,' ').trim();
const normalized=value=>String(value).normalize('NFKC').replace(/[ \t]+/g,' ').trim();
const labelSource='(?:faktura[ \\t]*(?:nummer|nr|no)|invoice[ \\t]*(?:number|no)|fakturadatum|faktureringsdatum|invoice[ \\t]+date|issue[ \\t]+date|förfallo(?:datum|dag)|förfaller|betalas[ \\t]+senast|oss[ \\t]+tillhanda[ \\t]+senast|due[ \\t]+date|leverantör|utställare|säljare|supplier|seller|kund|customer|fakturamottagare|bill[ \\t]+to|faktureras[ \\t]+till|organisations(?:nummer|nr)|org[ .]*(?:nr|nummer)|organi[sz]ation[ \\t]+number|bankgirokonto|bankgiro|bg|plusgiro|postgiro|iban|bic|swift|ocr(?:[ \\t-]?(?:nummer|nr|referens))?|betalningsreferens|payment[ \\t]+reference|netto|net[ \\t]+amount|belopp[ \\t]+före[ \\t]+moms|(?:belopp|summa)[ \\t]+exkl(?:usive)?[ .]*moms|summa[ \\t]+moms|moms(?:belopp)?|total[ \\t]+moms|vat|att[ \\t]+betala|summa[ \\t]+att[ \\t]+betala|totalbelopp|totalsumma|fakturabelopp|amount[ \\t]+due|valuta|currency)';
const standalone=new RegExp('^'+labelSource+'[ \\t]*[:.#]?$','iu');
const complete=new RegExp('^'+labelSource+'[ \\t]*[:.#][ \\t]*\\S','iu');
// Unknown explicit headings may block ownership, but never create a new
// supported field or authorize a reconstruction of their own.
const explicitStandalone=text=>/^(?=[^:]*\p{L})[^:\r\n]+:$/u.test(text);
const tableHeader=text=>isInvoiceTableHeader(text)||/\b(?:benämning|beskrivning|description|artikelbeskrivning)\b/iu.test(text)&&/\b(?:antal|quantity|qty)\b/iu.test(text);
const validBox=box=>object(box)&&['x0','y0','x1','y1'].every(key=>Number.isFinite(box[key])&&box[key]>=0&&box[key]<=12_000_000)&&box.x1>box.x0&&box.y1>box.y0;
const union=words=>({x0:Math.min(...words.map(w=>w.bbox.x0)),y0:Math.min(...words.map(w=>w.bbox.y0)),x1:Math.max(...words.map(w=>w.bbox.x1)),y1:Math.max(...words.map(w=>w.bbox.y1))});
const height=box=>box.y1-box.y0;
const contains=(outer,inner)=>outer.x0<=inner.x0&&outer.y0<=inner.y0&&outer.x1>=inner.x1&&outer.y1>=inner.y1;
const intersects=(a,b)=>a.x0<b.x1&&a.x1>b.x0&&a.y0<b.y1&&a.y1>b.y0;

/** Geometry may rearrange original words and whitespace, never their spelling
 * or confidence. An uncertain/malformed observation keeps the exact raw input.
 * This does not verify a field's value or authorize automatic registration. */
export function reconstructOcrLayout(text,blocks){
  const raw={text,blocks,reconstructed:false};
  try{
    if(typeof text!=='string'||text.length>MAX_TEXT||text.includes('\f')||!Array.isArray(blocks)||blocks.length>MAX_ROWS)return raw;
    const lines=[],words=[];
    for(const block of blocks){
      if(!Array.isArray(block?.paragraphs)||block.paragraphs.length>MAX_ROWS)return raw;
      for(const paragraph of block.paragraphs){
        if(!Array.isArray(paragraph?.lines)||paragraph.lines.length>MAX_ROWS)return raw;
        for(const line of paragraph.lines){
          if(lines.length>=MAX_ROWS||typeof line?.text!=='string'||!Array.isArray(line.words)||!line.words.length||line.words.length>MAX_WORDS)return raw;
          for(const word of line.words){
            if(words.length>=MAX_WORDS||!object(word)||typeof word.text!=='string'||!word.text.length||/\s/u.test(word.text)||!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>100||!validBox(word.bbox))return raw;
            words.push(word);
          }
          if(/[\r\n]/.test(line.text.trim())||spaced(line.words.map(w=>w.text).join(' '))!==spaced(line.text))return raw;
          // A line must have a common vertical band. A tall union of unrelated
          // word rows cannot serve as evidence for a multiword label.
          if(Math.max(...line.words.map(word=>word.bbox.y0))>=Math.min(...line.words.map(word=>word.bbox.y1)))return raw;
          const box=union(line.words);
          if(line.bbox!==undefined&&(!validBox(line.bbox)||!contains(line.bbox,box)))return raw;
          for(let n=1;n<line.words.length;n++)if(line.words[n].bbox.x0<line.words[n-1].bbox.x1)return raw;
          lines.push({source:line,words:line.words,box});
        }
      }
    }
    const chunks=[...text.matchAll(/[^\r\n]+/g)].filter(match=>match[0].trim());
    if(!lines.length||chunks.length!==lines.length||chunks.some((chunk,index)=>spaced(chunk[0])!==spaced(lines[index].source.text)))return raw;
    let comparisons=0;
    const byY=[...words].sort((a,b)=>a.bbox.y0-b.bbox.y0);
    for(let i=0;i<byY.length;i++)for(let j=i+1;j<byY.length&&byY[j].bbox.y0<byY[i].bbox.y1;j++){
      if(++comparisons>MAX_COMPARISONS||intersects(byY[i].bbox,byY[j].bbox))return raw;
    }

    // A table's end is not established by a blank gap, a bare field word, or
    // an unrelated complete field. Horizontal article columns may use all of
    // those. Do not add same-row ownership anywhere in/under an observed table;
    // the existing conservative vertical path remains independently available.
    // Preserve the source separators for the parser's authoritative census;
    // normalizing its spaces first would hide an already supported table.
    const tableRows=lines.map((row,index)=>tableHeader(chunks[index][0]));
    const horizontalTableTop=Math.min(...lines.filter((row,index)=>tableRows[index]).map(row=>row.box.y0));
    const segments=[];let inTable=false;
    for(let index=0;index<lines.length;index++){
      const row=lines[index],value=normalized(chunks[index][0]);
      if(tableRows[index]){row.excluded=true;inTable=true;}
      else {if(inTable&&(standalone.test(value)||complete.test(value)))inTable=false;row.excluded=inTable;}
      row.index=index;row.segments=[];
      const heights=row.words.map(word=>height(word.bbox)).sort((a,b)=>a-b),scale=heights[Math.floor(heights.length/2)];
      let group=[];
      const add=()=>{
        if(!group.length)return;
        const text=group.map(word=>word.text).join(' '),value=normalized(text),segment={id:segments.length,row,words:group,text,box:union(group),glyphHeight:Math.min(...group.map(word=>height(word.bbox))),label:standalone.test(value),explicitLabel:explicitStandalone(value),complete:complete.test(value)};
        row.segments.push(segment);segments.push(segment);group=[];
      };
      for(const word of row.words){if(group.length&&word.bbox.x0-group.at(-1).bbox.x1>3*scale)add();group.push(word);}add();
      if(segments.length>MAX_SEGMENTS)return raw;
    }

    const proposed=[],claims=new Map(),claimOwners=new Map();
    for(const label of segments.filter(segment=>segment.label||segment.explicitLabel)){
      const candidates=[];
      for(const value of segments){
        if(++comparisons>MAX_COMPARISONS)return raw;
        if(value.row.excluded||value.label||value.explicitLabel||value.complete)continue;
        // Only the label's actual glyphs establish its reach. A value printed
        // in a larger font must not widen the search into another column.
        const scale=label.glyphHeight,gap=value.box.y0-label.box.y1,below=value.row!==label.row&&gap>=0&&gap<=2*scale;
        const vertical=below&&Math.abs(value.box.x0-label.box.x0)<=scale/2;
        const rightGap=value.box.x0-label.box.x1,right=rightGap>=0&&rightGap<=16*scale;
        const glyph=Math.min(scale,value.glyphHeight),overlap=Math.min(label.box.y1,value.box.y1)-Math.max(label.box.y0,value.box.y0);
        // A tall box or union cannot manufacture a physical row. Only similar
        // actual glyph bands, close centres and a bounded rightward gap pair.
        const horizontal=right&&Math.max(height(label.box),height(value.box))<=2*glyph&&overlap>=glyph/2&&Math.abs(label.box.y0+label.box.y1-value.box.y0-value.box.y1)<=glyph;
        if(vertical||horizontal)candidates.push({value,horizontal});
        // The broader census only blocks ownership. Both directions compete
        // together, including unknown/excluded labels and labels with several
        // candidates. One label casts at most one claim on a value.
        const verticalClaim=below&&value.box.x0>=label.box.x0-scale/2&&value.box.x0<=label.box.x1+scale/2;
        const horizontalClaim=right&&value.box.y0<label.box.y1+scale/2&&value.box.y1>label.box.y0-scale/2;
        if(verticalClaim||horizontalClaim){
          claims.set(value.id,(claims.get(value.id)||0)+1);
          if(!claimOwners.has(value.id))claimOwners.set(value.id,new Set());
          claimOwners.get(value.id).add(label.id);
        }
      }
      // Never choose a closest/first value among plausible alternatives.
      if(!label.label||label.row.excluded||candidates.length!==1)continue;
      const {value,horizontal}=candidates[0],members=new Set([...label.words,...value.words]);
      if(horizontal&&Math.max(label.box.y1,value.box.y1)>horizontalTableTop)continue;
      const corridor=horizontal
        ?{x0:label.box.x1,x1:value.box.x0,y0:Math.min(label.box.y0,value.box.y0),y1:Math.max(label.box.y1,value.box.y1)}
        :{x0:Math.min(label.box.x0,value.box.x0),x1:Math.max(label.box.x1,value.box.x1),y0:label.box.y1,y1:value.box.y0};
      let intervening=false;
      if(corridor.y1>corridor.y0&&corridor.x1>corridor.x0)for(const word of words){
        if(++comparisons>MAX_COMPARISONS)return raw;
        if(!members.has(word)&&intersects(word.bbox,corridor)){intervening=true;break;}
      }
      if(!intervening)proposed.push({label,value});
    }
    const summary=planOcrSummaryCells(segments,words,lines.filter((row,index)=>tableRows[index]),claimOwners,()=>{if(++comparisons>MAX_COMPARISONS)throw new Error('layout budget');});
    const summaryMembers=new Set(summary.pairs.flatMap(pair=>[pair.label.id,pair.value.id]));
    const summaryLabels=new Set(summary.pairs.map(pair=>pair.label.id));
    // A typed VAT heading (including its untouched unreadable rate) is not
    // the preceding net heading's generic downward value candidate.
    let pairs=[...proposed.filter(pair=>claims.get(pair.value.id)===1&&!summaryMembers.has(pair.label.id)&&!summaryMembers.has(pair.value.id)),...summary.pairs];
    const disabled=new Set(lines.filter(row=>row.excluded&&!summary.rows.has(row)));
    // A split raw row is indivisible unless every segment has an explicit
    // role. Cancelling one pairing can expose another unresolved segment in
    // a different raw row, so repeat until no dependency remains.
    for(let repeat=0;repeat<=lines.length;repeat++){
      const resolved=new Set(pairs.flatMap(pair=>[pair.label.id,pair.value.id]));let changed=false;
      for(const row of lines)if(!disabled.has(row)&&row.segments.length>1&&row.segments.some(segment=>!segment.complete&&!resolved.has(segment.id)&&!summary.asides.has(segment.id))){disabled.add(row);changed=true;}
      const kept=pairs.filter(pair=>!disabled.has(pair.label.row)&&!disabled.has(pair.value.row));
      if(kept.length!==pairs.length)changed=true;pairs=kept;
      if(!changed)break;
    }
    const outgoing=new Map(pairs.map(pair=>[pair.label.id,pair.value])),incoming=new Set(pairs.map(pair=>pair.value.id));
    // OCR paragraph breaks are not physical address boundaries. Preserve a
    // role only when an already proved explicit party/name pair is followed
    // by one street row, one Swedish postcode row and a labelled organization
    // in the same short, unobstructed column. Unlabelled letterheads, prose,
    // footers, other entities and detached identifiers cannot create a role.
    const partyHeading=/^(?:leverantör|utställare|säljare|supplier|seller|kund|customer|faktureras till)\s*:?$/iu;
    const orgHeading=/^(?:org(?:anisations)?\.?\s*(?:nr|nummer)|org\.?\s*number|organi[sz]ation\s+number)(?=[\s.:#]|$)\s*[:.#]?\s*\S/iu;
    const addressBoundary=new RegExp('^(?:'+labelSource+'|buyer|recipient|bill[ \\t]+to|företag|company|konto|account)(?=[\\s.:#]|$)','iu');
    const streetRow=/^(?:[\p{L}][\p{L} .’'\-]{1,90}\s+\d{1,5}[A-Za-z]?|\d{1,5}[A-Za-z]?\s+[\p{L}][\p{L} .’'\-]{1,90})$/u;
    const postcodeRow=/^(?:SE[- ]?)?\d{3}\s?\d{2}\s+[\p{L}][\p{L} .’'\-]{1,70}$/u;
    const joinedPartyRows=new Set();
    for(const {label,value} of pairs){
      if(!partyHeading.test(normalized(label.text))||value.row.index!==label.row.index+1)continue;
      const body=[value.row,...lines.slice(value.row.index+1,value.row.index+4)];
      if(body.length!==4||[label.row,...body].some(row=>disabled.has(row)||row.segments.length!==1))continue;
      const [name,street,postcode,organization]=body;
      if(!streetRow.test(normalized(street.source.text))||addressBoundary.test(normalized(street.source.text))||!postcodeRow.test(normalized(postcode.source.text))||!orgHeading.test(normalized(organization.source.text)))continue;
      const sequence=[label.row,...body],scale=Math.min(...sequence.map(row=>row.segments[0].glyphHeight));
      if(sequence.some(row=>Math.abs(row.box.x0-label.box.x0)>scale/2))continue;
      if(sequence.slice(1).some((row,index)=>row.box.y0<sequence[index].box.y1||row.box.y0-sequence[index].box.y1>2*scale))continue;
      const members=new Set(sequence.flatMap(row=>row.words)),region=union([...members]);
      let obstructed=false;
      for(const word of words){
        if(++comparisons>MAX_COMPARISONS)return raw;
        if(!members.has(word)&&intersects(word.bbox,region)){obstructed=true;break;}
      }
      if(obstructed)continue;
      for(const row of [label.row,name,street,postcode])joinedPartyRows.add(row);
    }
    let rebuilt=text.slice(0,chunks[0].index);const output=[];
    for(const row of lines){
      const chunk=chunks[row.index],following=row.index+1<chunks.length?chunks[row.index+1].index:text.length;
      const gap=text.slice(chunk.index+chunk[0].length,following);
      const active=!disabled.has(row)&&(row.segments.length>1||row.segments.some(segment=>outgoing.has(segment.id)||incoming.has(segment.id)));
      if(!active){rebuilt+=chunk[0]+(joinedPartyRows.has(row)?'\n':gap);output.push(row.source);continue;}
      const parts=[];
      for(const segment of row.segments){
        if(incoming.has(segment.id))continue;
        const partner=outgoing.get(segment.id),joined=partner?[...segment.words,...partner.words]:segment.words;
        // Keep the proved label/value cell boundary distinct from the spaces
        // inside a printed amount. Otherwise an uncertain rate tail such as
        // "Moms 25" plus the separate cell "533,40" becomes "25 533,40".
        const text=partner&&summaryLabels.has(segment.id)?segment.words.map(word=>word.text).join(' ')+'\t'+partner.words.map(word=>word.text).join(' '):joined.map(word=>word.text).join(' ');
        parts.push(text);output.push({text:text+'\n',words:joined,bbox:union(joined)});
      }
      // Reconstructed fields are independent paragraphs. Their output order
      // must not transfer a party section to a following unowned raw field.
      const paired=row.segments.some(segment=>outgoing.has(segment.id));
      rebuilt+=joinedPartyRows.has(row)?parts.join('\n')+(parts.length?'\n':''):parts.join('\n\n')+(paired&&parts.length?'\n':'')+gap;
    }
    if(rebuilt===text)return raw;
    const retained=output.flatMap(row=>row.words),originals=new Set(words);
    if(retained.length!==words.length||new Set(retained).size!==words.length||retained.some(word=>!originals.has(word)))return raw;
    return {text:rebuilt,blocks:[{paragraphs:[{lines:output}]}],reconstructed:true};
  }catch{return raw;}
}
