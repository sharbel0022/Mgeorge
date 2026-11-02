function geometry(item){
  const t=item.transform;
  if(!Array.isArray(t)||t.length<6||!t.every(Number.isFinite)||!Number.isFinite(item.width)||item.width<0)return null;
  const scale=Math.hypot(t[0],t[1]);if(!scale)return null;
  return {x:t[4],y:t[5],ux:t[0]/scale,uy:t[1]/scale,upright:t[3]>0&&t[0]*t[3]-t[1]*t[2]>0,width:item.width,height:Math.hypot(t[2],t[3])||scale};
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
function streamText(items){
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

function positionedRows(items){
  const values=items.filter(item=>typeof item.str==='string'&&item.str.length);
  if(values.length>50000)return null;
  const positioned=values.map(item=>({item,box:geometry(item)}));
  // Content-stream order cannot restore a missing position or the reading
  // direction of rotated/mirrored text. Callers route these pages to OCR.
  if(positioned.some(({box})=>!box||!box.upright||box.ux<.999||Math.abs(box.uy)>.01))return null;
  positioned.sort((a,b)=>b.box.y-a.box.y||a.box.x-b.box.x);
  const rows=[];
  for(const entry of positioned){
    const previous=rows.at(-1),height=entry.box.height;
    if(previous&&Math.abs(previous.y-entry.box.y)<=Math.max(1,Math.min(previous.height,height)*.3)){
      previous.values.push(entry);previous.height=Math.min(previous.height,height);
    }else rows.push({y:entry.box.y,height,values:[entry]});
  }
  for(const row of rows){
    row.values.sort((a,b)=>a.box.x-b.box.x);
    let previous=null;
    for(const entry of row.values){
      if(!entry.item.str.trim())continue;
      if(previous&&previous.box.x+previous.box.width-entry.box.x>Math.max(.5,Math.min(previous.box.height,entry.box.height)*.25))return null;
      previous=entry;
    }
  }
  return rows;
}

export function reconstructPdfText(items){
  const rows=positionedRows(items);
  // Anonymous fragments do not assign field roles. Keep the longstanding raw
  // representation for that case; unknown geometry must never grant PDF trust.
  if(!rows||!/(?:faktura|invoice|ocr|moms|vat|netto|amount|antal|pris|belopp|summa|artikel)/i.test(items.map(item=>item.str||'').join(' ')))return streamText(items);
  const lines=rows.map(row=>{
    let text='',previous=null;
    for(const {item}of row.values){
      const box=geometry(item);
      if(!item.str.trim()&&box.width>Math.max(12,box.height*1.5)){
        text+='\t';previous=item;continue;
      }
      if(previous&&!/\s$/.test(text)&&!/^\s/.test(item.str)&&geometricSeparator(previous,item)){
        const a=geometry(previous),b=geometry(item),gap=b.x-a.x-a.width;
        // Preserve visible table columns for the detail parser. A large gap is
        // layout evidence; it must not become ordinary prose whitespace.
        text+=gap>Math.max(12,Math.min(a.height,b.height)*1.5)?'\t':' ';
      }
      text+=item.str;previous=item;
    }
    return text;
  });
  return lines.join('\n')+(items.at(-1)?.hasEOL?'\n':'');
}

const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function rgbLightness(args){
  // Current PDF.js emits CSS hex colors; older builds emit RGB components.
  if(typeof args[0]==='string'&&/^#[\da-f]{6}$/i.test(args[0]))return Math.min(...[1,3,5].map(i=>parseInt(args[0].slice(i,i+2),16)/255));
  if(args.length===3&&args.every(Number.isFinite)){const scale=args.some(n=>n>1)?255:1;return Math.min(...args)/scale;}
  return null;
}
function transformedBounds(bounds,matrix,padding=0){
  if(!bounds||bounds.length!==4||!Array.from(bounds).every(Number.isFinite))return null;
  const points=[[bounds[0],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[1]],[bounds[2],bounds[3]]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
  return [Math.min(...points.map(p=>p[0]))-padding,Math.min(...points.map(p=>p[1]))-padding,Math.max(...points.map(p=>p[0]))+padding,Math.max(...points.map(p=>p[1]))+padding];
}
function invoiceAnchors(text){
  const invoice=/(?:faktura[ \t]*(?:nummer|nr|no)|invoice[ \t]*(?:number|no))[ \t]*[:.#-]?[ \t]*[\p{L}\p{N}][\p{L}\p{N}/_-]{0,79}(?=[\s;|]|$)/iu;
  const total=/(?:att betala|summa att betala|totalsumma|totalbelopp|amount due|totalt inklusive moms|totalt inkl\.? moms)[ \t]*[:.]?[ \t]*(?:SEK[ \t]*)?-?\d[\d \t\u00a0.,]*(?:SEK|kr)?(?=[\s;|]|$)/iu;
  return invoice.test(text)&&total.test(text);
}

/** Routing evidence only: field validation and OCR confidence remain separate. */
export function pdfPageNeedsOpticalText(items,text,operations,OPS,pageArea){
  if(text.replace(/\s/g,'').length<60||!positionedRows(items))return true;
  const raster=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat].filter(Number.isFinite));
  const groupedRaster=new Set([OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat].filter(Number.isFinite));
  const textOperations=new Set([OPS.showText,OPS.showSpacedText,OPS.nextLineShowText,OPS.nextLineSetSpacingShowText].filter(Number.isFinite));
  const paints=new Map([
    [OPS.fill,[true,false]],[OPS.eoFill,[true,false]],[OPS.stroke,[false,true]],[OPS.closeStroke,[false,true]],
    [OPS.fillStroke,[true,true]],[OPS.eoFillStroke,[true,true]],[OPS.closeFillStroke,[true,true]],[OPS.closeEOFillStroke,[true,true]],
  ].filter(([op])=>Number.isFinite(op)));
  const boxes=items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>{const b=geometry(item);return [b.x,b.y-b.height*.25,b.x+b.width,b.y+b.height];});
  const initialState=()=>({matrix:[1,0,0,1,0,0],mode:0,fill:1,stroke:1,mask:false,blend:false,fillColor:0,strokeColor:0,lineWidth:1});
  let state=initialState(),hasRaster=false,rasterPixels=0,rasterArea=0,seenText=false,pathBounds=null;
  const stack=[];
  const obscuresText=(paint,bounds)=>{
    const [fill,stroke]=paint;
    // An opaque white background before any text is a normal page setup.
    // Other paints can conceal text, including later white rectangles.
    if(!seenText&&(!fill||state.fillColor===1)&&(!stroke||state.strokeColor===1))return false;
    const scale=Math.max(Math.hypot(state.matrix[0],state.matrix[1]),Math.hypot(state.matrix[2],state.matrix[3]));
    const box=transformedBounds(bounds,state.matrix,stroke?Math.max(.5,state.lineWidth*scale/2):0);
    if(!box||!box.every(Number.isFinite))return true;
    return boxes.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]);
  };
  for(let i=0;i<operations.fnArray.length;i++){
    const op=operations.fnArray[i],args=operations.argsArray[i]||[];
    if(op===OPS.save||op===OPS.paintFormXObjectBegin){stack.push({...state,matrix:[...state.matrix]});if(op===OPS.paintFormXObjectBegin&&Array.isArray(args[0])&&args[0].length===6)state.matrix=multiply(state.matrix,args[0]);}
    else if(op===OPS.restore||op===OPS.paintFormXObjectEnd){state=stack.pop()||initialState();}
    else if(op===OPS.transform&&args.length===6&&args.every(Number.isFinite))state.matrix=multiply(state.matrix,args);
    else if(op===OPS.setTextRenderingMode)state.mode=Number(args[0]);
    else if(op===OPS.setLineWidth)state.lineWidth=Number(args[0]);
    else if(op===OPS.setFillRGBColor)state.fillColor=rgbLightness(args);
    else if(op===OPS.setStrokeRGBColor)state.strokeColor=rgbLightness(args);
    else if(op===OPS.setFillGray)state.fillColor=Number(args[0]);
    else if(op===OPS.setStrokeGray)state.strokeColor=Number(args[0]);
    else if([OPS.setFillColor,OPS.setFillColorN,OPS.setFillCMYKColor].includes(op))state.fillColor=null;
    else if([OPS.setStrokeColor,OPS.setStrokeColorN,OPS.setStrokeCMYKColor].includes(op))state.strokeColor=null;
    else if(op===OPS.setGState){
      for(const [key,value]of args[0]||[]){if(key==='ca')state.fill=Number(value);if(key==='CA')state.stroke=Number(value);if(key==='SMask')state.mask=!!value;if(key==='BM')state.blend=value!=='Normal'&&value!=='Compatible';}
    }
    // Clip geometry, patterns and compositing require a renderer to establish
    // visibility. Never infer visible invoice fields from those text layers.
    if(op===OPS.clip||op===OPS.eoClip||op===OPS.shadingFill)return true;
    if(op===OPS.constructPath){
      pathBounds=args[2];
      // Modern PDF.js combines the path and its paint operation. Older builds
      // issue a separate fill/stroke, handled below with the same bounds.
      const paint=paints.get(args[0]);if(paint&&obscuresText(paint,pathBounds))return true;
    }else if(paints.has(op)&&obscuresText(paints.get(op),pathBounds))return true;
    if(textOperations.has(op)){
      const colors=state.mode===1?[state.strokeColor]:state.mode===2?[state.fillColor,state.strokeColor]:[state.fillColor];
      if(!Number.isInteger(state.mode)||state.mode<0||state.mode>=3||!Number.isFinite(state.fill)||!Number.isFinite(state.stroke)||state.fill<1||state.stroke<1||state.mask||state.blend||colors.some(color=>color===null||!Number.isFinite(color)||color>=.9))return true;
      seenText=true;
    }
    if(raster.has(op)){
      hasRaster=true;
      // Optimized repetitions/groups carry their own transforms and maps.
      // Their footprint is not represented by width/height in args[1..2].
      if(groupedRaster.has(op))return true;
      const width=Number(args[1]??args[0]?.width),height=Number(args[2]??args[0]?.height),matrix=state.matrix;
      const area=Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]);
      if(!Number.isFinite(width*height)||width<=0||height<=0||!Number.isFinite(area)||area<=0||!Number.isFinite(pageArea)||pageArea<=0)return true;
      // A substantial scan with a text layer is optical evidence, even when
      // split into small tiles. Summed coverage can overestimate overlapping
      // images, which conservatively sends those pages to review too.
      rasterPixels+=width*height;rasterArea+=Math.min(area,pageArea);
    }
  }
  return rasterPixels>=65536&&rasterArea>=pageArea*.25||hasRaster&&!invoiceAnchors(text);
}
