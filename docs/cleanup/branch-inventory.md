# Branch cleanup inventory

Generated: 2026-11-07T11:16:37.782478+00:00.

This report classifies all **80** remote branch heads from the cached GitHub inventory using the local Git graph. No remote mutation was performed.

Comparison: `origin/main` resolved once to `4c7b210a0553314c2d9ce95804b892b891f4fe36`. Cached remote inventory began 2026-11-07T10:46:49.529Z. No remote ref refresh was performed for this bounded follow-up.

## Result

- Graph ancestors of main: **62**.
- Nonancestor heads: **18**.
- Unknown graph results: **0**.
- Conditional deletion candidates: **59**; each requires a fresh unchanged-head check and confirmation that no collaborator is actively using the branch.
- Keep `main` and known interrupted WIP `feature/95-saas`.
- The historical recovery branch is **archive eligible after a durable bundle covering its exact head is verified**, not intrinsically a permanent branch.

| Category | Count |
|---|---:|
| already integrated | 58 |
| unique approved | 0 |
| unapproved experimental | 18 |
| duplicate | 2 |
| active | 1 |
| no longer needed | 1 |

## Definitions and limits

- **already integrated:** Exact tip is an ancestor of the frozen main commit; main itself must be retained.
- **unique approved:** Nonancestor tip exactly matches a merged PR head; accepted by merge, with content equivalence and formal approving-review status not established.
- **unapproved experimental:** Nonancestor or unknown tip without verified exact-tip acceptance; classification means approval and activity are unverified, not that experimental intent is proved.
- **duplicate:** Exact tip equals another current branch tip. Nonancestor duplicates remain on hold.
- **active:** Known interrupted WIP or an open PR; retain.
- **no longer needed:** Conditional category for the historical recovery branch: archive eligible only after a durable bundle covering its exact head is verified.

Graph uniqueness does not prove unique product behavior: squash/cherry-pick integration can preserve changes without ancestry. Formal review approval and current collaborator activity are not inferred from a merged or absent PR. Current tips that advanced after a merged PR remain on hold unless the exact current tip is proven to be an ancestor of main.

Observed 79 local archive tags. Prior remote matching-refs for the expected archive prefix returned `[]`. No durable bundle restoration was independently verified in this follow-up.

## All recorded branch heads

