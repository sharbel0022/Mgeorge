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

/** Three vertically stacked, right-column summary cells. A complete geometric
 * region permits a long label/value gap below a table, while article quantity
 * columns, suffixes, missing values and competing headings still block it. */
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
    const members=pairs.flatMap(pair=>[pair.label,pair.value]),ids=new Set(members.map(item=>item.id));
    if(ids.size!==6)continue;
    const scale=Math.min(...members.map(item=>item.glyphHeight));
    if(Math.max(...pairs.map(pair=>pair.value.box.x1))-Math.min(...pairs.map(pair=>pair.value.box.x1))>2*scale)continue;
    const region={x0:Math.min(...members.map(item=>item.box.x0)),x1:Math.max(...members.map(item=>item.box.x1)),y0:Math.min(...members.map(item=>item.box.y0)),y1:Math.max(...members.map(item=>item.box.y1))};
    // A summary cannot be manufactured in the article-description column.
    if(tableRows.some(row=>row.box.y0<=region.y1&&row.words.some(word=>description.test(normalize(word.text))&&region.x0<=word.bbox.x1+3*scale)))continue;
    const originalWords=new Set(members.flatMap(item=>item.words));
    if(words.some(word=>{spend();return !originalWords.has(word)&&intersects(word.bbox,region);}))continue;
    const rows=new Set(members.map(item=>item.row)),asides=new Set();let unresolved=false;
    for(const row of rows)for(const segment of row.segments){
      spend();if(ids.has(segment.id))continue;
      // Only a distinct, complete field or closed prose to the left may be
      // isolated from a raw mixed OCR row. Unknown value suffixes remain raw.
      const prose=/^\p{L}/u.test(segment.text)&&/[.!?]$/.test(segment.text)&&(segment.text.match(/\p{L}+/gu)||[]).length>=2;
      if(segment.box.x1<=region.x0-scale&&(segment.complete||prose)){asides.add(segment.id);continue;}
      unresolved=true;
    }
    if(!unresolved)groups.push({pairs,rows,asides,ids});
  }
  // No first/closest selection between overlapping proposed summary groups.
  const counts=new Map();for(const group of groups)for(const id of group.ids)counts.set(id,(counts.get(id)||0)+1);
  const accepted=groups.filter(group=>[...group.ids].every(id=>counts.get(id)===1));
  return {pairs:accepted.flatMap(group=>group.pairs),rows:new Set(accepted.flatMap(group=>[...group.rows])),asides:new Set(accepted.flatMap(group=>[...group.asides]))};
}
