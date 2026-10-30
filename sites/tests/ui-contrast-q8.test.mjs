import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selectors,body])=>({selectors:selectors.split(',').map(s=>s.trim()),declarations:body.split(';').map(declaration=>{const colon=declaration.indexOf(':');return [declaration.slice(0,colon).trim(),declaration.slice(colon+1).trim()];})}));
function property(selector,name){
  const values=rules.filter(rule=>rule.selectors.includes(selector)).flatMap(rule=>rule.declarations.filter(([key])=>key===name).map(([,value])=>value));
  assert.ok(values.length,`Missing ${name} declaration for ${selector}`);
  return values.at(-1);
}
function luminance(value){
  const color=({white:'#ffffff',black:'#000000'})[value]||value;
  assert.match(color,/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i,`Expected a solid color, got ${value}`);
  const hex=color.length===4?'#'+[...color.slice(1)].map(c=>c+c).join(''):color;
  return hex.slice(1).match(/../g).map(channel=>parseInt(channel,16)/255).map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
}
function contrast(foreground,background){const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);}

for(const {label,foreground,backgrounds} of [
  {label:'payment detail labels',foreground:'.details-grid dt',backgrounds:['.review-detail','.modal']},
  {label:'payment amount metadata',foreground:'.review-row-amount small',backgrounds:['.review-row','.review-row.selected']},
  {label:'selected review secondary text',foreground:'.review-row-copy>small',backgrounds:['.review-row.selected','.review-row','.review-row:hover']},
])test(`Q8 UI contrast: ${label} meets the normal-text 4.5:1 threshold`,t=>{
  const color=property(foreground,'color');
  for(const selector of backgrounds){
    const background=property(selector,'background'),ratio=contrast(color,background);
    t.diagnostic(`${foreground} ${color} on ${selector} ${background}: ${ratio.toFixed(3)}:1`);
    assert.ok(ratio>=4.5,`${foreground} on ${selector} is ${ratio.toFixed(3)}:1; expected at least 4.5:1`);
  }
});
