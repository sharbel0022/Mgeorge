# Sites development audit risk — 2026-11-06

**No compatible lockfile-only security fix was identified within the current dependency contract.** The eight moderate audit rows are one minimatch advisory propagated through seven development-tool ancestors. The exact-source CI verified an owned backport of the upstream fix. This is a retained development-tool/support risk, not eight independent application vulnerabilities or an unmitigated production audit failure.

## Bound evidence and affected packages

Audited commit: `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`; whole tree `ad40b5a5ae7710939801d73e5e16eb80f3186f48`; Sites subtree `ff078901d22a76ce0d0eac775e405ca50d8bcc6e`. The root-provided main Sites archive's raw audit and mitigation log bytes were independently compared with every recorded receipt hash. Production audit: **0**; all-dependency audit: **8 moderate, 0 high, 0 critical**. CI's policy threshold is high, so the all-dependency command's exit 0 does not mean an empty advisory list.

| Audit entry | Locked version | Meaning |
| --- | --- | --- |
| `@typescript-eslint/eslint-plugin` | 8.59.3 | Inherited dependency finding |
| `@typescript-eslint/parser` | 8.59.3 | Inherited dependency finding |
| `@typescript-eslint/type-utils` | 8.59.3 | Inherited dependency finding |
| `@typescript-eslint/typescript-estree` | 8.59.3 | Inherited dependency finding |
| `@typescript-eslint/utils` | 8.59.3 | Inherited dependency finding |
| `eslint-config-next` | 16.4.3 | Inherited dependency finding |
| `minimatch` | 10.2.5 | Underlying advisory |
| `typescript-eslint` | 8.59.3 | Inherited dependency finding |

All eight entries have `dev:true` in the exact lockfile. The affected instance is `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` 10.2.5. The separate minimatch 3.1.5 instance is outside this advisory's affected range.

The chain begins with the pinned `eslint-config-next@16.4.3`, through `typescript-eslint@8.59.3` and `@typescript-eslint/typescript-estree@8.59.3`, which requests `minimatch:^10.2.2`. The installed ESTree module uses minimatch to compare a source path with configured `allowDefaultProject` patterns, supplying `{dot:true}` and no optimization-level override. The application's `app/`, `lib/`, `components/` and `db/` source search found no import of these lint packages; the ESLint configuration does import them. This supports a development/lint exposure assessment. The zero production audit and static import search are not a new inspection of the deployed bundle.

## Advisory and existing mitigation

[GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249) describes excessive CPU/memory use from attacker-controlled glob patterns when `optimizationLevel >= 2`. GitHub's reviewed range is `>=7.0.0 <11.0.1`; the first fixed release is 11.0.1. The maintainer's original advisory describes the 10.2.6 reproduction; the broader reviewed range includes this lockfile's 10.2.5.

The repository already backports [upstream commit 77a0f5c](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8): it bounds first-phase growth by `braceExpandMax` and avoids quadratic pairwise processing above 1,000 entries. CJS/ESM runtime and source-map bytes are guarded, with package identity, exact version, lock integrity, paths and declaration/license files validated. The package continues to report 10.2.5, so npm correctly retains its version-based advisory finding.

The exact main CI step ran `node scripts/minimatch-backport.mjs --check --require-target` and returned **`targets:1, writes:0, status:verified`**. Its stdout SHA-256 is `03436c145f530b2840b889abbdfdc8cc588772302aa0ee8e3a20bf5daf58620c`. Existing tests cover the upstream expansion cases, both module formats, real parser compatibility and guarded install/build/check/lint entrypoints. The parser integration establishes compatibility; the adversarial expansion tests exercise minimatch directly. This follow-up and a parallel independent reader inspected those contracts and existing CI evidence; neither reran tests or mutated installed packages.

## Available remediation paths

Official npm metadata was fetched read-only during this review. The current `typescript-eslint` and `@typescript-eslint/typescript-estree` release is **8.72.1**; ESTree still requires **`minimatch:^10.2.2`**. Its official repository manifest and [release](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.1) agree. Updating the compatible TypeScript-ESLint family alone therefore does not move to the patched minimatch major. Current minimatch metadata reports **11.0.5**, requiring Node `20 || >=22`, which the tested Node versions meet; the dependency range and compatibility contract are the immediate obstacles, not that engine requirement.

| Option | Assessment |
| --- | --- |
| Ordinary compatible minimatch 10.x lock refresh | Does not satisfy the advisory's patched range; changing 10.2.5 also fails the current exact-byte backport guard until deliberately reviewed. |
| Compatible TypeScript-ESLint update to 8.72.1 | Still requests minimatch 10.x; does not clear this advisory. |
| `npm audit fix --force` proposal | Audit proposes `eslint-config-next@15.5.29` and labels it a semver-major change. This is a major downgrade from pinned 16.4.3 and changes the framework lint contract; it is not an established safe fix. |
| Owned override to minimatch >=11.0.1 | Potential future remediation, but outside the consumer's declared `^10.2.2` range. Requires explicit compatibility review, actual lint/parser tests, replacement/retirement of the exact 10.2.5 guard, normal Sites installation/build verification and source rebinding. No compatibility claim is made here. |
| Upstream consumer adopts the patched major | Preferred way to retire the owned backport without an out-of-range override; recheck published dependency metadata when available. |

No host restriction was demonstrated as the sole blocker. The current Sites install/check/build contract itself intentionally rejects unknown minimatch versions and bytes; a dependency transition must update that contract through the normal reviewed workflow. The safe current action is to keep the verified backport and its audit disclosure, and track replacement by a supported patched dependency. Do not run a forced downgrade or mask/change audit package identities merely to make the count zero.

## Residual risk and limits

A direct `npm ci --ignore-scripts` followed by direct `node_modules` CLI execution without the repository's verifier is outside the verified mitigation path. The repository's own install/cache paths still apply or check the guard when lifecycle scripts are disabled. Known interrupted/mismatched installations are rejected. The owned patch carries ongoing maintenance/support work, and upstream 10.x remains flagged. No customer-document-to-lint attack path, new production vulnerability or easy in-range lockfile security fix was demonstrated in this bounded review; this is not a proof of global unreachability.

Only this risk note and its [machine-readable evidence](sites-development-audit-risk.json) were written. No package, lockfile, production source, dependency installation, score, deployment or test was changed. The evidence file contains the eight exact package entries, official metadata snapshots, source hashes and hash-verified original CI audit bodies.
