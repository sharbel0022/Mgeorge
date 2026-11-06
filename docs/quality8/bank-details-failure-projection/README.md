# Begränsad felprojektion efter Site 66

## Verklig utgångspunkt och avgränsning

Root rapporterade publicerad Site 66 från main `0035ea89ef3cd60f0924f901503cad00d1ab1fca` och native `0b119b8d472f70a1bfeac686c12889b618a32fb2`, med 7 569 godkända CI-fall. Ett enda normalt `bank_revalidate_consent` gav originalavslaget `BANK_ACCOUNT_SCOPE_INVALID` / `ACCOUNT_USAGE_INVALID`: sparat explicit null 1, live omitted 1. Den nya diagnosen var:

```json
{"version":"selected-account-usage-details-v1","targetCount":1,"attemptedCount":1,"observedCount":0,"status":"unavailable","reason":"DETAILS_PROVIDER_UNAVAILABLE"}
```

Ingen usageklass returnerades. Root läste därefter begränsade Worker-errorloggar (errors_only, tio minuter, högst tjugo poster): två info-GET med outcome ok, ingen transportmarkör eller providerorsak. Dessa driftuppgifter är rootrapporterade och har inte återskapats genom ytterligare bankanrop här.

`attemptedCount` ökas före `getAccountDetails`. Svaret bevisar därför ett startat adapterförsök, inte ett skickat eller lyckat HTTP-anrop. Samma catch döljer transport/timeout, mappade providerfel, adapterkontraktfel och möjliga readguard-fel. Frånvaro av `BANK_PROVIDER_TRANSPORT_ERROR` i begränsade loggar avgör inte orsaken; timeout, mappade HTTP-fel och `invalidResponse` skriver inte den loggmarkören.

## Minsta ändring

Behåll samtliga befintliga fält och det ursprungliga avslaget. Endast en redan otillgänglig detaljdiagnos kan få ett frivilligt `providerFailure`:

```json
{"code":"INVALID_PROVIDER_RESPONSE","validationIssue":{"field":"cash_account_type","kind":"null"}}
```

Detta är ett syntetiskt formatsexempel, inte en diagnos av det verkliga kontot.

- Koden hämtas bara från `providerErrorCode`, som använder adapterns privata konstruktörsregister, och måste finnas i tjänstens befintliga fasta kodallowlist.
- `validationIssue` kommer endast från `providerResponseDiagnostic` och bara för `INVALID_PROVIDER_RESPONSE`. Den innehåller endast ett fast fältnamn och typen absent/null/string/object/array/other.
- Inga publika errorfält, getters, meddelanden, providertexter, statusvärden, kontonummer, UID, hashvärden eller användningsvärden kopieras.
- Okända eller förfalskade fel behåller dagens generiska diagnos. Ett ospecificerat fält hittas inte på för exempelvis ogiltig JSON.
- Samma slutliga failed-audit, ägar-/kontext-/runtime-/giltighetskontroller krävs före publicering. Partiella resultat får inga usage-counts.
- Ingen ny endpoint, GET, retry, normalisering, behörighetslättnad, statusändring, snapshotuppdatering eller ekonomisk ändring införs.

## Hur nästa verkliga svar kan användas

| Kodfamilj | Konkreta nästa steg |
| --- | --- |
| `INVALID_PROVIDER_RESPONSE` | Jämför det angivna fältet/typen med dokumenterat adapterkontrakt. Det visar att valideringen inte kunde godta svaret, inte att kontot är ORGA eller att kontroller får slopas. |
| `BANK_NETWORK_ERROR`, `BANK_TIMEOUT`, `BANK_SERVICE_ERROR` | Transport/tillgänglighet behöver utredas. Dessa koder bevisar inte utgånget medgivande. |
| `BANK_RATE_LIMIT` | Bevara providergrundad väntetid eller osäker spärr. Ingen automatisk extraläsning. |
| `BANK_RECONNECT_REQUIRED`, `BANK_ACCOUNT_UNAVAILABLE`, `BANK_ACTION_REQUIRED` | Hantera faktiskt medgivande, kontotillgång eller bankens användaråtgärd via ordinarie flöde; inga härledda rättigheter. |
| `BANK_USER_CONTEXT_REQUIRED` | Kontrollera det verkliga användarkontextkravet. Hitta inte på PSU-headers. Detaljadaptern tar i dag inte emot PSU-parametrar. |
| `PROVIDER_AUTHORIZATION_FAILED`, `PROVIDER_ACCESS_DENIED`, konfigurationsfel | Kontrollera serverapplikationens behörighet/konfiguration. Detta är inte bevis för att användarens BankID måste förnyas. |
| Ingen betrodd kod | Orsaken förblir okänd. Ingen tolkning som konto- eller samtyckesfakta. |

