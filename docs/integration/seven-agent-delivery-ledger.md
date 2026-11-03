# Seven-agent combined delivery ledger

The implementation brief is the user-provided seven-agent completion task of 2026-11-02. All financial acceptance reads are read-only; all write tests use isolated synthetic data. The final scoped results and production limits are recorded in [the final delivery receipt](../MGEORGE-SEVEN-AGENT-FINAL-DELIVERY.md).

## Execution and gates

- [x] Read current main, all six producer PRs, released contracts and current production status.
- [x] Normal merge PR27 at70c61267e049c29b6e2fb6a5a2bb658c3b029693; main CI41541298113 success.
- [x] Stage PR25,26,29,28(updated58e40a2),30 in one isolated integration branch; preserve original commits and both sides of conflicting tests.
- [x] Resolve migration collision:0016 account guard;0017 Bankgiro queue; update both Node/Sites consumers and snapshot chain.
- [x] C1/C4 trusted server-policy mapping, canonical ownership aliases and directional customer/supplier scope.
- [x] C2/C5 atomic bank/job completion, terminal fencing, independent afterchecks, lost-reply and cleanup recovery.
- [x] C1/C6 intended reference/source/block reason, real C3 status panel, valid formal OCR only.
- [x] C3 acknowledgement preserves source-wide429 embargo.
- [x] Seven joined new-producer acceptance cases pass; migration upgrade preserves workspace payload.
- [x] Align active automatic eligibility with invoice-original and partial/excess review requirements; manual/history preserved.
- [x] Bind C3 queue/source conflict and authority changes into C4 holds/snapshot and active writer eligibility, with atomic source race fences.
- [x] Fresh Node1563/Sites2980/type/audit gates and independent review; production build passed (exit0 / Build complete).
- [x] Normal integration PR31 and UI follow-up PR32; exact PR/main CI succeeded, final runtime93312189/mainCI41550351322.
- [x] Exact-main Sites subtree97b5de1 published as Sites59/source503448c; deploymentappgdep_6ae9260a23f88191ae8f2380cf5c14c2 succeeded. Read-only revision43/zero-allocation comparisons passed.
- [x] Final receipt,20-head ancestry inventory, verified Git bundle/isolated clone recovery; deletion unavailable through authorized interface, all histories preserved.

## Conflict matrix

| Producers | Shared boundary | Integration ruling |
| --- | --- | --- |
| C1/C2 | Node db/server; bank test fixtures | Preserve policy and bank final guards; generic fixture scope remains explicit. |
| C2/C3 | schema, migration0016 and metadata | Keep two separate additive migrations in order; no financial seed records. |
| C2/C5 | bank service catch, terminal job lease, atomic commit | Lease owns transaction; recovery reads commit receipt before lease assertion; preserve provider cooldown and failure audit. |
| C1/C4 | exact reference, preserved-original aliases, company config | Reuse trusted C1 selector and bounded canonical aliases; no browser policy injection. |
| C1/C6 | presentation/dashboard/tests | Show policy-derived intended reference; preserve bank-reported OCR independently. |
| C3/C6 | two status panels | One read-only report availability panel in dashboard; bank connection page retains its own panel. |
| C3/C5 | report transport capability vs preparation contract | Production source remains disabled; no invented capability, timestamp or parallel timer. |
| C3/C4 | retained competing originals/source authority | Owner-scoped source/identity holds and snapshot; authority/hash/status changes bind the active D1 commit. |
| C4/legacy active auto | strict preview vs previous writer eligibility | Exact remaining amount, scoped retained invoice original and source gates; manual/history preserved. |

## Verification history

Initial main baseline on Node24.22.1:1309 Node and2337 Sites passed, no failures/skips/cancellations. Exact producer heads also have successful Node22 GitHub CI. Early combined Node run had545 failures due the renamed migration still referenced from Node bootstrap; fixed and focused Node ingest15/15 plus Sites migration/ingest41/41 pass. Earlier UI full run crossed Stockholm midnight and exposed bank test fixtures using business dates against UTC provider bounds; explicit UTC fixtures plus deterministic boundary regression95/95 pass. These earlier red runs are not final acceptance.

Pre-delivery production baseline:Sites57/source12ece026c917a87c2b53f5feb02af488e35e40d1; runtime revision9; DB/R2 and existing three schedules retained. Selected0599 reads at workspace revision43:one economic AIS record, one separate non-economic report, zero allocations; account and deposit relation unproved; no registered invoice. These are pre-delivery observations. Post59:backup267/267 verified, Gmail00:00UTC run completed and fetch00:00:35.642Z;240review/2registered/24waitingOCR at00:10UTC. Cloud completion remains18:48UTC and freshness unverified.

No numeric quality increase is justified yet:255/330=7.73,0/33 at9.5. A successful internal synthetic source is not real bank authorization.

Final local suites1563+2980 pass,0fail/skip/cancel/todo. Independent review of the earlier runtime7164a2c closes all Critical/Important findings. Full-site preflight2963/2965 exposed one stale formal-OCR assertion and one new-component isolation alias; both corrected without removing original provenance/positive-formal controls. Native GitHub Git Data publication is used because terminal Git has no GitHub write credential; root-tree parity and producer parents were verified before normal PR31/32 merges. Final Node22 mainCI confirms1563+2980=4543,0fail/skip/cancel/todo. Documentation closeout changes no runtime/Sites files.
