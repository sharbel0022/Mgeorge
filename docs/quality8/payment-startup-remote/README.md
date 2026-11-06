# SQLite startup contention candidate

The existing five-second busy timeout now takes effect before WAL initialization. The timeout value, WAL, foreign keys, schema, import/allocation rules and original concurrency test bodies are unchanged. Worker diagnostics retain at most8 KiB of stderr and include exit/signal after streams close.

The added regression uses an already migrated synthetic WAL database, holds a real exclusive lock through the contender's terminal result, checks the actual connection timeout and elapsed wait, then releases/rolls back and verifies integrity, original bytes and unchanged financial rows. There is no sleep, retry loop or increased timeout.

The test and its locally observed RED were frozen before the product change. [Original results and recovery scope](RED-RECEIPT.json) link the exact rescued test patch. Local baseline was Node24.22.1; CI uses Node22.23.4. Full local raw logs remain in the unavailable execution environment. The earlier main CI failure did not capture child stderr, so this reproduced defect is not proof of that failure's exact cause.

At creation, no GREEN result is claimed. Independent review and full exact-head PR/main CI remain required. Site66 remains published; the attempted archive upload could not run without the primary execution environment. No bank/account/consent, production DB/R2 or schedule changes are part of this candidate.
