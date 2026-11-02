# Owned minimatch 10.2.5 backport

The transformations in `minimatch-10.2.5.json` derive from Isaac Z. Schlueter
and contributors' minimatch source, under [Blue Oak 1.0.0](minimatch-LICENSE.md).
Upstream fix: [77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8).

The owned adaptation limits first-phase expansion to `braceExpandMax` (default
100,000) and bypasses quadratic second-phase preprocessing above 1,000 entries.
The installed package remains **10.2.5**, including its original package metadata,
license, declarations and declaration maps. The separate 3.1.5 package is untouched.
This does not remove or relabel npm audit findings or resolve ESLint's support gap.

Runtime, embedded TypeScript source and source-map transformations have exact
SHA-256 before/after guards. Offline compilation with the pinned TypeScript 5.9.3
reproduced both original runtimes/maps and the owned backport outputs byte for byte.
The embedded source changes preserve source line counts. No compiler runs during
installation. Every target and planned output is validated before the first write;
each file is replaced through a sibling temporary file and rename, then reread.
Multiple file replacements are not one transaction. A known interrupted mixture
fails read-only verification and can be repaired by rerunning the apply command.

Apply: `node scripts/minimatch-backport.mjs --require-target`.
Read-only verification: `node scripts/minimatch-backport.mjs --check --require-target`.
Ordinary postinstall can report explicit zero targets when dev dependencies are
omitted; complete install/build/check/lint paths require the target.