| Branch | Exact head | Ancestor | Unique commits | Exact-tip merged PR | Category | Disposition |
|---|---|---|---:|---|---|---|
| `main` | `4c7b210a0553314c2d9ce95804b892b891f4fe36` | yes | 0 | none | already integrated | retain_main |
| `checkpoint/gmail-0600-observation-20261106-5cd67b18` | `5cd67b18792505139234de68533516fc33067ace` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/gmail-0700-observation-20261106-1ec960d9` | `1ec960d9de4f896f7f481bfdc0e0fc9cc47337fa` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/gmail-next-run-diagnostic-20261106-0611` | `fe7195ae1d6ffeb6ac52c37131c6b062f7c9f24d` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/ocr-analysis-recovery-20261106-0532` | `d5e9451ceff439ff7ae60799de58e8ff00971eb8` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/ocr-capacity-diagnosis-20261106-d5ae148f` | `d5ae148f4847e87b30e2e084494e3f44765afc27` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/payment-startup-recovery-20261106-053654` | `77d4fcf8a506a03ed03393a89be07f3d5e886e8d` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/pr60-cancellation-final-20261106-0648` | `520e22716c6298e4d24ccf3989e87cfe563d8d14` | yes | 0 | #60 | duplicate | deletion_candidate_after_final_checks |
| `checkpoint/pr60-ci-recovery-20261106-060352` | `93b39c641a542cf8add015b63b253de2926059e5` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/pr60-final-ci-520e2271-20261106-070909` | `2bf147fd2688313128e64028ebc4300472100794` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/rating8-current-20261106-wave6` | `c57c694d1baf58777b23b1f4d1b21f41a947d5a7` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/rating8-interruption-20261106-0529` | `3a2184929aaf65bfa67ac7426cf8045f2cbda8a9` | yes | 0 | none | already integrated | deletion_candidate_after_final_checks |
| `checkpoint/rating8-status-20261106-0621` | `c1525814ea6e5b41ec0e4176fb30715cc5343b29` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/startup-cancellation-fix-20261106-064156` | `165e8181e24b812901136a11b31d7b0bc21de3be` | yes | 0 | none | already integrated | deletion_candidate_after_final_checks |
| `checkpoint/startup-cancellation-red-20261106-063435` | `f0e845bb87ee08d15fa96cb75879849493aeb1fd` | yes | 0 | none | already integrated | deletion_candidate_after_final_checks |
| `checkpoint/startup-cancellation-red-f0e845bb-20261106-44c52893` | `44c5289383f23d2cc8e9f4d00f1ba2dc1297bb44` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/startup-main-ci-20261106` | `abe08e383a1838c545fba13a4cf367998900ad89` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/startup-review-20261106` | `819bc206f7c21c0f6f8ce0a490c36fbfb4047579` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/startup-review-followup-20261106` | `955fcb98333c36e54f7e3e580f7fd70a5ae21292` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `checkpoint/wave5-ci-recovery-20261106-6848bdc1` | `6848bdc1fdb98c98405caca67fafd2e3a203d752` | no | 1 | none | unapproved experimental | hold_unverified_work |
| `codex/backup-security-stabilization-20261102` | `bb4d40333e252ebd7067515cf2c9ba8e72419f7e` | yes | 0 | #15 | already integrated | deletion_candidate_after_final_checks |
| `codex/bankgiro-source-readiness-20261103` | `944fe16f864b55b3762b31ff808bded9d6e34c16` | yes | 0 | #34 | already integrated | deletion_candidate_after_final_checks |
| `codex/bankgiro-source-readiness-receipt-20261103` | `fd81177aad47e0a17341189b3f2197c05653e7e7` | yes | 0 | #35 | already integrated | deletion_candidate_after_final_checks |
| `codex/final-ui-quality-2026-11-02` | `72ce0daa891fccffc1d9112c3c8c45fa6901c672` | yes | 0 | #17 | already integrated | deletion_candidate_after_final_checks |
| `codex/ocr-quality-20261102` | `8b87098ebd899cc6f118fcb43a5aca4dcb12db42` | yes | 0 | #19 | already integrated | deletion_candidate_after_final_checks |
| `codex/rating8-reliability-20261105` | `e42b05a8b78e77a3210be00da0b0231454a29233` | yes | 0 | #48 | already integrated | deletion_candidate_after_final_checks |
| `codex/saas-master-integration-20261104` | `0d977408d79921c15a46035540159b3cb7bdca86` | no | 2 | none | unapproved experimental | hold_unverified_work |
| `codex/seven-agent-contracts-20261102` | `75418773829e49e99bf7db64c34e8e0ba8577af2` | yes | 0 | #22 | already integrated | deletion_candidate_after_final_checks |
| `codex/seven-agent-delivery-20261102` | `b86efe8adabc79b2feba419fbd307faaa7da390e` | yes | 0 | #31 | already integrated | deletion_candidate_after_final_checks |
| `codex/seven-agent-final-receipt-20261102` | `00a994625ff65239777e8d40aae79e7645074966` | yes | 0 | #24 | already integrated | deletion_candidate_after_final_checks |
| `codex/seven-agent-final-receipt-20261103` | `668a952f83bb327bf6787f907d58995604cfce01` | yes | 0 | #33 | already integrated | deletion_candidate_after_final_checks |
| `codex/seven-agent-integration-report-20261102` | `15f259d1ef46f28fbecf66d522ac70054cf2e6b4` | yes | 0 | #23 | already integrated | deletion_candidate_after_final_checks |
| `codex/six-pr-deployment-receipt-20261102` | `914e4ef03ac689e43f48f0bcdcc96a389ef9ac6c` | yes | 0 | #21 | already integrated | deletion_candidate_after_final_checks |
| `codex/six-pr-integration-acceptance-20261102` | `a34cbf53e275d093719b8565d19093dd093a8ef3` | yes | 0 | #20 | already integrated | deletion_candidate_after_final_checks |
| `docs/saas-final-report-20261105` | `ed88684964f1a8969d780c5aa94ec83ca95b9c34` | yes | 0 | #44 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-bank` | `ac1abdc5469248eba212496af4a4573864908ace` | yes | 0 | #45 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-bank-recovery` | `9529701a11f0511c7df4beaf80cd3975c9f27e5a` | yes | 0 | #65 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-bankgiro` | `7d3bcb5ef533c39c9e23714e61709c924384ffb8` | yes | 0 | #46 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-bankgiro-reconciliation` | `7cbcba72cd114d0ff19798ee47495cb546d07bc1` | yes | 0 | #68 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-document-automation` | `b2178405a684ca2cb95cf91153071c5f7736f3cb` | yes | 0 | #67 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-document-automation-gmail` | `a15eb18df8aa6540397a8997fe5524610fc9d91c` | no | 2 | none | unapproved experimental | hold_unverified_work |
| `feature/95-integration` | `03f84afd61bb1020e73c17c3cde332a1b07f55a0` | yes | 0 | #49 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-ocr` | `eb4242f783172ac441f9092f921b04b06dc11771` | yes | 0 | #52 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-openai-invoices` | `ce6fa6158c30b9fb64eac35d74f653be4ae9f568` | yes | 0 | #64 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-quality` | `875876ae539f5ecba1fc39d4c213197806e245ce` | yes | 0 | #47 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-reconciliation` | `0954777f10da8be9fb15daf3878c539b51801142` | yes | 0 | #51 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-saas` | `1619c0e3a63b922c75a7f46d493d39e68075952f` | yes | 0 | #50 | active | retain_active_or_interrupted_work |
| `feature/95-saas-readiness` | `c85f2375f97ea0191f9fbe64cd4190d869aebfaf` | yes | 0 | #66 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-security` | `3db9f01305aa6830a4c2d1cc01970c06b91018c2` | yes | 0 | #54 | already integrated | deletion_candidate_after_final_checks |
| `feature/95-ui` | `d6646dd0971650878738f81215d0cfc5c04a1da3` | yes | 0 | #55 | already integrated | deletion_candidate_after_final_checks |
| `feature/final-95-completion` | `861e70875f96e6de8eb1f641b8b59f0b8e1c9efe` | no | 3 | none | unapproved experimental | hold_unverified_work |
| `feature/final-95-recovery` | `ebbea9c67f174a6879f1e638633cc53e728282e2` | yes | 0 | #61 | already integrated | deletion_candidate_after_final_checks |
| `feature/mgeorge-automation-orchestration` | `b219d63a27c759019ccef937e0b557dfa3c03e7a` | yes | 0 | #29 | already integrated | deletion_candidate_after_final_checks |
| `feature/mgeorge-bankgiro-auto-ingest` | `5c9b51bc12c0c7b37df07b0c8061e9b6313189f6` | yes | 0 | #26 | already integrated | deletion_candidate_after_final_checks |
| `feature/mgeorge-invoice-reference-policy` | `5fada91427ee49d98897802eeb7a2aeede73fbf7` | yes | 0 | #27 | already integrated | deletion_candidate_after_final_checks |
| `feature/mgeorge-payment-ui` | `089ac0b8585d2a0c69c3537b510d3fec5291be50` | yes | 0 | #30 | already integrated | deletion_candidate_after_final_checks |
| `feature/mgeorge-safe-auto-reconciliation` | `58e40a21eb459e2191d7b19b458326459a09e5d6` | yes | 0 | #28 | already integrated | deletion_candidate_after_final_checks |
| `feature/mgeorge-swedbank-account-evidence` | `9dcf038567102514a14774b301cfa0078274b31b` | yes | 0 | #25 | already integrated | deletion_candidate_after_final_checks |
| `feature/rating8-bank-failure-diagnostic-20261106` | `501de72c079a6b41593356f027990bc24b0aac8c` | yes | 0 | #59 | already integrated | deletion_candidate_after_final_checks |
| `feature/rating8-release-wave2-20261105` | `d638f5e195711c3011816618f1899dc535c24120` | yes | 0 | #56 | already integrated | deletion_candidate_after_final_checks |
| `feature/rating8-reviewed-geometry-retry-20261106` | `f488841afccdefba17a6b584320347581f60c3f4` | yes | 0 | #58 | already integrated | deletion_candidate_after_final_checks |
| `feature/rating8-reviewed-parser-bank-diagnostics-20261105` | `c90ed82c73bb566e54cb70eec14dae4ad9848361` | yes | 0 | #57 | already integrated | deletion_candidate_after_final_checks |
| `feature/rating8-sqlite-startup-20261106` | `520e22716c6298e4d24ccf3989e87cfe563d8d14` | yes | 0 | #60 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-bank-consent` | `2eab8683db7e4ece1292b4c1f68c500af2f7e128` | yes | 0 | #39 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-bank-sync-reconciliation` | `6e3895218c719ad01a9382b360624d693a7a841f` | yes | 0 | #42 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-bankgiro-enrichment` | `86730fe47aab8736c6cfb04d672c5e04a10d473d` | yes | 0 | #41 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-customer-onboarding-ui` | `a3b2b944428af5b4fbe31856e0f7076f3637405a` | yes | 0 | #38 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-multitenant-foundation` | `1d7dc21f0d61d98c239f51eb778facd79b6a6aed` | yes | 0 | #40 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-openpayments-provider` | `bbd19a5a891ae44d05af8c59aac5e4de21292ace` | yes | 0 | #36 | already integrated | deletion_candidate_after_final_checks |
| `feature/saas-security-acceptance` | `3215d40b559b5cb60daf068fd197054e809e5f83` | yes | 0 | #37 | already integrated | deletion_candidate_after_final_checks |
| `fix/95-decimal-reference` | `d9ca037a90ef9c9e629f62c4dcbf9cfcdeacb459` | yes | 0 | #53 | already integrated | deletion_candidate_after_final_checks |
| `fix/enable-consent-compat-20261105` | `ab941744c3ee38be7ecd4c3121b8e7496082b9ab` | yes | 0 | #43 | already integrated | deletion_candidate_after_final_checks |
| `fix/gmail-document-automation-20261102` | `d3566fdc90857517330127eef7f9d7911849e06a` | yes | 0 | #18 | already integrated | deletion_candidate_after_final_checks |
| `fix/payment-0599-bankgiro-verification-20261102` | `493365c7e20cd86639ecae32ca8acfddd7aec363` | yes | 0 | #14 | already integrated | deletion_candidate_after_final_checks |
| `fix/seven-agent-selected-proposal` | `dc0a05c99319c77e11876f5a0ac19cc1af39e7f2` | yes | 0 | #32 | already integrated | deletion_candidate_after_final_checks |
| `fix/startup-cancellation-red-20261106-0643` | `f0e845bb87ee08d15fa96cb75879849493aeb1fd` | yes | 0 | none | duplicate | deletion_candidate_after_final_checks |
| `fix/swedbank-sync-date-recovery` | `b5c923c6612020044063da2b07c2f0dcdcb8f482` | yes | 0 | #16 | already integrated | deletion_candidate_after_final_checks |
| `integration/mgeorge-final-95` | `9b15b6c50b291fe5614cb4ff116e6e17763aef82` | yes | 0 | #63 | already integrated | deletion_candidate_after_final_checks |
| `recovery/main-before-final-integration-20261107` | `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8` | yes | 0 | none | no longer needed | archive_eligible_after_verified_bundle |
| `review/final95-ai-guards` | `38d731c0993ad0c4708d2571a9a18a342f5eb672` | yes | 0 | #69 | already integrated | deletion_candidate_after_final_checks |

