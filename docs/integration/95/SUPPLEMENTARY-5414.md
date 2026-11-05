# Kompletterande syntetisk integrationsgrind på 5414e226

## Resultat och exakt omfattning

**PASS: 512/512 tester i 24 kompletta repositoryfiler, utan fail, skip, cancel eller TODO.** Körningen tog 51.734 sekunder med Node v22.23.4. En separat konkret bevislucka för ny loginstate över krypterad backup/restore prövades därefter: **3/3 assertionsbaserade tester**, också utan fel eller överhopp. Dessa två kvitton redovisas separat; inget större helsvitetal påstås.

| Bindning | Värde |
| --- | --- |
| Exakt head | `5414e2269913e37c58e0e0cff1bf260c31b2a35f` |
| Git-tree | `c37b15b8b97f0c86c96bda524126a828168049bd` |
| Fryst git-archive | `/workspace/scratch/a96c4ccdbd4d/verification-5414` |
| Start | `2026-11-05T18:51:35.524704+00:00` |
| Slut | `2026-11-05T18:52:27.258870+00:00` |
| Node | `v22.23.4` |
| Kompletta filer | 12 Node-filer + 12 Sites-filer |
| Slutkod | `0` |
| TAP SHA-256 | `da03c2e6c8a96e0407e92a14878475de92c76d4eac0cfb37cd766bc5d9b2a13d` |
| Källmanifest före/efter | `2c3295247af8ce9c28319675013549f053d0ae1303f2e0235c6e5b77537fa31f` |

Alla **1 260 spårade filer** verifierades först mot commitens faktiska Git-blob-ID:n och SHA-256. Samma filer kontrollerades efter huvudkörningen och igen efter login/restore-proben; ingen ändrades. Manifesten före och efter är byteidentiska. Den aktiva integration-worktreen ändrades inte. Archive-kopian har tillfälliga dependency-symlänkar för direkta tester. Alla sex paket-/lockmanifest matchar kandidaten; detta är ingen ny installation, audit eller verifiering av guarded dependency-paths.

Denna grind är ett supplement på **5414e226 före den aviserade OCR-ingressrättningen**. Den tillskrivs inte en senare slutcommit och ersätter inte full CI, rena installationer, typkontroll, produktionsbygge, audit, browser- eller volymgrindar på slutkandidaten.

## Vad kedjorna faktiskt prövade

- **Faktura och betalning över lokal HTTP:** behållet CSV-original, fakturaregistrering, omstart och replay utan en andra betalning. Korrupt original kan inte användas för allokering.
- **Migration och replay:** historisk SQLite uppgraderas och öppnas upprepade gånger med oförändrad faktura-/betalningsidentitet, saldo och proveniens. Ändrade original får inte nya godkännandehashar. Sites migrationsjournal är unik, ordnad och bevarar en befintlig finansiell arbetsyta.
- **Samtidighet:** verkliga separata processer tävlar om import/avstämning i SQLite. Samma betalning används en gång; abrupt processavslut rullar tillbaka ofullständig import; startup väntar på ett verkligt övergående WAL-/journal-lås.
- **Båda batchmotorerna:** framåt-/bakåtordning, befintlig delbetalning plus exakt rest, överbetalning med bevarat överskott, fel/saknad referens, ändrade original och ej valt bankkonto. Återimport bevarar tidigare ekonomi och audit.
- **Företagsisolering:** tre riktiga lokala företag med gemensam aktör och identiska externa id:n, separata original/cache/medgivanden/jobb, återkallat medlemskap eller ändrad roll efter await samt nekad återställning till fel företag.
- **Backup och restore:** faktisk kryptering, WAL-data, originalbytes/hash, nyckelfel, brutna referenser, publicerings-/filidentitetsfel, företag, Bankgiro-intag, bolagssynkens kvot/checkpunkt/429/kvitton och ogiltigförklarade leases.
- **Separat Sites recovery-drill:** 27 ägarbundna backuptabeller, sju syntetiska standardoriginal, oberoende före-backup-facit och åtta negativa integritets-/ägarklasser. Detta är lokal evidence-only-återställning, ingen aktiverad produktionstjänst.
- **Loginbudgeten:** omstart, två konkurrerande serverinstanser, begränsad Retry-After, ignorerade klientpåstådda IP-headerfält, exakt tidsgräns och lyckad inloggning.

