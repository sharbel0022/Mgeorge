import type { RetryDiagnostic } from './enable-banking';

/** Stored operational evidence, never an inferred supplier deadline. An empty
 * string means no observed cooldown; missing/malformed storage fails closed. */
function decode(value: unknown): RetryDiagnostic | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const item = JSON.parse(value);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const timestamp = (input: unknown): number => {
      if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) return NaN;
      const parsed = Date.parse(input);
      return Number.isFinite(parsed) && new Date(parsed).toISOString() === input ? parsed : NaN;
    };
    const checked = timestamp(item.checkedAt), keys = Object.keys(item).sort().join(',');
    if (!Number.isFinite(checked)) return null;
    if (item.status === 'known') {
      const deadline = timestamp(item.notBefore);
      if (keys !== 'checkedAt,notBefore,provenance,status' || !['retry_after_seconds', 'retry_after_http_date'].includes(item.provenance) || !Number.isFinite(deadline) || deadline < checked || deadline - checked > 365 * 86400_000) return null;
      return { status: 'known', checkedAt: item.checkedAt, notBefore: item.notBefore, provenance: item.provenance };
    }
    if (keys !== 'checkedAt,provenance,status') return null;
    if (item.status === 'unknown' && ['retry_after_missing', 'retry_after_invalid'].includes(item.provenance)) return { status: 'unknown', checkedAt: item.checkedAt, provenance: item.provenance };
    if (item.status === 'manual_block' && item.provenance === 'retry_after_exceeds_limit') return { status: 'manual_block', checkedAt: item.checkedAt, provenance: item.provenance };
  } catch { /* Unreadable evidence is not permission to contact the bank. */ }
  return null;
}

export function accountReadCooldown(value: unknown, at = Date.now()): { blocked: boolean; retryAdvice: RetryDiagnostic | null } {
  if (value === '') return { blocked: false, retryAdvice: null };
  const advice = decode(value);
  return { blocked: !Number.isFinite(at) || !advice || advice.status !== 'known' || Date.parse(advice.checkedAt) > at || Date.parse(advice.notBefore) > at, retryAdvice: advice };
}

/** A transactions success/fallback must not erase an unresolved account read
 * limit. Even a new unrelated known deadline cannot resolve an unknown one. */
export function mergeAccountReadCooldown(value: string, advice: RetryDiagnostic | null): string {
  if (!advice) return value;
  const previous = value === '' ? null : decode(value);
  if (value !== '' && (!previous || previous.status !== 'known')) return value;
  if (previous?.status === 'known' && advice.status === 'known' && Date.parse(previous.notBefore) >= Date.parse(advice.notBefore)) return value;
  return JSON.stringify(advice);
}