## Branches requiring retention, archive verification or integration review

### `checkpoint/gmail-0600-observation-20261106-5cd67b18`

- Head: `5cd67b18792505139234de68533516fc33067ace`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/gmail-0700-observation-20261106-1ec960d9`

- Head: `1ec960d9de4f896f7f481bfdc0e0fc9cc47337fa`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/gmail-next-run-diagnostic-20261106-0611`

- Head: `fe7195ae1d6ffeb6ac52c37131c6b062f7c9f24d`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/ocr-analysis-recovery-20261106-0532`

- Head: `d5e9451ceff439ff7ae60799de58e8ff00971eb8`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/ocr-capacity-diagnosis-20261106-d5ae148f`

- Head: `d5ae148f4847e87b30e2e084494e3f44765afc27`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/payment-startup-recovery-20261106-053654`

- Head: `77d4fcf8a506a03ed03393a89be07f3d5e886e8d`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/pr60-ci-recovery-20261106-060352`

- Head: `93b39c641a542cf8add015b63b253de2926059e5`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/pr60-final-ci-520e2271-20261106-070909`

- Head: `2bf147fd2688313128e64028ebc4300472100794`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/rating8-current-20261106-wave6`

- Head: `c57c694d1baf58777b23b1f4d1b21f41a947d5a7`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/rating8-status-20261106-0621`

- Head: `c1525814ea6e5b41ec0e4176fb30715cc5343b29`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/startup-cancellation-red-f0e845bb-20261106-44c52893`

