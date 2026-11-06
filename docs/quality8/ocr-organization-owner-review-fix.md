# Organization ownership: follow-up after independent layout review

The prior scoped reviews closed the colon-name and table-header findings. A subsequent read-only identity analysis found a separate cross-role organization defect. It was independently confirmed before this fix; overall layout integration remained blocked.

## Exact defect and baseline distinction

An original containing an unsupported `Utställd av:` or `Avsändare:` block with an organization number, plus a separately explicit `Faktureras till:` recipient, assigned that organization to the recipient. Two paths caused it:

1. Unassigned organization evidence anywhere in the document was adopted by the only named role, crossing paragraphs and earlier/later source blocks.
2. Without a blank line, an unknown explicit sender field did not end the preceding recipient section; the following organization inherited that section.

The frozen before receipt and 36-case matrix are committed in `1372c9e4a5118ddf63b080b381d8847b189071a8`. Its comparison records both exact baseline `ae56dc9` and candidate `06ba7f0` on the same 24 negative source/method/engine combinations. The earlier baseline already returned the wrongly scoped organization but left the unsupported recipient party null and the document yellow. The new recipient alias supplied the party name and made native PDF green. This is a latent ownership error exposed as a new false-green result, not a claim that all of the old organization logic originated in the layout change.

## Narrow product correction

Only the two identical detail modules change. A single named role can no longer adopt unassigned organization numbers globally. Explicit owner-qualified organization labels and the uninterrupted local party sections are assigned before that point and retain their established behavior. Blank/page/scalar boundaries already ended local sections; unknown explicit colon or column fields now end them too.

Unsupported sender words remain unsupported. The fix does not invent a supplier name, recognize `Avsändare` as a legal counterparty, or move the number to another guessed role. The explicit recipient name survives; the unowned organization remains null with a review issue. The existing metadata-direction fallback **when no party role is named at all** is unchanged by this narrowly scoped correction. That fallback alone cannot supply a missing party name or create a green invoice. It is not represented as a complete future identity-region model.

## Verification

| Frozen matrix | Before | After | SHA-256 |
|---|---:|---:|---|
| Own source-boundary reproductions | 12 pass / 24 fail | 36/36 | `76f5b9e476c19ef432978d62728b1bdc8230a3002ace831896c482243463fd20` |
| Independent order/paragraph matrix | 8 pass / 32 fail | 40/40 | `a95bed90211b29d2996e618b7cb5b2b0fa513f7e0480f8ae01289dddc60614ea` |

Both matrices are byte-identical before and after. They cover both engines and native PDF/OCR, unknown explicit fields before and after the recipient, with and without paragraph gaps. Legitimate adjacent and same-line recipient identities, and explicitly owner-qualified identities across paragraphs, remain valid. Positive native cases remain green and existing OCR confidence limits remain unchanged.

The final targeted text/word suite passes **808/808**, with no skips and zero recognition calls. Sites TypeScript, detail byte parity and diff check pass. The new after receipt records the same 24 source hashes from the before receipt: all retain the explicit recipient name, have organization null, and require review. No original, corpus, gold or prior measurement is edited; V3 remains unread. The earlier two-image known replay remains bound to `6d6968d` and is not relabelled as a measurement of this fix.

Independent re-review of this exact follow-up is still required before overall READY.

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test \
  sites/tests/review-organization-owner-boundaries.test.mjs \
  sites/tests/review-organization-source-order-independent.test.mjs
```
