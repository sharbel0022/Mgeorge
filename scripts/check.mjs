import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Discover new tests as well as existing files so security coverage cannot be
// accidentally omitted from the syntax check when the suite grows.
const discover=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const path=`${dir}/${entry.name}`;
  if(entry.isDirectory()&&!['node_modules','.git'].includes(entry.name))return discover(path);
  return entry.isFile()&&/\.(?:js|mjs|cjs)$/.test(entry.name)?[path]:[];
});
const files=['src','public','scripts','test'].flatMap(discover).sort();
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
console.log(`${files.length} JavaScript-filer syntaxkontrollerade.`);
