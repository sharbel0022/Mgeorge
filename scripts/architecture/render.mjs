#!/usr/bin/env node
/** Render the checked-in diagram graph without requiring a browser process.
 * Supports the deliberately small Mermaid subset used by architecture.mmd.
 * Graphviz controls layout only; labels and directed edges come from Mermaid.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const source=new URL('docs/architecture/architecture.mmd',root);
const output=new URL('docs/architecture/architecture.svg',root);
const text=readFileSync(source,'utf8');
const nodes=new Map();
for(const match of text.matchAll(/([A-Za-z][A-Za-z0-9]*)\["([^"\n]+)"\]/g)){
  if(nodes.has(match[1])&&nodes.get(match[1])!==match[2])throw Error('Ambiguous diagram node');
  nodes.set(match[1],match[2]);
}
const edges=[];
for(const raw of text.trim().split('\n')){
  if(raw.startsWith('flowchart '))continue;
  const line=raw.trim().replace(/\["[^"\n]+"\]/g,'');
  const match=/^([A-Za-z][A-Za-z0-9]*)\s+(-->|-\.->|-\.\s+"([^"\n]+)"\s+\.->)\s+([A-Za-z][A-Za-z0-9]*)$/.exec(line);
  if(!match||!nodes.has(match[1])||!nodes.has(match[4]))throw Error('Unsupported diagram syntax: '+line);
  edges.push({from:match[1],to:match[4],dashed:match[2]!=='-->',label:match[3]||''});
}
const quote=JSON.stringify;
const wrap=value=>{
  const words=value.split(' '),lines=[];let current='';
  for(const word of words){if(current.length+word.length>39){lines.push(current);current=word;}else current+=(current?' ':'')+word;}
  if(current)lines.push(current);return lines.join('\n');
};
const dot=['digraph MG {',
  'graph [rankdir=TB, bgcolor="white", pad="0.4", nodesep="0.35", ranksep="0.65", fontname="Arial", label="MG Fakturakoll — faktisk produktionsarkitektur", labelloc=t, fontsize=23];',
  'node [shape=box, style="rounded,filled", fillcolor="#f5f5f5", color="#303030", fontcolor="#111111", fontname="Arial", fontsize=12, margin="0.18,0.13"];',
  'edge [color="#606060", fontcolor="#404040", fontname="Arial", fontsize=10, arrowsize=0.7];',
  ...[...nodes].map(([id,label])=>`${id} [label=${quote(wrap(label))}];`),
  ...edges.map(e=>`${e.from} -> ${e.to} [style=${e.dashed?'dashed':'solid'}, label=${quote(e.label)}];`),
  '}'].join('\n');
const result=spawnSync('dot',['-Tsvg'],{input:dot,encoding:'utf8',maxBuffer:8*1024*1024});
if(result.error||result.status!==0)throw Error('Graphviz dot is required for SVG generation. Mermaid source remains available. '+(result.error?.code||result.stderr));
writeFileSync(output,result.stdout);
console.log(JSON.stringify({source:fileURLToPath(source),output:fileURLToPath(output),nodes:nodes.size,edges:edges.length,renderer:'graphviz',reason:'browser-independent rendering of the same Mermaid graph'}));
