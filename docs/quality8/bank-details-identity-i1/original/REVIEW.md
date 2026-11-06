# Oberoende bankgranskning av 638c7736

## Beslut: Important-fynd, inte READY

Granskad commit är `638c77365dbf8f4c73db6b23816a37f577da5689`, med bas `41aadcef5fc6f65cc73979997b195c7b4f12eec1`. Granskningen använder en egen `git archive`-snapshot. De tre produktfilerna har efter körningarna verifierats byte för byte mot den exakta committen. Produktkoden har inte ändrats. Detta är en ny oberoende review; ingen slutsats eller provkörning från den tidigare förlorade reviewen räknas här.

Bankdelen bör inte integreras eller publiceras förrän nedanstående identifierarkonflikt är rättad och de röda motproven är gröna. Inga Critical-fynd har verifierats. Ett sammanhållet Important-fynd är verifierat med flera reproduktioner.

## I1 — Motsägande primäridentifierare kan publiceras som en komplett detaljobservation

**Källa:** `snapshot/sites/lib/bank-consent-policy.js`, `primaryIdentifiers` och `observeAccountUsageDetails`, raderna 147–184, särskilt jämförelsen på rad 184. Tjänsten publicerar resultatet genom `snapshot/sites/lib/banking/service.ts`, raderna 737–748 och 784–788. Designkravet finns i `docs/quality8/bank-null-usage-details-design.md`, invariant 7 (rad 31) och matrisraden Färsk konflikt (rad 57).

`primaryIdentifiers` kan skapa flera olika värden för samma schema. Observatören jämför sparade och aktuella identifierare mot det färska svaret, men kontrollerar varken en resurs mot sig själv eller sparad mot aktuell när färska identifierare saknas.

Det starkaste tjänsteprovet använder vanlig syntetisk JSON. Ett redan valt explicit-null-konto har identiska sparade, aktuella och färska primärhashar. UID och valuta är rätt. Det färska svaret innehåller två olika primära IBAN:

```js
account_id: {
  iban: 'SE4550000000058398257466',
  other: {
    scheme_name: 'IBAN',
    identification: 'SE4550000000058398257474'
  }
}
```

Numren är enbart syntetiska testvärden. Tidigare resurser har BBAN och saknar jämförbar IBAN. Den oförändrade riktiga `getAccountDetails`-adaptern accepterar båda fälten. Genom ordinarie `revalidateConsent` returneras sedan:

```js
{
  version: 'selected-account-usage-details-v1',
  status: 'observed',
  reason: 'EXACT_SELECTED_DETAILS_OBSERVED',
  targetCount: 1,
  attemptedCount: 1,
  observedCount: 1,
  usage: { omitted: 0, orga: 1, priv: 0, explicitNull: 0, otherString: 0, wrongType: 0 }
}
```

Förväntat är `status: 'unavailable'`, `reason: 'DETAILS_ACCOUNT_CONFLICT'`, `observedCount: 0` och inga `usage`-kategorier. Den ursprungliga `ACCOUNT_USAGE_INVALID`/409 består, hela anslutningsraden förblir oförändrad och ingen aktivering, workspace eller ekonomisk synk skapas. Fyndet gäller därmed den kompletta diagnosens tillförlitlighet, inte ett verifierat auth- eller aktiveringsintrång.

Två ytterligare rena policyreproduktioner visar samma jämförelselucka: sparad BBAN A och aktuell BBAN B accepteras när färskt `account_id` saknas; en internt motsägande sparad IBAN-resurs accepteras också när färskt `account_id` saknas. Dessa är policyfall, medan det färska interna konfliktfallet dessutom har verifierats genom både riktig adapter och ordinarie tjänst.

**Rättningsriktning:** jämför primära identifierare för samma schema inom och mellan alla tre resurserna. En uttrycklig konflikt måste avvisas även om färska identifierare saknas. Behåll legitim frånvaro, exakt primärhashbindning och den ursprungliga avvisningen. Inför inga alias, gissningar eller automatisk reparation. Gör de bevarade policy-, adapter- och tjänstemotproven gröna.

## Faktiska egna körningar

Alla körningar använder Node `v24.22.1` på `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`, `NODE_ENV=test`, repositoryts isolationpreloader och testkonkurrens 1. Typecheck kördes från snapshotens `sites` med `scripts/run-verified-tool.mjs check`.

