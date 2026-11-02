/** Enable Banking dates are inclusive UTC dates, independent of the UI timezone.
 * Ninety days is our bounded request size, not a claimed bank retention limit.
 */
const DAY = 86_400_000;
export type BankPeriod = { dateFrom: string; dateTo: string };
export type BankFetchBudget = { requests: number; rows: number };
export class BankPeriodError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export function bankUtcDate(at = Date.now()): string { return new Date(at).toISOString().slice(0, 10); }
function day(value: string): number {
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
  if (!Number.isFinite(parsed) || bankUtcDate(parsed) !== value || value < '2000-01-01') throw new BankPeriodError('BANK_DATE_RANGE_INVALID', 'Bankperioden innehåller ett ogiltigt datum. Kontrollera startdatumet.');
  return parsed;
}
function checkedPeriod(dateFrom: string, dateTo: string): [number, number] {
  const from = day(dateFrom), to = day(dateTo);
  if (from > to || dateTo > bankUtcDate()) throw new BankPeriodError('BANK_DATE_RANGE_INVALID', 'Välj en bankperiod där startdatumet inte är efter slutdatumet eller dagens UTC-datum.');
  return [from, to];
}
export function bankSyncRange(dateFrom: string, lastSynced: string | null, dateTo = bankUtcDate()): BankPeriod {
  checkedPeriod(dateFrom, dateTo);
  if (!lastSynced) return {dateFrom, dateTo};
  const at = Date.parse(lastSynced);
  if (!Number.isFinite(at) || bankUtcDate(at) > dateTo) throw new BankPeriodError('BANK_DATE_RANGE_INVALID', 'Senaste bankhämtningens tidpunkt är ogiltig. Kontrollera anslutningen innan hämtningen fortsätter.');
  const overlap = bankUtcDate(day(bankUtcDate(at)) - 3 * DAY);
  return {dateFrom: overlap > dateFrom ? overlap : dateFrom, dateTo};
}

type Page<T> = { transactions: T[]; continuation_key?: string | null };
type PeriodInput<T> = BankPeriod & {
  budget: BankFetchBudget;
  authorize: () => Promise<void>;
  isPeriodError: (error: unknown) => boolean;
  fetchPage: (input: BankPeriod & {continuationKey?: string}) => Promise<Page<T>>;
};

/** All requested windows must finish before anything can be returned for import.
 * A rejected window restarts from its original beginning with a fresh cursor.
 * Never fall back to `longest`: it ignores date_to and can silently trim history.
 */
export async function fetchBankPeriods<T>(input: PeriodInput<T>): Promise<(BankPeriod & {transactions: T[]})[]> {
  const [first, last] = checkedPeriod(input.dateFrom, input.dateTo);
  const result: (BankPeriod & {transactions: T[]})[] = [];
  let start = first, width = 90, adjustments = 0;
  while (start <= last) {
    const end = Math.min(last, start + (width - 1) * DAY);
    const period = {dateFrom: bankUtcDate(start), dateTo: bankUtcDate(end)};
    const transactions: T[] = [], seen = new Set<string>();
    let continuationKey: string | undefined;
    try {
      do {
        await input.authorize();
        if (input.budget.requests >= 25) throw new BankPeriodError('BANK_SYNC_LIMIT', 'Bankperioden kunde inte hämtas inom gränsen för 25 anrop. Inga nya händelser sparades. Välj en kortare period och försök igen när banken tillåter det.');
        input.budget.requests++;
        const page = await input.fetchPage({...period, ...(continuationKey ? {continuationKey} : {})});
        await input.authorize();
        if (!page || !Array.isArray(page.transactions)) throw new BankPeriodError('BANK_INVALID_RESPONSE', 'Banken lämnade ett ogiltigt svar. Inga nya bankhändelser sparades.');
        input.budget.rows += page.transactions.length;
        if (input.budget.rows > 1000) throw new BankPeriodError('BANK_SYNC_LIMIT', 'Perioden innehåller fler än 1 000 bankhändelser. Välj en kortare period. Inga nya bankhändelser sparades.');
        transactions.push(...page.transactions);
        const cursor = page.continuation_key;
        if (cursor !== undefined && cursor !== null && cursor !== '') {
          if (typeof cursor !== 'string' || cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(cursor) || seen.has(cursor)) throw new BankPeriodError('BANK_INVALID_RESPONSE', 'Bankens sidindelning kunde inte slutföras. Inga nya bankhändelser sparades.');
          seen.add(cursor); continuationKey = cursor;
        } else continuationKey = undefined;
      } while (continuationKey);
    } catch (error) {
      if (!input.isPeriodError(error)) throw error;
      const days = Math.round((end - start) / DAY) + 1;
      if (days <= 1 || adjustments >= 6) throw new BankPeriodError('BANK_PERIOD_UNAVAILABLE', `Banken kan inte lämna perioden ${period.dateFrom}–${period.dateTo}, även efter försök med kortare intervall. Inga nya bankhändelser sparades och tidigare historik finns kvar. Kontrollera medgivandets historikåtkomst eller importera den saknade perioden från bankfil.`);
      width = Math.max(1, Math.floor(days / 2)); adjustments++;
      continue;
    }
    result.push({...period, transactions});
    start = end + DAY;
  }
  return result;
}
