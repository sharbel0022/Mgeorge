// Planning only: callers retain every original OCR word and run the complete
// field census afterwards. This never validates or repairs a printed value.
const normalize=value=>String(value).normalize('NFKC').replace(/[ \t]+/g,' ').trim();
const netLabel=/^(?:netto(?:belopp)?|totalt netto|net amount|(?:summa|totalt|belopp) exkl(?:usive|\.)? moms|belopp före moms)\s*[:.]?$/iu;
const totalLabel=/^(?:(?:summa )?att betala|fakturabelopp|totalbelopp|totalsumma|amount due)\s*:?\s*(?:SEK|EUR|USD|GBP|NOK|DKK)?$/iu;
// A damaged rate is retained verbatim in this cell; it still fails the parser's
// whole-value validation. It must not erase independently printed net/gross.
const vatOccurrence=/^(?:summa moms|total moms|moms(?:belopp)?|(?:total )?VAT(?: amount)?)(?=[\s:(]|$)/iu;
const printedMoney=/^(?:(?:SEK|EUR|USD|GBP|NOK|DKK)\s+)?-?(?:\d+|\d{1,3}(?: \d{3})+|\d{1,3}(?:,\d{3})+)\s*[.,]\d{2}(?:\s+(?:SEK|EUR|USD|GBP|NOK|DKK|kr))?$/iu;
const description=/^(?:beskrivning|benämning|artikelbeskrivning|description|item|product|service)[:.]?$/iu;
const intersects=(a,b)=>a.x0<b.x1&&a.x1>b.x0&&a.y0<b.y1&&a.y1>b.y0;
const band=(a,b)=>{
  const scale=Math.min(a.glyphHeight,b.glyphHeight);
  return Math.max(a.box.y1-a.box.y0,b.box.y1-b.box.y0)<=2*scale
    && Math.min(a.box.y1,b.box.y1)-Math.max(a.box.y0,b.box.y0)>=scale/2
    && Math.abs(a.box.y0+a.box.y1-b.box.y0-b.box.y1)<=scale;
};

function closedGroup(pairs,words,tableRows,spend,vertical){
  const members=pairs.flatMap(pair=>[pair.label,pair.value]),ids=new Set(members.map(item=>item.id));
  if(pairs.length!==3||ids.size!==6)return null;
  const scale=Math.min(...members.map(item=>item.glyphHeight));
  if(vertical&&Math.max(...pairs.map(pair=>pair.value.box.x1))-Math.min(...pairs.map(pair=>pair.value.box.x1))>2*scale)return null;
  const region={x0:Math.min(...members.map(item=>item.box.x0)),x1:Math.max(...members.map(item=>item.box.x1)),y0:Math.min(...members.map(item=>item.box.y0)),y1:Math.max(...members.map(item=>item.box.y1))};
  // Stacked labels must be outside the article-description column. The other
  // shape requires a complete net/VAT/payable header row and three owned
  // values beneath it; no article heading or quantity may share that region.
  if(vertical&&tableRows.some(row=>row.box.y0<=region.y1&&row.words.some(word=>description.test(normalize(word.text))&&region.x0<=word.bbox.x1+3*scale)))return null;
  const originalWords=new Set(members.flatMap(item=>item.words));
  if(words.some(word=>{spend();return !originalWords.has(word)&&intersects(word.bbox,region);}))return null;
  const rows=new Set(members.map(item=>item.row)),asides=new Set();
  for(const row of rows)for(const segment of row.segments){
    spend();if(ids.has(segment.id))continue;
    // Every affected source row remains indivisible unless all remaining
    // segments are independently complete fields or closed left-hand prose.
    const prose=/^\p{L}/u.test(segment.text)&&/[.!?]$/.test(segment.text)&&(segment.text.match(/\p{L}+/gu)||[]).length>=2;
    if(segment.box.x1<=region.x0-scale&&(segment.complete||prose)){asides.add(segment.id);continue;}
    return null;
  }
  return {pairs,rows,asides,ids};
}

function otherHeadingClaims(value,label,segments,spend){
  return segments.some(other=>{
    spend();
    if(other===label||!(other.label||other.explicitLabel||vatOccurrence.test(normalize(other.text))))return false;
    // Include excluded/table rows as negative evidence. Such a heading must
    // never become invisible just because it cannot create a positive pair.
    const scale=other.glyphHeight,gap=value.box.y0-other.box.y1,right=value.box.x0-other.box.x1;
    const below=other.row!==value.row&&gap>=0&&gap<=2*scale&&value.box.x0>=other.box.x0-scale/2&&value.box.x0<=other.box.x1+scale/2;
    const beside=right>=0&&right<=16*scale&&value.box.y0<other.box.y1+scale/2&&value.box.y1>other.box.y0-scale/2;
    return below||beside;
  });
}

/** Closed summaries: three stacked right-column cells, or three net/VAT/payable
 * columns with one aligned value row. Every word and competing heading remains
 * part of the census; this never repairs a damaged rate or computes a value. */
export function planOcrSummaryCells(segments,words,tableRows,claimOwners,spend){
  const nets=segments.filter(item=>netLabel.test(normalize(item.text)));
  const vats=segments.filter(item=>vatOccurrence.test(normalize(item.text)));
  const totals=segments.filter(item=>totalLabel.test(normalize(item.text)));
  const groups=[];
  for(const net of nets){
    const near=(item,after)=>{
      spend();
      const scale=Math.min(net.glyphHeight,item.glyphHeight),gap=item.box.y0-after.box.y1;
      return Math.abs(item.box.x0-net.box.x0)<=scale&&gap>=0&&gap<=6*scale;
    };
    const possibleVats=vats.filter(vat=>near(vat,net));
    if(possibleVats.length!==1)continue;
    const vat=possibleVats[0],possibleTotals=totals.filter(total=>near(total,vat));
    if(possibleTotals.length!==1)continue;
    const labels=[net,vat,possibleTotals[0]],labelIds=new Set(labels.map(item=>item.id)),pairs=[];
    for(const label of labels){
      const candidates=segments.filter(value=>{
        spend();
        const gap=value.box.x0-label.box.x1;
        return value!==label&&gap>=0&&gap<=32*label.glyphHeight&&band(label,value);
      });
      if(candidates.length!==1||!printedMoney.test(normalize(candidates[0].text)))break;
      const value=candidates[0];
      if([...claimOwners.get(value.id)||[]].some(owner=>owner!==label.id))break;
      // A second plausible value below the heading is negative evidence too.
      if(segments.some(other=>{
        spend();
        const gap=other.box.y0-label.box.y1;
        return !labelIds.has(other.id)&&other!==value&&!other.label&&!other.explicitLabel&&!other.complete
          &&gap>=0&&gap<=2*label.glyphHeight&&Math.abs(other.box.x0-label.box.x0)<=label.glyphHeight/2;
      }))break;
      pairs.push({label,value});
    }
    if(pairs.length!==3)continue;
    const group=closedGroup(pairs,words,tableRows,spend,true);if(group)groups.push(group);
  }
  for(const net of nets){
    const next=(item,previous)=>{
      spend();const gap=item.box.x0-previous.box.x1;
      return gap>=0&&gap<=32*Math.min(item.glyphHeight,previous.glyphHeight)&&band(previous,item);
    };
    const possibleVats=vats.filter(vat=>next(vat,net));if(possibleVats.length!==1)continue;
    const vat=possibleVats[0],possibleTotals=totals.filter(total=>next(total,vat));if(possibleTotals.length!==1)continue;
    const labels=[net,vat,possibleTotals[0]],pairs=[];
    for(const label of labels){
      const candidates=segments.filter(value=>{
        spend();const gap=value.box.y0-label.box.y1;
        return value!==label&&gap>=0&&gap<=2*label.glyphHeight&&Math.abs(value.box.x0-label.box.x0)<=label.glyphHeight/2;
      });
      if(candidates.length!==1||!printedMoney.test(normalize(candidates[0].text)))break;
      const value=candidates[0];
      if([...claimOwners.get(value.id)||[]].some(owner=>owner!==label.id)||otherHeadingClaims(value,label,segments,spend))break;
      pairs.push({label,value});
    }
    if(pairs.length!==3||pairs.slice(1).some(pair=>!band(pairs[0].value,pair.value)))continue;
    if(pairs.slice(1).some((pair,index)=>{
      const previous=pairs[index],scale=Math.min(pair.label.glyphHeight,pair.value.glyphHeight,previous.label.glyphHeight,previous.value.glyphHeight);
      return Math.max(previous.label.box.x1,previous.value.box.x1)+scale>Math.min(pair.label.box.x0,pair.value.box.x0);
    }))continue;
    const group=closedGroup(pairs,words,tableRows,spend,false);if(group)groups.push(group);
  }
  // No first/closest selection between overlapping proposed summary groups.
  const counts=new Map();for(const group of groups)for(const id of group.ids)counts.set(id,(counts.get(id)||0)+1);
  const accepted=groups.filter(group=>[...group.ids].every(id=>counts.get(id)===1));
  return {pairs:accepted.flatMap(group=>group.pairs),rows:new Set(accepted.flatMap(group=>[...group.rows])),asides:new Set(accepted.flatMap(group=>[...group.asides]))};
}
