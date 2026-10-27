import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Discover new tests as well as existing files so security coverage cannot be
// accidentally omitted from the syntax check when the suite grows.
const files=['src','public','scripts','test'].flatMap(dir=>readdirSync(dir).filter(name=>/\.(?:js|mjs)$/.test(name)).map(name=>`${dir}/${name}`));
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
console.log(`${files.length} JavaScript-filer syntaxkontrollerade.`);
