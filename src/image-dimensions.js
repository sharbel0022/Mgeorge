// Bound dimensions BEFORE native decoding. Only formats accepted by Sites.
export function imageDimensions(bytes,mime){
  const b=Buffer.from(bytes);let width=0,height=0;
  if(mime==='image/png'&&b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){width=b.readUInt32BE(16);height=b.readUInt32BE(20);}
  else if(mime==='image/jpeg'&&b[0]===255&&b[1]===216){
    let at=2;while(at+8<b.length&&at<65536){if(b[at++]!==255)break;while(b[at]===255)at++;const marker=b[at++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;const size=b.readUInt16BE(at);if(size<2||at+size>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=b.readUInt16BE(at+3);width=b.readUInt16BE(at+5);break;}at+=size;}
  }else if(mime==='image/webp'&&b.length>=30&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'){
    const kind=b.subarray(12,16).toString();
    if(kind==='VP8X'){if(b[20]&2)throw Error('animated_image');width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3);}
    else if(kind==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=b.readUInt16LE(26)&16383;height=b.readUInt16LE(28)&16383;}
    else if(kind==='VP8L'&&b[20]===47){const bits=b.readUInt32LE(21);width=1+(bits&16383);height=1+((bits>>>14)&16383);}
  }
  if(!width||!height||width>12000||height>12000||width*height>12000000)throw Error('image_dimensions');
  return {width,height};
}
