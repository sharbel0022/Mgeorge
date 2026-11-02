// Shared behavioral contract: both applications must make the same policy decisions.
export function registerInvoiceReferencePolicyTests(test, assert, policyExports) {
  const {
    INVOICE_REFERENCE_POLICY_VERSION,
    MGEORGE_INVOICE_REFERENCE_POLICY,
    resolveInvoiceReference,
    strictInvoiceReferenceMatch,
    matchesInvoiceReference,
    validateInvoiceReferencePolicies,
  } = policyExports;
  const company = {name: 'M.George Vitvaror AB'};
  const context = () => ({company: {...company}});
  const invoice = (changes = {}) => ({invoice_number: '0599', direction: 'customer', ...changes});
  const customPolicy = (changes = {}) => ({...MGEORGE_INVOICE_REFERENCE_POLICY, ...changes});
  const resolve = (changes = {}, settings = context()) => resolveInvoiceReference(invoice(changes), settings);
  test('a valid long Node company name remains outside the M.George policy',()=>{
    const decision=resolve({}, {company:{name:'Synthetic generic company '+ 'A'.repeat(210)}});
    assert.equal(decision.applies,false);
    assert.equal(decision.status,'REVIEW');
  });
  const blocked = decision => {
    assert.equal(decision.applies, true);
    assert.equal(decision.status, 'BLOCKED');
    assert.ok(decision.issues.length > 0);
    assert.equal(matchesInvoiceReference(decision, '0599'), false);
    assert.equal(typeof decision.reason, 'string');
    assert.ok(decision.reason.length > 0);
  };

  test('policy declares an intention with a stable result contract, never bank verification', () => {
    const decision = resolve();
    assert.deepEqual(Object.keys(decision).sort(), [
      'applies', 'declaredPaymentReference', 'intendedPaymentReference', 'invoiceNumber',
      'issues', 'policyId', 'reason', 'source', 'status', 'version',
    ].sort());
    assert.equal(decision.version, 'invoice-reference-policy-v1');
    assert.equal(decision.version, INVOICE_REFERENCE_POLICY_VERSION);
    assert.equal(decision.policyId, 'mgeorge-own-invoice-number-v1');
    assert.equal(decision.applies, true);
    assert.equal(decision.status, 'REVIEW');
    assert.equal(decision.source, 'invoice_number_policy');
    assert.deepEqual(decision.issues, []);
    assert.equal(decision.declaredPaymentReference, null);
    assert.equal(typeof decision.reason, 'string');
    assert.ok(decision.reason.length > 0);
  });

  for (const number of ['0001', '0599', 'AB/0001', 'AB_0001', 'AB-0001']) {
    test(`full invoice identifier is the intended reference without losing zeros: ${number}`, () => {
      const decision = resolve({invoice_number: number});
      assert.equal(decision.invoiceNumber, number);
      assert.equal(decision.intendedPaymentReference, number);
      assert.equal(decision.status, 'REVIEW');
      assert.equal(matchesInvoiceReference(decision, number), true);
    });
  }

  test('ordinary surrounding spaces can be removed while the original fields remain unchanged', () => {
    const input = invoice({invoice_number: '  0599  ', reference: ' 0599 ', original: {
      invoice_number: ' 0599 ', reference: ' 0599 ', issuer_name: '  m.george   vitvaror ab ',
    }});
    const settings = {company: {name: ' M.GEORGE   VITVAROR AB '}};
    const before = structuredClone({input, settings});
    const decision = resolveInvoiceReference(input, settings);
    assert.equal(decision.status, 'REVIEW');
    assert.equal(decision.invoiceNumber, '0599');
    assert.equal(decision.declaredPaymentReference, '0599');
    assert.equal(decision.intendedPaymentReference, '0599');
    assert.equal(strictInvoiceReferenceMatch(' 0599 ', '0599'), true);
    assert.deepEqual({input, settings}, before);
  });

  for (const [left, right] of [
    ['0001', '1'], ['0599', '599'], ['0599', '0599x'], ['0599', 'x0599'],
    ['0599', '0599-1'], ['0599', '05-99'], ['0599', '0599.0'],
    ['0599', '0599,0'], ['0599', '05 99'], ['AB/0001', 'AB0001'],
    ['AB_0001', 'AB-0001'], ['AB-0001', 'ab-0001'],
    ['0599', 'Faktura: 0599'], ['0599', 'OCR:0599'], ['0599', '０５９９'],
  ]) {
    test(`matching never equates distinct complete identifiers: ${left} / ${right}`, () => {
      assert.equal(strictInvoiceReferenceMatch(left, right), false);
      assert.equal(strictInvoiceReferenceMatch(right, left), false);
      assert.equal(matchesInvoiceReference(resolve({invoice_number: left}), right), false);
    });
  }

  test('exact comparison accepts only nonempty bounded primitive strings without controls', () => {
    for (const value of [undefined, null, '', ' ', 599, true, {}, [], ['0599'], new String('0599'),
      '\n0599', '0599\r', '0599\t', '0599\0', '05\u007f99', '\u00a00599', '0599\u200b', '9'.repeat(101)]) {
      assert.equal(strictInvoiceReferenceMatch(value, value), false);
      assert.equal(strictInvoiceReferenceMatch('0599', value), false);
    }
    assert.equal(strictInvoiceReferenceMatch('9'.repeat(100), '9'.repeat(100)), true);
    assert.equal(strictInvoiceReferenceMatch('0599', '0599'), true);
  });

  test('missing or malformed invoice numbers block without String coercion or partial parsing', () => {
    for (const value of [undefined, null, '', '   ', 599, 0, true, {}, [], ['0599'], new String('0599'),
      '0599.0', '0599,0', '05 99', 'Invoice 0599', '0599\n', '\t0599', '0599\u200b', '０５９９', '9'.repeat(101)]) {
      const decision = resolve({invoice_number: value});
      blocked(decision);
      assert.ok(decision.issues.some(issue => /invoice_number/.test(issue)));
      assert.equal(decision.intendedPaymentReference, null);
    }
    assert.equal(resolve({invoice_number: '9'.repeat(100)}).status, 'REVIEW');
  });

  test('an absent optional reference does not prevent the number policy', () => {
    for (const reference of [undefined, null, '', '  ']) {
      const decision = resolve({reference});
      assert.equal(decision.status, 'REVIEW');
      assert.equal(decision.declaredPaymentReference, null);
      assert.equal(decision.intendedPaymentReference, '0599');
    }
  });

  test('a registered exact reference agrees with the invoice number policy', () => {
    const decision = resolve({reference: '0599'});
    assert.equal(decision.status, 'REVIEW');
    assert.equal(decision.declaredPaymentReference, '0599');
    assert.equal(decision.intendedPaymentReference, '0599');
    assert.equal(decision.source, 'invoice_number_policy');
  });

  test('conflicting registered references are retained and cannot replace the intended number', () => {
    for (const reference of ['599', '000018', '0599x', '0599-1', 'AB/0599']) {
      const decision = resolve({reference});
      blocked(decision);
      assert.equal(decision.declaredPaymentReference, reference);
      assert.equal(decision.intendedPaymentReference, '0599');
      assert.ok(decision.issues.includes('declared_reference_conflict'));
      assert.equal(matchesInvoiceReference(decision, reference), false);
    }
  });

  test('a supplied malformed reference blocks even when it resembles the correct number', () => {
    for (const reference of [599, 0, false, {}, [], ['0599'], new String('0599'), '0599.0',
      '0599\n', '\t0599', 'OCR:0599', '０５９９', '9'.repeat(101)]) {
      const decision = resolve({reference});
      blocked(decision);
      assert.ok(decision.issues.includes('declared_reference_invalid'));
    }
  });

  test('matching original invoice identifiers and issuer allow review without claiming bank proof', () => {
    const decision = resolve({reference: '0599', original: {
      invoice_number: '0599', reference: '0599', issuer_name: 'M.George Vitvaror AB',
    }});
    assert.equal(decision.status, 'REVIEW');
    assert.deepEqual(decision.issues, []);
    assert.equal(decision.intendedPaymentReference, '0599');
  });

  test('an original invoice number contradiction blocks even when the registered reference matches', () => {
    const decision = resolve({reference: '0599', original: {invoice_number: '599'}});
    blocked(decision);
    assert.ok(decision.issues.includes('original_invoice_number_conflict'));
  });

  test('an original explicit reference contradiction blocks without rewriting either reference', () => {
    const decision = resolve({reference: '0599', original: {invoice_number: '0599', reference: '000018'}});
    blocked(decision);
    assert.ok(decision.issues.includes('original_reference_conflict'));
    assert.equal(decision.intendedPaymentReference, '0599');
    assert.equal(decision.declaredPaymentReference, '0599');
  });

  test('malformed original identifiers cannot silently disappear into the number policy', () => {
    for (const original of [{invoice_number: 599}, {reference: 599}, {invoice_number: '0599.0'},
      {reference: '0599\n'}, {issuer_name: 599}, [], '0599']) {
      blocked(resolve({original}));
    }
  });

  test('missing and empty optional original fields are not contradictions', () => {
    for (const original of [undefined, null, {}, {invoice_number: '', reference: '  ', issuer_name: ''}]) {
      assert.equal(resolve({original}).status, 'REVIEW');
    }
  });

  test('an explicitly different original issuer blocks a purported own outgoing invoice', () => {
    for (const issuer_name of ['Example Supplier AB', 'M.George Vitvaror AB Demo', 'MGeorge Vitvaror AB']) {
      const decision = resolve({original: {issuer_name}});
      blocked(decision);
      assert.ok(decision.issues.includes('original_issuer_conflict'));
    }
  });

  test('other companies retain only their explicit reference, without inheriting the number policy', () => {
    for (const name of ['Example AB', 'M.George Demo', 'M.George Vitvaror AB Demo',
      'Demo M.George Vitvaror AB', 'MGeorge Vitvaror AB', 'M. George Vitvaror AB']) {
      const decision = resolve({reference: '000018'}, {company: {name}});
      assert.equal(decision.applies, false);
      assert.equal(decision.policyId, null);
      assert.equal(decision.status, 'REVIEW');
      assert.equal(decision.intendedPaymentReference, '000018');
      assert.equal(decision.source, 'explicit_invoice_reference');
      assert.equal(matchesInvoiceReference(decision, '000018'), false);
      assert.equal(resolve({}, {company: {name}}).intendedPaymentReference, null);
    }
  });

  test('supplier and unknown-direction invoices do not acquire a new invoice-number reference', () => {
    for (const direction of ['supplier', 'unknown', '', undefined, null]) {
      const decision = resolve({direction, reference: '000018'});
      assert.equal(decision.applies, false);
      assert.equal(decision.status, 'REVIEW');
      assert.equal(decision.intendedPaymentReference, '000018');
      assert.equal(resolve({direction}).intendedPaymentReference, null);
    }
  });

  test('malformed company identity fails closed for outgoing invoices without a fallback', () => {
    for (const settings of [undefined, null, {}, [], {company: null}, {company: {}},
      {company: {name: ''}}, {company: {name: 599}}, {company: {name: 'M.George Vitvaror AB\n'}},
      {company: {name: 'M.George\u00a0Vitvaror AB'}}]) {
      const decision = resolveInvoiceReference(invoice({reference: '0599'}), settings);
      blocked(decision);
      assert.ok(decision.issues.includes('invalid_company_configuration'));
    }
  });

  test('explicitly empty policies disable the policy without inventing another intended reference', () => {
    const settings = {...context(), policies: []};
    const decision = resolve({}, settings);
    assert.equal(decision.applies, false);
    assert.equal(decision.intendedPaymentReference, null);
    assert.equal(decision.source, 'none');
    assert.equal(resolve({reference: '000018'}, settings).intendedPaymentReference, '000018');
    assert.equal(resolveInvoiceReference(invoice(), {policies: []}).applies, false);
  });

  test('an explicit-reference strategy requires the reference but allows a different invoice number', () => {
    const settings = {...context(), policies: [customPolicy({id: 'mgeorge-explicit-v1', referenceSource: 'explicit_reference'})]};
    const decision = resolve({reference: '000018', original: {invoice_number: '0599', reference: '000018'}}, settings);
    assert.equal(decision.status, 'REVIEW');
    assert.equal(decision.source, 'explicit_invoice_reference');
    assert.equal(decision.intendedPaymentReference, '000018');
    assert.equal(decision.invoiceNumber, '0599');
    assert.equal(matchesInvoiceReference(decision, '000018'), true);
    assert.equal(matchesInvoiceReference(decision, '0599'), false);
    const missing = resolve({}, settings);
    blocked(missing);
    assert.ok(missing.issues.includes('explicit_reference_missing'));
    assert.equal(missing.intendedPaymentReference, null);
  });

  test('explicit-reference strategy still blocks original contradictions and malformed invoice numbers', () => {
    const settings = {...context(), policies: [customPolicy({referenceSource: 'explicit_reference'})]};
    blocked(resolve({reference: '000018', original: {reference: '0599'}}, settings));
    blocked(resolve({reference: '000018', original: {invoice_number: '599'}}, settings));
    blocked(resolve({invoice_number: 599, reference: '000018'}, settings));
  });

  test('a validated policy can explicitly scope a separate company without broad company matching', () => {
    const settings = {company: {name: 'Example Supplies AB'}, policies: [customPolicy({
      id: 'example-explicit-v1', companyName: 'Example Supplies AB', referenceSource: 'explicit_reference',
    })]};
    const decision = resolve({reference: 'EXP-000018'}, settings);
    assert.equal(decision.applies, true);
    assert.equal(decision.status, 'REVIEW');
    assert.equal(decision.policyId, 'example-explicit-v1');
    assert.equal(decision.intendedPaymentReference, 'EXP-000018');
    assert.equal(resolve({}, {...settings, company}).applies, false);
  });

  test('invalid configured policy fields are rejected by validation and block resolution', () => {
    for (const invalid of [
      {...MGEORGE_INVOICE_REFERENCE_POLICY, version: 'future-version'},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, id: ''},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, id: 599},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, companyName: ''},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, companyName: 599},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, companyName: 'M.George Vitvaror AB\n'},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, referenceSource: 'invoiceNumber'},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, direction: 'supplier'},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, matchMode: 'numeric'},
      {...MGEORGE_INVOICE_REFERENCE_POLICY, matchMode: 'substring'},
      null, [], 'invoice_number', {},
    ]) {
      assert.throws(() => validateInvoiceReferencePolicies([invalid]), TypeError);
      const decision = resolve({reference: '0599'}, {...context(), policies: [invalid]});
      blocked(decision);
      assert.ok(decision.issues.includes('invalid_policy_configuration'));
    }
    for (const policies of [null, {}, 'default', 1, false]) {
      assert.throws(() => validateInvoiceReferencePolicies(policies), TypeError);
      blocked(resolve({}, {...context(), policies}));
    }
  });

  test('duplicate policy IDs and company scopes fail closed instead of choosing the first entry', () => {
    for (const policies of [
      [customPolicy(), customPolicy()],
      [customPolicy(), customPolicy({id: 'second-v1'})],
      [customPolicy(), customPolicy({id: 'second-v1', companyName: ' m.george  vitvaror ab '})],
      [customPolicy(), customPolicy({companyName: 'Another AB'})],
    ]) {
      assert.throws(() => validateInvoiceReferencePolicies(policies), TypeError);
      const decision = resolve({}, {...context(), policies});
      blocked(decision);
      assert.ok(decision.issues.includes('invalid_policy_configuration'));
    }
  });

  test('malformed configuration never drops into another matching valid policy', () => {
    const policies = [customPolicy({matchMode: 'numeric'}), customPolicy({id: 'fallback-v1'})];
    blocked(resolve({}, {...context(), policies}));
  });

  test('sparse policy arrays are rejected as malformed entries rather than skipped', () => {
    for (const policies of [Array(1), [customPolicy(), ,]]) {
      assert.throws(() => validateInvoiceReferencePolicies(policies), TypeError);
      blocked(resolve({}, {...context(), policies}));
    }
  });

  test('policy validation returns independent records while the built-in policy stays frozen', () => {
    assert.equal(Object.isFrozen(MGEORGE_INVOICE_REFERENCE_POLICY), true);
    const policies = [customPolicy()];
    const before = structuredClone(policies);
    const result = validateInvoiceReferencePolicies(policies);
    assert.deepEqual(result, before);
    assert.notEqual(result, policies);
    assert.notEqual(result[0], policies[0]);
    result[0].companyName = 'Changed AB';
    assert.deepEqual(policies, before);
    assert.equal(resolve().status, 'REVIEW');
    assert.deepEqual(validateInvoiceReferencePolicies([]), []);
  });

  test('resolution and matching preserve frozen inputs and contain no payment side effects', () => {
    const original = Object.freeze({invoice_number: '0599', reference: '000018', issuer_name: 'M.George Vitvaror AB'});
    const input = Object.freeze(invoice({reference: '0599', original, bank_ocr: '000018', paid_cents: 0}));
    const policies = Object.freeze([Object.freeze(customPolicy())]);
    const settings = Object.freeze({company: Object.freeze({...company}), policies});
    const before = structuredClone({input, settings});
    const decision = resolveInvoiceReference(input, settings);
    blocked(decision);
    matchesInvoiceReference(decision, '0599');
    validateInvoiceReferencePolicies(policies);
    assert.deepEqual({input, settings}, before);
    assert.equal(input.bank_ocr, '000018');
    assert.equal(input.paid_cents, 0);
    assert.equal(Object.hasOwn(decision, 'bank_ocr'), false);
    assert.equal(Object.hasOwn(decision, 'verified'), false);
  });
}
