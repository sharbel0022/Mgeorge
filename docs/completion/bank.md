# Bank och Bankgiro — avgränsad slutgranskning

Datum: 2026-11-06. Granskad bas: PR 61, `30dfaa97bb7ce2118b4756205347d4a96e8be6ab`.

## Beslut och evidensnivå

Verklig bankåtkomst och automatisk Bankgirohämtning är fortfarande blockerade. Leveransen omfattar en avgränsad korrigering av statusvisning för skadad lokal metadata, nya syntetiska regressionstester och denna rapport. Inga medgivanden, token, original eller ekonomiska uppgifter har ändrats. Ingen ny bank-/providerkörning, produktionsmutation, publicering eller push har gjorts. Tidigare gröna sviter är historisk evidens och får inte räknas som en färsk verifiering av slutkandidaten. De nya lokala körningarna redovisas separat nedan.

Läst underlag omfattar `AGENTS.md`, `PROGRESS.md`, `QUALITY-SCORECARD.md`, [bank/recovery-granskningen](../final95/reviews/bank-recovery.md), [Bankgirogranskningen](../final95/reviews/bankgiro-final-audit.md), [beredskapskvittot](../integration/bankgiro-readiness-receipt.json), [medgivandets livscykel](../integration/saas/openpayments-consent-lifecycle.md) och [diagnoskontraktet](../quality8/bank-details-failure-projection/README.md). Root ansvarar för aktuell integrerad CI, produktionsschema och releasebeslut. Denna rapport höjer inga kvalitetspoäng.

## Färsk driftinformation från root

Uppgifterna nedan kommer från roots godkända driftkontroll och [completion-baslinjen](baseline.json), inte från ytterligare anrop av denna delagent.

| Observation | Vad den innebär |
| --- | --- |
| Publicerad Site 66, native `0b119b8d472f70a1bfeac686c12889b618a32fb2` | Den publicerade tjänsten och den granskade PR-kandidaten är olika leveranser. |
| `connected=false`; senaste lyckade bankhämtning `2026-11-05T08:05:14.646Z` | Ett aktiverat automatreglage bevisar inte fungerande bankhämtning. |
| Vanlig revalidering gav endast `BANK_CONSENT_INVALID` | Ingen betrodd providerorsak följde med. Transportfel, appbehörighet och utgånget medgivande kan inte särskiljas från detta svar. |
| `companies=0`, `saas_bank_state=0`, en äldre `bank_connections`-rad | Det finns ännu ingen etablerad SaaS-företagsanslutning i den lästa driften. Root såg även att tokenkontrolltabellerna saknas; migrationsgrinden ägs av säkerhetsgranskningen. |
| Bankvyn anger att den äldre anslutningen saknar separat verifierad företagsbehörighet | Ett framtida `valid_until` eller en vanlig appinloggning etablerar inte den saknade behörigheten. |
| Bankgiro `DISABLED` / `SOURCE_NOT_CONFIGURED` | Ingen riktig Bankgirokälla är aktiverad eller verifierad. |

Nästa användaråtgärd för den äldre anslutningen är det ordinarie förnyelseflödet med verklig bank-/providerauktorisation, aktuell separat företags-/kontobindning och uttryckligt val av tillåtna konton. BankID behöver genomföras av användaren när banken kräver det. Detta följer av den saknade behörigheten; det generiska revalideringsfelet bevisar inte att förnyelse löser den okända providerorsaken eller att flödet kommer att lyckas. Koden får inte fylla i `ORGA`, skapa nya konto-snapshots eller återaktivera en session utifrån antaganden.

## Tekniska gränser som ska bevaras

Granskningsspåren i basen behandlar följande kontrakt. Färsk integrerad testning behövs för ett nytt godkänt kandidatbesked.

| Område | Kontrakt och begränsning |
| --- | --- |
| Företagskontext och usage | Enable Banking-session, uttryckligt kontoval, kontots användningsuppgift och separat företagsbehörighet är skilda kontroller. Null/utelämnad usage eller en detaljdiagnos får inte omvandlas till företagsbevis. Detaljförsökets räknare bevisar inte att ett HTTP-anrop skickades. |
| OAuth och callback | Applikationstoken är inte kundmedgivande. Callback ska vara bunden till state, aktuell användare, företag och engångskonsumtion. Det befintliga Open Payments-adapterkontraktet exponerar inte PKCE; tjänsten anger `pkce: not_exposed_by_adapter`. Detta får inte beskrivas som verifierat PKCE-stöd. |
| mTLS och token | Basens senare transport-/tokenarbete ersätter äldre dokumentationsuppgifter om saknad Workers-transport. Befintlig kod och lokala transporttester bevisar ändå inte installerat produktionscertifikat, verklig mTLS-binding eller produktgodkännande. Tokenkontrollens migration, behörighet och samtidighet måste verifieras i den avsedda driftsmiljön. |
| Pagination och återspelning | Enable Banking följer `continuation_key`, även efter tom sida. Open Payments använder `transactions._links.next`. Konto, period, ursprung och behörighet ska kvarstå genom hela hämtningen. Identiska underlag får inte skapa dubbla insättningar; samma belopp/referens räcker inte för att slå ihop olika bankhändelser. |
| Kontoisolering | Aktuell ägare/företagskontext, kontoval, samtyckesversion och runtime-generation måste gälla före och efter väntande providerarbete och före lagring. Roots säkerhetsändringar i delad tenantlagring granskas separat. |
| Bankgiroproveniens | Exakta original, hash, fångstkvitto, behörighet, betalarfält, samlingsinsättning och fakturarelation är separata bevis. Manuell koppling ger inte underlaget bankäkthet. |

