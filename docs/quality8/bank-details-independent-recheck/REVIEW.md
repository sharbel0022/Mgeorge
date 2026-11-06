# Oberoende omprövning av I1 — e66cde67

## READY

**Exakt granskad commit:** `e66cde6767ebd232e2b966eb2b002193ea0a0999`.

**Bas för fixen:** `638c77365dbf8f4c73db6b23816a37f577da5689`.

**Fryst RED:** `30aa6612a0d43006b9797dc5d0721fb1accd98e7`.

Det tidigare Important-fyndet I1 är stängt. Inget kvarstående Critical- eller Important-fynd har verifierats i denna avgränsade omprövning. READY gäller kodgranskningen av denna exakta bankkandidat. Integrerad CI, merge och publicering hanteras separat av root. Ingen kvalitetspoäng ändras och inga faktiska bankuppgifter härleds från syntetiska prov.

## Vad fixen gör och varför I1 är stängt

`observeAccountUsageDetails` samlar nu de primära identifierarna från det färska detaljsvaret, det sparade kontot och den aktuella sessionsresursen i en lokal lista. En `Map` kräver sedan ett enda exakt värde för varje schema. Olika värden för samma schema avvisas med `DETAILS_ACCOUNT_CONFLICT` innan en usage-kategori kan returneras.

Kontrollen täcker nu både en resurs som motsäger sig själv och motsägelser mellan resurser. Sparad/aktuell konflikt kan inte döljas genom att det färska svaret saknar `account_id` eller använder ett annat schema. Identiska dubbletter tillåts. Distinkta scheman jämförs inte med varandra. Legitim frånvaro förblir frånvaro. Den lokala listan skapas av `primaryIdentifiers`; ingen inkommande kontoresurs, privat plan eller sparad data muteras när identifierare samlas.

Exakt hashbindning och UID-kontroller utförs fortfarande före jämförelsen. Ingen normalisering, aliasmatchning, nummerreparation eller ändring av auth-/read-plan-gater har införts. Konflikten kan inte omvandlas till en usage-kategori.

## Faktiska egna prov på fixen

Jag kopierade den första reviewens tre testkällor byte för byte till en ny exakt `git archive`-snapshot. Dessa är de oförändrade fem policyfallen, två adapterfallen och sju ordinarie tjänste-/auditfallen. Inga importer behövde ändras eftersom samma katalogrelationer behölls. De sju extra kontrollfallen kördes från den nya snapshotens fyra frysta RED-testfiler, vars byteidentitet med RED-committen verifierades separat.

| Egen körning | Tester | Pass | Fail | Cancel/skip/TODO | Exit | Tid ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fryst policy + riktig adapter | 7 | 7 | 0 | 0/0/0 | 0 | 469.887524 |
| Fryst ordinarie tjänsteharness | 7 | 7 | 0 | 0/0/0 | 0 | 4479.108284 |
| Sju extra policy-/tjänstekontroller | 7 | 7 | 0 | 0/0/0 | 0 | 2278.120346 |
| Eget extra prov: intern konflikt på femte adaptersvaret | 1 | 1 | 0 | 0/0/0 | 0 | 1430.288012 |
| Sites guarded typecheck, slutligt försök | — | — | — | — | 0 | — |

**De begärda 21 fallen är 21/21 gröna. Med det egna extra riskprovet är resultatet 22/22.** Typecheck kördes från `snapshot/sites` med `scripts/run-verified-tool.mjs check`; den lyckade råloggen är tom.

Den första reviewens oförändrade 14 fall går från tidigare oberoende dokumenterade 9 pass/5 fail till nu 14 pass/0 fail. Den gamla RED-evidensen har inte skrivits över. Jag har inte räknat producentens 427 fall som egna nya körningar och har inte gjort en ny bred full CI.

## Beteenden som faktiskt verifierats

- Färskt `account_id.iban=A` tillsammans med `other:{scheme_name:'IBAN',identification:B}` avvisas när A och B skiljer sig. Detta är verifierat genom policy, den riktiga provideradaptern och ordinarie `revalidateConsent`.
- Sparad/aktuell BBAN-konflikt avvisas även när färska identifierare saknas eller har ett annat schema.
- Interna sparade och aktuella IBAN-konflikter avvisas även när färska identifierare saknas eller är icke jämförbara.
- Genuint frånvarande identifierare, identiska dubbletter och skilda scheman förblir observerbara med korrekt hash-/UID-bindning.
- De ordinarie tjänstefallen behåller original409 och `ACCOUNT_USAGE_INVALID`. Vid konflikt returneras ingen `usage`-räkning i detaljdiagnosen. Anslutningsraden förblir oförändrad; ingen workspace, ekonomisk synk eller lyckad revalidering skapas.
- Mitt nya riskprov kör fem detaljanrop genom den riktiga adaptern, med syntetiskt mockat HTTP. Fyra svar är konsistenta och det femte innehåller interna motstridiga IBAN. Resultatet är `unavailable/DETAILS_ACCOUNT_CONFLICT`, `targetCount:5`, `attemptedCount:5`, `observedCount:4` och inget `usage`-fält. De fyra tidigare observationerna publiceras alltså inte som positiva usage-kategorier.
- Den oförändrade tjänsteharnessen bevarar de sex tidigare gröna gränsfallen: komplett blandad femkontomängd, providerfel på sista svaret, metadataändring vid audit, förlorad auditkvittens, kontextändring efter auditcommit och deadline vid auditkvittens.