- Head: `44c5289383f23d2cc8e9f4d00f1ba2dc1297bb44`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/startup-main-ci-20261106`

- Head: `abe08e383a1838c545fba13a4cf367998900ad89`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/startup-review-20261106`

- Head: `819bc206f7c21c0f6f8ce0a490c36fbfb4047579`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/startup-review-followup-20261106`

- Head: `955fcb98333c36e54f7e3e580f7fd70a5ae21292`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `checkpoint/wave5-ci-recovery-20261106-6848bdc1`

- Head: `6848bdc1fdb98c98405caca67fafd2e3a203d752`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `codex/saas-master-integration-20261104`

- Head: `0d977408d79921c15a46035540159b3cb7bdca86`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `feature/final-95-completion`

- Head: `861e70875f96e6de8eb1f641b8b59f0b8e1c9efe`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- Current tip changed from the latest merged PR head; do not infer current-tip acceptance from that older PR.

### `feature/95-document-automation-gmail`

- Head: `a15eb18df8aa6540397a8997fe5524610fc9d91c`.
- Category: **unapproved experimental**; disposition: `hold_unverified_work`.
- Current tip has no verified exact-head approval/integration evidence and is not proven to be an ancestor of main. This category describes the evidence gap, not proven experimental intent.
- No PR for this branch name appears in the cached all-PR inventory; collaborator activity remains unknown.

### `feature/95-saas`

- Head: `1619c0e3a63b922c75a7f46d493d39e68075952f`.
- Category: **active**; disposition: `retain_active_or_interrupted_work`.
- Known interrupted SaaS WIP from existing PR63 metadata; current collaborator activity is unverified.

### `recovery/main-before-final-integration-20261107`

- Head: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`.
- Category: **no longer needed**; disposition: `archive_eligible_after_verified_bundle`.
- Historical recovery branch is conditionally removable after its exact head is covered by a verified durable recovery bundle; it is not intrinsically a permanent branch.
- Before deletion: Verify durable bundle coverage and successful restoration of this exact head.
- Before deletion: Refresh the remote head and confirm it still equals the recorded SHA.
- Before deletion: Confirm no active collaborator work depends on retaining this branch.