Den vanliga `saas-test-isolation.mjs` laddades och NODE_ENV var test. Underlagen och originalen är syntetiska. Inga verkliga bank-, Gmail-, OCR-, kund- eller produktionsanrop gjordes.

## Exakt körkommando

Arbetskatalog: `/workspace/scratch/a96c4ccdbd4d/verification-5414`. `run-result.json` innehåller samma argv, miljööverstyrningar och fullständiga resultat. `test-files.txt` är den frysta listan.

```sh
NODE_ENV=test NODE_OPTIONS=--max-old-space-size=1024 TZ=UTC \
CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false \
/home/agent/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --experimental-strip-types \
  --test --test-concurrency=1 \
  test/quality-regressions-recovery-api.test.js \
  test/quality-regressions-migration-replay.test.js \
  test/payment-concurrency.test.js \
  test/reconciliation-batch-integration.test.js \
  test/saas-company-acceptance.test.js \
  test/security-login-rate-limit.test.js \
  test/backup.test.js \
  test/backup-disaster-recovery.test.js \
  test/backup-integrity-q8.test.js \
  test/backup-reference-integrity-final.test.js \
  test/backup-configuration.test.js \
  test/integration-jobs-backup.test.js \
  sites/tests/reconciliation-batch-integration.test.mjs \
  sites/tests/saas-company-acceptance.test.mjs \
  sites/tests/seven-agent-migration-order.test.mjs \
  sites/tests/recovery-drill.test.mjs \
  sites/tests/backup-recovery.test.mjs \
  sites/tests/backup-integrity-q8.test.mjs \
  sites/tests/backup-reference-integrity-final.test.mjs \
  sites/tests/company-backup.test.mjs \
  sites/tests/backup.test.mjs \
  sites/tests/bank-api-backup-q8.test.mjs \
  sites/tests/company-bank-sync-backup.test.mjs \
  sites/tests/bankgiro-ingest-backup.test.mjs
```

## Ny login_rate_limits: schema, rollback och backup

En separat oberoende granskare läste denna del på exakt 5414e226. **Ingen blockerande schema-/dataintegritetsdefekt hittades.** Följande begränsningar behöver däremot stå uttryckligen i release-/rollbackbeskrivningen.

`src/server.js:55–57` öppnar kontrolldatabasen och anropar `createLoginRateLimiter(controlDb)`. `src/login-rate-limit.js:17–21` kör additiv `CREATE TABLE IF NOT EXISTS`. Det är en **Node-schemaändring vid serverstart**, utan ny versionsstyrd SQL-migrationsfil. Tabellen skapas inte av `openDatabase()` ensamt, tillförs inte automatiskt separata företagsdatabaser och ingår inte i Sites migrationsschema.

En äldre databas utan tabellen får en tom budget när den nya serverns limiter startar. Om tabellen finns bevaras kontoetiketten, räknaren och sluttiden. Den innehåller bara den fasta etiketten administrator, försöksantal och tid; inga lösenord, sessioner eller IP-adresser lagras där.

**Strukturell rollback är inte bibehållen säkerhetsfunktion.** Äldre databas-/backupkod accepterar den extra tabellen och den behöver inte raderas. Men basens äldre server läser inte tabellen utan använder en processlokal, IP-bunden Map. En gammal instans eller blandade versioner ger därför inte den nya beständiga kontogemensamma budgeten. Tenant-omedveten kod får inte heller öppna företagsbunden data vid rollback.

`src/backup.js` använder VACUUM INTO för den valda SQLite-filen. Kontroll-/legacybackup inkluderar därmed loginräknare/sluttid, medan backup av en separat företagsdatabas inte automatiskt säkerhetskopierar den centrala loginbudgeten. Återställning bevarar den fångade sluttiden. Utgånget fönster medger nytt försök; försök efter snapshoten följer inte med. Loginspärren är således **inte monoton över återställning av äldre snapshots**.

`docs/SECURITY-95-REVIEW.md:128–130` nämner redan hel databasbackup och sluttid, men saknar full upp-/nedgraderingspolicy samt skillnaden mellan kontroll- och företagsbackup. Formuleringen ”inga migrationsfiler ändras” är riktig. ”Ingen schemaändring” vore fel för den samlade kandidaten.

