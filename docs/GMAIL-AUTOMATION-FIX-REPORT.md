# Gmailautomatisering och dokumentkö – leveransrapport

Datum: 2026-11-02. Alla driftstämplar nedan anges i UTC.

## Leverans och samordning

- Område: Gmailhämtning, MIME-/providertolkning, dokumentkö och deras statusvyer.
- Utvecklingsbranch: `fix/gmail-document-automation-20261102`.
- Ursprunglig bas: `a9f88ae1c0f697376b3ecd140e1e80a64405125a`, hämtad från `origin/main` innan branchen skapades.
- Leverans sker som PR mot `main`. Ingen direkt push till `main`, force-push, automatisk merge eller Sites-publicering ingår under det parallella arbetet.
- Befintligt Sites-projekt, databas, originalarkiv, OAuth-hemligheter och externa scheman bevaras. Ingen kundkommunikation eller ändring av produktionsfakturor har utförts.
- Gemensam fakturaparser/OCR, bank, bankgiro, backup och generell dashboardutformning tillhör parallella uppdrag. Denna branch ändrar inte dessa områden.

Kodkandidaten är implementerad, oberoende granskad och verifierad enligt tabellen nedan. Senaste `origin/main` kontrollerades igen efter sluttesterna och var fortfarande bascommitten ovan; inga mergekonflikter behövde lösas. Leveransens commit och PR redovisas i GitHub och slutmeddelandet. Rapportens produktionsobservationer är läsningar av befintlig drift, inte ett påstående att den nya koden redan körs där.

## Före: observerad drift och befintlig arkitektur

### Gmail, schema och bearbetning är olika bevis

| Begrepp | Vad som kan beläggas | Vad det inte belägger |
|---|---|---|
| Ansluten | Sparad Gmailanslutning och godkända behörigheter vid kontrollen | Att framtida OAuthförnyelse fungerar eller att schemat körs |
| Schemalagd | En extern automation är konfigurerad och aktiverad | Att en ny schemastart faktiskt inträffat |
| Automatikanrop observerat | Systemets automationsingång har anropats och eventuellt lämnat ett kvitto | Att just den externa schemaläggaren startade anropet |
| Hämtad | Original/avvisade källreferenser och körningsresultat är beständigt sparade | Att alla original har tolkats eller registrerats |
| Behandlad | Dokumentjobbet har ett sparat tolkningsresultat eller ett beständigt fel | Att resultatet är tillräckligt säkert för registrering |
| Registrerad | Ett registreringskvitto och en faktura har sparats i samma ekonomiska arbetsflöde | Att fakturan är betald |

Sites använder Gmail OAuth, ägaravgränsad D1-lagring, R2-original och beständiga dokumentjobb. Original identifieras med SHA-256. Gmailkällor använder konto, meddelande-ID och MIME-delens ID; bilagans nedladdnings-ID bevaras som metadata. En ägaravgränsad Gmaillease och kontroller inne i databasbatchen hindrar försenade körningar från att skriva efter att de förlorat låset.

Nodeservern använder motsvarande Gmailadapter, SQLiteoriginal och en beständig integrationskoordinator. Dess befintliga schemaläggare är separat från ChatGPTautomationen. Inget nytt schema skapas i denna ändring.

| Befintlig del | Kod eller plattform | Inventerat ansvar |
|---|---|---|
| Gmail OAuth och nedladdning | `src/gmail.js`, `sites/lib/gmail-adapter.js` | Konto-/scopekontroll, tokenförnyelse, meddelanden och bilagor |
| Sites hämtning | `sites/lib/gmail-service.ts`, `sites/lib/banking/mcp.ts` | Manuell/API-/automationsingång, lease, original, körningskvitton och kontrollpunkt |
| Sites dokumentkö | `sites/lib/document-processing.ts` | Tolkningsjobb, arbetsleases, försök, granskning och registreringskvitton |
| Befintlig moln-OCR | `.github/workflows/sites-cloud-ocr.yml` | Konfigurerad på minut 7, 22, 37 och 52; kräver `main` och aktiveringsflaggan `MG_CLOUD_OCR_ENABLED`. Ingen Gmailhämtning skapas av vår ändring |
| Befintlig Nodeschemaläggare | `src/server.js`, `src/integration-jobs.js` | Kontrollerar inställda jobb medan Nodeservern kör; ändringen aktiverar inte en ny server eller timer |
| ChatGPTs Gmailtimautomatik | Extern automation, inventerad nedan | Startar systemets befintliga automationsingång; ligger utanför GitHubkoden |

