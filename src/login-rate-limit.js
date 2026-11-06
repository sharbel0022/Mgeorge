const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

function throttled(until, now) {
  return Object.assign(new Error('För många inloggningsförsök. Försök igen senare.'), {
    status: 429,
    code: 'login_rate_limited',
    retryAfter: Math.max(1, Math.min(900, Math.ceil((until - now) / 1000))),
  });
}

/** The self-hosted HTTPS server has one administrator login. Its budget is
 * account-wide, shared by processes, and independent of untrusted IP headers.
 * Only a fixed account label, count and expiry are retained; no credentials or
 * peer addresses are stored. This table belongs in the control database. */
export function createLoginRateLimiter(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS login_rate_limits(
    account TEXT PRIMARY KEY CHECK(account='administrator'),
    attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 5),
    window_ends_at INTEGER NOT NULL
  )`);
  const read = db.prepare("SELECT attempts,window_ends_at FROM login_rate_limits WHERE account='administrator'");
  const reserve = db.prepare(`INSERT INTO login_rate_limits(account,attempts,window_ends_at)
    VALUES('administrator',1,?)
    ON CONFLICT(account) DO UPDATE SET
      attempts=CASE WHEN window_ends_at<=? THEN 1 ELSE attempts+1 END,
      window_ends_at=CASE WHEN window_ends_at<=? THEN excluded.window_ends_at ELSE window_ends_at END
    WHERE window_ends_at<=? OR attempts<?
    RETURNING attempts`);
  const clear = db.prepare("DELETE FROM login_rate_limits WHERE account='administrator'");
  return {
    check() {
      const at = now(), row = read.get();
      if (row?.window_ends_at > at && row.attempts >= MAX_ATTEMPTS) throw throttled(row.window_ends_at, at);
    },
    reserve() {
      const at = now();
      // One SQLite statement reserves the slot: separate server processes
      // cannot both observe and consume the last available attempt.
      if (!reserve.get(at + WINDOW_MS, at, at, at, MAX_ATTEMPTS)) {
        throw throttled(read.get()?.window_ends_at ?? at, at);
      }
    },
    clear() { clear.run(); },
  };
}
