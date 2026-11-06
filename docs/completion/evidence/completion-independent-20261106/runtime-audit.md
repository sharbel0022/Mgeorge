# Runtime binding, recorded before the first optical call

The immutable corpus freeze is `246ea4ac2f60d7567fddd2ee57cd7c48bc3f23a4a2b902a1f3fab30ece12781c`, timestamp `2026-11-06T15:02:48.030229+00:00`. The 19 images, source text, gold, generator, protocol and run plan remain unchanged. No optical or parser call preceded this note.

The frozen gold uses the semantic direction `incoming`. The product API accepts `supplier` or `customer`; the adapter therefore supplies `direction: 'supplier', direction_confident: true` for this trusted incoming context and compares the returned `supplier` as `incoming`. This is an explicit enum translation, not visual recognition or a gold correction. The nine image-derived fields are the primary outcome and exclude direction entirely. No other recognition confidence is overridden.

The unchanged `runDocumentProcess` implementation has its own 90-second child-worker timeout. This is retained; the run plan's 120-second value is a maximum, not a change to production worker behavior. PNG input uses installed local Swedish Tesseract data; English cases are intentionally evaluated by the existing Swedish worker, without selecting another model.

Node and Sites field interpreters receive the same worker observation, including actual confidence and hash-bound evidence. Sites is loaded using the repository harness's relative-import URL adaptation; no parser logic is changed. This does not evaluate browser-side optical processing or end-to-end registration.

The isolated worktree has symlinks to the existing root and Sites dependency installations. It is launched with an empty environment except PATH, TEMP and LANG, with no credentials, provider invocation or production workflow. The worker itself further restricts its child environment. No warm-up document or sample parser call is made.

Pre-optical setup diagnostics: the worktree initially lacked node_modules links, which were added; `/usr/bin/time` is not installed, so Python subprocess/resource statistics are used instead. These were setup checks, with zero optical/parser calls. No case attempt is discarded or repeated. The run ledger refuses to overwrite an existing attempt file. Setup exceptions and any document/parser failures will be retained explicitly.

The executable runner and scorer are additionally hash-bound in `runtime-binding.json` before any optical attempt. This supplements the original corpus freeze rather than replacing or editing it. The corpus freeze was performed before inspecting the optical worker and parser API. Source import resolution after the freeze is for execution only; there is no parser tuning.
