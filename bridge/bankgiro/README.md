# Bankgiro SFTP delivery bridge

This isolated Node service implements **our normalized report protocol**. It is not a Swedbank or Bankgiro API implementation, format certification, bank authorization, or payment service. No bank hostname, credentials, customer report, deployable registration, or production configuration is included. Production remains disabled until the bank/channel/profile, company, Bankgiro relation, read entitlement and acceptance evidence are actually verified.

It downloads through authenticated, host-key-pinned, read-only SFTP, retains exact originals in a private durable spool, and serves authenticated HTTP on **127.0.0.1 only**. Deploy an approved HTTPS reverse proxy on the same host for external clients. The application HTTPS registry must separately bind the real TLS origin/path and credential; browser input must never set these values. HTTP GETs only read retained state and never connect to SFTP. The isolated test suite also imports the actual shared HTTPS adapter, so its authorization/list/content contract is verified against the real SSH/SFTP and HTTP bridge rather than duplicate fixture schemas.

## Install and run

Linux/POSIX, Node >=22.13, a private local persistent filesystem supporting SQLite locks, hard links and directory fsync are required. Network filesystems and ephemeral container filesystems are unsupported. The built-in `node:sqlite` exclusive transaction supplies cross-process writer ownership and releases safely on process death; Node22 may print its standard experimental-API warning. It stores no report rows or credentials in SQLite.

