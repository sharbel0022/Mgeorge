# Oberoende slutgranskning — PR49, 0ce2604

**Kodbeslut: GODKÄND inom nedanstående omfattning. Inga blockerande integrationsfel identifierade.** Full CI är ännu inte avslutad vid kvittot. Detta är ett oberoende kodgranskningskvitto, inte ett godkännande av produktionslansering.

## Versionsbindning och omfattning

- Publicerad PR: https://github.com/sharbel0022/Mgeorge/pull/49
- Commit: `0ce2604de16b77bf96ff76ccedab115f61a3f9ac`.
- Git-träd: `50d1ec1226d7ced62bb640707740244c4504ab4c`.
- Lokal kontrollcommit `1e510281ccc57b02608c9cb1a0570437c65237e9` har exakt samma träd.
- Jämförelsebas för sista konfliktsyntesen: `8fa3ed8b12f1789308cfd608cbbeacbc04a685eb`.
- GitHub-kontroll 2026-11-05 cirka 19:18 UTC: PR49 är öppen, draft, mergeable och har fortfarande exakt ovanstående head.

Granskningen är skrivskyddad och bygger på Git-objekt, tidigare oberoende delgranskningar, aktuella GitHub-API-svar och lästa lokala testloggar. Ingen ny testkörning, repoändring, checkout, workflowstart, bankhämtning eller OCR-dispatch gjordes. Jag har inte författat den granskade sista konfliktsyntesen.

## Alla frysta producentversioner ingår

Varje relation kontrollerades separat med `git merge-base --is-ancestor` mot 0ce2604; samtliga gav exit 0.

| PR | Exakt producent-head | Ingår som ancestor |
| --- | --- | --- |
| 45 | ac1abdc5469248eba212496af4a4573864908ace | Ja |
| 46 | 732bfb3f16abde42c19bcef796ec1070cb3e7a09 | Ja |
| 47 | 875876ae539f5ecba1fc39d4c213197806e245ce | Ja |
| 50 | 1619c0e3a63b922c75a7f46d493d39e68075952f | Ja |
| 51 | 0954777f10da8be9fb15daf3878c539b51801142 | Ja |
| 52 | eb4242f783172ac441f9092f921b04b06dc11771 | Ja |
| 53 | d9ca037a90ef9c9e629f62c4dcbf9cfcdeacb459 | Ja |
| 54 | 3db9f01305aa6830a4c2d1cc01970c06b91018c2 | Ja |

Den publicerade första-föräldra-kedjan behåller separata logiska integrationscommits för producentleveranserna och den ursprungliga Open Payments-rättningen `9a531da`. Det lokala alternativet 1e510 används som trädidentiskt testkvitto, inte som påstådd publicerad mergekedja.

## Konfliktlösningarna bevarar befintliga tester

**Bank-fixturen:** `sites/tests/banking-security.test.mjs:29–43` använder innehållshashade temporära moduler, unik katalog, exklusiv filskapning, mode 0600 och bortstädning efter sviten. Hela återstoden från `function compiledModule(` till EOF är byteidentisk med 8fa3. Den är 156 162 byte med SHA256:

`380e500d6facb74be53b0ffda9ea5f64354470b23500936684e826cef4a37c3b`.

Det bevarar de 203 integrerade bankfallen, deras importmappningar och assertions. Ingen dubbel import/cachedeklaration återstår i det granskade prefixet. Hela slutfilens SHA256 är `40290361fe8f26260cac3c1debbb2b83c9bf430a58c582c1a9069a6362c9993c`.

**OCR-fixturen:** hela `sites/tests/document-queue-recovery.test.mjs` från 8fa3 är oförändrat prefix i slutfilen. Prefixets SHA256 är `4ce41e217fb9d76d1610bd0ebd2dc3d1fafdaf4a7c42972b1d3819c257422c61`. De tidigare 32 köfallen bevaras. Tillägget på rader 374–421 kör faktisk route och request-wrapper med syntetiska plattformsgränser och innehåller fyra nya fall:

1. Giltiga 120 000 flerbytetecken accepteras, med exakt en dispatch och oförändrat original.
2. Över 600 000 transportbyte avvisas före dispatch.
3. Över 150 000 texttecken avvisas fortsatt av domänvalideringen.
4. Över 350 000 råa JSON-tecken avvisas fortsatt av domänvalideringen.

Hela slutfilens SHA256 är `07a52f3cb332eb8720cf729e00b34f11c12ee96daf4e72a99940c44f4c1806e8`. Tilläggets funktions-/testinnehåll, utan de två inledande separationsradbrytningarna, har SHA256 `c89e668a6db170c5d73f615815dc3137abae8edb0147280c6951630e0cd0fd40`; den råa append-strängen inklusive dessa radbrytningar har `1b7515323e9992b4e6e2f385b38be62e8f80b3d2b84858ba04bfd615a9fc76a7`. Det förklarar den olika hashavgränsningen i säkerhetsrapporten.

## Runtimeöverlappen är bevarade