En vanlig appinloggning ersätter inte den ogiltiga sparade null-snapshoten. Med befintlig kod är normal **Förnya anslutningen** med verklig providerauktorisation den enda vägen till en ny icke-tom `encrypted_accounts`. Callback kräver nytt och färskt validerat providersvar samt separat aktuell bank-/providerbaserad företags-/kontobindning. Därefter krävs uttryckligt tillåtet kontoval. Även ett framtida detaljerat ORGA-svar skulle fortsatt lämna originalavslaget kvar. Det aktuella generiska felet visar inte om förnyelse behövs för själva detaljläsningen eller skulle lyckas.

## RED och fokusgrindar

Den isolerade basen är exakt main `0035ea89`; `origin/main` hämtades och var samma commit. Tre testharnessar återexporterar adapterns redan befintliga `providerResponseDiagnostic` inför den nya importen. En befintlig exakt femtefallsförväntan stärks med det avsiktliga nya `BANK_TIMEOUT`-fältet; dess gamla avslag, antal, sekretess och oförändrade rader kvarstår. Alla andra befintliga testkroppar bevaras.

Nya syntetiska fall prövar verkligt HTTP-mappade fel och adaptervalidering, alla sex fälttyper, generisk JSON-/transportavvisning, getter/proxy/prototypförfalskning, okänd konstruktörskod, partiell läsning, förlorad read-marker, audit/kontext/giltighetsgränser och verklig MCP-projektion. Testnätet är blockerat med `saas-test-isolation.mjs`; bankgränsen använder enbart syntetiska svar.

Första faktiska RED på byteoförändrad produkt: **37 fall, 12 godkända och 25 assertionsfel**, exit 1, inga skip/cancel/TODO. Alla 25 fel är den saknade förväntade `providerFailure`-projektionen; inga import-, syntax- eller transporthinder. Råloggen är `red.tap` (SHA256 `7a1add3166f8c6668de3d2b6fdacd33f6e7f814832ad526a9e7924233adb4f88`). De tolv redan gröna fallen skyddar spoofing, audit/kontext och förlorad read-marker. `base-manifest.json` binder kod och testfiler före produktändring.

## Fryst produkt och faktiskt slutresultat

- Bas: `0035ea89ef3cd60f0924f901503cad00d1ab1fca`.
- Fryst RED: `9c1078cadfbca8923213f066cef1476c612796c6`.
- Fryst produktfix: `92b6fefe60c31d8f862f6d93f2d422e777801390`.
- Enda ändrade produktfil: `sites/lib/banking/service.ts`, 14 tillagda och 6 borttagna rader; SHA256 `cc3114a7bb7a9e4d013a50d7740d9b1f1389a47861a46c44d47e9b061d8e628d`. Exakt ändring finns i `product.diff`.
- Adapter, policy/typer, readguard, store, MCP, kontoevidens och företagsbehörighet är byteoförändrade. Alla tre testfiler är byteidentiska mellan fryst RED och granskad produkt. `source-manifest.json` och `test-preservation.json` visar jämförelserna.

| Faktisk körning | Resultat | Tid | Max-RSS |
| --- | --- | --- | --- |
| Fryst RED, 37 relevanta fall | 12 pass / 25 förväntade assertionsfel; exit 1 | 9,191 s | 418 696 KiB |
| Samma oförändrade 37 fall efter fix | 37/37; exit 0 | 10,026 s | 421 108 KiB |
| Hela berörda serviceharnessarna: banking-security, company-bank-sync och bank-sync-integrity-q8 | 357/357; exit 0 | 63,390 s | 806 916 KiB |
| Guarded TypeScript från `sites` | exit 0, tom fellogg | 13,570 s | 938 360 KiB |

Samtliga testkörningar har noll skip/cancel/TODO. De 37 fokuserade fallen ingår i slutkörningens 357 och summeras inte igen. Körningarna använder Node 24.22.1, `NODE_ENV=test`, nätisolering och `--test-concurrency=1`. Råa TAP-loggar och separata maskinläsbara kvitton finns intill rapporten. Ingen körning avbröts eller räknades om till godkänt. Full projekt-CI har inte körts i denna avgränsade ändring; root hanterar den integrerade kandidaten.

**Producentens överlämning är klar för separat oberoende granskning.** Granskaren bör använda exakt `92b6fef`, jämföra mot `9c1078c`, behålla original409 och pröva egna förfalskade fel, partiell diagnos och audit/kontextgränser. Det här dokumentet är inte ett oberoende READY-kvitto.

Ingen ny bankläsning har gjorts och Site 66:s verkliga bakomliggande fel är fortfarande okänt. En framtida tillåten normal revalidering måste först använda publicerad, granskad kod och klara alla befintliga väntetider och behörighetsvillkor. Ingen konto- eller företagsfakta, aktivering, BankID-framgång eller kvalitetspoäng härleds från de syntetiska testerna. Alla poäng är oförändrade; denna arbetskopia gör ingen produktionsmutation, merge eller publicering.

Kodreferenser i basen: `sites/lib/banking/service.ts` (`usageDetailsLease`, `revalidateConsent`, `bankFailure`), `sites/lib/banking/enable-banking.ts` (`providerErrorCode`, `providerResponseDiagnostic`, `providerRequest`, `getAccountDetails`), `sites/lib/banking/account-read-guard.ts` (`guardedBankRead`).
