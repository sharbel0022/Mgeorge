# Integrated onboarding browser receipt — 2026-11-05

## Provenance and scope

This records the **parent/root agent's CUA browser checks** of a fresh bundle of the integrated UI at original-field repair commit `ad7aa57f3fe493dfa9b9e0a96cd9d72e74fffb2e`. The subsequent `b26af1a` change updated only the company-workspace test harness; production UI code was unchanged. This document transcribes the root agent's reported observations. It is **not a fresh run of the 41-scenario automated Playwright suite**, and the historical `acceptance-results.json`, source manifest and screenshots remain historical artifacts.

The checks used synthetic preview data. They establish the observed frontend behavior; they do not establish a live bank connection, provider callback, configured production schedule or live financial operation. Provider/projection focused checks, including the separately reported 78-test review, and full Node/Sites release gates are separate evidence and are not counted as browser scenarios here.

## Responsive measurements

The root agent reported the following actual document-element measurements. At every viewport, client width equaled scroll width: no horizontal page overflow was observed.

| Viewport width | HTML client width | HTML scroll width |
| ---: | ---: | ---: |
| 320 px | 305 px | 305 px |
| 390 px | 375 px | 375 px |
| 768 px | 753 px | 753 px |
| 1024 px | 1009 px | 1009 px |
| 1440 px | 1425 px | 1425 px |

## Observed interactions and states

- **Company creation:** the form retained the typed company name during ordinary reads. Cancel restored focus to the opener. The current request contract sends exactly `name` and `confirmEmptyCompany: true`; legal organization identity is not inferred from the entered name.
- **Disconnect confirmation:** initial focus was on Keep. Shift+Tab remained within the dialog, and Escape closed it and restored opener focus.
- **Unsupported bank:** the bank action remained disabled with configuration-required messaging.
- **Expired consent:** account selection and sync were disabled.
- **Viewer access:** the actual synthetic company-A viewer could read status but could not mutate bank consent, account selection or sync. The fixture made only A a viewer; company B retained its configured admin role.
- **Company switching:** the UI displayed loading and then the selected company, without presenting another company's data as the selected company's result.
- **Incomplete payment evidence:** missing payer/reference states remained explicit; observed reference `0000599` preserved its leading zeroes and the observation remained marked as needing review.

## Evidence boundaries

The parent/root agent also independently accepted the `ad7aa57` original-field projection repair: original bank observations remain separate from later manual corrections. That code review is separate from this browser receipt. No new automated browser run or production validation is claimed by this documentation update.
