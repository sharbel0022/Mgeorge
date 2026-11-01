function geometry(item){
  const t=item.transform;
  if(!Array.isArray(t)||t.length<6||!t.every(Number.isFinite)||!Number.isFinite(item.width)||item.width<0)return null;
  const scale=Math.hypot(t[0],t[1]);if(!scale)return null;
  return {x:t[4],y:t[5],ux:t[0]/scale,uy:t[1]/scale,width:item.width,height:Math.hypot(t[2],t[3])||scale};
}
function geometricSeparator(previous,current){
  const a=geometry(previous),b=geometry(current);
  // Without positions, joining two unknown fragments could invent an ID.
  if(!a||!b)return ' ';
  if(a.ux*b.ux+a.uy*b.uy<.99)return ' ';
  const dx=b.x-a.x,dy=b.y-a.y,height=Math.min(a.height,b.height);
  if(Math.abs(-dx*a.uy+dy*a.ux)>Math.max(1,height*.5))return '\n';
  const gap=dx*a.ux+dy*a.uy-a.width;
  return Math.abs(gap)>Math.max(.5,height*.25)?' ':'';
}
export function reconstructPdfText(items){
  let text='',previous=null;
  for(const item of items){
    if(typeof item.str!=='string')continue;
    if(previous&&item.str&&!text.endsWith('\n')){
      const separator=geometricSeparator(previous,item);
      if(separator==='\n')text+='\n';
      else if(separator&&!/\s$/.test(text)&&!/^\s/.test(item.str))text+=separator;
    }
    // PDF.js already emits explicit space items. Adjacent glyph fragments are
    // joined as drawn, with geometry only separating otherwise unmarked gaps.
    text+=item.str;
    if(item.hasEOL){text+='\n';previous=null;}
    else if(item.str)previous=item;
  }
  return text;
}
