const MAX_PIXELS=12_000_000;
export function ocrRasterSize(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_PIXELS)throw Error('pixels');
  const enlarged={width:Math.ceil(width*1.5),height:Math.ceil(height*1.5)};
  return enlarged.width*enlarged.height<=MAX_PIXELS?enlarged:{width,height};
}
