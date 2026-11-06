# Releasegrindar — Agent 9

**Kommersiell produktionslansering: NOT APPROVED.** Kodens tekniska grindar och extern acceptans bedöms separat. Grön syntetisk CI kan inte ersätta bankmedgivanden, leverantörsavtal, operativ återställning eller kundacceptans.

| Grind | Bedömning | Konkreta bevis och kvarstående villkor |
| --- | --- | --- |
| Säkerhetskritiska problem lösta | Granskade kandidatfixar; samlad slut-CI PASS | Tvetydiga medgivanden/kända handtag, aktuell bankbehörighet före läsning/commit, beständig loginbudget, begränsade requestkroppar och OCR-cleanup har negativa/positiva regressioner. UTF-8-kompatibiliteten är rättad och de fyra nya regressionerna är godkända. Kandidaten är inte driftsatt; inget allmänt produktionssäkerhetscertifikat utfärdas. |
| Företagsisolering | Syntetiskt verifierad; samlad slut-CI PASS | Tre företag, fyra roller, kolliderande externa ID:n, verkliga SQLite-partitioner och Sites D1/R2-gränser via syntetiska adaptrar. Återkallat medlemskap, A→B→A, export/original, worker, skriv- och callbackgränser. Faktisk driftkonfiguration återstår. |
| Produktionsbank och medgivanden | **BLOCKED** | Läsande status 19:14 UTC: connected=false, senaste lyckade hämtning08:05. Faktisk företags-/kontobehörighet, aktuell callback/providerregistrering, API-produkter/avtal, certifikat/mTLS och nödvändig SCA är inte slutverifierade. |
| Bankgiro/OCR får inte bli falskt bankbevis | Kodgränser verifieras; faktisk kanal **BLOCKED** | Rapportkälla SOURCE_NOT_CONFIGURED, authorization UNKNOWN. Intakt manuell rapport finns; aktuell kontorelation, gemensam bankutfärdad insättningsidentitet, formell OCR och rätt registrerad faktura är inte styrkta. Dokumentnummer, råreferens, manuell attest och bankfakta hålls åtskilda. |
| Backup och återställning testade | Lokal fullkedja godkänd; operativ restore **BLOCKED** | Snapshot 362/362, manifest_pass. Syntetisk riktig backup/export/restore kontrollerar27 ägarbundna backuptabeller, original/ekonomifacit och åtta negativa klasser. Ingen oberoende produktionsbackup har återställts med faktisk nyckeltillgång och tjänsteacceptans; verkliga RPO/RTO saknas. |
| Externa behörigheter och regulatoriska krav | **NOT VERIFIED** | Leverantörsavtal/aktivering, kundens bank-/företagsbehörighet, AIS-/ombuds-/tillståndsmodell och relevanta dataskyddsprocesser kräver daterat underlag från ansvarig part. En skapad företagsarbetsyta styrker inte juridisk identitet. |
| Relevanta acceptanstester | Samlad CI PASS; extern acceptans **BLOCKED** | Faktura→original→import→avstämning→historik, rollback/replay, migration/restore, Chromium och1/10/100 företag provas syntetiskt. Märkt representativ originalkorpus, kund-/bank-/driftacceptans och relevanta hjälpmedel/fysiska enheter återstår. |
| Faktiskt publicerad kod | Sites 63 lyckad; kandidat **NOT DEPLOYED** | Native källa b79213c, archive2fa6da50…, deployment succeeded, miljörevision10. Exakt Sites 63↔GitHub-motsvarighet är inte självständigt verifierad. GitHub-OCR-arbetarens mainbf24 binder inte mottagande Siteskälla. |
| Minst314/330 | **NOT ACHIEVED** | Full 33-komponentsmatris ger verifierat 250/330 på exakt 0ce2604 med godkänd slut-CI. Varje ändring motiveras separat; inga poäng för branch-/PR-/testantal eller planerat arbete. |

[Sanerat läskvitto](evidence/production-readonly.json) innehåller tider, verktyg, värden och begränsningar. Läsningarna är inte en atomisk produktionssnapshot. Andra aktörer mergade PR 48 och publicerade Sites 63 under uppdraget; deras arbete tillskrivs inte Agent 9.

## Medgivanden och säkra återförsök

Ett lyckat fjärranrop kan ha skapat medgivandet även när svarsläsning, JSON, lokal försegling eller efterkontroll misslyckas. `mayHaveSucceeded` bevaras; nytt idempotens-ID gör inte utfallet säkert. Även DELETE är en fjärrändring. Ett känt krypterat handtag bevaras om första lagringen misslyckas och den guardade fallbackskrivningen lyckas.

Ny start ersätter inte känt eller okänt medgivande. Uttrycklig renewal/disconnect måste bekräfta cleanup. Saknat handtag med osäker fjärrskapning kräver verifierad provider-/operatörsavstämning. Ingen ny resetknapp får nollställa osäkerheten. Definitivt avvisad skapning får `retrySafe=true` men behåller `consentCreation=pending` och försökskorrelation som historik. Fel före consent-POST får återförsök utan en påhittad resurs. Äldre ofullständiga poster hanteras konservativt.

Legacyåtervalidering är separat från ny SCA. Bara ett fortfarande giltigt, oförändrat medgivande med en faktisk godkänd providersession och samma valda konton kan återaktiveras. Aktuell status kontrolleras precis före anropet; appmetadata binds i atomisk commit. Även replay av ett sparat framgångskvitto projicerar aktuell apphälsa. Ingen verklig återvalidering kördes av Agent 9.