### Läsning av produktionen före ändringarna

Via det skrivskyddade `gmail_sync_status`-verktyget observerades:

- Gmail anslutet; senaste försök `2026-11-02T17:57:59.781Z`.
- Senaste lyckade hämtning `2026-11-02T17:58:16.150Z`.
- **191 dokument i manuell granskning och 2 i kö.**
- Senaste dokumentbearbetning `2026-11-02T17:58:22.070Z`.
- Lokal dokumentarbetare hade aktuell aktivitet. Molnarbetarens senaste slutförande var `2026-10-29T07:16:18.997Z`; molnarbetaren kunde därför inte beskrivas som färsk.
- `schedule_verified` var `false`. Tom `last_synced` under pågående paginering betyder inte att ingen lyckad hämtning finns; statusen har ett separat kvitto för lyckad hämtning.

Det befintliga externa ChatGPTschemat inventerades utan ändring:

- Automation `Automation_6efa3aafab4081918c48001acc562f96`, **Hämta och tolka Gmail i MG Fakturakoll**.
- Aktiverat; varje timme, minut 0, tidszon Europe/Stockholm.
- Senaste konfigurationsuppdatering `2026-11-02T18:03:05.743715Z`.
- Senast registrerade schemastart vid baslinjeläsningen: `2026-10-29T15:00:00Z`, slutförd `15:01:01.378295Z`.
- `next_run_time` saknades i verktygssvaret. Ett aktiverat schema bevisar därför inte en ny körning efter återaktiveringen.

Vid denna baslinje återstod extern schemaverifiering. Ett manuellt anrop till automationsverktyget får inte användas som ersättning för ett kvitto från schemaläggaren. Slutkontrollen nedan verifierade senare en ny schemastart.

### Ny läsning under det parallella arbetet

Skrivskyddad kontroll `2026-11-02T18:59:57Z` visade **196 dokument för granskning och 6 i kö**, senaste lyckade hämtning `18:47:44.513Z` och senaste bearbetning `18:48:21.248Z`. Molnarbetarens senaste slutförande hade uppdaterats till `18:48:28.449Z` och klassades nu som färskt. Automatiken hade fortfarande samma senaste registrerade schemastart den 29 oktober; inget nytt schemakvitto fanns i den läsningen.

Detta är förändringar i den befintliga driften medan flera uppdrag pågår. Vår branch är inte publicerad och kontrollerna här har inte startat någon hämtning. Förändringen från 191/2 till 196/6 ska därför inte tillskrivas våra kodändringar eller beskrivas som bevis på fungerande timschema.

### Ny extern schemakörning verifierad vid slutkontrollen

Det befintliga schemat lästes igen kl. **19:10 UTC**. Nu fanns ett nytt körningskvitto:

| Fält | Verifierat värde |
|---|---|
| Körnings-ID | `24458c56-57a4-8323-83b8-1ffbe09b4c71` |
| Schemalagd tid | `2026-11-02T19:00:00Z` |
| Faktisk start | `2026-11-02T19:02:58.518407Z` |
| Slutförande | `2026-11-02T19:06:34.045408Z` |
| Registrerad körningsstatus | `completed` |
| Resultatets körnings-ID | Samma ID som körningen |
| Resultatets skapandetid | `2026-11-02T19:06:33.583724Z`, efter körningens start |
| Automatikens resultat | 8 nya Gmailunderlag importerade; 209 för granskning och 1 i OCRkö vid resultatets tidpunkt; inga mejl skickade |

Det skrivskyddade applikationsstatusanropet därefter visade lyckad Gmailhämtning `19:04:39.928Z`, bearbetning `19:06:18.438Z`, **210 för granskning och inga väntande eller pågående jobb i köstatusen**. Den senare läsningen skiljer sig från körningsresultatet eftersom OCRkön hade fortsatt bearbetas. Den registrerade totalsiffran var fortfarande 5.

**En ny verklig schemastart efter återaktiveringen är därmed verifierad.** Detta gäller den befintliga driften. Det bevisar inte att vår ännu ej publicerade kod körs i produktion eller att framtida schemakörningar alltid lyckas. Automatikens separata bankvarningar hör till bankuppdraget och ändras inte här.

Applikationen har ännu ingen egen verifierad kanal till ChatGPTs externa körningskvitton. Därför förblir dess `schedule_verified` och nya `external_schedule_verified` ärligt `false`: systemanropen ensamma kan inte styrka schemaursprung. Det externa kvittot ovan är en separat observation från automationsplattformen.