## Nonancestor commit subjects

Only nonancestor heads are listed below. These commits are graph-unique relative to the frozen main commit; the list does not by itself prove that their changes are absent from main.

### `checkpoint/gmail-0600-observation-20261106-5cd67b18`

| Commit | Date | Subject |
|---|---|---|
| `5cd67b18792505139234de68533516fc33067ace` | 2026-11-06 | docs: record read-only Gmail 06:00 schedule observation |

### `checkpoint/gmail-0700-observation-20261106-1ec960d9`

| Commit | Date | Subject |
|---|---|---|
| `1ec960d9de4f896f7f481bfdc0e0fc9cc47337fa` | 2026-11-06 | docs: preserve nominal 07:00 Gmail run and matching-result diagnosis |

### `checkpoint/gmail-next-run-diagnostic-20261106-0611`

| Commit | Date | Subject |
|---|---|---|
| `fe7195ae1d6ffeb6ac52c37131c6b062f7c9f24d` | 2026-11-06 | Record one scheduled Gmail diagnostic without changing cadence |

### `checkpoint/ocr-analysis-recovery-20261106-0532`

| Commit | Date | Subject |
|---|---|---|
| `d5e9451ceff439ff7ae60799de58e8ff00971eb8` | 2026-11-06 | docs(quality8): preserve c5 OCR analysis during environment outage |

### `checkpoint/ocr-capacity-diagnosis-20261106-d5ae148f`

| Commit | Date | Subject |
|---|---|---|
| `d5ae148f4847e87b30e2e084494e3f44765afc27` | 2026-11-06 | docs: diagnose ordinary cloud OCR capacity and observed run gap |

### `checkpoint/payment-startup-recovery-20261106-053654`

| Commit | Date | Subject |
|---|---|---|
| `77d4fcf8a506a03ed03393a89be07f3d5e886e8d` | 2026-11-06 | docs: preserve startup contention RED and unapplied repair after environment outage |

### `checkpoint/pr60-ci-recovery-20261106-060352`

