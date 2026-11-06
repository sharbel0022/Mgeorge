# Independent review: retained bank status metadata

Date: 2026-11-06. Reviewed commit: **`d7ede6af7cdd6633442c773f98b880d90104ac25`**. Decision: **no blocking finding in this bounded diff**. Complete integrated CI/build remains the parent's gate.

## Scope and method

I read the entire product diff in `sites/lib/banking/service.ts` and `sites/components/bank-connection.tsx`, the new author tests, and the existing ownership, consent, account-health and warning-rendering call sites.

I separately froze 22 probes and compiled the exact `service.ts` bytes extracted from the commit and its parent through the existing synthetic service/identity/store/SQLite fixture. The fixture context is `edaccd85dcd7e8b23268c04640e1f9fc4d41ba57`, including the reviewed company SQL correction. Author test cases were not imported or executed. Inputs and assertions in these probes are independently specified.

| Same frozen probe | Pass | Fail | Cancel / skip / TODO | Exit |
| --- | ---: | ---: | --- | ---: |
| Before correction | 6 | 16 | 0 / 0 / 0 | 1 |
| Reviewed correction | **22** | **0** | **0 / 0 / 0** | **0** |

The corrected run took 4.669 seconds. During every status call SQLite enforced `PRAGMA query_only=ON`; every stored table was also compared before and after. Provider dispatch count remained zero, and ordinary fetch was forbidden. No production database, credentials, original or provider was used.

## Findings

- Malformed warning JSON, JSON null/object/boolean/number and mixed arrays produce an explicit unknown-aftercheck warning. The retained run and its imported/skipped counts remain visible; the damaged warning field is not repaired or discarded silently.
- Valid warning arrays retain order, duplicate strings, empty strings and the existing postprocessing warning. Valid strings in mixed arrays survive alongside the unknown-metadata warning; object content is not exposed as text.
- Malformed account selection is not partially salvaged. No account is presented as selected, automatic sync is not allowed, and no next attempt is advertised. Existing semantic rejection of duplicate account IDs also remains effective.
- A newer foreign-owner run cannot replace or expose another owner's status. A foreign company selector is still denied. Expired consent, absent company authority, malformed consent metadata and damaged encrypted account data retain their existing restrictions.
- The product UI renders `connection.metadataWarning` in its existing error area with `role="alert"`. Existing `postprocessWarning` and retained-run warning rendering remain present. This UI conclusion comes from the actual TSX diff and surrounding render code; this review did not claim a separate browser run.
- The parsing fallback is confined to retained warning/selection presentation. It does not catch or suppress authority, consent or account decryption failures. No provider or mutation path was added.

The [machine-readable receipt](bank-status-independent-review.json) records exact source hashes, the frozen probe hash, commands and retained red/green log hashes. Raw synthetic evidence is in `/workspace/scratch/aab0f7dc06f9/security-evidence/`. The temporary executable probe was removed from the test directory after verification; its frozen copy remains in that evidence directory.

This signoff covers this diff only. It does not override earlier failed local full-gate attempts or approve production bank activation, provider access or recovery-barrier release.
