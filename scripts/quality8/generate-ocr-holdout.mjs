// This generator never imports an application parser or invokes OCR.
// Reproduce into a fresh directory; existing frozen images are not overwritten.
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {targetCommit,scalarFields,mandatoryFields,criticalFields,hash,fileHash,freezeSource,harnessFiles,runtimeDependencies} from './ocr-holdout-provenance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const fixture=join(root,'test/fixtures/quality8/ocr-holdout-v1');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: node scripts/quality8/generate-ocr-holdout.mjs --output FRESH_DIRECTORY');
const output=resolve(args[1]);if(existsSync(output))throw Error('Refusing to overwrite generated corpus: '+output);
const specs=JSON.parse(readFileSync(join(fixture,'documents.json'),'utf8'));
const gold=JSON.parse(readFileSync(join(fixture,'gold.json'),'utf8'));
const fontFiles=[['Holdout Sans','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],['Holdout Sans','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],['Holdout Serif','/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'],['Holdout Serif','/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf']];
for(const [family,file] of fontFiles)if(!GlobalFonts.registerFromPath(file,family))throw Error('Cannot load frozen rendering font: '+file);
const fontHashes=Object.fromEntries(fontFiles.map(([,file])=>[file,fileHash(file)]));
if(specs.cases.filter(row=>row.population==='normal-readable').length!==8||specs.cases.filter(row=>row.population==='stress').length!==2)throw Error('Unexpected population');
for(const row of specs.cases){
  const answer=gold.cases[row.id]?.fields;
  if(!answer||scalarFields.some(field=>!Object.hasOwn(answer,field))||Object.keys(answer).length!==13)throw Error('Incomplete literal gold: '+row.id);
  if(answer.net_cents+answer.vat_cents!==answer.total_cents)throw Error('Gold arithmetic contradiction: '+row.id);
}