| Körning | Tester | Pass | Fail | Cancel/skip | Exit | Rå logg |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ny policy, första körningen | 59 | 59 | 0 | 0/0 | 0 | `logs/policy-59.tap` |
| Fokuserad service/MCP-regression | 120 | 120 | 0 | 0/0 | 0 | `logs/service-regression.tap` |
| Policy/adapters/provider-regression | 286 | 286 | 0 | 0/0 | 0 | `logs/policy-adapters-provider.tap` |
| Egna tjänsteprov för hel/partiell mängd och auditgränser | 6 | 6 | 0 | 0/0 | 0 | `logs/reviewer-service-probes.tap` |
| Eget tjänsteprov: motstridiga färska IBAN genom riktig adapter | 1 | 0 | 1 | 0/0 | 1 | `logs/reviewer-service-identity-conflict.tap` |
| Egna policydelprov | 5 | 2 | 3 | 0/0 | 1 | `policy-probes/policy-identity-conflicts.tap` |
| Egna adapterdelprov | 2 | 1 | 1 | 0/0 | 1 | `policy-probes/adapter-primary-conflict.tap` |
| Sites typecheck, slutligt försök | — | — | — | — | 0 | `logs/sites-typecheck-physical-deps.log` |

De första 59 policyfallen ingår även i 286-körningen och ska inte dubbelräknas. Det finns 406 unika befintliga gröna regressionstestfall i 120+286-körningarna. De 14 egna riktade fallen ger 9 pass och 5 fail; alla fem röda assertioner reproducerar samma Important-fynd. De är inte godkända tester. Den första 59-loggen och policydelprovets logg använder Nodes standardreporter `spec` trots `.tap`-filändelsen; övriga testloggar använder TAP.

De sex gröna egna tjänsteproven verifierar: komplett femkontomängd med blandade usage-kategorier och saknad valfri UID; providerfel på femte kontot efter fyra lyckade svar utan partiella kategorier; ändrad appmetadata atomiskt vid sista failed audit; förlorad auditkvittens efter commit; ändrad anslutningskontext efter auditcommit; samt deadline som löper ut efter sista svaret men före auditkvittens. Alla behåller avvisning och förhindrar positiva kategorier där kontext eller audit inte kan bestyrkas.

## Granskat och verifierat

Design, plan, ledger, fryst RED, leveransevidens och produktdiff har lästs. Den nya policybindningen och snapshotkopieringen, planeringen, primärhash-/UID-kontrollerna, observationskategorierna, tjänstens begränsade anropsplats, sekventiella reads, strikta cooldown, kontext/deadline-fence och failed-audit-publicering är granskade. Relevanta delar av `account-read-guard.ts`, provideradaptern och testharnessen har lästs.

Tjänstesviten kontrollerar bland annat autentisering, ägar-/företagsgränser, adoption, runtime/generation, metadataarrayer, cooldown, maxantal, allselected-hashpreflight, detaljkonflikter, partiella svar och auditfel. Den gröna policysviten omfattar förfalskade eller främmande fel, ändrad input, vanliga getters och planproveniens. Detta är vad den faktiskt körda populationen visar; ingen obegränsad säkerhetsgaranti lämnas.

Hela `account-evidence.ts` är byteidentisk med basen och den granskade committen. Källhashar och exakta jämförelser finns i `source-verification.json`. Producentens påståenden om andra gamla matriser och 48 importkonsumenter har inte räknats som egna körningar. Full CI lämnas till root på integrationskandidaten. Inga verkliga bankuppgifter eller produktionseffekter har observerats i denna review.

## Körhinder och miljö

Första Sites-checken avbröts med exit 1 av repositoryts minimatch-beroendeguard eftersom granskningskopian använde en symlänk för `sites/node_modules`. Detta var ett lokalt granskningsuppläggsfel. Loggen finns i `logs/sites-typecheck.log`. En därefter felplacerad shellrad fick ett redirectionsfel innan Node/check ens startade; det är inte en typkontroll och räknas inte som sådan. En fysisk kopia av samma befintliga beroenden skapades i snapshoten, och den slutliga oförändrade check-kommandoraden från `sites` avslutade exit 0. Loggen är tom, vilket är normalt vid lyckad kontroll.

Inga exec-transportavbrott inträffade i de här redovisade slutliga körningarna. Tidigare avbrutna eller ej genomförda aktiviteter har inte räknats som pass. Inga produktionsanrop, riktiga bankanrop, hemlighetsinspektioner, produktändringar, merge, publiceringar, V3-ändringar eller poängändringar har gjorts av denna review.

## Bevarade artefakter

- `REVIEW.md`: denna rapport.
- `review-evidence.json`: exakta kommandon, utfall, hashmanifest och begränsningar.
- `source-verification.json`: de exakta granskade produktkällorna mot commit och bas.
- `product.diff`: den bevarade produktdiffen.
- `snapshot/sites/tests/reviewer-usage-details-six.test.mjs`: exakt sexfallsstadium av den egna harnessen.
- `snapshot/sites/tests/reviewer-usage-details.test.mjs`: harness med även det röda ordinarie tjänstefallet.
- `policy-probes/policy-review.md` och `policy-review-evidence.json`: separat granskare, policy-/adaptermotprov, källor, kommandon och hashar.
