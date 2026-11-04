import type { Company, Snapshot } from './contract';
export type OnboardingErrorKind = 'signin' | 'forbidden' | 'conflict' | 'rate_limited' | 'unavailable' | 'invalid';
const messages: Record<OnboardingErrorKind, string> = {
  signin: 'Logga in för att se dina företag och bankanslutningar.',
  forbidden: 'Du har inte längre åtkomst till företaget. Företagsuppgifterna har dolts. Läs in företagslistan igen.',
  conflict: 'Uppgifterna har ändrats. Läs in aktuell status innan du försöker igen.',
  rate_limited: 'Nästa hämtning är ännu inte tillåten. Kontrollera tiden för nästa möjliga synkronisering.',
  unavailable: 'Tjänsten kunde inte nås. Läs in aktuell status och försök igen.',
  invalid: 'Svaret kunde inte verifieras. Företagsuppgifterna visas när aktuell status har kunnat bekräftas.',
};
export class OnboardingError extends Error {
  readonly kind: OnboardingErrorKind;
  constructor(kind: OnboardingErrorKind) { super(messages[kind]); this.name = 'OnboardingError'; this.kind = kind; }
}
type Fetcher = (path: string, options: RequestInit) => Promise<Response>;
export type BankAction = 'connect' | 'renew' | 'disconnect' | 'accounts' | 'sync';
/** Recheck eligibility at the click, independently of the last rendered clock tick. */
export function mutationAllowed(snapshot: Snapshot, role: Company['role'], action: BankAction, now = Date.now()): boolean {
  const checkedAt = Date.parse(snapshot.checkedAt), capability = action === 'accounts' ? snapshot.actions.selectAccounts : snapshot.actions[action];
  if (!['owner', 'admin'].includes(role) || !capability || !Number.isFinite(now) || !Number.isFinite(checkedAt) || now - checkedAt > 300000 || checkedAt - now > 30000) return false;
  const connection = snapshot.connection;
  if (action === 'connect') return !connection || connection.status === 'revoked';
  if (!connection || connection.companyId !== snapshot.companyId || connection.status === 'revoked') return false;
  if (action === 'renew' || action === 'disconnect') return true;
  if (connection.status !== 'active' || !connection.validUntil || Date.parse(connection.validUntil) <= now) return false;
  if (action === 'accounts') return true;
  if (!snapshot.accounts.some(account => account.selected && account.importable) || ['queued', 'running', 'blocked'].includes(snapshot.sync.state)) return false;
  return snapshot.sync.nextAllowedAt === null || Number.isFinite(Date.parse(snapshot.sync.nextAllowedAt)) && Date.parse(snapshot.sync.nextAllowedAt) <= now;
}

/** This client intentionally knows no provider credentials or external URLs. */
export function createOnboardingClient(fetcher: Fetcher = (path, options) => fetch(path, options)) {
  const base = (companyId: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(companyId)) throw new OnboardingError('invalid');
    return `/api/companies/${companyId}`;
  };
  async function request(path: string, signal?: AbortSignal, mutation?: { body: unknown; csrfToken: string }, missingDirectory = false): Promise<unknown | null> {
    if (mutation && (typeof mutation.csrfToken !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(mutation.csrfToken))) throw new OnboardingError('invalid');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    // Bound both transport and JSON reads, even if a transport ignores abort.
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => { reject(new DOMException('Aborted', 'AbortError')); controller.abort(); };
      signal?.addEventListener('abort', abort, { once: true });
      timeout = setTimeout(() => { reject(new OnboardingError('unavailable')); controller.abort(); }, 20000);
    });
    async function perform() {
      const response = await fetcher(path, {
        method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: mutation ? { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': mutation.csrfToken, 'Idempotency-Key': crypto.randomUUID() } : { 'Accept': 'application/json' },
        body: mutation ? JSON.stringify(mutation.body) : undefined,
      });
      if (response.status === 404 && missingDirectory) return null;
      if (!response.ok) {
        const kind = response.status === 401 ? 'signin' : [403, 404].includes(response.status) ? 'forbidden' : response.status === 409 ? 'conflict' : response.status === 429 ? 'rate_limited' : 'unavailable';
        throw new OnboardingError(kind);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) throw new OnboardingError('invalid');
      const value: unknown = await response.json().catch(() => { throw new OnboardingError('invalid'); });
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'error')) throw new OnboardingError('invalid');
      return value;
    }
    try {
      return await Promise.race([perform(), interrupted]);
    } catch (error) {
      if (error instanceof OnboardingError || error instanceof Error && error.name === 'AbortError') throw error;
      throw new OnboardingError('unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    directory(signal?: AbortSignal): Promise<unknown | null> { return request('/api/companies', signal, undefined, true); },
    async snapshot(companyId: string, signal?: AbortSignal): Promise<unknown> { return request(`${base(companyId)}/bank-onboarding`, signal); },
    createCompany(body: unknown, csrfToken: string, signal?: AbortSignal): Promise<unknown> { return request('/api/companies', signal, { body, csrfToken }); },
    async mutate(companyId: string, action: BankAction, body: unknown, csrfToken: string, signal?: AbortSignal): Promise<unknown> {
      if (!['connect', 'renew', 'disconnect', 'accounts', 'sync'].includes(action)) throw new OnboardingError('invalid');
      return request(`${base(companyId)}/bank/${action}`, signal, { body, csrfToken });
    },
  };
}