## Rättningar och före/efter

| Reproducerat problem | Förändring i denna branch | Verifiering |
|---|---|---|
| Strukturerade Gmail 403-kvotfel behandlades som saknad läsrättighet | Kända kvotorsaker behandlas som `rate_limited`; verklig åtkomstbrist kräver fortfarande åtgärd | Syntetiska svar i båda adaptrarna |
| HTML vid 401/5xx kunde dölja den verkliga felklassen; 5xx väntetid tappades | Statusklassificeringen bevaras även när svaret inte är JSON; `Retry-After` bevaras även vid 5xx | Providerfel med JSON, HTML och tidsbaserad väntetid |
| Ett avbrott efter mottagna HTTPheaders saknade transient felkod | Avbruten svarsläsning/timeout blir säkert `connection_error`; storleksfel behåller sin egen klass | Strömavbrott, timeout, bilagenedladdning och tidigt manuellt återförsök i båda motorer |
| Nätverks-/providerfel hade otillräckligt beständig väntetid | Gmail får beständig exponentiell väntan på 15, 30 och 60 minuter med liten jitter; längre providerväntan respekteras | Omstart, automatiskt försök och tidigt manuellt försök |
| Återkallad OAuth kunde användas igen av obevakade försök | Permanenta behörighetsfel stoppar automatiska hämtningar tills anslutningen har åtgärdats | `invalid_grant` och efterföljande schemalikt anrop |
| Pausad dokumentautomation kunde ändå hämta Gmail | Automationsingången respekterar paus före nätverksanrop | Inga provideranrop eller tolkningar vid paus |
| En samtidig registrering/avvisning kunde lämna en ny källalias i granskning | Källans terminala status läses i samma atomiska SQLskrivning som den nya aliasen skapas | Samtidigt granskningsbeslut + samma original i nytt meddelande |
| Avvisade bilagor tappade sitt skäl i Sites | Säkra felkoder sparas och räknas per ägare; äldre okända orsaker visas som okända | Felaktigt format, för stor bilaga, återhämtning och ägarisolering |
| Ingen beständig skillnad mellan manuella hämtningar och automationsanrop | Ägaravgränsade start-/resultathändelser i befintlig auditlogg, utan ny migration | Start, slutförande, väntan, tappat slutkvitto och manuell hämtning |
| En Nodefaktura kunde sparas men följas av ett fel från matchningsförslag som utlöste felaktig rollback | Registreringskvittot returneras även om efterkontrollen misslyckas; säker varning följer med | Efter-COMMIT-fel, återstart/replay och fel före COMMIT |
| Flera Sitesjobb för samma ägare/motor kunde få giltiga samtidiga leases trots utlovad samtidighet 1 | Atomisk kontroll av aktiv lease per ägare och motor | Två arbetare, utgången lease, återstart och försenat resultat |

Det ursprungliga dubblettskyddet behålls: samma Gmaildel återimporteras inte, identiska bytes återanvänder samma original och registrering har ett beständigt kvitto. De nya testerna kontrollerar även avbrott mellan originalsparande, källregistrering och ekonomisk registrering. Behörighets-/ägarkontroller och konservativa registreringsvillkor sänks inte.

Automatikanrop loggas med `source: system_entrypoint` och `external_schedule_verified: false`. Ett saknat slutkvitto visas som `running_or_interrupted`, eftersom det utan ytterligare bevis inte går att skilja en pågående körning från en avbruten. En redan lyckad hämtning blir inte misslyckad bara för att observationskvittot inte kunde sparas.

Ofullständiga metadata lagras på bevarade original i `metadata.missing_fields`; inget saknat datum fylls med 1970 eller dagens datum. En PDF utan filnamn får ett neutralt nedladdningsnamn. Metadatafel ger inte registreringssäkerhet. Normala upprepade transporthuvuden som `Received` behandlas däremot inte som motstridiga avsändaruppgifter. Helt trasiga meddelanderesponser stoppar kontrollpunkten, medan en identifierbar felaktig bilaga kan avvisas beständigt utan att blockera senare giltiga bilagor.

En pausad referenssökning får HTTP 409, så en befintlig konsument inte tolkar ett uteblivet hämtningsförsök som en lyckad hämtning. Vanliga automationsanrop kan fortsatt rapportera det observerade tillståndet `paused` utan att göra nätverksanrop.

