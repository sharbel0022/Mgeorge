/** The browser accepts only explicit, company-scoped facts from the server. */
export type Permission = 'accounts:read' | 'transactions:read' | 'bankgiro:read';
export type Company = { id: string; name: string; organizationNumber: string; role: 'owner' | 'admin' | 'viewer' };
export type Directory = { version: 1; csrfToken: string; canCreate: boolean; companies: Company[] };
export type Bank = { id: string; name: string; country: string; providerLabel: string; available: boolean; authorization: 'redirect' | 'decoupled' | 'separate' | 'unavailable'; supportedPermissions: Permission[]; requiredPermissions: Permission[]; maximumConsentSeconds: number | null; bankgiro: 'included' | 'separate' | 'unsupported' | 'unknown'; unavailableReason: 'unsupported_bank' | 'provider_unavailable' | 'separate_agreement' | 'configuration_required' | null };
export type Authorization = { id: string; companyId: string; mode: 'redirect' | 'decoupled'; state: 'pending' | 'completed' | 'cancelled' | 'failed'; expiresAt: string; redirectPath: string | null };
export type Snapshot = {
  version: 1; companyId: string; revision: number; checkedAt: string; environment: 'production' | 'sandbox';
  actions: { connect: boolean; renew: boolean; disconnect: boolean; selectAccounts: boolean; sync: boolean };
  banks: Bank[];
  connection: { id: string; companyId: string; bankId: string; bankName: string; status: 'active' | 'pending' | 'expired' | 'revoked' | 'error'; validUntil: string | null; permissions: Permission[]; revocationStatus?: 'confirmed' | 'pending' | 'unknown' } | null;
  accounts: { id: string; companyId: string; name: string; maskedNumber: string; currency: string; selected: boolean; importable: boolean }[];
  sync: { state: 'never' | 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked'; automaticEnabled: boolean; lastSuccessAt: string | null; nextAllowedAt: string | null; errorCode: string | null };
  bankgiro: { state: 'available' | 'pending' | 'separate_agreement' | 'unsupported' | 'unknown' | 'expired'; lastSuccessAt: string | null; nextAllowedAt: string | null; validUntil: string | null };
  authorization: Authorization | null;
  payments: { id: string; companyId: string; date: string; amountMinor: number; currency: string; payerName: string | null; reference: { value: string; kind: 'ocr' | 'payment' | 'invoice'; source: 'bank_account' | 'bankgiro_report' } | null; verification: { status: 'verified' | 'review' | 'unverified'; evidenceId: string | null; reason: 'missing_bankgiro' | 'missing_reference' | 'missing_payer' | 'conflict' | 'pending_review' | null } }[];
  paymentsHasMore: boolean; manualImportPath: string | null;
};

type ObjectValue = Record<string, unknown>;
function invalid(): never { throw new Error('Ogiltigt svar från tjänsten.'); }
function object(value: unknown): ObjectValue { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as ObjectValue; }
function string(value: unknown, max = 200): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value; }
function id(value: unknown): string { const result = string(value, 128); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result)) invalid(); return result; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(); return value; }
function choice<T extends string>(value: unknown, options: readonly T[]): T { if (typeof value !== 'string' || !options.includes(value as T)) invalid(); return value as T; }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value === null ? null : parse(value); }
function array<T>(value: unknown, parse: (value: unknown) => T, maximum = 100): T[] { if (!Array.isArray(value) || value.length > maximum) invalid(); return value.map(parse); }
function unique<T>(items: T[], identity: (item: T) => string): T[] { const ids = items.map(identity); if (new Set(ids).size !== ids.length) invalid(); return items; }
function calendarDate(value: unknown): string { const result = string(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) invalid(); return result; }
function timestamp(value: unknown): string {
  const result = string(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result)) invalid();
  calendarDate(result.slice(0, 10));
  const time = Date.parse(result);
  if (!Number.isFinite(time) || Number(result.slice(11, 13)) > 23 || Number(result.slice(14, 16)) > 59 || Number(result.slice(17, 19)) > 59) invalid();
  return result;
}
function companyScope(value: unknown, expected: string): string { const parsed = id(value); if (parsed !== expected) invalid(); return parsed; }
const permissionValues = ['accounts:read', 'transactions:read', 'bankgiro:read'] as const;
function permissions(value: unknown): Permission[] { return unique(array(value, item => choice(item, permissionValues), 3), item => item); }
function currency(value: unknown): string { const parsed = string(value, 3); if (!/^[A-Z]{3}$/.test(parsed)) invalid(); return parsed; }
function safeCode(value: unknown): string { const parsed = string(value, 64); if (!/^[a-z][a-z0-9_]{0,63}$/.test(parsed)) invalid(); return parsed; }
function version(value: unknown): 1 { if (value !== 1) invalid(); return 1; }

