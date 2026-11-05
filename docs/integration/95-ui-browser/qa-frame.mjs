import { workspaceViews } from '../../../sites/lib/workspace-location.ts';
import { scenarios } from './fixtures.mjs';

export const frameWidths = [320, 390, 768, 1024, 1440];
const frameViews = [...workspaceViews, 'bank-page'];
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function renderQaFrame(url) {
  const width = Number(url.searchParams.get('width') || 390);
  const height = Number(url.searchParams.get('height') || 900);
  const scenario = url.searchParams.get('scenario') || 'standard';
  const view = url.searchParams.get('view') || 'overview';
  if (!frameWidths.includes(width) || !Number.isSafeInteger(height) || height < 240 || height > 2400 || !Object.hasOwn(scenarios, scenario) || !frameViews.includes(view)) {
    return { status: 400, body: 'Invalid frame viewport, scenario or view.' };
  }
  const appUrl = new URL(view === 'bank-page' ? '/bank' : '/', url.origin);
  appUrl.searchParams.set('scenario', scenario);
  if (view !== 'bank-page') appUrl.searchParams.set('view', view);
  const options = (values, selected) => values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
  return { status: 200, body: `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MG synthetic viewport</title>
<style>html{color-scheme:light}body{margin:0;background:#e8edf2;font:14px system-ui,sans-serif;color:#182737}header{padding:12px 16px;background:#fff;border-bottom:1px solid #c4ced8}form{display:flex;align-items:end;gap:12px;flex-wrap:wrap}label{display:grid;gap:4px}select,input,button{font:inherit;padding:6px 8px}input{width:76px}p{margin:10px 0 0}main{padding:16px;width:max-content;min-width:calc(100% - 32px)}iframe{display:block;border:0;width:${width}px;height:${height}px;min-width:${width}px;max-width:none;flex:none;background:white;box-shadow:0 1px 8px #0002}</style></head>
<body><header><form action="/qa-frame" method="get">
<label>Bredd<select name="width" aria-label="Viewport width">${options(frameWidths, width)}</select></label>
<label>Höjd<input name="height" type="number" min="240" max="2400" value="${height}" aria-label="Viewport height"></label>
<label>Scenario<select name="scenario" aria-label="Fixture scenario">${options(Object.keys(scenarios), scenario)}</select></label>
<label>Vy<select name="view" aria-label="App view">${options(frameViews, view)}</select></label><button type="submit">Visa</button>
</form><p>Syntetiskt test • faktisk appvy ${width} × ${height} CSS-pixlar • ingen skalning. Breda vyer kan kräva horisontell rullning.</p></header>
<main><iframe name="qa-app" title="MG Fakturakoll – actual app viewport" width="${width}" height="${height}" src="${escapeHtml(appUrl.pathname + appUrl.search)}"></iframe></main></body></html>` };
}
