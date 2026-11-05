# Bankgiro evidence and traceability

## User goal and authorized delivery

Improve Bankgiro and payment evidence on `feature/95-bankgiro`, test both applications, document actual provider limits and open a PR to `main`. Production financial records, allocations, provider configuration and deployments are outside this change. The required acceptance case uses [recipient Bankgiro withheld], an exact text reference with a leading zero [reference value withheld], [original amount withheld] in SEK and [original booking date withheld]. Real originals are inspected only through authenticated read-only evidence tools; tests use explicitly synthetic originals and identities.

## Existing architecture

Baseline `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5` already contains a durable `BankgiroReportSource`, pinned SFTP/HTTPS intake, CAMT.053/.054, the Swedbank XLSX profile, CSV and Open Payments raw-response capture. Corporate provider receipts join the existing company-scoped intake. Reports do not represent new economic deposits; account proof, stable bank entry identity and complete group totals control their relation to AIS. Both Node and Sites share parsers and payment-reference rules.

Retain that architecture. Replacing intake or converting native API JSON into another bank format would obscure the original and duplicate authority and idempotency controls. This change extends existing read-only evidence and repairs only reproduced parsing/status defects.

## Required behavior

- Never derive bank OCR from invoice numbers or bank payers from invoice customers. Preserve leading zeros and typed reference sources.
- Payer and reference checks must reflect missing, uncertain, conflicting or intact original evidence separately. A present value alone cannot pass an unsuccessful original check.
- Retained-report inspection exposes original size, retention time, import receipts, source acquisition history and the exact saved transaction/allocation identifiers belonging to that original. It labels these as stored history, not proof of bank authenticity, current entitlement or a correct invoice relationship.
- History is owner-scoped, read-only, bounded and explicit about omissions and snapshot changes. Do not expose credentials, authorization bindings, full accounts or raw provider payloads.
- Continue to require independent current provider authority and complete bank evidence before API enrichment or AIS decomposition. Keep CAMT054C/SFTP fallback.
- No new import, confirmation, allocation, financial mutation or bank request is caused by evidence inspection.

## Verification and live limits

Use behavioral regressions for every corrected defect and run the repository's root, Sites and bridge gates. Test malformed references, conflicting payers, duplicate delivery, missing originals, incomplete groups and wrong invoice relations. Review independently before PR creation. The real acceptance case receives a separate sanitized report of retained-original checks and remaining gaps; synthetic passing tests never count as production bank proof. Scores stay evidence-based; absent agreements/account/deposit evidence cannot be replaced by a numeric target.
