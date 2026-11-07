// Explicit reviewed model identifiers, not invented dated snapshots.
// Prices verified 2026-11-06 from the official model pages listed below.
// This conservative accounting uses standard uncached prices and the default service tier.
export const INVOICE_AI_PROFILE_VERSION = 'invoice-ai-profiles-2026-11-06.v1';
export const INVOICE_AI_POLICY_VERSION = 'invoice-ai-integration-2026-11-06.v1';
export const INVOICE_AI_PRICING_VERSION = 'openai-standard-2026-11-06.v1';

const limits = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxPages: 10,
  maxInputTokens: 128000, // Deliberately below the documented 272K long-context price threshold.
  maxOutputTokens: 8192,
  maxAttempts: 2,
  maxResponseBytes: 524288,
  maxDocumentTextChars: 150000,
  timeoutMs: 30000,
  retryDelayMs: 250,
});
function profile(id, model, input, output) {
  return Object.freeze({
    id, version: INVOICE_AI_PROFILE_VERSION, model, reasoningEffort: 'low',
    pricingVersion: INVOICE_AI_PRICING_VERSION,
    pricing: Object.freeze({
      inputMicroUsdPerMillionTokens: input,
      outputMicroUsdPerMillionTokens: output,
    }),
    limits,
    source: 'https://developers.openai.com/api/docs/models/' + model,
    verifiedOn: '2026-11-06',
  });
}
export const INVOICE_AI_PROFILES = Object.freeze({
  'luna-v1': profile('luna-v1', 'gpt-6-luna', 100000, 500000),
  'sol-v1': profile('sol-v1', 'gpt-6.1-sol', 2000000, 10000000),
});
export function getInvoiceAiProfile(id) {
  return typeof id === 'string' && Object.hasOwn(INVOICE_AI_PROFILES, id) ? INVOICE_AI_PROFILES[id] : null;
}
export function invoiceAiCostMicroUsd(usage, pricing) {
  for (const value of [usage?.inputTokens, usage?.outputTokens, pricing?.inputMicroUsdPerMillionTokens, pricing?.outputMicroUsdPerMillionTokens]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid integer token accounting');
  }
  const numerator = BigInt(usage.inputTokens) * BigInt(pricing.inputMicroUsdPerMillionTokens)
    + BigInt(usage.outputTokens) * BigInt(pricing.outputMicroUsdPerMillionTokens);
  const result = (numerator + 999999n) / 1000000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Token cost exceeds safe integer range');
  return Number(result);
}