## Varför dokument stannar i granskning

Följande räknare lästes från befintliga sparade tolkningar. Samma dokument kan räknas under flera skäl; detta är inte en ny tolkning av kundoriginal.

| Granskningsskäl | Baslinje: 191 | Kl. 18:59: 196 | Kl. 19:10: 210 |
|---|---:|---:|---:|
| Motpart inte verifierad | 190 | 195 | 209 |
| Låg tolkningssäkerhet | 141 | 145 | 155 |
| Datum saknas | 108 | 109 | 115 |
| Organisationsnummer saknas | 105 | 106 | 113 |
| Motpartsnamn saknas | 63 | 64 | 70 |
| Moms/netto saknas eller behöver kontrolleras | 60 | 61 | 67 |
| Belopp saknas | 55 | 56 | 62 |
| Fakturanummer saknas | 25 | 26 | 32 |
| Dubblettvarning | 0 | 0 | 0 |

En overifierad motpart är ett ekonomiskt säkerhetsvillkor, inte i sig ett parserfel. Den kontrollen får inte tas bort för att minska kön. Inte heller kan antalet brister i fält användas som bevis att alla berörda dokument är riktiga fakturor.

### Reproducerat fynd för det parallella OCRuppdraget

En syntetisk faktura med:

```text
Fakturadatum: 24 oktober 2026
Förfallodatum: 7 november 2026
```

gav `issued_at.value = null` och `due_at.value = null` i både `src/invoice-extraction.js` och `sites/lib/invoice-fields.js` på bascommitten. Samma faktura med `24/10/2026` och `07/11/2026` gav `2026-10-24` och `2026-11-07`, båda med säkerhet 0,96. Reproduktionen kördes mot de verkliga tolkningsfunktionerna, utan kunddata.

Detta avgränsade fel dokumenteras för OCRuppdraget. De gemensamma parserfilerna ändras inte här för att undvika överlappande utveckling. Reproduktionen visar inte hur många av produktionsköns 108 datumbrister som har denna orsak. Gmailadaptrarnas metadata- och MIMEtolkning rättas inom denna branch.

## Testbevis

Testdata är syntetiska. Ingen testkörning använder riktiga Gmailtoken, hämtar kundpost eller registrerar produktionsfakturor.

Verifieringsmatris för slutlig kodkandidat (Linux, Node 24.22.1):

| Kontroll | Resultat |
|---|---|
| Root `npm ci --ignore-scripts --no-audit --no-fund` | Genomförd |
| Sites `npm run install:ci` | Genomförd; befintlig minimatchbackport tillämpad |
| Root `npm run check` | Godkänd: 108 JavaScriptfiler |
| Root `npm test` | **1 132 tester, 1 132 godkända, 0 fel, 0 överhoppade** |
| Root `npm audit --audit-level=high` | 0 sårbarheter |
| Sites `node scripts/minimatch-backport.mjs --check --require-target` | Godkänd: 1 mål, 0 skrivningar, `verified` |
| Sites `npm run check` | Godkänd |
| Sites `npm test` | **2 020 tester, 2 020 godkända, 0 fel, 0 överhoppade** |
| Sites `npm audit --audit-level=high` | 0 höga/kritiska; 16 måttliga befintliga beroendefynd |
| Sites `npm audit --omit=dev --audit-level=high` | 0 sårbarheter i produktionsberoenden |
| Sites `npm run build` | Godkänt lokalt produktionsbygge, ingen publicering |
| Oberoende granskning av ändringarna | Inga kvarvarande blockerande fynd efter rättning och uppföljning |
| `git diff --check` | Godkänd |

Slutsviterna kördes efter den sista rättningen av avbrutna svarströmmar. Dessförinnan reproducerades felen i separata RED/GRÖN-körningar. De nya adapterfallen omfattar 64 fall per motor, totalt 128; nya statusrenderingar omfattar 28 fall; den separata kösviten har 7 fall. De ingår i respektive fullsvit ovan. Befintliga utskicks- och ägarkontrolltester ingår också. De 16 måttliga auditfynden ligger i utvecklingsberoenden; inga beroendeversioner ändras i denna branch. Repositoryts befintliga GitHub CI kör även sina kontroller på Node 22 vid branch-/PRleverans; dess aktuella status visas i PR:n.

Miljöns sandbox begränsar HTTPlyssning och Nodeunderprocesser. De riktiga integrations- och helsvitkörningarna görs därför med miljöns stödda utökade körbehörighet. Assertions och produktionskod kringgås inte. Diagnostiska sandboxkörningar som inte körde alla deltester räknas inte som godkända testsvar.

