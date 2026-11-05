/** Server-only adapter input. This is a bank-evidenced account/company mapping,
 * never a membership registry or a browser's declaration of company ownership.
 * A missing, stale or contradictory mapping cannot authorize a company flow.
 */
export function resolveCorporateAccountEvidence(configuration, input) {
  const clean = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
  // Configuration timestamps are canonical UTC instants. Date.parse alone also
  // accepts arrays/numbers and normalizes impossible calendar dates.
  const instant = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? timestamp : NaN;
  };
  if (!input || !input.context || !['companyId', 'storageOwnerId', 'actorId'].every(key => clean(input.context[key])) ||
    !clean(input.bankName) || !/^[A-Z]{2}$/.test(input.country || '')) return undefined;
  if (configuration === undefined || configuration === null || configuration === '') return undefined;
  let registry;
  try {
    if (typeof configuration !== 'string' || configuration.length > 262144) return undefined;
    registry = JSON.parse(configuration);
  } catch { return undefined; }
  if (registry?.version !== 1 || !Array.isArray(registry.bindings) || registry.bindings.length > 100) return undefined;
  const { context, bankName, country, accounts, validUntil, now = Date.now() } = input;
  const candidates = registry.bindings.filter(binding => binding && binding.companyId === context.companyId &&
    binding.storageOwnerId === context.storageOwnerId && binding.provider === 'enablebanking' &&
    binding.bankName === bankName && binding.country === country);
  if (candidates.length !== 1) return undefined;
  const binding = candidates[0];
  const checked = instant(binding.checkedAt), expires = Math.min(instant(binding.validUntil), instant(validUntil));
  if (binding.status !== 'active' || !['bank', 'provider'].includes(binding.origin) || !clean(binding.evidenceId) ||
    !Number.isFinite(now) || !Number.isFinite(checked) || checked > now || !Number.isFinite(expires) || expires <= now ||
    !Array.isArray(binding.accountKeys) || !binding.accountKeys.length || binding.accountKeys.length > 100 ||
    !binding.accountKeys.every(key => clean(key) && key !== '*') || new Set(binding.accountKeys).size !== binding.accountKeys.length ||
    !Array.isArray(accounts) || !accounts.length || accounts.length > 100 ||
    !accounts.every(account => account && clean(account.uid) && clean(account.key) && (account.usage === undefined || ['ORGA','PRIV'].includes(account.usage))) ||
    new Set(accounts.map(account => account.uid)).size !== accounts.length) return undefined;
  const scoped = accounts.filter(account => account.usage !== 'PRIV' && binding.accountKeys.includes(account.key));
  if (!scoped.length || new Set(scoped.map(account => account.uid)).size !== scoped.length) return undefined;
  return {
    status: 'verified', origin: binding.origin, evidenceId: binding.evidenceId,
    companyId: context.companyId, actorId: context.actorId, bankName, country,
    accountUids: scoped.map(account => account.uid), checkedAt: binding.checkedAt,
    validUntil: new Date(expires).toISOString(),
  };
}
