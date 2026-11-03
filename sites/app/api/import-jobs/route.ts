import { env } from 'cloudflare:workers';
import { db, identity, response, failure } from '@/lib/server';
import { readImportJobStatuses } from '@/lib/import-job-overview';

export const dynamic = 'force-dynamic';

/** Owner-only read. It never runs a job or accepts a client-selected owner. */
export async function GET() {
  try {
    const user = await identity();
    const config = env as unknown as Record<string, string>;
    return response(await readImportJobStatuses(db(), user.userId, {
      bankgiroConfiguration:config.BANKGIRO_SOURCE_CONFIG,bankgiroSecrets:env as unknown as Record<string,unknown>,
      backupEnabled: config.BACKUP_ENABLED === 'true',
      backupConfigured: !!env.BUCKET && /^[a-f0-9]{64}$/i.test(config.BACKUP_ENCRYPTION_KEY || ''),
    }));
  } catch (error) {
    return failure(error);
  }
}