En oberoende läsande kodgranskning identifierade tre konkreta förbättringar: upprepade transporthuvuden, felaktigt lyckat resultat för pausad referenssökning och oklassificerade svarströmsavbrott. Alla tre har rättats med reproduktioner. Slutgranskningen fann inga kvarvarande blockerande fel i dessa ändringar, källstatusens atomiska arv, köbegränsningen, registreringskvittot eller OAuthstatusen.

Tester använder riktiga adaptrar och SQLitebaserad D1-emulering med styrda samtidighetsförlopp. De bevisar inte en verklig Cloudflare-isolats omstart, en ny extern schemastart eller ett autentiserat produktionsflöde i webbläsaren.

## Ändrade filer

| Grupp | Filer |
|---|---|
| Gmailadapter och server | `src/gmail.js`, `src/server.js`, `sites/lib/gmail-adapter.js`, `sites/lib/gmail-service.ts` |
| Dokumentkö och registreringsresultat | `src/invoice-review.js`, `sites/lib/document-processing.ts` |
| Avgränsade statusvyer | `sites/components/document-ocr-status.tsx`, `sites/components/gmail-summary.tsx`, `sites/components/gmail-workspace.tsx` |
| Noderegressioner | `test/document-registration-outcome.test.js`, `test/gmail-adapter-reliability.test.js`, `test/gmail-retry-automation.test.js`, `test/helpers/gmail-adapter-reliability.mjs` |
| Sitesregressioner | `sites/tests/document-queue-recovery.test.mjs`, `sites/tests/gmail-adapter-reliability.test.mjs`, `sites/tests/gmail-operational-status-ui.test.mjs`, `sites/tests/gmail.test.mjs` |
| Dokumentation | `docs/GMAIL-AUTOMATION-FIX-REPORT.md`, `docs/superpowers/plans/2026-11-02-gmail-document-automation.md` |

## Återstående driftverifiering efter samordnad integration

1. Granska och integrera denna PR i överenskommen ordning tillsammans med de andra uppdragen. Hämta senaste `origin/main` och behåll alla andras ändringar.
2. Kör nödvändiga gemensamma tester efter integrationen. Publicera därefter en gång i det befintliga Sites-projektet.
3. Följ upp timautomatiken efter publiceringen: jämför ett nytt externt körnings-ID och dess schemalagda tid med applikationens nya observerade anrop och lyckade hämtningskvitto. Körningen kl. 19:00 i denna rapport gäller koden före vår publicering.
4. Kontrollera efter schemastarten att kön gör framsteg, väntetider respekteras och inga osäkra fakturor blir automatiskt registrerade.
5. Hantera verifierade parserfel i OCRuppdraget och verkliga granskningsbeslut via det ordinarie granskningsflödet. Gör ingen massregistrering av den befintliga kön.

Poäng/acceptans: inga produktionsberoende kvalitetsbetyg höjs på grund av lokal testframgång. Drift, schemastart och publicering måste beläggas separat. Framsteg för detta avgränsade uppdrag följs i denna rapport och dess plan; delade framstegsfiler ändras inte under de parallella uppdragen.

## Tekniska källor

- [Gmail Message och MIMEdelar](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages): meddelande-ID och `partId` är stabila identifierare. `attachmentId` behålls som bilagans nedladdningsreferens.
- [Googles Gmailfel och backoff](https://developers.google.com/workspace/gmail/api/guides/handle-errors): skiljer kvot-/ratelimitfel från behörighetsfel samt beskriver återförsök.
- [Gmailbilagor](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments): bytes i base64url och bilagans storlek.
- Repositoryts `AGENTS.md`, `.github/workflows/payment-control-ci.yml` och den aktuella koden styr verifieringskraven.

## Exakt fortsättningspunkt

Implementation, separata regressionstester, fullsviter, bygge och oberoende kodgranskning är klara. Leveransen avser endast utvecklingsbranchen och en PR mot `main`. Gitklienten saknade pushautentisering; den anslutna GitHubappen används därför för att publicera samma testade träd, med jämförelse av hela Gitträdets hash och oförändrad bas. Nästa integrationssteg är mänsklig PRgranskning och samordning med övriga uppdrag, följt av gemensam publicering och driftkontroll. Ingen merge eller produktionspublicering görs inom denna leverans.
