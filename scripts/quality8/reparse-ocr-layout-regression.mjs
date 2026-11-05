// Reparse stored optical observations only. No worker, rasterizer or OCR call.
// This is development regression evidence, not an independent holdout.
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {projectReviewedFields, evaluateDocument, summarizeDocuments} from '../../test/helpers/ocr-quality-metrics.mjs';
import {hash, fileHash, localGraph, resolveLocal, mandatoryFields, criticalFields, graphEntries, downstreamEntries} from './ocr-holdout-provenance.mjs';

const targetCommit = '145e310ca2f561764b54606275625d87cbe22002';
const observationCommit = '68e3cb752d05f825e36f88eab58f925cb056e3e8';
const previousFile = 'docs/quality8/ocr-layout-regression-result.json';
const previousSha256 = 'c992ad8445979a72dac0b01ea3ba486c0c184d3a6f9bc3fd77391f9cc8cd9e41';
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--source-root', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) {
    throw Error('Use --source-root CHECKOUT --output NEW_RESULT.json');
  }
  options[args[i]] = args[i + 1];
}
if (!options['--source-root'] || !options['--output']) throw Error('Both paths are required');
const root = resolve(options['--source-root']), output = resolve(options['--output']);
if (existsSync(output)) throw Error('Refusing to overwrite an earlier result');
if (fileHash(join(harnessRoot, previousFile)) !== previousSha256) throw Error('Stored observations changed');
const previous = JSON.parse(readFileSync(join(harnessRoot, previousFile), 'utf8'));
if (previous.status !== 'completed' || previous.sourceCommit !== observationCommit) throw Error('Wrong optical run');
const fixture = join(harnessRoot, 'test/fixtures/quality8/ocr-holdout-v1');
const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'));
const gold = JSON.parse(readFileSync(join(fixture, 'gold.json'), 'utf8'));
const protectedFiles = {
  ...previous.protectedFirstEvidenceHashes,
  [previousFile]: previousSha256,
  'scripts/quality8/measure-ocr-layout-regression.mjs': previous.runnerSha256,
  'docs/quality8/ocr-layout-regression-report.md': fileHash(join(harnessRoot, 'docs/quality8/ocr-layout-regression-report.md')),
};
function checkProtected() {
  for (const [file, want] of Object.entries(protectedFiles)) {
    if (fileHash(join(harnessRoot, file)) !== want) throw Error('Prior evidence changed: ' + file);
  }
}
checkProtected();
const metricHelperSha256 = fileHash(join(harnessRoot, 'test/helpers/ocr-quality-metrics.mjs'));
if (metricHelperSha256 !== previous.metricHelperSha256) throw Error('Metric helper changed');
const observationsSha256 = hash(JSON.stringify(previous.processing));
if (previous.processing.length !== manifest.images.length) throw Error('Observation count changed');
for (const [index, item] of manifest.images.entries()) {
  const sample = previous.processing[index];
  if (sample.id !== item.id || sample.population !== item.population || sample.inputSha256 !== item.sha256 || sample.textSha256 !== hash(sample.text)) {
    throw Error('Observation/manifest mismatch: ' + item.id);
  }
}

const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sourceFiles = [...new Set([
  ...git('ls-tree', '-r', '--name-only', targetCommit, '--', 'src', 'sites/lib').split('\n').filter(Boolean),
  'package.json', 'package-lock.json', 'sites/package.json', 'sites/package-lock.json',
])].sort();
const sourceHashes = Object.fromEntries(sourceFiles.map(file => {
  const bytes = readFileSync(join(root, file));
  const committed = execFileSync('git', ['show', targetCommit + ':' + file], {cwd: root, maxBuffer: 10_000_000});
  if (!bytes.equals(committed)) throw Error('Source differs from exact target: ' + file);
  return [file, hash(bytes)];
}));
const opticalGraph = localGraph(root, graphEntries), downstreamGraph = localGraph(root, downstreamEntries);
if ([...opticalGraph, ...downstreamGraph].some(file => !sourceHashes[file])) throw Error('Untracked source in graph');
if (JSON.stringify(opticalGraph) !== JSON.stringify(previous.opticalGraph)) throw Error('Optical graph membership changed');
const changedOpticalFiles = opticalGraph.filter(file => sourceHashes[file] !== previous.sourceHashes[file]);
if (JSON.stringify(changedOpticalFiles) !== JSON.stringify(['sites/lib/invoice-fields.js', 'src/invoice-extraction.js'])) {
  throw Error('Changes are not limited to the two reviewed parsers');
}

