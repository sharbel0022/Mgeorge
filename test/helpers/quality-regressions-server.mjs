// Child-process harness: real production HTTP server and disk SQLite, with only
// a synthetic approved account. No external provider request is permitted.
import { approveSyntheticBankAccount } from '../bank-fixtures.js';

Object.assign(process.env, {
  NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', DB_PATH: process.argv[2],
  SESSION_SECRET: '1'.repeat(64), BANK_DATA_KEY: '3'.repeat(64),
});
for (const key of Object.keys(process.env)) {
  if (/^(GOOGLE_|ENABLE_BANKING_|ENABLEBANKING_|MG_ADMIN_PASSWORD|ENCRYPTION_KEY)/.test(key)) delete process.env[key];
}
globalThis.fetch = async () => { throw new Error('External network is prohibited in the quality regression fixture'); };

const { server, db } = await import('../../src/server.js');
if (!db.prepare('SELECT id FROM bank_connections WHERE id = ?').get('synthetic-bank')) {
  approveSyntheticBankAccount(db, 'SE4280000890119146168423');
  db.prepare('UPDATE bank_connections SET owner = ? WHERE id = ?').run('local-admin', 'synthetic-bank');
}
server.listen(0, '127.0.0.1', () => process.send?.({ ready: true, port: server.address().port }));
process.on('message', message => {
  if (message === 'stop') {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }
});