### Reproducerat och avgränsat rättat metadatafel

`sites/lib/banking/service.ts` antog att parsad `bank_sync_runs.warnings` alltid var en array. Ogiltig JSON, `null` och objekt fick vanlig statusläsning att kasta; en JSON-sträng eller blandad array kunde nå klienten med fel typ. Samma antagande för `selected_accounts` kunde krascha status eller visa ett konto som valt trots att hela urvalet var ogiltigt. Detta reproducerades med syntetiska databasrader i den befintliga SQLite-/serviceharnessen, inte med ändringar i drift.

Den smala rättningen typkontrollerar listorna vid läsprojektion. Giltiga varningssträngar bevaras; ofullständiga varningar kompletteras med ett fast begripligt besked att efterkontrollens status är okänd. Ett felaktigt kontoval avvisas i sin helhet och visas med okänd kontovalsstatus. Befintlig `connectionHealth` avgör fortfarande behörighet och nästa åtgärd; inga rättigheter eller giltighetstider skapas. UI-komponenten `sites/components/bank-connection.tsx` visar kontovarningen i det befintliga alertområdet. Giltiga kontoval och giltiga varningslistor behåller sitt beteende.

Testerna kontrollerar oförändrade anslutningsrader, arbetsyta, auditantal och sparade warnings-värden samt noll provideranrop. Det finns inget belägg för att produktionens metadata är skadad. Fixen påstår därför inte att den återställer den verkliga bankanslutningen. Skrivvägar, medgivandekontroller, import, förnyelse och transaktionscommit ändras inte.

## 0599 och 625 SEK

Den versionslåsta tidigare [Bankgirogranskningen](../final95/reviews/bankgiro-final-audit.md) beskriver ett hashverifierat XLSX-original med betalare och generisk referens `0599`, samt en separat AIS-post på 625 SEK utan betalare/referens. Det finns enligt det underlaget ingen styrkt gemensam insättningsidentitet och faktura `0599` var inte registrerad. Dessa kunduppgifter har inte hämtats eller verifierats på nytt i denna delgranskning.

`0599` ska behålla sin inledande nolla. Generisk referens och dokumentnummer får inte klassas om till formellt OCR. Syntetiska 125 + 500 SEK-fall som summerar till en insättning på 625 SEK bevisar parserns avsedda modell, inte relationen mellan de verkliga underlagen. Ingen säker fakturabetalning eller automatisk matchning kan härledas ur beloppet och referensen ensamma.

## Externa krav före faktisk aktivering

**Enable Banking / befintlig bank:** fungerande registrerad applikation, korrekt callback, bankens faktiska företagsstöd och användarens behörighet; ordinarie nytt auktorisationsflöde, verifierat aktuellt konto-/företagsunderlag och uttryckligt kontoval. Därefter behövs en avgränsad tillåten hämtning som visar rätt konto, verklig bankstatus och bestående resultat. Appinloggning eller tokenförnyelse ersätter inte dessa steg.

**Open Payments:** produktionsgodkänd applikation och faktiska AIS-/Bankgiroprodukter för rätt företag/konton; giltigt organisationscertifikat med matchande privat nyckel och riktig Node-/Workers-mTLS-konfiguration; säker app-/generationskonfiguration, godkända callback-URL:er och kombinerade `accountinformation bankgiroinformation corporate`-scopes. Verklig PSU-/företagsidentitet och leverantörens åtkomstpolicy ska vara styrkta. Kundmedgivande/SCA och kontoval ska genomföras separat. Interna `bankgiro_reports:read` är applikationens intagskrav, inte ett Open Payments OAuth-scope.