### Kompletterad konkret restore-probe

De befintliga 512 testerna gav inget direkt krypterat backup→restore→limiter-bevis. Därför skapades `login-limiter-restore-probe.test.mjs` **utanför repositoryt**, med den frysta kandidatens faktiska SQLite-/krypterings-/restoremoduler. Den körde:

1. Snapshot med två reserverade försök, därefter tre fler i källan: återställningen behåller två och den exakta sluttiden, medan källan fortfarande har fem. Tre nya tillåtna försök når åter samma 429-spärr. Detta visar också den dokumenterade snapshotgränsen.
2. Snapshot med full budget: restore blockerar fram till sluttiden och öppnar exakt därefter ett nytt femtonminutersfönster.
3. Krypterad äldre snapshot utan tabellen: `openDatabase()` skapar ingen loginstate; limiterstart lägger till den tomma tabellen och ett första försök fungerar.

Utfall **3/3**, exit 0. Probe-SHA-256 `83da55693dadbe6d0df8ba246e9611a05d237716e5a2374958237a96c19b9d11`; logg-SHA-256 `3c1ab81c76b20aed677268c64329933da3ae7737da803f8e3f6be50633dad2ec`. Ingen produktionskod ändrades och inget RED→GREEN påstås. Dessa fall är kompletterande acceptansbevis; de är inte införda i repositoryts regressionssvit.

```sh
NODE_ENV=test NODE_OPTIONS=--max-old-space-size=1024 \
/home/agent/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node \
  --import /workspace/scratch/a96c4ccdbd4d/verification-5414/scripts/saas-test-isolation.mjs \
  --test /workspace/scratch/a96c4ccdbd4d/verification-5414-evidence/login-limiter-restore-probe.test.mjs
```

## Utvalda exakta källhashar

Det fullständiga manifestet innehåller alla 1 260 filer, inklusive samtliga test-/fixture-/migrationsfiler. Här är särskilt relevanta gränser:

| Fil | SHA-256 på 5414e226 |
| --- | --- |
| `src/server.js` | `8bf48b1b108b364c6b2467adea8741a1780de1d2b2f4bb022043f05a408fdce4` |
| `src/db.js` | `fed7ade267ab959966d6b5230daecf3066fe8da2835f680644ee4dcfa68a423a` |
| `src/login-rate-limit.js` | `b99d802e8b221697f16df0a58a07b49c88172561729ed248392dbf6702d35ddb` |
| `src/backup.js` | `68fcf28489d40b1acd107f404969b4188e225ee3dd554a5d4892fb4975dd03fa` |
| `test/security-login-rate-limit.test.js` | `2ddb3b0b528a6d457a7985849f48fe4615e61a69a3e686c3731b0f0429a6b2ab` |
| `test/quality-regressions-migration-replay.test.js` | `e9fe8c6f212218e0492dcc45a63a6c2e840e31ebecd0ed4ff4e0d6d0b13d0b0d` |
| `test/quality-regressions-recovery-api.test.js` | `bac1ba9787a4c7afc81fceed895a45d4018fec2297579a8f6d499ec321bfab2f` |
| `sites/scripts/recovery-drill.mjs` | `5a80d1f5335ade1860b6e61f278a81d8c0df11818c38ce5f950e86a12da7dd89` |
| `sites/scripts/lib/recovery-acceptance.mjs` | `79da81aba22c6579fc7730a3bca5f44c6e3967d68c9489e041fc9eeaf5b21fcf` |

## Kvitton

- `snapshot.json`: head/tree, arkiv och beroendemanifest.
- `source-manifest-before.json` och `source-manifest-after.json`: samtliga Git-blobs, SHA-256 och byteantal.
- `test-files.txt`: 24 kompletta filer, inga namnfilter inom dem.
- `run-start.json` och `run-result.json`: exakta kommandon, tider, miljö, counts, logg-/källhashar och separat probe.
- `tests-node22.tap`: full körlogg för de 512 testerna.
- `login-limiter-restore-probe.test.mjs` och `login-limiter-restore-probe-node22.tap`: granskningsbar separat implementation och utfall för de tre nya acceptansfallen.

Ingen push, källändring, workflowdispatch, deployment eller produktionsåtgärd utfördes av denna granskare. Root ansvarar för slutlig full CI och källbindning efter kommande ändringar.