const width=1600,height=2000,rendered=new Map(),bounds=[];
function render(d){
  const canvas=createCanvas(width,height),c=canvas.getContext('2d');
  c.fillStyle='#ffffff';c.fillRect(0,0,width,height);
  const serif=['classic-workshop','editorial-studio','ledger-paper'].includes(d.layout),family=serif?'Holdout Serif':'Holdout Sans';
  const text=(value,x,y,{size=32,bold=false,color='#19232a',max=1450}={})=>{
    c.font=`${bold?'bold ':''}${size}px "${family}"`;c.fillStyle=color;
    const measured=c.measureText(value).width;
    if(x<0||y-size<0||x+measured>Math.min(width-40,x+max)||y>height-30)throw Error('Text outside its allotted readable area in '+d.id+': '+value);
    c.fillText(value,x,y);bounds.push({id:d.id,text:value,x,y,size,width:Math.ceil(measured)});
  };
  const line=(x1,y1,x2,y2,color='#bcc5ca')=>{c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();};
  const box=(x,y,w,h,fill='#f1f5f7')=>{c.fillStyle=fill;c.fillRect(x,y,w,h);};
  const pair=(label,value,x,y,{stack=false,size=32,max=1400,bold=false}={})=>{
    if(stack){text(label,x,y,{size:26,color:'#35434a',max});text(value,x,y+43,{size,bold,max});}
    else text(label+': '+value,x,y,{size,bold,max});
  };
  const issuer=(x,y,{stack=false,size=32}={})=>{pair('Leverantör',d.party,x,y,{stack,size});pair('Organisationsnummer',d.organization,x,y+(stack?108:62),{size:30});};
  const recipient=(x,y)=>{pair('Kund',d.recipient,x,y,{size:29});text('Testgatan 12, 123 45 Exempelstad',x,y+45,{size:27,color:'#46545c'});};
  const table=(x,y,w=1420)=>{
    box(x,y,w,64,'#eaf0f3');text('Benämning',x+20,y+43,{size:29,bold:true});text('Antal',x+w-530,y+43,{size:29,bold:true});text('Belopp exkl. moms',x+w-350,y+43,{size:29,bold:true,max:335});
    text(d.description,x+20,y+125,{size:29,max:w-580});text('1',x+w-505,y+125,{size:29});text(d.net,x+w-315,y+125,{size:30,max:300});line(x,y+161,x+w,y+161);
  };
  const totals=(x,y,{stack=false}={})=>{
    pair('Netto',d.net+' SEK',x,y,{stack});pair('Moms',d.vat+' SEK',x,y+(stack?110:64),{stack});
    pair('Att betala',d.total+' SEK',x,y+(stack?220:140),{stack,bold:true,size:36});
  };
  const payment=(x,y,{stack=false,vertical=false}={})=>{
    pair('Bankgiro',d.bankgiro,x,y,{stack,bold:true});
    pair('OCR',d.reference,vertical?x:x+750,y+(vertical?(stack?115:75):0),{stack});
    text('Ange OCR-numret vid betalning.',x,y+(vertical?(stack?220:150):(stack?115:75)),{size:27,color:'#46545c'});
  };
  const title=(x,y)=>text('FAKTURA',x,y,{size:54,bold:true});
  switch(d.layout){
    case 'modern-service':
      box(0,0,width,165,'#e7f0f6');title(90,112);issuer(90,270);pair('Fakturanummer',d.invoiceNumber,90,430,{bold:true});
      pair('Fakturadatum',d.issued,90,505);pair('Förfallodatum',d.due,850,505);recipient(90,660);table(90,840);
      totals(850,1180);line(90,1570,1510,1570);payment(90,1700);break;
    case 'classic-workshop':
      title(90,130);line(90,175,1510,175);pair('Fakturanummer',d.invoiceNumber,90,260,{bold:true});issuer(90,370);
      pair('Bankgiro',d.bankgiro,1110,305,{stack:true,max:400});pair('Fakturadatum',d.issued,90,560);pair('Förfallodatum',d.due,90,625);recipient(90,760);
      table(90,940);totals(780,1260);pair('OCR',d.reference,90,1650);text('Betalningsvillkor: 30 dagar',90,1730,{size:29});break;
    case 'two-column-consulting':
      title(90,125);issuer(90,265,{stack:true,size:31});pair('Fakturanummer',d.invoiceNumber,1080,245,{stack:true,max:430,bold:true});
      pair('Fakturadatum',d.issued,90,535,{stack:true});pair('Förfallodatum',d.due,840,535,{stack:true});recipient(90,720);
      table(90,895);totals(90,1220);box(70,1580,1460,275,'#f2f5f7');payment(100,1645,{stack:true});break;
    case 'boxed-wholesale':
      title(90,130);recipient(90,270);issuer(90,420);box(70,575,1460,230,'#eef3ef');
      pair('Fakturanummer',d.invoiceNumber,100,645,{bold:true});pair('Fakturadatum',d.issued,100,735);pair('Förfallodatum',d.due,850,735);
      table(90,905);totals(820,1220);payment(90,1640,{vertical:true});break;
    case 'freight-band':
      box(0,0,45,height,'#17617a');box(45,0,1555,165,'#dceff4');title(100,115);issuer(100,270);
      pair('Fakturanummer',d.invoiceNumber,100,455,{bold:true});pair('Fakturadatum',d.issued,100,540);pair('Förfallodatum',d.due,100,605);
      pair('Bankgiro',d.bankgiro,1060,510,{stack:true,max:450});recipient(100,755);table(100,925,1400);totals(100,1245);
      box(80,1575,1440,225,'#edf5f7');pair('OCR',d.reference,110,1665,{stack:true});text('Ange OCR-numret vid betalning.',790,1720,{size:27});break;
    case 'editorial-studio':
      title(90,145);issuer(90,290,{stack:true,size:34});pair('Fakturanummer',d.invoiceNumber,90,520,{stack:true,bold:true});
      pair('Fakturadatum',d.issued,90,700,{stack:true});pair('Förfallodatum',d.due,850,700,{stack:true});recipient(90,880);table(90,1050);
      totals(750,1360);line(90,1650,1510,1650);payment(90,1740);break;
    case 'maintenance-form':
      box(70,70,1460,110,'#f1f3f2');title(100,145);pair('Fakturanummer',d.invoiceNumber,90,280,{bold:true});issuer(90,420);
      recipient(90,585);pair('Fakturadatum',d.issued,90,755);pair('Förfallodatum',d.due,850,755);table(90,915);
      totals(90,1230,{stack:true});payment(850,1280,{stack:true,vertical:true});break;
    case 'ledger-paper':
      title(560,140);line(90,185,1510,185);pair('Fakturanummer',d.invoiceNumber,90,280,{bold:true});issuer(90,415);
      pair('Fakturadatum',d.issued,90,600);pair('Förfallodatum',d.due,850,600,{stack:true});recipient(90,760);
      box(70,865,1460,210,'#f2f1ec');payment(100,935);table(90,1170);totals(760,1500);break;
    default:throw Error('Unknown fixed layout '+d.layout);
  }
  line(90,1880,1510,1880);text('SYNTETISKT TESTUNDERLAG  •  Inga verkliga affärshändelser',90,1940,{size:23,color:'#68727a'});
  return canvas;
}