| Granskad gräns | Kodbevis i exakt 0ce2604 | Bedömning |
| --- | --- | --- |
| PR45:s callback, generation, behörighet och consentläsning | `sites/lib/banking/{service.ts,store.ts,runtime-config.ts,account-read-guard.ts,details-service.ts}` är byteidentiska med ac1abdc. Strikt resolver finns i runtime-config 16–36; revalidate börjar i service 705. | Producentens efter-await-kontroller, aktuella grants, atomiska appmetadata-grindar och aktuella health-projektioner bevaras. |
| PR49:s tvetydiga Open Payments-skrivningar tillsammans med PR45 | Mot granskad 77e7591 har `openpayments/http.js` bara den avsiktliga utvidgningen till alla icke-GET-metoder, inklusive DELETE. `openpayments-provider.js` har bara PR45:s kontotillgänglighetskontroll som tillägg. HTTP 132–156 och provider 17–20, 143, 225–266 behåller ambiguity-markering efter accepterat men ogiltigt/oläsbart svar. | Ingen automatisk osäker omsändning återinförs; DELETE:s okända utfall markeras också. |
| PR50:s consentåterhämtning | `openpayments-lifecycle.js` och `saas-bank-runtime.js` är byteidentiska med 1619c0e. Lifecycle 7–9, 30–50 behåller not_started/pending/known, consentRequested, createdConsentHandle och retrySafe. | Fel före consentfasen kan hanteras säkert; känt eller osäkert skapat consent spärrar ny start. Handle finns kvar även om lagring direkt efter skapandet fallerar och fångas upp. |
| PR54:s centrala loginspärr och PR45/50:s Node-serverändringar | `src/login-rate-limit.js` och `test/security-login-rate-limit.test.js` är byteidentiska med 3db9f01. Diffen i `src/server.js` mot 3db9 avser bara PR45:s consentdiagnostik och PR50:s skrivfria bankstatus/exportaudit. | PR54:s budgetreservation, kontrollDB-koppling, inloggningsflöde och requestgränser tappas inte i syntesen. |
| PR52:s OCR och PR54:s bytebudget | `sites/lib/server.ts:21–26` är byteidentisk med 3db9 och begränsar completion till 600 000 byte. `sites/lib/document-processing.ts:378–381` behåller 350 000 JSON-tecken, 150 000 texttecken samt lease-, ägar-, original- och resultatvalidering. | UTF-8-kompatibiliteten återställs utan att domänens teckengränser höjs. |

Den nya permanenta kontrollDB-regressionen i `test/security-login-rate-limit.test.js:127–185` använder faktisk krypterad backup/verify/restore, avvisar fel nyckel och ändrad ciphertext före målskapande, bevarar källan och spärrens absoluta sluttid samt verifierar fortsatt 429 före expiry och ny budget efter expiry. Detta är syntetisk kontrollDB-återställning. Det bevisar inte att driftens företagsbackup automatiskt innehåller den centrala kontrollDB:n och förändrar inte den tidigare dokumenterade rollback-/restoregränsen.

## Test- och CI-kvitton

Jag har läst följande slutloggars sammanfattningar; de är utförda av säkerhetsgranskaren/root på det träd som nu verifierats identiskt med 0ce2604. Jag har inte kört om dem:

| Logg under /workspace/scratch/a96c4ccdbd4d/ | Lästa resultat |
| --- | --- |
| `pr54-final-combination-node22.tap` | 7/7, inga fail/cancel/skip/TODO |
| `pr54-final-combination-sites-node22.tap` | 271/271, inga fail/cancel/skip/TODO |
| `pr54-final-combination-typecheck-node22.log` | check/minimatch/TypeScript slutförd utan typfel; exit 0 dokumenterat av utföraren |

Sites-fördelningen 203 bank + 18 company-request + 36 OCR-kö + 14 requestbudget = 271 framgår av utförarens versionsbundna rapport `pr54-review.md`. Delsviter överlappar tidigare körningar och ska inte summeras som nya unika helsviter.

GitHub-API-snapshot cirka 19:18 UTC:

| Grind | Observerad status |
| --- | --- |
| [SaaS security acceptance 42091716587](https://github.com/sharbel0022/Mgeorge/actions/runs/42091716587) | completed / success |
| [Payment control checks 42091716726](https://github.com/sharbel0022/Mgeorge/actions/runs/42091716726) | in_progress |
| Node 22.23.4 och Node 24.22.1 | Båda success |
| Chromium, Bankgiro SFTP och syntetisk 1/10/100-företagsprestanda | Alla success |
| Sites types, tests and production build | in_progress |

Snapshot sparas även i `final-aggregate-review-0ce2604-evidence.json`. Full CI ska bli grön på exakt slutversion innan root stänger integrationsgrinden. Senare dokumentcommit eller headflytt får eget versionsbundet kvitto.

## Beslut och signatur

**Oberoende kodgranskning: GODKÄND för exakt 0ce2604 / 50d1ec12, med avslutad slut-CI kvar som separat grind.** Inga ytterligare kodändringar rekommenderas av denna granskning.

Rootens 250/330 är en separat evidensbaserad kvalitetsbedömning och räknas inte om i detta kvitto. Kommersiell produktionslansering förblir **NOT APPROVED**. Lokala syntetiska tester och grön CI ersätter inte verifierad faktisk bankåtkomst, konfigurerad Bankgirokälla, oberoende operativ produktionsåterställning eller exakt bindning mellan publicerad Siteskälla och kandidaten.

Signerat som granskningsattest (ingen kryptografisk GPG-signatur):
**/root/bank_review/pr45_transport**
**2026-11-05 UTC**
Granskat objekt: **0ce2604de16b77bf96ff76ccedab115f61a3f9ac**
Träd: **50d1ec1226d7ced62bb640707740244c4504ab4c**
