import {emptyState} from '../../lib/domain.ts';

// Legacy accounting fixtures intentionally allow a separate invoice number/OCR
// or a manually reviewed refund reference. Make their generic issuer explicit;
// the built-in M.George rule remains active in production and its own fixtures.
export function genericCompanyState() {
  const state = emptyState();
  state.company.name = 'Synthetic Reference Issuer AB';
  return state;
}
