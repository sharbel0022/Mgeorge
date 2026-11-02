# Final engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Rätta de reproducerade dataintegritets- och ekonomifelen och leverera verifierad kod utan riktiga ekonomiska skrivningar.

**Architecture:** Befintlig Node/SQLite och Sites/D1/R2 behålls. Oberoende, avgränsade rättningar med test-först; root samordnar integration och produktion.

**Tech Stack:** Node 22, JavaScript, TypeScript, SQLite, D1, R2, Vinext/React.

**Spec:** `docs/superpowers/specs/2026-11-02-final-engineering-design.md`

## Global Constraints

- Tester använder syntetiska data och isolerade databaser.
- Bevara originalbytes, bankfakta, historiska allokeringar och saldon.
- Båda apparna bedöms vid gemensamma parser-/betalningsregler.
- Inga nya bankanrop, verkliga ekonomiska skrivningar eller kundmejl.
- Ingen forcepush eller branchradering utan konkret godkännande.
- Bevara befintligt Sites-projekt, DB/R2, runtimehemligheter och scheman.

## Review Focus

- D1 commit med förlorat svar och misslyckad efterläsning: bevara originalet.
- Windows filidentitet, utbytt mål och sidecars: återställ bara verifierade bytes.
- Tvetydiga datum/metadata: ingen grön autoregistrering från giltigt prefix.
- Organisationsidentitet bakom bokad betalning: ingen ny lärd kundrelation.
- Utgången kontoåtkomst efter bokning: håll aktuell verifieringsstatus, bevara saldo.

### Task 1: Original vid osäker D1-skrivning

**Files:** `sites/app/api/files/route.ts`, ny `sites/tests/file-upload-integrity-final.test.mjs`.

**Interfaces:** Samma POST/GET och documents-schema; ingen ny endpoint.

- [ ] RED: verklig multipart/route/SQLite, commit-then-throw ger fortfarande läsbara byteidentiska original efter retry.
- [ ] Testa även precommitfel, misslyckad efterläsning, ägargräns och dubblett.
- [ ] Minimal bevarandekontroll efter INSERT-fel enligt befintlig Gmail-gräns.
- [ ] GREEN: riktad svit, oberoende granskning; root committar.

### Task 2: Kompletta fakturadatum och metadataidentifierare

**Files:** `src/invoice-extraction.js`, `sites/lib/invoice-fields.js`, båda `document-triage.js`, respektive parser-/triagetester.

**Interfaces:** Befintlig interpretInvoice och sourceInvoiceNumbers; gemensamma regler i båda motorerna.

- [ ] RED: issued/due med semikolon/komma/okänd suffix hålls; 80-teckensoriginal kontra längre explicit metadata blir ingen grön prefixträff.
- [ ] Behåll positiva svenska datum, layout/rader och exakta ledande nollor; testa verklig autoregistreringsgräns där möjligt.
- [ ] Minimal strikt fältläsning utan att kasta råvärden/proveniens.
- [ ] GREEN och samma före-/efterkorpus; root ordnar oberoende review/commit.

### Task 3: Windows restore utan falsk identitetsavvikelse

**Files:** `src/backup.js`, `test/backup.test.js`, vid behov avgränsade backup-testhjälpare.

**Interfaces:** Befintlig restoreBackup; Windows jämför konsistent filidentitet utan försvagat Linuxskydd.

- [ ] RED: verklig syntetisk krypterad SQLite-backup återställs byteidentiskt i Windows och egen felstädning fungerar.
- [ ] Bevara negativfallen för främmande WAL, länkar, ersatta sökvägar och felbytes.
- [ ] Rätta identitetsjämförelsen minimalt och redovisa separat om symlink-fixturer saknar OS-behörighet.
- [ ] GREEN: riktad backupsvit och oberoende review; root committar.

### Task 4: Bokad kundidentitet och aktuell evidensstatus

**Files:** Sites `lib/domain.ts`, `lib/reconciliation.ts`, `lib/payment-presentation.ts`, `lib/economy.ts` enligt faktiskt funnen ansvarsfördelning; riktade domän/evidenstester. Bedöm motsvarande Node-regler.

**Interfaces:** Befintligt invoice.save, allokeringar och bankPaymentView/economySummary.

- [ ] RED: ändring av organisationsidentitet efter allokering kan inte lära en ny kundrelation eller ändra andra fakturors saldo.
- [ ] RED: bankAccountIssue/bankPaymentReview håller aktuell verifieringsstatus även efter bokning; historiskt saldo/allokering bevaras.
- [ ] Minsta rättning och positiva kontroller för tillåten fakturaredigering/korrekt attest.
- [ ] GREEN och oberoende review; root committar.

### Task 5: Leverans, granskning och 33-områdesrapport

**Files:** `PROGRESS.md`, `QUALITY-SCORECARD.md`, `PLAN.md`, `docs/MGEORGE-FINAL-ENGINEERING-REPORT.md`, leveranskvitto/mätningar.

- [ ] Kör root npm ci --ignore-scripts/check/test/audit och Sites install:ci/check/test/build/audit enligt aktuell CI; redovisa faktiska miljöbegränsningar.
- [ ] Fristående scoped och samlad granskning, rätta konkreta fynd och omverifiera ändrad omfattning.
- [ ] Kontrollera privat bank/faktura/register/Gmail/backup läsande; inga okända konto-retries.
- [ ] Ny fetch, normal main-push, exakt CI, separat Sites-källträd/bygge/publicering och läsande efterkontroll.
- [ ] Alla 33 före-/efterpoäng med bevis, risk och nästa åtgärd; exakt fortsättningspunkt och ärlig slutstatus.

## Förkontroll och beslut

Task1–4 har separata produktfiler; parser och ekonomi delar endast oförändrade domänimporter. Task5 ägs av root. Ruling: oberoende implementationer får köras parallellt med uttryckligt filägarskap; gemensam commit och fullgranskning hålls sekventiellt. Det minskar väntan utan samtidiga ändringar i samma fil. Baslinjeinstallationer är klara; nya fullsviter körs i isolerad worktree före ändringar. Historiska gröna Linuxresultat ersätter inte aktuell Windowsverifiering.

## Exekveringskvitto

- [x] Task1–4: RED/GREEN, oberoende scoped granskning och rättningsrundor passerar.
- [x] Tillagd Task6: faktisk responsiv dialog tappade fokus; minsta fallbackrättning, RED4→GREEN6, riktig Chromiumgreen och samlad slutreviewREADY.
- [x] Task5 tekniska leveransgrindar: main2410e4b, exaktCI41480737514 med991Node/1609Sites/0fail/skip; separat Sites54/samma källträd, succeeded och skrivfri efterkontroll revision42/oförändrade jämförda fält.
- [x] Ny konkret raderingsbekräftelse erhållen; fem brancher raderade med förväntade SHA-villkor,17refs/träd privat återställda, endastmain kvar ochPR9/10closed.
- [x] Alla33områden,23bankkontroller, test-/arkiv-/produktionsbegränsningar och exakt fortsättningspunkt dokumenterade i slutrapport/kvittot.
- [ ] Hela användarmålet9,5i33områden: externa bank-/verksamhets-/DRbevis och kvarstående teknisk/representativ acceptans återstår. Detta är inte ett slutfört verksamhetsgodkännande.