const details = [], report = {
  schema: 'mgeorge-ocr-layout-reparse-v1',
  description: 'Omtolkning av sparade observationer, 0 nya OCR-anrop, inte hållprov.',
  independentHoldout: false, developmentKnownImages: true, synthetic: true,
  ocrCalls: 0, reparsePasses: 1, parserCalls: 0, status: 'running', startedAt: new Date().toISOString(),
  sourceCommit: targetCommit, sourceTree: git('rev-parse', targetCommit + '^{tree}'),
  sourceHashes, sourceSha256: hash(JSON.stringify(sourceHashes)), opticalGraph, downstreamGraph,
  opticalComparison: {
    observationCommit, sameGraph: true, files: opticalGraph.length, changedFiles: changedOpticalFiles,
    changedHashes: Object.fromEntries(changedOpticalFiles.map(file => [file, {before: previous.sourceHashes[file], after: sourceHashes[file]}])),
    scope: 'Static transitive local import graph of the actual worker and both parsers; the worker is not executed by this reparse.',
  },
  changedSourceFilesFromOpticalRun: Object.keys({...previous.sourceHashes, ...sourceHashes}).filter(file => previous.sourceHashes[file] !== sourceHashes[file]),
  observationSource: {file: previousFile, sha256: previousSha256, sourceCommit: observationCommit, startedAt: previous.startedAt, completedAt: previous.completedAt, processingSha256: observationsSha256},
  datasetSha256: previous.datasetSha256, goldSha256: previous.goldSha256,
  protectedEvidenceHashes: protectedFiles, firstHoldoutPassed: false,
  runnerSha256: fileHash(fileURLToPath(import.meta.url)), metricHelperSha256,
  runtime: {node: process.version}, historicalOpticalRuntime: previous.runtime,
  reusedProcessing: previous.processing, details,
  methodology: {
    chain: 'Exactly one call per actual Node/Sites parser for each stored observation. No runDocumentProcess, worker, rasterizer or Tesseract call. Text, method, confidence, input hash and word evidence are supplied unchanged.',
    population: 'Eight readable synthetic normal images and two separate stress images from the known V1 corpus. These images and observations have already been used in diagnosis.',
    metrics: 'The unchanged helper measures all 13 fields, mandatory 10 and mandatory image-only 9 separately for each engine. Wrong non-null values count as FP and FN; null known values remain FN. Stress is separate.',
    metadata: 'Direction supplier remains supplied metadata, not image recovery. Image-only nine excludes direction.',
    timing: 'durationMs in new details and summaries measures parsing only. reusedProcessing.processingTimeMs is historical optical timing and is never included as new processing work.',
    limits: 'Not a fresh optical run, independent holdout, browser/cloud end-to-end test, production validation or financial approval. Numeric targets do not establish general-population accuracy.',
  },
};
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

