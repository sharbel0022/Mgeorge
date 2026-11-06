import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.props?.children) : String(node);
let source = transpile('../components/onboarding/bank-onboarding-views.tsx');
for (const [name, url] of Object.entries({
  react: data("export const useId = () => 'company-picker-test';"),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  '@/lib/onboarding/contract': data(transpile('../lib/onboarding/contract.ts')),
})) for (const quote of ['"', "'"]) source = source.replaceAll(quote + name + quote, JSON.stringify(url));
const { CompanyPicker } = await import(data(source));
const companies = [
  { id: 'company-a', name: 'Exempelbolaget AB', organizationNumber: '556000-0000', role: 'owner' },
  { id: 'company-b', name: 'Andra företaget AB', organizationNumber: null, role: 'accountant' },
];
const props = overrides => ({ companies, value: 'company-a', onChange() {}, onCreate() {}, canCreate: true, ...overrides });

test('active workspace company is clear without a duplicate selector and retains company creation', () => {
  let created = false;
  const view = CompanyPicker(props({ activeWorkspaceCompanyId: 'company-a', onCreate: () => { created = true; } }));
  assert.equal(nodes(view).filter(node => node.type === 'select').length, 0);
  assert.match(text(view), /Företag för bankanslutningen/);
  assert.match(text(view), /Exempelbolaget AB/);
  assert.match(text(view), /Organisationsnummer 556000-0000/);
  assert.match(text(view), /Ägare/);
  assert.match(text(view), /Byt företag i Aktivt företag högst upp\./);
  const createButton = nodes(view).find(node => node.type === 'button' && text(node) === 'Lägg till företag');
  assert.ok(createButton);
  createButton.props.onClick();
  assert.equal(created, true);
});

test('standalone company picker retains its labelled selector and change callback', () => {
  let selected;
  const view = CompanyPicker(props({ onChange: id => { selected = id; } }));
  const select = nodes(view).find(node => node.type === 'select');
  assert.ok(select);
  assert.ok(nodes(view).find(node => node.type === 'label' && node.props.htmlFor === select.props.id && text(node) === 'Välj företag'));
  select.props.onChange({ target: { value: 'company-b' } });
  assert.equal(selected, 'company-b');
});

test('missing or mismatched active workspace company keeps selection available', () => {
  for (const activeWorkspaceCompanyId of [null, undefined, 'company-b']) {
    const view = CompanyPicker(props({ activeWorkspaceCompanyId }));
    assert.ok(nodes(view).find(node => node.type === 'select'));
  }
  const unknown = CompanyPicker(props({ value: 'unknown', activeWorkspaceCompanyId: 'unknown' }));
  assert.ok(nodes(unknown).find(node => node.type === 'select'));
});

test('compact company summary preserves missing-organisation and role information and creation permission', () => {
  const view = CompanyPicker(props({ value: 'company-b', activeWorkspaceCompanyId: 'company-b', canCreate: false }));
  assert.equal(nodes(view).filter(node => node.type === 'select').length, 0);
  assert.match(text(view), /Andra företaget AB/);
  assert.match(text(view), /Organisationsnummer ej verifierat/);
  assert.match(text(view), /Redovisning/);
  assert.equal(nodes(view).filter(node => node.type === 'button').length, 0);
});