From `bridge/bankgiro`:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm audit --omit=dev --audit-level=high
npm start
```

`npm start` requires the private configuration path and credentials described below. It defaults to no configuration; missing or invalid configuration exits with a safe `BRIDGE_START_FAILED` code. No source becomes enabled by installation. Explicit `synthetic:true` or `mode:'synthetic'` source or entitlement markers are rejected before opening the spool or contacting SFTP. `BRIDGE_READY` only means that the local HTTP listener started; it does not mean the bank source is authorized or reports imported.

Run as a dedicated unprivileged OS user, with `umask 077`, a private persistent volume, and no public access to the loopback HTTP port. Terminate with SIGTERM/SIGINT for orderly connection/server/lock shutdown. Service supervision may restart the same process; the service's internal bounded poll loop uses no external schedule and does not modify the application's existing scheduler.

## Private configuration

Set `BANKGIRO_BRIDGE_CONFIG` to an absolute JSON file owned by the service user with mode0600 (or stricter), with no symlink path components. The service never accepts configuration via HTTP. No actual configuration is committed.

| JSON field | Required meaning / bound |
| --- | --- |
| `enabled` | Explicit boolean. Keep `false` until actual bank evidence and acceptance permit activation. |
| `spoolDirectory` | Absolute private persistent directory; created0700 or existing owner-only directory. New scope/identity/upstream binding needs a separate spool. |
| `binding.owner`, `binding.sourceId` | Exact server-owned owner/source registration identifiers. |
| `binding.companyId` | Exact internal legal-entity key; do not invent an organization number. |
| `binding.bankgiro` | Bank-confirmed canonical7–8 digits, kept as text. |
| `binding.scopeId`, `binding.generation` | Exact scope and opaque nonempty generation string (1–500 characters, no control characters); never coerce a number into the wire contract. |
| `binding.profileId` | Exact verified delivery profile identifier. Naming a profile does not certify a format. |
| `entitlement.status`, `entitlement.origin` | Must be `VERIFIED` and `provider_authorization`; only populate from actual authorized evidence. AIS/manual evidence does not establish report entitlement. |
| `entitlement.evidenceId` | Actual retained authorization evidence identifier. |
| `entitlement.checkedAt`, `entitlement.validUntil` | Valid date strings, proof checked in the past and not expired. Expiry gates every SFTP operation and journal publication. |
| `entitlement.capabilities` | Must contain `bankgiro_reports:read`. No payment capability is used. |
| `sftp.host`, `sftp.port`, `sftp.username` | Actual verified SFTP endpoint and read-only user. No defaults or discovery. |
| `sftp.hostKeySha256` | Mandatory lowercase64-hex SHA256 of the SSH public key's raw SSH wire bytes (`ssh2` `hostHash:'sha256'`). Obtain through an independently authenticated bank/provider channel. No trust on first use or automatic key rotation. |
| `sftp.remoteDirectory` | Exact absolute canonical non-root POSIX directory. Every ancestor must be a directory without symlinks. No recursion. |
| `sftp.privateKeyFile` | Optional absolute private key file owned by the service user,0600 or stricter, without symlink path components. Select either this or the password environment binding. |
| `allowedFormats` | Explicit extension allowlist drawn from `csv`, `xml`, `xlsx`, `txt`, `dat`. No format is inferred or converted; use only extensions accepted by the separately approved application parser/profile. |
| `maxFileBytes` | Default15000000;1–15000000. Empty files are rejected. |
| `maxEntries` | Default1000;1–10000 non-dot entries per full scan, before publication. Unbounded/repeated listings fail closed. Each non-EOF page, including an empty page after literal dot entries are filtered, counts against a separate `maxEntries + 1` page budget; empty pages do not imply EOF. |
| `maxJournalEntries` | Default100000;1–1000000. Exhaustion blocks further publication; no automatic retention deletion. |
| `operationTimeoutMs` | Default10000;100–60000. Covers each callback, including disconnects that never call back. |
| `scanTimeoutMs` | Default120000;100–1800000. Whole-scan deadline; a failed scan cannot renew authorization. |
| `pollIntervalMs` | CLI only; default60000;30000–240000 after each completed scan. Choose scan/interval limits that keep healthy authorization within five minutes. |
| `http.port` | CLI only; default8788;0–65535 (0 asks OS for an ephemeral loopback port). |
| `http.host` | Optional, only `127.0.0.1` accepted. Public listeners require the separate HTTPS proxy. |

Credentials are read only from these private paths/environment bindings:

| Binding | Purpose |
| --- | --- |
| `BANKGIRO_BRIDGE_BEARER_TOKEN_FILE` **or** `BANKGIRO_BRIDGE_BEARER_TOKEN` | Exactly one.32–256 printable non-space ASCII characters. File may end with one newline; owned by service user,0600 or stricter. Use a high-entropy server credential. |
| `BANKGIRO_BRIDGE_SFTP_PASSWORD` **or** JSON `sftp.privateKeyFile` | Exactly one upstream authentication method. No anonymous/agent/interactive fallback. |
| `BANKGIRO_BRIDGE_SFTP_PASSPHRASE` | Optional key passphrase, only with private-key authentication. |

Raw `bearerToken`, `password`, `privateKey` or `passphrase` JSON keys are rejected. Never place secrets on command-line arguments, in the repository, HTTP URLs or logs. Pin changes require independently verified evidence, a deliberate binding/scope decision and a new spool; never repoint an existing spool to a different authority.

## Normalized HTTP v1 contract

Every request requires `Authorization: Bearer <server credential>`. Wrong/missing credentials return401 before any state is exposed. GET is the only method; other methods return405. Responses set `Cache-Control:no-store`; there is no CORS grant. HTTPS must terminate at the approved local reverse proxy; do not forward credentials over an untrusted plaintext network.

| Endpoint | Response |
| --- | --- |
| `GET /v1/authorization` | `{status:'VERIFIED',owner,sourceId,companyId,bankgiro,scopeId,generation,profileId,evidenceId,checkedAt,validUntil,origin:'provider_authorization',capabilities:['bankgiro_reports:read']}`. Binding fields match configuration exactly. `checkedAt` is the last completely successful authenticated SFTP scan; it must be at most five minutes old. The entitlement's own expiry remains authoritative. Startup/restart, failed scan, disabled source, or expired receipt cannot claim fresh authorization. |
| `GET /v1/reports?cursor=...&limit=...` | `{reports:[{reportId,filename,sha256,byteLength,availableAt}],nextCursor}`. Default/max limit50. Cursor is an opaque-to-client decimal discovery sequence, never a filename/date. Initial empty list returns`'0'`; empty later pages retain their checkpoint, so delayed old-dated files remain discoverable. Unknown/future/invalid cursors return400. |
| `GET /v1/reports/{opaque-report-id}/content` | Exact retained bytes, fixed `Content-Length`, application/octet-stream. No per-report download URL or remote path is accepted. Every read rechecks exact length/SHA256; corrupt bytes return503. |

The source is unavailable503 until a successful scan. Disabled/expired entitlement returns403. Unknown report/path returns404. A remote filename whose bytes change retains the same report ID and appends a new sequence event with the changed hash. Both originals remain immutable. Content for that identity returns409 `REPORT_HASH_CONFLICT`, including after restart; it cannot silently substitute a newer original. The application's ingest queue must retain its existing identity/hash conflict checks and hash deduplication. Renames are new deliveries with the same original hash, allowing the application's existing deduplication to prevent duplicate economic effects.

Only safe codes appear on HTTP/log errors. Upstream messages, credentials and paths are not copied into responses. Authorization/list/content require current authority, while the durable spool remains intact when upstream authority is unavailable. An HTTP client cannot write, import, allocate, move/delete remote files or start a scan.

## Durability and recovery

`binding.json` binds the spool to exact owner/source/company/Bankgiro/scope/generation/profile, formats, endpoint/user/pinned key and remote directory. Delivery identity uses a separate versioned namespace: SHA256 of the JSON array `["bankgiro-delivery-namespace",1,owner,sourceId,scopeId,companyId,bankgiro]` in exactly that canonical order. The opaque report ID hashes `["bankgiro-delivery-id",1,deliveryNamespaceHash,remoteBasename]`. Generation/profile/transport changes do not change an existing scoped delivery ID; changed bytes remain visible under the same ID so application scope/reportId conflict checks survive authorization renewal. A different canonical namespace produces a different ID. The full spool binding still includes generation, profile, formats and all upstream identity fields, so a changed configuration requires a new spool even when delivery identity stays stable. Version2 `binding.json` records both hashes. Pre-release version1 spools fail closed and retain their originals; they are never silently rekeyed or migrated. Preserve that evidence and use a new spool for this unreleased format change. Sequence event files are immutable, contiguous and atomically published only after their SHA-addressed blob is fsynced and read back. Temp writes use exclusive creation, then no-replace hard linking, readback and directory fsync. Blobs/events are0400; directories0700. Full committed journal and blob integrity is checked at startup; damaged, missing, foreign or inconsistent evidence fails closed.

Per-attempt cancellation, upstream disconnection, entitlement and the whole-scan deadline gate atomic blob/event links, completion after each durable publication and the final authorization refresh. An abort after a completed atomic journal link preserves that complete verified event for restart/replay, but cannot create fresh authorization. A killed process releases the SQLite OS lock. Complete events replay once, incomplete private temp writes are discarded, and unreferenced completed blobs remain preserved. Next scan retries from the remote original; no remote acknowledgement, rename, move, truncation or delete occurs. Late files get a new sequence even with old timestamps. A filesystem error after an event's atomic publication may require process restart to reload its committed state. Keep the durable volume and original configuration; do not delete a spool/lock to bypass binding or integrity errors. Capacity planning and separately verified backup/recovery are deployment responsibilities; there is no automatic pruning or production restore action here.

SFTP accepts only bounded ASCII basenames and configured extensions. It rejects symlinks, traversal, repeated names, nonregular files, canonical-path escapes, oversized/empty/partial/extra streams, handle/path metadata changes and operation/scan timeouts. Size,mode,mtime,uid,gid and canonical paths are checked before/after the handle read; local final bytes are hashed and read back before exposure. SFTPv3 exposes no portable inode identity or atomic `O_NOFOLLOW` open, so it cannot prove the absence of a malicious same-metadata path swap between remote checks. Production therefore also requires a bank/provider-controlled immutable publication directory and a confined read-only account; bank-specific atomic delivery/completeness guarantees must be confirmed during acceptance. The bridge does not claim to certify a hostile authenticated server or a proprietary bank format.

## Package evidence

Pinned production dependency:`ssh2@1.17.0`; all transitives/integrities are captured in this package's own lockfile. Root and Sites dependencies are untouched. Optional native install scripts are disabled; the tested pure-JavaScript transport path works without them.

Primary API references: [official ssh2 README](https://github.com/mscdex/ssh2#readme), [official SFTP API](https://github.com/mscdex/ssh2/blob/master/SFTP.md), [official npm package](https://www.npmjs.com/package/ssh2). `npm view ssh2 version --json` returned`1.17.0` on2026-11-03. The installed version's primary README/SFTP docs were also inspected: `hostHash`/`hostVerifier`, `sftp`, handle-based bounded `opendir`/`readdir`, `lstat`, `realpath`, read-only `open`, `fstat`, `read`, `close`, server protocol handlers and disconnect behavior. In1.17.0 a handle READDIR EOF is status-code1, so the bridge maps that exact EOF without swallowing other errors. The library bounds incoming SFTP packets at256KiB.

Tests use real in-process SSH/SFTP servers over loopback, ephemeral native-generated RSA host keys held only in memory, real durable files, real HTTP listeners, a spawned CLI process and SIGKILL/restart. No test private keys, actual bank fixtures, secrets or production registrations are committed. Tests deliberately avoid the library's randomized OpenSSH test-key generator, whose generated ED25519 private keys occasionally failed its own parser in local characterization; production host identity is pinned, and malformed upstream client keys fail closed.