| Commit | Date | Subject |
|---|---|---|
| `93b39c641a542cf8add015b63b253de2926059e5` | 2026-11-06 | docs: archive verified PR60 CI and original terminal job logs |

### `checkpoint/pr60-final-ci-520e2271-20261106-070909`

| Commit | Date | Subject |
|---|---|---|
| `2bf147fd2688313128e64028ebc4300472100794` | 2026-11-06 | docs: archive final PR60 head520 CI and full original job logs |

### `checkpoint/rating8-current-20261106-wave6`

| Commit | Date | Subject |
|---|---|---|
| `c57c694d1baf58777b23b1f4d1b21f41a947d5a7` | 2026-11-06 | docs: record verified main and failed native publication without raising ratings |

### `checkpoint/rating8-status-20261106-0621`

| Commit | Date | Subject |
|---|---|---|
| `c1525814ea6e5b41ec0e4176fb30715cc5343b29` | 2026-11-06 | Update current quality evidence without changing scores or publication claims |

### `checkpoint/startup-cancellation-red-f0e845bb-20261106-44c52893`

| Commit | Date | Subject |
|---|---|---|
| `44c5289383f23d2cc8e9f4d00f1ba2dc1297bb44` | 2026-11-06 | docs: preserve first expected startup-cancellation RED attempt |

### `checkpoint/startup-main-ci-20261106`

| Commit | Date | Subject |
|---|---|---|
| `abe08e383a1838c545fba13a4cf367998900ad89` | 2026-11-06 | docs: archive independently verified first main startup CI |

### `checkpoint/startup-review-20261106`

| Commit | Date | Subject |
|---|---|---|
| `819bc206f7c21c0f6f8ce0a490c36fbfb4047579` | 2026-11-06 | docs: preserve independent startup NOT READY review |

### `checkpoint/startup-review-followup-20261106`

| Commit | Date | Subject |
|---|---|---|
| `955fcb98333c36e54f7e3e580f7fd70a5ae21292` | 2026-11-06 | docs: preserve independent static P2 P3 follow-up review |

### `checkpoint/wave5-ci-recovery-20261106-6848bdc1`

| Commit | Date | Subject |
|---|---|---|
| `6848bdc1fdb98c98405caca67fafd2e3a203d752` | 2026-11-06 | docs: preserve original PR59 and failed main237 CI recovery evidence |

### `codex/saas-master-integration-20261104`

| Commit | Date | Subject |
|---|---|---|
| `0d977408d79921c15a46035540159b3cb7bdca86` | 2026-11-05 | WIP: preserve interrupted company bank integration and stop checkpoint |
| `1f4e7d42fc8505d1c99401f37a08311a3878dcd9` | 2026-11-04 | docs: record provider main CI backup verification and joined contract |

### `feature/final-95-completion`

| Commit | Date | Subject |
|---|---|---|
| `861e70875f96e6de8eb1f641b8b59f0b8e1c9efe` | 2026-11-06 | docs: record Site69 final evidence and honest 33-criterion release decision |
| `7f45fed02237b4f07415d7e0452046df853fab4d` | 2026-11-06 | docs: prove isolated synthetic restore on final main f3c8062 |
| `3a05cceabade5ca6f6548322a0880abfd01a068b` | 2026-11-06 | docs: verify PR62 security CI and exact tested source tree |

### `feature/95-document-automation-gmail`

| Commit | Date | Subject |
|---|---|---|
| `a15eb18df8aa6540397a8997fe5524610fc9d91c` | 2026-11-07 | fix: bound Gmail source lookups and correlate automatic run receipts |
| `8e08e81099654bf7c3b7285183fd17448b9fa5af` | 2026-11-07 | test: reproduce Gmail unbounded membership reads and missing run receipts |

## Sources

- Cached GitHub API inventory: `/workspace/scratch/2236a42849dc/release-inventory/github-inventory.json`; it contains source endpoints and PR/check URLs.
- Local commands: `git merge-base --is-ancestor <head> <frozen-main>`, `git rev-list --count <head> ^<frozen-main>`, and `git log <head> ^<frozen-main>` for nonancestors only.
- Exact-tip PR matches use `head_sha` from the cached all-PR inventory; comparisons do not substitute the PR merge commit or an older branch head.
- Per-branch reasons, exact matching PR metadata, duplicate refs and local archive-tag coverage are preserved in `branch-inventory.json`.