export function parseCompany(input: unknown): Company {
  const value = object(input), organizationNumber = string(value.organizationNumber, 11);
  if (!/^\d{6}-?\d{4}$/.test(organizationNumber)) invalid();
  return { id: id(value.id), name: string(value.name), organizationNumber, role: choice(value.role, ['owner', 'admin', 'viewer']) };
}
export function parseDirectory(input: unknown): Directory {
  const value = object(input);
  const csrfToken = string(value.csrfToken, 512);
  if (!/^[\x21-\x7e]{16,512}$/.test(csrfToken)) invalid();
  return { version: version(value.version), csrfToken, canCreate: boolean(value.canCreate), companies: unique(array(value.companies, parseCompany), item => item.id) };
}
function parseBank(input: unknown): Bank {
  const value = object(input), country = string(value.country, 2);
  if (!/^[A-Z]{2}$/.test(country)) invalid();
  const supportedPermissions = permissions(value.supportedPermissions), requiredPermissions = permissions(value.requiredPermissions);
  if (requiredPermissions.some(permission => !supportedPermissions.includes(permission))) invalid();
  return { id: id(value.id), name: string(value.name), country, providerLabel: string(value.providerLabel), available: boolean(value.available), authorization: choice(value.authorization, ['redirect', 'decoupled', 'separate', 'unavailable']), supportedPermissions, requiredPermissions, maximumConsentSeconds: nullable(value.maximumConsentSeconds, raw => integer(raw, 1, 366 * 86400)), bankgiro: choice(value.bankgiro, ['included', 'separate', 'unsupported', 'unknown']), unavailableReason: nullable(value.unavailableReason, reason => choice(reason, ['unsupported_bank', 'provider_unavailable', 'separate_agreement', 'configuration_required'])) };
}
function authorization(input: unknown, companyId: string, now: number, handoff: boolean): Authorization {
  const value = object(input), authorizationId = id(value.id), mode = choice(value.mode, ['redirect', 'decoupled']), state = choice(value.state, ['pending', 'completed', 'cancelled', 'failed']);
  const expiresAt = timestamp(value.expiresAt), redirectPath = nullable(value.redirectPath, path => string(path, 512));
  companyScope(value.companyId, companyId);
  if (state === 'pending' && Date.parse(expiresAt) > now + 20 * 60000) invalid();
  if (handoff && (state !== 'pending' || Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 20 * 60000)) invalid();
  if (state === 'pending' && mode === 'redirect') { if (redirectPath !== `/api/companies/${companyId}/bank/authorizations/${authorizationId}/redirect`) invalid(); }
  else if (redirectPath !== null) invalid();
  return { id: authorizationId, companyId, mode, state, expiresAt, redirectPath };
}
export function parseAuthorization(input: unknown, companyId: string, now = Date.now()): { version: 1; companyId: string; authorization: Authorization } {
  id(companyId); if (!Number.isFinite(now)) invalid();
  const value = object(input);
  return { version: version(value.version), companyId: companyScope(value.companyId, companyId), authorization: authorization(value.authorization, companyId, now, true) };
}
export function parseSnapshot(input: unknown, companyId: string, now = Date.now()): Snapshot {
  id(companyId); if (!Number.isFinite(now)) invalid();
  const value = object(input), actions = object(value.actions), sync = object(value.sync), bankgiro = object(value.bankgiro);
  const connection = value.connection === null ? null : (() => {
    const item = object(value.connection);
    return { id: id(item.id), companyId: companyScope(item.companyId, companyId), bankId: id(item.bankId), bankName: string(item.bankName), status: choice(item.status, ['active', 'pending', 'expired', 'revoked', 'error'] as const), validUntil: nullable(item.validUntil, timestamp), permissions: permissions(item.permissions), ...(item.revocationStatus === undefined ? {} : { revocationStatus: choice(item.revocationStatus, ['confirmed', 'pending', 'unknown'] as const) }) };
  })();
  const accounts = unique(array(value.accounts, raw => { const item = object(raw); return { id: id(item.id), companyId: companyScope(item.companyId, companyId), name: string(item.name), maskedNumber: string(item.maskedNumber, 80), currency: currency(item.currency), selected: boolean(item.selected), importable: boolean(item.importable) }; }), item => item.id);
  if (!connection && accounts.some(account => account.selected)) invalid();
  const payments = unique(array(value.payments, raw => {
    const item = object(raw), verification = object(item.verification);
    const status = choice(verification.status, ['verified', 'review', 'unverified'] as const), evidenceId = nullable(verification.evidenceId, id), reason = nullable(verification.reason, raw => choice(raw, ['missing_bankgiro', 'missing_reference', 'missing_payer', 'conflict', 'pending_review'] as const));
    if (status === 'verified' && (!evidenceId || reason !== null)) invalid();
    const reference = item.reference === null ? null : (() => { const reference = object(item.reference); return { value: string(reference.value), kind: choice(reference.kind, ['ocr', 'payment', 'invoice'] as const), source: choice(reference.source, ['bank_account', 'bankgiro_report'] as const) }; })();
    return { id: id(item.id), companyId: companyScope(item.companyId, companyId), date: calendarDate(item.date), amountMinor: integer(item.amountMinor, Number.MIN_SAFE_INTEGER), currency: currency(item.currency), payerName: nullable(item.payerName, string), reference, verification: { status, evidenceId, reason } };
  }), item => item.id);
  const manualImportPath = nullable(value.manualImportPath, path => string(path, 256));
  if (manualImportPath !== null && manualImportPath !== `/companies/${companyId}/imports`) invalid();
  const result: Snapshot = { version: version(value.version), companyId: companyScope(value.companyId, companyId), revision: integer(value.revision), checkedAt: timestamp(value.checkedAt), environment: choice(value.environment, ['production', 'sandbox']), actions: { connect: boolean(actions.connect), renew: boolean(actions.renew), disconnect: boolean(actions.disconnect), selectAccounts: boolean(actions.selectAccounts), sync: boolean(actions.sync) }, banks: unique(array(value.banks, parseBank, 200), item => item.id), connection, accounts, sync: { state: choice(sync.state, ['never', 'queued', 'running', 'succeeded', 'failed', 'blocked']), automaticEnabled: boolean(sync.automaticEnabled), lastSuccessAt: nullable(sync.lastSuccessAt, timestamp), nextAllowedAt: nullable(sync.nextAllowedAt, timestamp), errorCode: nullable(sync.errorCode, safeCode) }, bankgiro: { state: choice(bankgiro.state, ['available', 'pending', 'separate_agreement', 'unsupported', 'unknown', 'expired']), lastSuccessAt: nullable(bankgiro.lastSuccessAt, timestamp), nextAllowedAt: nullable(bankgiro.nextAllowedAt, timestamp), validUntil: nullable(bankgiro.validUntil, timestamp) }, authorization: value.authorization === null ? null : authorization(value.authorization, companyId, now, false), payments, paymentsHasMore: boolean(value.paymentsHasMore), manualImportPath };
  if (!freshSnapshot(result, now)) invalid();
  for (const success of [result.sync.lastSuccessAt, result.bankgiro.lastSuccessAt]) { if (success !== null && Date.parse(success) > now + 30000) invalid(); }
  return result;
}
export function freshSnapshot(snapshot: Snapshot, now = Date.now()): boolean { const checkedAt = Date.parse(snapshot.checkedAt); return Number.isFinite(now) && Number.isFinite(checkedAt) && now - checkedAt <= 300000 && checkedAt - now <= 30000; }
export function activeConsent(snapshot: Snapshot, now = Date.now()): boolean { return freshSnapshot(snapshot, now) && snapshot.connection?.companyId === snapshot.companyId && snapshot.connection.status === 'active' && snapshot.connection.validUntil !== null && Date.parse(snapshot.connection.validUntil) > now; }
export function selectedPermissions(bank: Bank, values: string[]): Permission[] {
  const parsed = parseBank(bank), selected = permissions(values);
  if (!selected.length || !parsed.available || !['redirect', 'decoupled'].includes(parsed.authorization) || selected.some(value => !parsed.supportedPermissions.includes(value)) || parsed.requiredPermissions.some(value => !selected.includes(value))) invalid();
  return selected;
}
export function callbackMessage(result: string | null, snapshot: Snapshot | null, now = Date.now()): string | null {
  if (result === 'connected') return snapshot && freshSnapshot(snapshot, now) && activeConsent(snapshot, now) && snapshot.authorization?.state === 'completed' && snapshot.authorization.companyId === snapshot.companyId ? 'Banken har bekräftat företagets anslutning.' : null;
  switch (result) {
    case 'cancelled': return 'Bankens identifiering avbröts. Du kan starta en ny anslutning.';
    case 'failed': return 'Bankens identifiering misslyckades. Kontrollera status och försök igen.';
    case 'expired': return 'Tiden för bankens identifiering har gått ut. Starta en ny anslutning.';
    case 'wrong_user': return 'Bankens identifiering kunde inte kopplas till din användare. Försök igen med rätt användare.';
    case 'signin_required': return 'Logga in igen för att kontrollera bankanslutningen.';
    default: return null;
  }
}
export function dateLabel(value: string | null): string { if (value === null) return 'Inte tillgängligt'; const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(time) : 'Inte tillgängligt'; }
export const permissionLabels: Record<Permission, { label: string; description: string }> = {
  'accounts:read': { label: 'Läsa konton', description: 'Se de företagskonton som banken delar efter ditt medgivande.' },
  'transactions:read': { label: 'Läsa transaktioner', description: 'Hämta kontohändelser för de konton du väljer.' },
  'bankgiro:read': { label: 'Läsa bankgirounderlag', description: 'Hämta bankgirounderlag när banken och företagsavtalet stöder det.' },
};
