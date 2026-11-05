import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sites = path.join(repo, 'sites');
const scratch = process.env.MGEORGE_95_UI_QA || path.join(tmpdir(), 'mgeorge-95-ui-qa');
const web = path.join(scratch, 'web');
const require = createRequire(path.join(sites, 'package.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = new Map();
const harnessPaths = [
  'docs/integration/95-ui-browser/build-harness.mjs', 'docs/integration/95-ui-browser/serve-harness.mjs', 'docs/integration/95-ui-browser/fixtures.mjs',
  'docs/integration/agent-6-browser/fixtures.mjs', 'sites/tests/helpers/bank-api-fixture.mjs',
  'sites/tests/helpers/payment-field-source-fixture.mjs', 'sites/tests/helpers/saas-onboarding-fixture.mjs',
].map(file => path.join(repo, file));
for (const file of harnessPaths) sources.set(file, sha(await fs.readFile(file)));
async function snapshot(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await snapshot(file);
    else if (/\.(?:ts|tsx|js|mjs|css)$/.test(entry.name)) sources.set(file, sha(await fs.readFile(file)));
  }
}
for (const directory of ['app', 'components', 'lib', 'styles']) await snapshot(path.join(sites, directory));
await fs.mkdir(web, { recursive: true });
const result = await require('esbuild').build({
  absWorkingDir: sites,
  stdin: { contents: `import React from 'react';
import {createRoot} from 'react-dom/client';
import Dashboard from './app/dashboard.tsx';
import BankPage from './app/bank/page.tsx';
import CompanyWorkspace from './components/company-workspace.tsx';
import {readWorkspaceLocation} from './lib/workspace-location.ts';
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,window.location.href);if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/'))return Promise.reject(new Error('Synthetic harness blocked a non-local API request'));return nativeFetch(input,init);};
for(const name of ['click','auxclick'])document.addEventListener(name,event=>{const link=event.target instanceof Element?event.target.closest('a[href]'):null;if(!link)return;const url=new URL(link.href,window.location.href);if(url.protocol!=='blob:'&&url.origin!==window.location.origin){event.preventDefault();event.stopImmediatePropagation();}},true);
const nativeOpen=window.open.bind(window);window.open=(url,target,features)=>{if(url&&new URL(String(url),window.location.href).origin!==window.location.origin)throw new Error('Synthetic harness blocked external navigation');return nativeOpen(url,target,features);};
const current=readWorkspaceLocation(new URLSearchParams(window.location.search));
createRoot(document.getElementById('root')).render(<CompanyWorkspace>{window.location.pathname==='/bank'?<BankPage/>:<Dashboard initialView={current.view} openBankImport={current.openBankImport}/>}</CompanyWorkspace>);`, resolveDir: sites, sourcefile: '95-ui-browser-entry.tsx', loader: 'tsx' },
  outdir: web, entryNames: 'app', chunkNames: 'chunks/[name]-[hash]', splitting: true, bundle: true, platform: 'browser', format: 'esm', target: ['chrome120'], jsx: 'automatic',
  alias: { '@': sites }, define: { 'process.env.NODE_ENV': '"production"' }, metafile: true, logLevel: 'warning',
});
const cssFiles = ['app/globals.css', 'styles/bank-connection.css', 'styles/bankgiro-source.css', 'styles/saas-onboarding.css', 'styles/company-workspace.css', 'styles/workspace-design.css'];
const cssPaths = cssFiles.map(file => path.join(sites, file));
const cssSources = await Promise.all(cssPaths.map(file => fs.readFile(file, 'utf8')));
const compiled = await require('postcss')([require('@tailwindcss/postcss')({ base: sites })]).process(cssSources[0], { from: cssPaths[0], to: path.join(web, 'app.css') });
await fs.writeFile(path.join(web, 'app.css'), compiled.css + '\n' + cssSources.slice(1).join('\n'));
await fs.writeFile(path.join(web, 'index.html'), '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MG · Synthetic isolated UI acceptance</title><link rel="stylesheet" href="/app.css"></head><body class="antialiased"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const inputs = [];
const inputPaths = new Set([...Object.keys(result.metafile.inputs).filter(file => !file.includes('node_modules') && file !== '95-ui-browser-entry.tsx').map(file => path.resolve(sites, file)), ...cssPaths]);
for (const file of inputPaths) {
  const digest = sha(await fs.readFile(file));
  if (sources.get(file) !== digest) throw new Error('Product source changed during build: ' + path.relative(repo, file));
  inputs.push({ path: path.relative(repo, file), sha256: digest });
}
const outputPaths = new Set([...Object.keys(result.metafile.outputs).map(file => path.resolve(sites, file)), path.join(web, 'app.css'), path.join(web, 'index.html')]);
const outputs = [];
for (const file of outputPaths) outputs.push({ path: path.relative(web, file), sha256: sha(await fs.readFile(file)) });
const harnessInputs = [];
for (const file of harnessPaths) {
  const digest = sha(await fs.readFile(file));
  if (sources.get(file) !== digest) throw new Error('Harness or fixture source changed during build: ' + path.relative(repo, file));
  harnessInputs.push({ path: path.relative(repo, file), sha256: digest });
}
const manifest = { builtAt: new Date().toISOString(), sourceStableDuringBuild: true, harness: 'Actual production Dashboard, BankPage, CompanyWorkspace, real React and production CSS. Only the entry HTML and isolated API responses are synthetic.',
  toolchain: { node: process.version, react: require('react/package.json').version, esbuild: require('esbuild/package.json').version, postcss: require('postcss/package.json').version, tailwindPostcss: JSON.parse(await fs.readFile(path.join(sites, 'node_modules/@tailwindcss/postcss/package.json'), 'utf8')).version }, inputs, harnessInputs, outputs };
await fs.writeFile(path.join(scratch, 'bundle-source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ web, manifest: path.join(scratch, 'bundle-source-manifest.json'), productInputs: inputs.length, browserBundles: outputs.length }));
