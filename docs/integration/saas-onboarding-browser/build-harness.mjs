import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sites = path.join(repo, 'sites');
const scratch = process.env.MGEORGE_ONBOARDING_QA || path.join(tmpdir(), 'mgeorge-saas-onboarding-qa');
const web = path.join(scratch, 'web');
const require = createRequire(path.join(sites, 'package.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(web, { recursive: true });
const result = await require('esbuild').build({
  absWorkingDir: sites,
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import BankPage from './app/bank/page';
createRoot(document.getElementById('root')).render(<BankPage/>);`, resolveDir: sites, sourcefile: 'onboarding-test-entry.tsx', loader: 'tsx' },
  outdir: web, entryNames: 'app', bundle: true, platform: 'browser', format: 'esm', target: ['chrome120'], jsx: 'automatic',
  alias: { '@': sites }, define: { 'process.env.NODE_ENV': '"production"' }, metafile: true, logLevel: 'warning',
});
const cssFiles = ['app/globals.css', 'styles/bank-connection.css', 'styles/bankgiro-source.css', 'styles/saas-onboarding.css'];
const globalsPath = path.join(sites, cssFiles[0]);
const compiled = await require('postcss')([require('@tailwindcss/postcss')({ base: sites })]).process(await fs.readFile(globalsPath, 'utf8'), { from: globalsPath, to: path.join(web, 'app.css') });
const extra = await Promise.all(cssFiles.slice(1).map(file => fs.readFile(path.join(sites, file), 'utf8').catch(error => { if (file.endsWith('saas-onboarding.css') && error.code === 'ENOENT') return ''; throw error; })));
await fs.writeFile(path.join(web, 'app.css'), compiled.css + '\n' + extra.join('\n'));
await fs.writeFile(path.join(web, 'index.html'), '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic onboarding acceptance</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const inputs = [...new Set([...Object.keys(result.metafile.inputs).filter(file => !file.includes('node_modules') && file !== 'onboarding-test-entry.tsx'), ...cssFiles])];
const manifest = { generatedAt: new Date().toISOString(), inputs: [], outputs: [] };
for (const input of inputs) {
  try { manifest.inputs.push({ path: path.relative(repo, path.resolve(sites, input)), sha256: sha(await fs.readFile(path.resolve(sites, input))) }); }
  catch (error) { if (!input.endsWith('saas-onboarding.css') || error.code !== 'ENOENT') throw error; }
}
for (const output of ['index.html', 'app.js', 'app.css']) manifest.outputs.push({ path: output, sha256: sha(await fs.readFile(path.join(web, output))) });
await fs.writeFile(path.join(scratch, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ web, inputs: manifest.inputs.length, outputs: manifest.outputs.length }));
