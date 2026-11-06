# MG Fakturakoll — verifierad publicering av Sites 68

Publiceringen lyckades den 6 november 2026. Denna rapport avser den levererade integrationen i PR 61. En senare, separat Node-workerändring måste ha egna CI-kvitton och ändrar inte detta publicerade Sites-träd.

## Exakt leveranskedja

| Objekt | Verifierad identitet |
| --- | --- |
| PR | [61](https://github.com/sharbel0022/Mgeorge/pull/61), normal merge 2026-11-06 14:48:45 UTC |
| Slutlig PR-head | `ebbea9c67f174a6879f1e638633cc53e728282e2` |
| Testad GitHub merge-checkout | `4d19058628bf3ec2973be40a465c509eaf82408d` |
| Mergad main | `24390ef7e8cf6b2274c57804dc9c2d74d362ab12` |
| Gemensamt fullständigt Git-träd | `ad40b5a5ae7710939801d73e5e16eb80f3186f48` |
| `sites/`-träd | `ff078901d22a76ce0d0eac775e405ca50d8bcc6e` |
| Native-källcommit | `349779e799d4510b56173901e6be69880818b5d4` |
| Publicerad version | **68** |
| Deployment | `appgdep_6aedec7b8f98819188f5a15a565a6880`, **succeeded** |
| Miljörevision | **10**, bevarad |
| URL | [MG Fakturakoll](https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site) |

Native-källans rotträd och GitHub-källans `sites/`-träd är exakt lika. Det officiella native-bygget passerade. Arkivet var 18 707 091 byte med SHA-256 `f4fa5b48f516a04b2ca4eaff5f0752fdda84c8b3b10eb282c943e57d386436db`. Tjänstens normaliserade arkiv har det separat rapporterade hashvärdet `55b3a8737b8b835bca524927da9c0781c2a2019379b341cb0e2e91524bc444b2` (48 609 280 byte, 441 filer); dessa är olika representationer och ska inte jämföras som samma fil.

Projekt, publik åtkomst, DB/R2-bindningar och miljörevision bevarades. Version 67:s tidigare misslyckade deployment kvarstår som ett misslyckande. Version 66 finns som föregående fungerande version; ingen rollback behövdes för version 68. Bankauktorisation eller tokenåterställningsspärr får inte nollställas som en del av rollback.

## Full CI före publicering

| Grind | PR 61 | Separat main |
| --- | --- | --- |
| Node 22 | 2 898/2 898 | 2 898/2 898 |
| Node 24 | 2 898/2 898 | 2 898/2 898 |
| Sites | 5 820/5 820 | 5 820/5 820 |
| Bankgiro bridge | 47/47 | 47/47 |
| Chromium | 77/77 | 77/77 |
| 1/10/100 företag | PASS | PASS |
| Låsta installationer, syntax/typer och produktionsbygge | PASS | PASS |

[PR-kvalitet 42235429917](https://github.com/sharbel0022/Mgeorge/actions/runs/42235429917), [PR-säkerhet 42235429991](https://github.com/sharbel0022/Mgeorge/actions/runs/42235429991) och [main-kvalitet 42237265007](https://github.com/sharbel0022/Mgeorge/actions/runs/42237265007) slutfördes framgångsrikt. Säkerhetskörningen omfattade 377 Node- och 1 225 Sites-fall. Denna delmängd överlappar huvudsuiten. Node-versionerna är också samma population: 2 898 + 5 820 + 47 + 77 = **8 842 suitefall**, inte ett påstående om 8 842 statistiskt oberoende observationer.

Produktionsberoenden hade noll rapporterade sårbarheter i alla granskade profiler. Sites samtliga beroenden hade **åtta moderate**, noll high/critical; detta är inte ett nollfynd för hela utvecklingskedjan. Övriga granskade hela profiler hade noll. Den tidigare lokala säkerhetskörningens SIGKILL-fel bevaras; en senare ren full CI ersätter releasens saknade grind men ändrar inte historiska misslyckanden.

En separat [beroendegranskning](sites-development-audit-risk.md) binder de åtta paketleden till samma minimatch-advisory i utvecklingskedjan. CI verifierade den befintliga skyddade backporten med `targets:1, writes:0, status:verified`. Ingen kompatibel uppdatering av enbart låsfilen identifierades inom det nuvarande beroendekontraktet. Den kvarstående versions-/underhållsrisken redovisas även om själva korrigeringen verifierades.

Chromiumfallen omfattar 41 onboarding-, fem arbetsyte- och 31 dashboardfall med syntetiska API-svar: noll externa anrop och noll browserfel. Benchmarken verifierar isolering, omspelning och konkurrerande claims för 1/10/100 syntetiska företag, totalt 1 110 första importer, 2 220 avvisade omspelningsdubbletter och 111 förväntade busy-svar. Den använder fyra samtidiga företagsjobb, upp till åtta försök i konkurrensfasen, i en Node-process med SQLite; inga bankanrop eller påståenden om distribuerad produktionskapacitet följer av detta.

Alla nedladdade artefakters GitHub-digests verifierades. Kärnkvitton, sammanfattningar och komprimerade källmanifest finns i [ci/pr](ci/pr/provenance.json) och [ci/main](ci/main/provenance.json). De binder exakta kommandon, versioner, källträd och utfall. Instrumenterad täckning omfattar laddade källfiler; omvandlade källmappningar har inte kontrollerats oberoende.

## Migration och datajämförelse

Före deployment saknades tabellerna `company_application_token_control` och `company_application_tokens`. Efter deployment fanns båda: migration 0025 accepterades av den riktiga miljön. Kontrollraden var `id=1, revision=1, recovery_required=0` med tomma restore-/recoveryfält, och tokentabellen innehöll noll rader. Detta var initialisering av ett tidigare frånvarande schema. Ingen befintlig recoverybarriär återställdes. Noll tokenrader observerades; inga tokenanrop initierades av releasearbetet.

Direkt före publicering och efter lyckad deployment jämfördes nio befintliga tabeller genom den behöriga, begränsade databasläsningen: `workspaces`, `bank_connections`, `companies`, `company_memberships`, `company_roles`, `invoice_counterparties`, `document_registrations`, `bankgiro_ingest_sources`, `saas_bank_state`. Samtliga returnerade rader/fält var identiska. Registreringsraderna var fortfarande två, bankanslutningarna en och företagen noll.

**Jämförelsen är avgränsad.** `workspaces.payload` och `bank_connections.encrypted_accounts` trunkerades av läsverktyget. Deras returnerade prefix, arbetsytans revision och samtliga 23 övriga bankfält var lika. De övriga sju tabellerna lästes komplett. Detta är inte ett fullständigt databasexport- eller bytehashbevis för all kunddata. Inga råa kundrader eller credentialvärden lagras i rapporten.

## Publicerad UI och API

En riktig autentiserad Chromiumflik laddade om version 68. Efter den synliga laddningsfasen visades den nya uppmaningen att återansluta banken. Dashboardens ekonomiska totaler var oförändrade: 0 SEK mottaget, 16 000 SEK utestående, 7 250 SEK förfallet och 0 SEK att betala; noll verifierade betalningar, 44 poster utan specifikation och fem manuella betalningsgranskningar.

Tangentbordskedjan sökning → ArrowDown → Enter öppnade rätt fakturadialog; Escape stängde den och återförde fokus till sökfältet. Sökningen rensades. Bankvyn visade noll SaaS-företag, spärrad företagsväljare och bevarad äldre Swedbankanslutning med krav på förnyelse. Inga bankanslutningsknappar eller ekonomiska åtgärder användes vid denna kontroll. Fliken lämnades på fakturaöversikten.

Mobilgeometrier och svartvit utformning verifierades med syntetisk Chromiumacceptans, inklusive 320 px, och skärmbilder granskades visuellt. Ingen verklig mobilproduktionsviewport påstås: browserns försök till viewportoverride ändrade inte den riktiga skärmbredden.

## Verkligt driftläge efter publicering

**Swedbank:** `connected=false`, `connectionStatus=reauth_required`, `syncAllowed=false`, `blockedReason=BANK_RECONNECT_REQUIRED`, `nextAction=reconnect`. Ordinarie återvalidering tidigare under uppdraget gav `BANK_CONSENT_INVALID`. Senast sparade lyckade bankhämtning är 2026-11-05 08:05:14.646 UTC. Den bakomliggande bank-/providerorsaken och aktuell corporate-behörighet är inte fastställda. Ett framtida sparat giltighetsdatum bevisar inte giltigt medgivande. Ingen falsk anslutning eller verifierad betalning skapades.

**Bankgiro:** `DISABLED`, `SOURCE_NOT_CONFIGURED`, ingen sourceId och auktorisation `UNKNOWN`. Alla intake-köantal är noll. Det äldre exemplet 0599/625 SEK bevaras som regression för en uttrycklig generisk referens; det bevisar varken formell OCR-klass, rapport–AIS-relation eller fakturabetalning. [Bankrapporten](bank.md) och [kontrollerade leverantörskällor](provider-reference-check.md) skiljer teknisk färdigställning från verklig aktivering.

Miljömetadata innehåller inte `SAAS_BANK_ENABLED`, `SAAS_OPENPAYMENTS_CONFIG`, `SAAS_OPENPAYMENTS_REGISTRATIONS` eller `SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG`. Open Payments SaaS-flöde är därför inte konfigurerat i denna Site. Det är en konstaterad frånvaro av konfiguration, inte ett påstående att ett faktiskt produktionscertifikat har provats och avvisats. Hemliga värden lästes inte för att undersöka detta.

**Gmail:** En vanlig behörig direktkörning importerade sju nya underlag. Senaste framgång vid efterläsningen var 14:28:00.627 UTC; källan till den senare körningen är okänd. Den befintliga timuppgiften var fortsatt aktiv med oförändrad kadens. Körningen schemalagd 15:00 registrerades `no_update` utan nytt appinvokeringskvitto. Dess äldre publicerade text från 02:00 tillhör en annan körning och tillskrivs inte 15:00. Promptförtydligandet och ny `sync_eligibility` är inte ett verifierat botemedel mot den externa dispatchbristen.

**OCR:** Den ordinarie molnworkern kördes automatiskt via `workflow_run` efter grön main-CI: [42239375434](https://github.com/sharbel0022/Mgeorge/actions/runs/42239375434), exakt `24390ef`, **sex behandlade och noll körfel**. Appen bekräftade slutförande 15:05:07.163 UTC. Efterläsningen 15:07 hade 409 dokument för granskning, 54 väntande OCR, noll aktiva/utgångna/uttömda jobb och två registrerade dokument. Detta visar verklig köprogress, inte korrekt extraktion eller periodiskt Gmail-schema. [Körkvittot](automatic-cloud-ocr.json) håller begränsningen uttrycklig.

**Backup:** Snapshot `768fde9a-27a2-4b85-b85a-278239ec4aea` har 430/430 kontrollästa original, 185 567 855 byte och `manifest_pass`, färdigkontrollerad 00:48:58.086 UTC. Den omfattar inte dagens senare importer. API-evidensdelen har 19 kontrollerade kvitton och 112 äldre poster utan sådant kvitto; det ändrar inte originalmanifestets 430 hashkontroller. Isolerad syntetisk återställning på exakt main återställde 430 original och 27 tabellgrupper, avvisade tio negativa fall och verifierade tokenkarantän. Restore+acceptans tog 5 470,712 ms; hela drillen 16 951,556 ms. Produktionsbackup återställdes inte. [Full restore-rapport](final-restore.md).

## Beslut

**Teknisk publicering av Sites 68: genomförd och godkänd inom verifierat scope.** API/UI, migration, källidentitet och avgränsad ekonomisk före-/efterläsning är kontrollerade. Ingen rollbackindikator observerades.

**Kommersiell bank-/flerföretagslansering: NOT_APPROVED. Bankacceptans: NOT_VERIFIED. Målet 314/330: inte styrkt.** Verklig bankauktorisation och Bankgirokälla återstår. OCR-precision/recall och Gmail-dispatch har också egna kvarstående produkt-/utvärderings-/driftkrav; dessa kan inte beskrivas som enbart externa bankberoenden.

Maskinläsbara före-/efterobservationer finns i [prepublication-observations.json](prepublication-observations.json) och [postpublication-observations.json](postpublication-observations.json). Samtliga påståenden ovan avser uttryckligen deras tidpunkter, inte framtida drift.