## Källor, frysta tester och bevarande

Producentens rena HEAD verifierades före arkivering. Sex relevanta produktfiler i den nya snapshoten verifierades mot `git show` för exakt e66cde. Oberoende bytejämförelse mot 638c773 visar att endast `observeAccountUsageDetails` ändrats: 8 tillagda och 1 borttagen rad. Policyns prefix och suffix runt funktionen är byteoförändrade. Därmed är båda validatorerna, `primaryIdentifiers`, den privata planbindningen och övrig policy oförändrade. Hela tjänsten, adaptern, typdeklarationen, account-evidence-läsaren och read-guarden är också byteoförändrade.

| Källa | SHA256 |
| --- | --- |
| `sites/lib/bank-consent-policy.js` | `1937e714693702c8dd2d26fe751b5519d92bf11e3a5767ce8dfe03eb67c58c43` |
| `sites/lib/banking/service.ts` | `5fb0f6883931fcefeb3be3b9df271b2f428232eaafad36c3bb8adfeafe5e5f24` |
| `sites/lib/banking/enable-banking.ts` | `c28a4576d73673652a242002e174dbbf91a3f3802f731fc8ffdfdc5c39a345a6` |
| `product.diff` | `cf6a8aa1456aaec655f6d0f3a11959e743c7cf6f52fea929816079ab819ee438` |

Den faktiska diffen matchar även den frysta diffen i fixens dokumentation. Alla 24 filer i den första reviewens manifest matchar fortfarande sina ursprungliga hashar. De fyra nya testfilerna matchar den frysta RED-committen. Den frysta harnessen återanvänds utan ändringar; det nya femkontoprovet ligger i en separat testfil.

Läst under denna omprövning: fixens README, hela evidence.json, produktdiffen, källverifieringen, den berörda observatören med primäridentifierarhjälparen, de sju extra kontrollfallen och relevanta originaltestkällor. Den första oberoende reviewens relevanta tjänst-/policybedömning återanvänds endast för de byteoförändrade delarna; dess förlorade föregångare räknas fortfarande inte som genomförd review.

## Miljö och begränsningar

Körningarna använder Node `v24.22.1` från `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`, `NODE_ENV=test`, repositoryts isolationpreloader, type stripping och testkonkurrens 1. Alla provideranrop använder syntetiska fixtures eller mockat HTTP. Inga riktiga bank- eller produktionsanrop har gjorts.

Första typecheckförsöket avbröts med exit 1 av beroendeguarden eftersom den nya granskningskopian hade hårdlänkade beroendefiler. Det var ett lokalt granskningsuppläggsfel och kontrollen nådde inte tsc. Loggen finns i `logs/sites-typecheck-initial-hardlink.log`. Jag ersatte beroendena med en fristående kopia och körde samma oförändrade guard från `sites`; det slutliga försöket avslutade exit 0. Ingen guard eller produktkod ändrades.

Den tidigare policydelgranskaren kunde inte återstartas på grund av agenttrådsgränsen. Omprövningen och de redovisade körningarna genomfördes därför av huvudreviewern. Inga transportavbrott eller avbrutna testkörningar inträffade. Producentens filer har inte ändrats. Inga hemligheter, livebankdata, V3-filer eller kvalitetspoäng har hanterats.

## Artefakter

- `review-evidence.json`: exakta kommandon, exitkoder, resultat och SHA256 för prov, källor och råloggar.
- `source-verification.json`: oberoende bytejämförelser mot exakt fixcommit och granskad bas.
- `preservation.json`: verifiering av ursprungliga 24 manifestfiler och fyra frysta RED-testfiler.
- `logs/`: fyra TAP-loggar, lyckad typechecklogg och det separat bevarade första guardfelet.
- `policy-probes/`: två oförändrade ursprungliga policy-/adaptertestfiler.
- `snapshot/sites/tests/reviewer-usage-details.test.mjs`: oförändrad sju-fallsharness från första reviewen.
- `snapshot/sites/tests/reviewer-i1-final-batch.test.mjs`: separat riskprov för konflikt efter fyra tidigare lyckade detaljsvar, körd med ett specifikt testnamnsfilter.
