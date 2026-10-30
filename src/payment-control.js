import {randomUUID} from 'node:crypto';

export const CONTROL_STEPS = [
  ['gmail', 'Hämta fakturaunderlag'], ['documents', 'Tolka och kontrollera fakturor'],
  ['bank', 'Hämta bankhändelser'], ['reconcile', 'Stäm av betalningar'],
  ['messages', 'Förbered mejlutkast']
];

/** Select only ready connections before applying the bound. Persisted attempts
 * rotate failing connections as well as successfully synchronized accounts. */
export function planBankControl(connections, {now = Date.now(), limit = 3} = {}) {
  const timestamp = value => value ? Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z') || 0 : 0;
  const eligible = connections.filter(c => ['connected', 'error'].includes(c.status) && c.selected_account_uid && Date.parse(c.valid_until) > now);
  const cached = eligible.filter(c => !(c.retry_after > now) && c.last_synced && now - timestamp(c.last_synced) < 60_000);
  const ready = eligible.filter(c => !(c.retry_after > now) && !cached.includes(c)).sort((a, b) =>
    (a.control_attempt_at || 0) - (b.control_attempt_at || 0) || timestamp(a.last_synced) - timestamp(b.last_synced) || a.id.localeCompare(b.id));
  return {selected: ready.slice(0, limit), cached: cached.length,
    waiting: eligible.length !== connections.length || eligible.some(c => c.retry_after > now) || ready.length > limit};
}
const fail = (message, status) => Object.assign(new Error(message), {status});
const stamp = now => new Date(now()).toISOString();
const resultStates = new Set(['done', 'cached', 'waiting', 'blocked']);