**Bankgirokälla:** separat aktuellt auktoriseringsunderlag måste binda owner/company/source/generation, rapportprodukt, rätt Bankgiro och konto/IBAN. För Open Payments behövs `openpayments-bankgiro-v1`, bevarade native `.opbg.json`-original och exakt JSON-profil i HTTPS-registret. För SFTP/CAMT krävs faktiskt bank-/leverantörsavtal, kundspecifik MIG/XSD/Envelope-profil, auktoriserade acceptansoriginal, read-only-användare, rätt katalog, oberoende verifierad SSH-host-key och privat beständig spool. Brygga och applikation ska ha samma käll-/företags-/generationsbindning. Ett färskt behörighetskvitto får utfärdas först efter helt lyckad scan.

Före aktivering ska en uttryckligen godkänd avgränsad läsacceptans visa faktisk kontotäckning, kompletta original, samlingsinsättningar, oförändrad ekonomi vid återspelning och säkert beteende för ändrat original/återstart. Det interna bryggkontraktets `/v1/authorization` och rapportvägar är inte Swedbanks publika bank-API. Bankgiro Lookup är ett separat mottagaruppslag och bevisar inte betalaren i en historisk inbetalning. `SOURCE_NOT_CONFIGURED` ska kvarstå tills kraven är uppfyllda.

## Officiella referenser och aktualitetsgräns

Följande officiella länkar finns i de versionslåsta tidigare granskningarna och är nästa kontrollpunkter inför faktisk onboarding. De har inte hämtats på nytt under denna delgranskning; aktuella leverantörsvillkor och kundavtal ska verifieras före konfiguration. Ingen ny bekräftelse från leverantör eller bank påstås.

- [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) och [FAQ](https://enablebanking.com/docs/faq/): sessioner, konton, callback och pagination.
- [Open Payments access tokens](https://docs.openpayments.io/docs/get_access_token), [consent](https://docs.openpayments.io/docs/create_consent) och [production/get started](https://docs.openpayments.io/docs/getstarted): scopes, medgivande, certifikat och produktionsgodkännande.
- [Open Payments AIS](https://docs.openpayments.io/api/account-information-service-ais), [schemas](https://docs.openpayments.io/api/~schemas) och [juni 2025-ändringen](https://docs.openpayments.io/docs/changelog/2025-06): sidkedjor, konto-/PSU-kontext och berikade referens-/aggregatfält.
- [Open Payments Bankgiro Lookup](https://docs.openpayments.io/api/bankgiro-lookup): separat produkt för mottagaruppslag.
- [Swedbank MIG](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html) och [anslutning företag](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html): kundens faktiska filprofil och anslutning. Tidigare hämtning av länkade MIG-/Envelope-original nekades med HTTP 403; generisk CAMT-parser är därför ingen Swedbank-certifiering.

## Leveranskontroll

Rapporten är inte ett produktions-READY-kvitto och ersätter inte roots färska integrerade CI eller en verklig bankacceptans. Produktdiffen är begränsad till statusprojektionen i `service.ts` och varningsvisningen i `bank-connection.tsx`; regressionerna ligger i `sites/tests/banking-security.test.mjs`.

| Ny lokal kontroll, Node 24.22.1 | Resultat |
| --- | --- |
| Elva nya regressioner på oförändrad produkt, `--test-name-pattern='bank status metadata:'` | 1 pass / 10 fail, exit 1. Felen är kastad JSON-/typvalidering eller felaktig statusprojektion. |
| Samma elva regressioner efter rättning | 11/11, exit 0. |
| Hela `banking-security.test.mjs`, inklusive de elva nya fallen och förstärkt kontroll av giltigt kontoval | 360/360, exit 0, 72,215 s; noll skip/cancel/TODO. De elva räknas inte dubbelt. |
| Guarded TypeScript för denna arbetskopias `sites/tsconfig.json` | exit 0, tom fellogg. |
| `git diff --check` | exit 0. |

Testkommandot kördes från `sites`:

```sh
NODE_ENV=test node --import ../scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1 tests/banking-security.test.mjs
```

Nätisoleringen blockerar extern trafik och servicefixturen förbjuder dessutom all verklig fetch. En första start utan `NODE_ENV=test` avvisades av `SAAS_TEST_ONLY` före testkörning; den räknas inte som regressionens röda resultat. Både root- och Sites-lockfil matchar den återanvända installationen exakt. Den vanliga guarded-check-starten från denna arbetskopia avvisade dess `node_modules`-symlänk enligt säkerhetsgrinden. Grinden ändrades inte: den godkända körningen gjordes från den verkliga installationskatalogen `/workspace/scratch/0005a76ddf57/Mgeorge/sites` med explicit projekt:

```sh
node scripts/run-verified-tool.mjs check --project /workspace/scratch/aab0f7dc06f9/completion-bank/sites/tsconfig.json
```

Full projekt-CI och oberoende diffgranskning samordnas av root på den integrerade kandidaten. Ingen build, verklig BankID-acceptans eller automatisk Bankgirohämtning påstås här.
