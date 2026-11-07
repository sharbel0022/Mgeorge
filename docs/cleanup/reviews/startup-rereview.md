# Task 3 scoped re-review — round 1

Reviewed the supplied fix diff from `0bdc2fc` through `be943c3abcc8ac5221a82e1204b4fb4860fbf4ae`, the implementer's fix report, and the added regression cases against the original three findings retained from the independent review. This was a read-only review of implementation changes; no full suites or builds were rerun and no remote/production operation occurred.

**Spec verdict for the reviewed fixes: PASS. Code-quality verdict for the reviewed fixes: PASS. No remaining blocker found in this diff.**

| Original finding | Verdict | Evidence in the fix |
| --- | --- | --- |
| P2: stop releases ownership while the installer still runs | **ADDRESSED** | `scripts/start/index.mjs` retains the installation promise and abort controller; shutdown aborts and awaits installation settlement before stopping the API/releasing ownership. `common.mjs` terminates the retained npm child, applies a bounded force fallback, and settles on child close. Setup also connects authenticated stop/signals to cancellation and releases in its sequential finally. The new regression verifies delayed installer termination, retained ownership, competing-start refusal, successful stop and unrelated-process survival. |
| P2: incomplete/dripping HTTP responses evade readiness bounds | **ADDRESSED** | `request()` now enforces an absolute timer independent of socket activity, settles once, handles response abort/error/premature close, and destroys failed resources. Launcher calls cap each request and retry delay by the remaining startup budget. Direct HTTP tests cover drip, truncation, byte limits and valid responses; command-level tests cover readiness and stop against dripping endpoints. |
| P2: JSON DB_PATH escaping corrupts persisted configuration | **ADDRESSED** | `dotenvValue()` accepts a representation only when Node's actual parser returns exactly the intended key/value, otherwise rejects before configuration creation. Function-based replacement also preserves literal replacement metacharacters. Regression cases cover Windows backslashes, embedded quotes, spaces and `$&`, plus failure without writes for an unsupported path. |

The changes remain localized and preserve the existing ownership/authentication approach. No new actionable correctness regression was found in the scoped diff.

The implementer reports final exact-source focused results of **26/26 on Node 22.23.4 and 26/26 on Node 24.22.1**, plus a clean diff check. These are implementer evidence, not independently rerun results. Native Windows process behavior remains unverified, as previously documented; parser round-trip coverage on both Node versions addresses the specific DB_PATH defect. Final integrated checks and facade wiring remain the coordinator's responsibility.