/** Durable orchestration only: no Gmail-send callback is accepted or called. */
export function createPaymentControl(db, {adapters, summarize, now = Date.now, cooldownMs = 60_000, leaseMs = 240_000}) {
  db.exec(`CREATE TABLE IF NOT EXISTS payment_control_runs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_id TEXT NOT NULL,
    status TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL,
    steps TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}', UNIQUE(owner,request_id));
    CREATE UNIQUE INDEX IF NOT EXISTS payment_control_one_active
    ON payment_control_runs(owner) WHERE status='running';
    CREATE TABLE IF NOT EXISTS payment_control_requests (
      owner TEXT NOT NULL, request_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES payment_control_runs(id), created_at TEXT NOT NULL,
      PRIMARY KEY(owner,request_id));
    INSERT OR IGNORE INTO payment_control_requests(owner,request_id,run_id,created_at)
      SELECT owner,request_id,id,started_at FROM payment_control_runs;`);
  const pending = new Map();
  let stopping = false;
  const unpack = row => row ? {id: row.id, status: row.status, started_at: row.started_at,
    updated_at: row.updated_at, finished_at: row.finished_at, steps: JSON.parse(row.steps), summary: JSON.parse(row.summary)} : null;

  function recover(owner) {
    for (const row of db.prepare("SELECT * FROM payment_control_runs WHERE owner=? AND status='running' AND lease_until<=?").all(owner, now())) {
      const steps = JSON.parse(row.steps).map(s => ['queued','running'].includes(s.state) ?
        {...s, state: 'interrupted', note: 'Kontrollen avbröts. Starta en ny kontroll; inga mejl har skickats.'} : s);
      db.prepare("UPDATE payment_control_runs SET status='interrupted',steps=?,updated_at=?,finished_at=? WHERE id=? AND status='running' AND lease_until<=?")
        .run(JSON.stringify(steps), stamp(now), stamp(now), row.id, now());
    }
  }
  function latest(owner) {
    if (!owner) throw fail('Logga in för att se betalningskontrollen.', 401);
    recover(owner);
    return unpack(db.prepare('SELECT * FROM payment_control_runs WHERE owner=? ORDER BY rowid DESC LIMIT 1').get(owner));
  }
  function get(owner, id) {
    if (!owner) throw fail('Logga in för att se betalningskontrollen.', 401);
    recover(owner);
    const row = db.prepare('SELECT * FROM payment_control_runs WHERE id=? AND owner=?').get(id, owner);
    if (!row) throw fail('Kontrollen saknas.', 404);
    return unpack(row);
  }
  function active(id) {
    const row = db.prepare('SELECT status,lease_until FROM payment_control_runs WHERE id=?').get(id);
    return !stopping && row?.status === 'running' && row.lease_until > now();
  }
  async function execute(id, owner, authorize) {
    const row = db.prepare('SELECT * FROM payment_control_runs WHERE id=? AND owner=?').get(id, owner);
    const steps = JSON.parse(row.steps);
    const guard = () => {
      authorize();
      if (!active(id)) throw fail('Kontrollen är inte längre aktiv.', 409);
    };
    const save = () => db.prepare("UPDATE payment_control_runs SET steps=?,updated_at=?,lease_until=? WHERE id=? AND status='running'")
      .run(JSON.stringify(steps), stamp(now), now() + leaseMs, id);
    const timer = setInterval(() => {
      if (active(id)) db.prepare("UPDATE payment_control_runs SET lease_until=? WHERE id=? AND status='running'").run(now() + leaseMs, id);
    }, Math.min(15_000, leaseMs / 3));
    timer.unref?.();
    try {
      for (const step of steps) {
        guard(); step.state = 'running'; save();
        try {
          const value = await adapters[step.id]({owner, authorize: guard});
          guard();
          if (!value || !resultStates.has(value.state)) throw Error('Invalid step response');
          step.state = value.state;
          // Adapter notes are application-controlled. Never persist provider payloads.
          step.note = String(value.note || '').slice(0, 400);
          if (Number.isSafeInteger(value.count) && value.count >= 0) step.count = value.count;
          if (value.next_at && Number.isFinite(Date.parse(value.next_at))) step.next_at = value.next_at;
        } catch (error) {
          if ([401,403].includes(error.status) || !active(id)) throw error;
          step.state = error.status === 429 || error.status === 409 ? 'waiting' : 'error';
          step.note = step.state === 'waiting' ? 'Hämtningen väntar eller en annan åtgärd pågår. Befintliga uppgifter bevaras.' :
            'Det här steget kunde inte slutföras. Öppna anslutningen eller underlaget för kontroll.';
          if (error.status === 429 && Number.isFinite(error.retryAfter)) step.next_at = new Date(now() + Math.max(60,error.retryAfter)*1000).toISOString();
        }
        save();
      }
      guard();
      const summary = summarize();
      const status = steps.some(s => !['done','cached'].includes(s.state)) ? 'partial' : 'complete';
      db.prepare("UPDATE payment_control_runs SET status=?,summary=?,updated_at=?,finished_at=?,lease_until=0 WHERE id=? AND status='running'")
        .run(status, JSON.stringify(summary), stamp(now), stamp(now), id);
    } catch {
      for (const s of steps) if (['queued','running'].includes(s.state)) {
        s.state = 'interrupted'; s.note = 'Kontrollen stoppades. Logga in och kontrollera status innan du startar igen.';
      }
      db.prepare("UPDATE payment_control_runs SET status='interrupted',steps=?,updated_at=?,finished_at=?,lease_until=0 WHERE id=? AND status='running'")
        .run(JSON.stringify(steps), stamp(now), stamp(now), id);
    } finally {clearInterval(timer);}
  }
  function start(owner, requestId, authorize) {
    if (!owner) throw fail('Logga in för att starta betalningskontrollen.', 401);
    if (stopping) throw fail('Servern stängs av. Försök igen efter omstart.', 503);
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) throw fail('Ogiltig kontrollidentifierare.', 400);
    authorize();
    db.exec('BEGIN IMMEDIATE');
    let job, reused = false;
    try {
      recover(owner);
      const receipt = db.prepare('SELECT run_id FROM payment_control_requests WHERE owner=? AND request_id=?').get(owner, requestId);
      const same = receipt ? db.prepare('SELECT * FROM payment_control_runs WHERE owner=? AND id=?').get(owner, receipt.run_id) :
        db.prepare('SELECT * FROM payment_control_runs WHERE owner=? AND request_id=?').get(owner, requestId);
      if (receipt && !same) throw fail('Kontrollens tidigare kvitto kunde inte verifieras. Starta inte samma begäran igen innan historiken har kontrollerats.', 409);
      const running = db.prepare("SELECT * FROM payment_control_runs WHERE owner=? AND status='running'").get(owner);
      const recent = db.prepare('SELECT * FROM payment_control_runs WHERE owner=? ORDER BY rowid DESC LIMIT 1').get(owner);
      const useRecent = recent && now() - Date.parse(recent.started_at) < cooldownMs;
      if (same || running || useRecent) {job = unpack(same || running || recent); reused = true;}
      else {
        const id = randomUUID(), time = stamp(now);
        db.prepare("INSERT INTO payment_control_runs(id,owner,request_id,status,started_at,updated_at,lease_until,steps) VALUES(?,?,?,'running',?,?,?,?)")
          .run(id, owner, requestId, time, time, now()+leaseMs, JSON.stringify(CONTROL_STEPS.map(([key,title]) => ({id:key,title,state:'queued',note:''}))));
        job = unpack(db.prepare('SELECT * FROM payment_control_runs WHERE id=?').get(id));
      }
      // Every accepted ID is a durable receipt, including aliases to an active
      // or recently finished run. Commit it with the run before scheduling work.
      db.prepare('INSERT OR IGNORE INTO payment_control_requests(owner,request_id,run_id,created_at) VALUES(?,?,?,?)')
        .run(owner, requestId, job.id, stamp(now));
      db.exec('COMMIT');
    } catch (error) {db.exec('ROLLBACK');throw error;}
    if (!reused) {
      const task = Promise.resolve().then(() => execute(job.id, owner, authorize)).finally(() => pending.delete(job.id));
      pending.set(job.id, task);
    }
    return {job, reused};
  }
  return {start, get, latest, wait: id => pending.get(id) || Promise.resolve(), stop: () => {stopping = true;}};
}
