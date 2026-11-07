# Fresh integrated local startup smoke

PASS on exact source **9fc922739cb3522d34a3b9e854bc98262b6f32ba**, Node 24.22.1, npm 11.9.0, Linux. A new checkout was extracted from git archive without .env or node_modules. No implementation source edits, actual provider credentials, customer data, full suites or builds were used.

- npm start installed locked local dependencies, created mode0600 .env with valid random keys, and served health200/frontend200. Initial authenticated readiness:1649ms.
- Terminal Ctrl+C was simulated by SIGINT to the dedicated test foreground process group. Outer npm exited via SIGINT; both app and authenticated control ports were independently proven reusable.
- npm start restart and npm run stop both succeeded; stop and launcher exited0.
- Missing OpenAI key produced blocked/API_KEY_MISSING while the local app remained available.
- Invalid unregistered model with a clearly synthetic, non-real key independently produced blocked/MODEL_PROFILE_REQUIRED while the local app remained available. No provider probe was performed.
- npm run dev reached readiness, then a source mtime change caused a clean reload and a second authenticated readiness. Source contents were unchanged. npm run stop and launcher exited0.
- Occupied app port caused exit1 and a configuration alternative. The original synthetic listener remained running.
- App port:34979; checkout control port:52505. All owned ports released after each stop.
- Every archived tracked file retained its SHA256; .env retained its hash across restarts. Temporary checkout was removed after verification. No keys were printed.

Exact commands, exit results, timings and status lines are in summary.json. Logs and runner are alongside it. source-manifest.json records per-file hashes from the exact archive; sha256.json binds this evidence packet. The invalid-model scenario deliberately uses a synthetic key so missing-key validation cannot mask model validation.
