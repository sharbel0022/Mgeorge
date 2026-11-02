import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = path.resolve(process.env.MGEORGE_QA_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const sites = path.join(repo, 'sites');
const scratch = process.env.MGEORGE_QA_SCRATCH || path.join(tmpdir(), 'mgeorge-payment-ui-qa');
const web = path.join(scratch, 'web');
const requireSites = createRequire(path.join(sites, 'package.json'));
const esbuild = requireSites('esbuild');
const postcss = requireSites('postcss');
const tailwind = requireSites('@tailwindcss/postcss');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(repo, file).split(path.sep).join('/');
const sourcesBefore = new Map();
async function snapshot(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await snapshot(target);
    else if (/\.(?:ts|tsx|js|mjs|css)$/.test(entry.name)) sourcesBefore.set(relative(target), sha(await fs.readFile(target)));
  }
}
for (const directory of ['app', 'components', 'lib', 'styles']) await snapshot(path.join(sites, directory));
await fs.mkdir(web, { recursive: true });
const result = await esbuild.build({
  absWorkingDir: sites,
  stdin: {
    contents: [
      "import React from 'react';",
      "import {createRoot} from 'react-dom/client';",
      "import Dashboard from './app/dashboard.tsx';",
      "import {readWorkspaceLocation} from './lib/workspace-location.ts';",
      "const location=readWorkspaceLocation(new URLSearchParams(window.location.search));",
      "createRoot(document.getElementById('root')).render(React.createElement(Dashboard,{initialView:location.view,openBankImport:location.openBankImport}));",
    ].join('\n'),
    resolveDir: sites,
    sourcefile: 'qa-browser-entry.tsx',
    loader: 'tsx',
  },
  outdir: web,
  entryNames: 'app',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  splitting: true,
  jsx: 'automatic',
  alias: { '@': sites },
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  logLevel: 'warning',
});
const globalsPath = path.join(sites, 'app/globals.css');
const globals = await fs.readFile(globalsPath, 'utf8');
const compiledCSS = await postcss([tailwind({ base: sites })]).process(globals, { from: globalsPath, to: path.join(web, 'app.css') });
const connectionPath = path.join(sites, 'styles/bank-connection.css');
const connection = await fs.readFile(connectionPath, 'utf8');
await fs.writeFile(path.join(web, 'app.css'), compiledCSS.css + '\n' + connection);
await fs.writeFile(path.join(web, 'index.html'), '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MG payment UI · synthetic local QA</title><link rel="stylesheet" href="/app.css"></head><body class="antialiased"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const inputs = [];
for (const file of Object.keys(result.metafile.inputs)) {
  const absolute = path.resolve(sites, file);
  if (absolute.startsWith(sites + path.sep) && !absolute.includes(path.sep + 'node_modules' + path.sep) && !file.startsWith('qa-browser-entry')) {
    const filePath = relative(absolute), digest = sha(await fs.readFile(absolute));
    if (sourcesBefore.get(filePath) !== digest) throw Error('Product source changed during the build: ' + filePath);
    inputs.push({ path: filePath, sha256: digest });
  }
}
for (const [file, content] of [[globalsPath, globals], [connectionPath, connection]]) {
  const filePath = relative(file), digest = sha(await fs.readFile(file));
  if (sourcesBefore.get(filePath) !== digest || digest !== sha(content)) throw Error('Stylesheet changed during the build: ' + filePath);
  inputs.push({ path: filePath, sha256: digest });
}
const outputFiles = new Set(Object.keys(result.metafile.outputs).map(file => path.resolve(sites, file)));
outputFiles.add(path.join(web, 'app.css'));
outputFiles.add(path.join(web, 'index.html'));
const outputs = [];
for (const file of outputFiles) outputs.push({ path: path.relative(web, file).split(path.sep).join('/'), sha256: sha(await fs.readFile(file)) });
const manifest = { builtAt: new Date().toISOString(), sourceStableDuringBuild: true, harness: 'Actual Sites Dashboard and imported product components, real React, actual Tailwind/PostCSS and bank connection CSS. Only the entry HTML and API fixtures are synthetic.', inputs, outputs };
await fs.writeFile(path.join(scratch, 'bundle-source-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ web, productInputs: inputs.length, browserBundles: manifest.outputs.length, cssBytes: Buffer.byteLength(compiledCSS.css + connection) }));