## Migration, schema och rollback

Ingen befintlig ekonomisk tabell eller D1-migrationsfil ändras av95-diffarna. **PR 54 skapar däremot den additiva tabellen `login_rate_limits` i Nodes centrala kontrolldatabas vid serverstart med `CREATE TABLE IF NOT EXISTS`.** Det är en schemaeffekt även utan numrerad migration. Separata syntetiska krypterade SQLite-backup-/restoreprov verifierar bevarade fakturarader respektive loginbudget. En separat företagsbackup omfattar inte automatiskt den centrala kontrollens state.

Äldre kod kan strukturellt öppna databasen och lämnar extratabellen kvar, men återgår till den gamla process-/adresslokala loginspärren. **Nedgradering eller blandade runtimeversioner bevarar därför inte det nya säkerhetsskyddet.** En äldre backup kan återföra en äldre räknare; skyddet är inte monotont över restore. Radera inte tabellen vid rollback. Återinför inte heller tenant-omedveten kod eller gamla återställda behörigheter/leaser.

PR 47 sätter samma befintliga 5 000 ms SQLite-väntetid före WAL-förhandlingen. PR 49/50 utökar redan krypterad JSON med fas-/återhämtningsmetadata, utan SQL-migration. Ren migrering, historisk uppgradering, original, finansiell historik och återöppning ingår i den syntetiska verifieringen. Produktionens schemavy har lästs, inte migrerats. Sitesjournalens23 poster och de befintliga prefixluckorna dokumenteras separat; journalindex21/22 motsvarar0023/0024.

Produktionsberoenden, miljövariabler och hostingbindningar ändras inte av95-leveranserna. QA tillför isolerad låst Playwright-tooling under `qa/browser` och uppdaterar två testworkflows till officiellt verifierade SHA-pinnade Actions. Detta är skilt från produktens runtime. Samtliga slutbyggen/audits är gröna på samma kombinerade kod 0ce2604.

## Produktionsdrift och framtida release

Main48 har redan en `workflow_run`-trigger för moln-OCR efter lyckad CI på aktuell main, med två fail-closed refkontroller före credentialsteget. Det är en redan mergad driftförändring från annan aktör. Våra PR-körningar uppfyller inte mainvillkoret. En framtida mainmerge kan få operationell effekt om befintliga flaggor/credentials tillåter det; detta ingår i releasebeslutet. Agent 9 har inte dispatchat workflow eller ändrat flaggor/scheman.

Sex faktiska slutförda moln-OCR-resultat verifierades i schemakörning42083409804. Detta stöder P10=1, inte fältprecision, uthållig kadens eller leverans av kandidaten. Gmail har en färsk lyckad hämtning 18:59:26 UTC men `background_ready=false`, `external_schedule_unverified` och `ocr_worker_unavailable`. Molnworkerns senaste resultat är fortfarande 18:23:31; dess heartbeat bedöms inte längre färsk vid kontrollen 19:14. En komplett bank-/Gmail-/OCR-driftkedja är inte godkänd.

En senare tillåten release behöver binda byggd Siteskälla/arkiv till testat Git-innehåll, bevara projekt/domän/DB/R2/identitet och kontrollera native deployment samt autentiserade flöden. Kommersiella bank-/kundgrindar förblir stängda tills extern acceptans finns. Nodes publika identitet är fortfarande `single_administrator`; den är inte en färdig självständig fleranvändaridentitet för kommersiell drift.

## Produktionskontrollens läsgräns

Vissa äldre sidor kan göra POST vid montering eller fortsätta betalningskontrolljobb. Vanlig sidnavigering är därför inte generellt skrivfri. Här används uttryckligt läsande status-/evidensverktyg och native versions-/deploymentöversikt. Syntetisk Chromium körs separat. Inga verkliga bankhämtningar, nya SCA-försök, consentreset, finansiella mutationer, kundmeddelanden, OCR-dispatcher eller deployment görs för att få gröna tester.

## Officiella externa krav och deras gräns

- [Swedbanks direkt-TPP-onboarding](https://www.swedbank.com/openbanking/contact-us-openbanking/golive.html): relevant tillstånd/registrering och QSEAL/QWAC gäller direktmodellen. Kraven tillskrivs inte automatiskt aggregatorns kundmodell.
- [Open Payments getting started](https://docs.openpayments.io/docs/getstarted): produktionsapplikation, organisationsspecifikt certifikat, API-produkter och exakt redirect. [Access token](https://docs.openpayments.io/docs/get_access_token) skiljer corporate AIS från särskild Bankgirobehörighet.
- [Enable Banking control panel](https://enablebanking.com/docs/api/control-panel/) och [linked accounts](https://enablebanking.com/docs/api/linked-accounts): begränsad egenkontolänkning är inte i sig godkänd kommersiell flerklientsdrift; full aktivering/avtal och faktiska medgivanden bedöms separat.

Primärkällorna styrker kravens natur. De bevisar inte att kunden har rätt avtal, certifikat, API-produkt, bankbehörighet eller regulatorisk roll; detta kräver aktuellt kund-/leverantörsspecifikt underlag.

## Dokumenthistorik

Aktuella producentdokument har maskerats där de återgav privata betalningsidentifierare. Ekonomiska original och testfixtures har inte ändrats. Äldre publicerade Git-objekt har inte skrivits om; hantering av eventuell kvarstående historisk exponering måste bedömas av repositoryägaren. Den nya rapporten innehåller sanerade statuskvitton och inga kundoriginal eller kontouppgifter.
