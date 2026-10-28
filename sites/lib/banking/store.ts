import { env } from 'cloudflare:workers';
import { db } from '@/lib/server';
import { randomToken, seal, unseal, digest } from './security';
import type { ProviderApplication, ProviderAccount, ProviderConfig } from './enable-banking';
import { runtimeBankConfig, runtimeBankStatus } from './runtime-config';

export type BankApplicationRow = {
  owner: string; application_id: string; encrypted_key: string; metadata: string;
  generation: string; created_at: string; updated_at: string;
};
export type BankConnectionRow = {
  id: string; owner: string; app_generation: string; environment: 'SANDBOX' | 'PRODUCTION';
  bank_name: string; country: string; encrypted_session: string; encrypted_accounts: string;
  selected_accounts: string; valid_until: string; date_from: string; status: string;
  last_synced_at: string | null; last_error: string | null; created_at: string; updated_at: string;
  auto_sync_enabled: number; auto_last_attempt_at: string | null; auto_next_at: string | null;
  control_last_attempt_at: string | null;
  retry_after: string; sync_failures: number;
};
export type BankFlowRow = {
  state_hash: string; owner: string; cookie_hash: string; app_generation: string;
  bank_name: string; country: string; environment: 'SANDBOX' | 'PRODUCTION';
  redirect_uri: string; date_from: string; expires_at: string; status: string; created_at: string;
};

function secret(): string {
  const value = (env as unknown as Record<string, unknown>).BANK_DATA_ENCRYPTION_KEY;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('BANK_STORAGE_UNAVAILABLE');
  return value;
}
export function storageReady(): boolean { try { secret(); return true; } catch { return false; } }
export const encrypt = (owner: string, purpose: string, value: unknown) => seal(secret(), owner, purpose, value);
export const decrypt = <T>(owner: string, purpose: string, value: string) => unseal<T>(secret(), owner, purpose, value);
export const configurationStatus = () => runtimeBankStatus(env as unknown as Record<string, unknown>);

export async function application(owner: string): Promise<BankApplicationRow | null> {
  if (!configurationStatus().configured) return null;
  const config = runtimeBankConfig(env as unknown as Record<string, unknown>);
  const generation = await digest(`runtime-v1:${config.applicationId}:${config.environment}:${config.privateKeyPem}`);
  const stored = await db().prepare('SELECT * FROM bank_applications WHERE owner=?').bind(owner).first<BankApplicationRow>();
  if (stored?.generation === generation && stored.application_id === config.applicationId) return { ...stored, encrypted_key: '' };
  const at = new Date().toISOString();
  return { owner, application_id: config.applicationId, encrypted_key: '', generation, created_at: at, updated_at: at,
    metadata: JSON.stringify({ name: 'MG Fakturakoll', kid: config.applicationId, environment: config.environment, active: false, redirect_urls: [], countries: [], services: [] }) };
}
export async function connection(owner: string): Promise<BankConnectionRow | null> {
  return db().prepare('SELECT * FROM bank_connections WHERE owner=?').bind(owner).first<BankConnectionRow>();
}
export async function providerConfig(row: BankApplicationRow): Promise<ProviderConfig> {
  const config = runtimeBankConfig(env as unknown as Record<string, unknown>);
  const generation = await digest(`runtime-v1:${config.applicationId}:${config.environment}:${config.privateKeyPem}`);
  if (row.application_id !== config.applicationId || row.generation !== generation) throw new Error('BANK_RUNTIME_CONFIGURATION_CHANGED');
  return { applicationId: config.applicationId, privateKeyPem: config.privateKeyPem };
}
export async function saveApplicationMetadata(row: BankApplicationRow, info: ProviderApplication, lease?: BankLease): Promise<void> {
  const statement = db().prepare(`INSERT INTO bank_applications (owner,application_id,encrypted_key,metadata,generation,created_at,updated_at) VALUES (?,?,?, ?,?,?,?)
    ON CONFLICT(owner) DO UPDATE SET application_id=excluded.application_id,encrypted_key='',metadata=excluded.metadata,generation=excluded.generation,updated_at=excluded.updated_at`)
    .bind(row.owner, row.application_id, '', JSON.stringify(info), row.generation, row.created_at, new Date().toISOString());
  if (lease) await lease.run(statement); else await statement.run();
}
export function metadata(row: BankApplicationRow): ProviderApplication { return JSON.parse(row.metadata); }
export async function accounts(row: BankConnectionRow): Promise<ProviderAccount[]> {
  if (!row.encrypted_accounts) return [];
  return decrypt<ProviderAccount[]>(row.owner, `accounts:${row.id}`, row.encrypted_accounts);
}
export async function sessionId(row: BankConnectionRow): Promise<string> {
  return decrypt<string>(row.owner, `session:${row.id}`, row.encrypted_session);
}

// Serialize mutations for an owner, including callback, disconnect and sync.
// A crashed invocation cannot lock out the account permanently.
export type BankLease = { assert: () => Promise<void>; write: (statements: D1PreparedStatement[]) => Promise<D1Result[]>; run: (statement: D1PreparedStatement) => Promise<D1Result> };
export async function withBankLock<T>(owner: string, fn: (lease: BankLease) => Promise<T>): Promise<T> {
  const token = randomToken(), at = new Date().toISOString();
  const until = new Date(Date.now() + 10 * 60_000).toISOString();
  const result = await db().prepare(`INSERT INTO bank_locks (owner,token,expires_at) VALUES (?,?,?)
    ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE bank_locks.expires_at < ?`).bind(owner, token, until, at).run();
  if (result.meta.changes !== 1) throw new Error('BANK_BUSY');
  const lost = () => new Error('BANK_LEASE_LOST');
  const lease: BankLease = {
    async assert() { if (!await db().prepare("SELECT owner FROM bank_locks WHERE owner=? AND token=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(owner, token).first()) throw lost(); },
    async write(statements) {
      // The NOT NULL token constraint aborts this atomic batch before any write
      // if the lease expired or changed while waiting for D1's write lock.
      const fence = db().prepare("INSERT INTO bank_locks(owner,token,expires_at) VALUES(?,(SELECT token FROM bank_locks WHERE owner=? AND token=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')),?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token").bind(owner, owner, token, until);
      try { return (await db().batch([fence, ...statements])).slice(1); }
      catch (error) { await lease.assert(); throw error; }
    },
    async run(statement) { return (await lease.write([statement]))[0]; },
  };
  try { return await fn(lease); }
  finally { await db().prepare('DELETE FROM bank_locks WHERE owner=? AND token=?').bind(owner, token).run(); }
}