mkdirSync(join(output,'images'),{recursive:true});const images=[];
for(const d of specs.cases){
  let canvas;
  if(d.population==='normal-readable')canvas=render(d);
  else {
    const source=rendered.get(d.sourceId);if(!source)throw Error('Missing stress parent');
    canvas=createCanvas(width,height);const c=canvas.getContext('2d');c.drawImage(source,0,0);
    if(d.layout==='stress-pixelation'){
      const tiny=createCanvas(36,45);tiny.getContext('2d').drawImage(source,0,0,36,45);c.imageSmoothingEnabled=false;c.drawImage(tiny,0,0,width,height);
    }else if(d.layout==='stress-obscured-payment'){
      c.fillStyle='#777777';c.fillRect(60,850,1480,235);c.fillRect(650,1410,900,340);
    }else throw Error('Unknown stress transform');
  }
  rendered.set(d.id,canvas);
  const bytes=canvas.toBuffer('image/png'),name=d.id+'.png';writeFileSync(join(output,'images',name),bytes,{flag:'wx'});
  images.push({id:d.id,population:d.population,layout:d.layout,filename:'images/'+name,mimeType:'image/png',width,height,bytes:bytes.length,sha256:hash(bytes),metadata:d.metadata,sourceId:d.sourceId??null,notes:d.notes});
}
// Contact sheets are visual QA only. They are never measurement inputs.
for(const [number,rows] of [[1,specs.cases.slice(0,4)],[2,specs.cases.slice(4,8)],[3,specs.cases.slice(8)]]){
  const sheet=createCanvas(900,rows.length>2?1180:590),c=sheet.getContext('2d');c.fillStyle='#d7dce0';c.fillRect(0,0,sheet.width,sheet.height);
  for(let i=0;i<rows.length;i++){const x=(i%2)*450,y=Math.floor(i/2)*590;c.drawImage(rendered.get(rows[i].id),x+10,y+25,430,538);c.fillStyle='#111111';c.font='16px "Holdout Sans"';c.fillText(rows[i].id,x+10,y+18);}
  writeFileSync(join(output,'contact-'+number+'.png'),sheet.toBuffer('image/png'),{flag:'wx'});
}
writeFileSync(join(output,'rendered-text-bounds.json'),JSON.stringify(bounds,null,2)+'\n',{flag:'wx'});
const source=freezeSource(root),harnessHashes=Object.fromEntries(harnessFiles.map(file=>[file,fileHash(join(root,file))]));
const manifest={schema:'mgeorge-independent-ocr-holdout-v1',synthetic:true,createdAt:new Date().toISOString(),targetCommit,source,
  preregistration:{normalDocuments:8,stressDocuments:2,selection:'All ten predetermined images are included. No OCR/text-parser result was obtained before freezing. No failed document is removed, replaced or relabelled after the first measurement.',
    population:'New computer-generated Swedish supplier invoices, readable typeset single-page images, SEK, 25 percent VAT, explicit labels, eight deliberately varied layouts. Not a random production sample.',
    metadata:'direction=supplier and direction_confident=true are supplied context, identical to the existing measurement chain. Direction is not recovered from image pixels; an additional mandatory-without-direction breakdown is reported.',
    scalarFields,mandatoryFields,criticalFields,normalPrecisionMinimum:0.98,normalRecallMinimum:0.85,
    acceptance:'Report the same 98% precision and 85% recall gates for all 13 fields and for the 10 mandatory fields separately, for each parser. Overall holdout success requires both gates on both parsers, zero false-green critical decisions, and both stress documents to require review. No averaging across engines or populations.',
    stressAcceptance:'Both distinct destructive inputs must stay non-green. Their original factual gold remains unchanged; missing values count as false negatives and never improve the normal population.',
    freezeRule:'Generator, document specification, separate gold, exact PNG bytes, source hashes, measurement harness and metric definitions are committed before the first OCR invocation. Results may be added afterward; source/threshold/gold/corpus are not tuned.'},
  documentsSha256:fileHash(join(fixture,'documents.json')),goldSha256:fileHash(join(fixture,'gold.json')),harnessHashes,harnessSha256:hash(JSON.stringify(harnessHashes)),fontHashes,runtime:runtimeDependencies(root),
  images,datasetSha256:hash(JSON.stringify(images.map(({id,sha256,population})=>({id,sha256,population})))),
  visualQa:'Inspect all contact sheets and full-size readable inputs before the freeze commit. Layout/readability fixes may only precede freezing and the first OCR call. Contact sheets and text bounds are not inputs to OCR.'};
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,images:images.length,bytes:images.reduce((n,row)=>n+row.bytes,0),datasetSha256:manifest.datasetSha256,targetCommit,sourceFiles:Object.keys(source.hashes).length,opticalGraphFiles:source.opticalGraph.length,downstreamGraphFiles:source.downstreamGraph.length,noOcrInvoked:true},null,2));
