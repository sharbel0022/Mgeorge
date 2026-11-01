# Private Bankgiro original verification

Baseline: `db1b81fdfabf966ad77ad59c4eb6ba6a4b36964c`, latest fetched main. This public report contains no original accounts, payer names, original hashes, private document IDs or original files. Actual observations are returned privately to the requesting user.

## Original and integration checks

- Supplied Work attachment read directly without conversion or upload. OOXML and independent workbook inspection agreed. One detail row matches summary count and total. Recipient account/Bankgiro, sender and payment reference have separate cell evidence. Original bytes remain unchanged.
- The original labels its reference as a payment reference, not formal OCR; generic `Datum` is a report date. Explicit currency, separate booking/value/settlement date, stable AIS identity and sender bank account are absent. A sender-row Bankgiro/avi number is not a bank account.
- Invoice PDF retrieved read-only from the verified company Gmail account; complete extracted text and rendered page agree. Invoice number, total and seller Bankgiro correspond to the report. Invoice recipient and report payer have different names; no customer relationship or third-party authorization follows from the PDF.
- Current native Sites reads confirmed an active production Swedbank connection, future consent expiry, one selected account, recent successful sync and no reported sync error. Workspace revision was 40. Workspace payload and encrypted account resource were truncated: full current AIS original, account aliases, register and balances could not be inspected.
- Connected-browser navigation timed out repeatedly. Another supported browser reached the Site but required ChatGPT sign-in. No authenticated production-data read, sign-in credentials or fresh register-absence assertion is claimed. The previous delivery's register/AIS findings remain historical evidence.

## Corrected defects

1. Sites accepted `account_id.other` without an allowed string scheme and ignored alias collisions on unselected/different-currency resources. It now requires string identifiers with IBAN/BBAN/CPAN and checks uniqueness across every provider resource before selection/SEK checks. Raw report account stays intact.
2. Hard-coded operational SEK became Node `explicit_currency:true`. New `currencySource` distinguishes `profile_assumption` from a genuinely labelled SEK cell. Missing/legacy XLSX currency evidence blocks new manual source associations in both apps. The operational SEK display is not currency proof. Optional explicit `Valuta` has cell provenance; positive synthetic link fixtures now state it, while the original-layout fixture still omits currency.
3. Generic `Datum` became `valueDate`/`settlementDate`. It is now `reportDate` with `dateKind:report_date`; value/settlement claims are not manufactured. Date proximity remains a candidate hint.

Older XLSX observations remain retained and reviewable; absent new evidence cannot gain stronger link rights. Original replay can require re-review when older derived metadata differs. No migration rewrites original observations, allocations or balances.

## Before and after

| Check | Before fix | After fix | Scope |
| --- | --- | --- | --- |
| Six invalid/ambiguous aliases | Six intended failing negative tests | All rejected with read-only state preserved | Synthetic retained-preview service |
| Five currency/date regressions | 79/84, five intended failures | 84/84 | Parser and both source-link boundaries |
| Full Node suite | 645/645 baseline | 646/646 | Fresh local full runs |
| Full Sites suite | 1126 baseline; 1138/1138 after alias fix | 1142/1142 integrated | 12 alias +4 parser/domain tests added |
| Supplied private original | Overstated currency/date metadata | 12/12 private assertions; unchanged bytes | No original/hash in public artifacts |
| Independent final review | Not performed | No critical/important findings; 29 Node +136 Sites passed | Local code and synthetic evidence only |

Syntax92, TypeScript and production build passed. Root audit0. Sites high/critical audit passed with16 existing moderate development-tool findings; production-only audit has zero vulnerabilities. No dependencies/locks changed.

## Financial boundary and outstanding evidence

No real invoice registration, bank import, source association, allocation, balance change, email or bank payment was performed. No production sync/reconciliation/document-processing mutation was used as a test. Source pushes/publication are separate from financial-data changes.

The actual payment is **not fully verified**. Required next evidence:

- Full current owner-authorized AIS original/integrity receipt: amount, currency, booking date, stable bank identity and transaction account.
- Explicit bank-provided recipient-account/selected-AIS-account relation, plus shared stable identity or independently supported report/deposit association. Sequence, amount and nearby dates alone are insufficient.
- Supplementary bank-issued currency evidence; the supplied report omits it.
- Complete current register read, followed by ordinary registration if absent. Historical absence is not fresh proof.
- Verified customer/third-party relationship resolving the different invoice recipient and report payer.

No paid-state decision is made. Exact main, CI and Sites identity belong in the delivery receipt.

## Verified code delivery

Code `89622547fbeadb232689ada5e7fd57fe7038d341` is on main. Both jobs in [Actions41357990960](https://github.com/sharbel0022/Mgeorge/actions/runs/41357990960) succeeded on that exact SHA, including clean installations and build. **Sites48 succeeded**, with an identical source tree and runtime9. Post-publication workspace revision40 and modification time are unchanged; native data remains truncated. Existing audience/auth/DB/R2/table list and schedules are preserved. [Machine-readable receipt](BANKGIRO-ORIGINAL-VERIFICATION-DELIVERY.json). The code is delivered; the actual payment is not approved.
