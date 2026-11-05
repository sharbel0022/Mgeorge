export function word(text,x,y,{width=text.length*8,height=20,confidence=96,id}={}){
  return {text,confidence,bbox:{x0:x,y0:y,x1:x+width,y1:y+height},...(id===undefined?{}:{syntheticTokenId:id})};
}
export function observation(rows,{gap='\n',trailing='\n'}={}){
  let id=0;
  const lines=rows.map(words=>{
    words=words.map(item=>({...item,syntheticTokenId:id++}));
    return {text:words.map(w=>w.text).join(' ')+gap,words,bbox:{x0:Math.min(...words.map(w=>w.bbox.x0)),y0:Math.min(...words.map(w=>w.bbox.y0)),x1:Math.max(...words.map(w=>w.bbox.x1)),y1:Math.max(...words.map(w=>w.bbox.y1))}};
  });
  return {text:lines.map(row=>row.text.trim()).join(gap)+trailing,blocks:[{paragraphs:[{lines}]}]};
}
export const allWords=blocks=>blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
export const textRows=text=>text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
export const inlineColumns=()=>observation([
  [word('Fakturadatum:',0,10),word('2026-10-03',120,10),word('Förfallodatum:',400,10),word('2026-11-02',520,10)],
]);
export const totalReferenceMix=({unknownSuffix=false}={})=>observation([
  [word('OCR',400,0)],
  [word('Att',0,30),word('betala',40,30),word('0065432109',400,30)],
  [word('925,00',0,70),word('SEK',65,70),...(unknownSuffix?[word('Observera',400,70),word('suffix',480,70)]:[])],
],{gap:'\n\n',trailing:'\n\n'});
