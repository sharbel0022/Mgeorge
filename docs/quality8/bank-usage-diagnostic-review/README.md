# Independent bank usage diagnostic review

The script was executed as the same Node stdin module in the onboarding worktree before it was saved here. `probe-result.json` preserves that tool output; the script was not rerun to produce another measurement.

Reproduction from the same Git repository and reviewed product/test hashes:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs /tmp/mgeorge-usage-diagnostic-independent-review-rQOQWb/probe.mjs
```

The independently rerun HTTP/service command was:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --test --test-name-pattern='usage diagnostic|independent scope review' sites/tests/banking-security.test.mjs
```

That run completed 25 tests, 25 passes, zero failures or skips in 7930.334885 ms. Network was forbidden by the test fixture. No bank calls, production writes, credential reads, or OCR calls occurred.

Review outcome: READY for the three exact product hashes in the JSON. The ordinary acceptance predicate, strict validator, owner guards, cooldown, bank requests and CAS behavior remain unchanged. The diagnostic is private, bounded, copied, deeply frozen, and exposed only for the exact local validation error after the existing failed-event write succeeds. The ordinary live usage value remains unknown until a later authorized production revalidation.