try {
  const node = await import(pathToFileURL(join(root, 'src/invoice-extraction.js')).href);
  const sitesEntry = join(root, 'sites/lib/invoice-fields.js');
  let code = readFileSync(sitesEntry, 'utf8');
  code = code.replace(/\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
    (_, prefix, _quote, specifier) => prefix + JSON.stringify(pathToFileURL(resolveLocal(root, sitesEntry, specifier)).href));
  const sites = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const parsers = [['node', node.interpretInvoice], ['sites', sites.interpretInvoice]];
  for (const [index, item] of manifest.images.entries()) {
    const sample = previous.processing[index];
    for (const [engine, parse] of parsers) {
      const start = performance.now();
      let extraction, parserError = null;
      report.parserCalls++;
      try {
        extraction = parse(sample.text, {...item.metadata, method: sample.method || 'pdf', ocrConfidence: sample.confidence || 0, ocrEvidence: sample.ocrEvidence, ocrInputSha256: sample.inputSha256});
      } catch {
        extraction = {fields: {}, level: 'red', issues: []};
        parserError = 'parser-error';
      }
      if (sample.error) extraction.level = 'red';
      const parsingTimeMs = performance.now() - start;
      const row = evaluateDocument({id: item.id, family: item.layout, subset: item.population, engine,
        ...projectReviewedFields(extraction, gold.cases[item.id]), level: extraction.level, requireReview: gold.cases[item.id].requireReview,
        error: sample.error || parserError, durationMs: parsingTimeMs, parsingTimeMs, inputSha256: sample.inputSha256,
        observationSha256: hash(JSON.stringify(sample)), issues: extraction.issues || [], fieldEvidence: extraction.fields});
      row.falseGreenCritical = row.green && Boolean(row.error || row.requireReview || item.population === 'stress' || row.fields.some(field => criticalFields.includes(field.name) && !field.correct));
      details.push(row);
    }
  }
  const subset = (rows, fields) => rows.map(row => evaluateDocument({id: row.id, family: row.family, subset: row.subset,
    expected: Object.fromEntries(row.fields.filter(f => fields.includes(f.name)).map(f => [f.name, f.expected])),
    actual: Object.fromEntries(row.fields.filter(f => fields.includes(f.name)).map(f => [f.name, f.actual])),
    level: row.level, requireReview: row.requireReview, error: row.error, durationMs: row.durationMs}));
  report.summaries = Object.fromEntries(parsers.map(([engine]) => {
    const normal = details.filter(row => row.engine === engine && row.subset === 'normal-readable');
    const stress = details.filter(row => row.engine === engine && row.subset === 'stress');
    return [engine, {normal: {all13: summarizeDocuments(normal), mandatory10: summarizeDocuments(subset(normal, mandatoryFields)),
      mandatoryImage9: summarizeDocuments(subset(normal, mandatoryFields.filter(f => f !== 'direction')))},
      stress: summarizeDocuments(stress), falseGreenCritical: details.filter(row => row.engine === engine && row.falseGreenCritical).length}];
  }));
  report.numericTargets = Object.fromEntries(Object.entries(report.summaries).map(([engine, summary]) => [engine, {
    all13: summary.normal.all13.fieldPrecision >= .98 && summary.normal.all13.fieldRecall >= .85,
    mandatory10: summary.normal.mandatory10.fieldPrecision >= .98 && summary.normal.mandatory10.fieldRecall >= .85,
    mandatoryImage9: summary.normal.mandatoryImage9.fieldPrecision >= .98 && summary.normal.mandatoryImage9.fieldRecall >= .85,
    zeroFalseGreenCritical: summary.falseGreenCritical === 0,
    stressAbstained: summary.stress.documents === 2 && summary.stress.greenCount === 0,
  }]));
  report.normal07 = Object.fromEntries(parsers.map(([engine]) => {
    const row = details.find(row => row.engine === engine && row.id === 'holdout-normal-07');
    const field = row.fields.find(field => field.name === 'total_cents');
    const before = previous.details.find(row => row.engine === engine && row.id === 'holdout-normal-07').fields.find(field => field.name === 'total_cents');
    return [engine, {before: before.actual, after: field.actual, expected: field.expected, level: row.level,
      abstainedWithoutInventingAmount: field.actual === null && field.expected !== null && row.manualReview && !row.green}];
  }));
  report.observationsUnchanged = hash(JSON.stringify(previous.processing)) === observationsSha256;
  report.sourceStable = Object.entries(sourceHashes).every(([file, want]) => fileHash(join(root, file)) === want);
  checkProtected();
  report.priorEvidenceUnchanged = true;
  if (!report.observationsUnchanged || !report.sourceStable) throw Error('Input/source mutated during reparse');
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error?.message || error);
  throw error;
} finally {
  report.completedAt = new Date().toISOString();
  save();
}
console.log(JSON.stringify({sourceCommit: targetCommit, ocrCalls: report.ocrCalls, parserCalls: report.parserCalls,
  numericTargets: report.numericTargets, normal07: report.normal07, sourceStable: report.sourceStable,
  observationsUnchanged: report.observationsUnchanged, priorEvidenceUnchanged: report.priorEvidenceUnchanged}, null, 2));
