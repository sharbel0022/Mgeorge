# Mgeorge V4 – bankbevis, återhämtning och leverans

Utgångspunkt: `main` på `f549293`, publicerad Sites 30 och mergad PR #12. Branch: `codex/mgeorge-v4-bank-verification`. Arbetet inleddes 2026-10-28; slutkontroll 2026-10-29. Befintlig Site och produktion har inte ändrats av V4-arbetet.

**EXTERN BLOCKERING – INTE FULLSTÄNDIGT PRODUKTIONSVERIFIERAT.** En autentisk, godkänd individuell Swedbankrapport, företagets exakta rapportavtal/MIG och en verifierad leveranskanal saknas i uppdraget. V4 får därför inte markeras som helt uppnått. Exempelinsättningen 1 875 kr med bankreferens `SWED2610261A77HM` har inte tilldelats betalare eller faktura 0604/0589/0587 genom gissning.

## Levererad förbättring

De befintliga import- och betalningsmotorerna återanvänds. En gemensam begränsad XML-läsare stoppar okänd namespace/version, blandade meddelanden, tvetydiga belopp, konton, datum, betalarfält och referensstrukturer. Detaljåterföringar, ofullständiga antal och felaktiga totalsummor kan inte delvis importeras som säkert bankbevis. Generiska camt.053/.054-profiler `.02` och `.08` är syntetiskt testade; detta är **inte** fullständig XSD-validering eller företagets Swedbank-MIG-certifiering. Swedbank Envelope och övriga profiler stoppas tills de har mappats mot godkänt original och specifikation.

Node skapar inte längre bankens individuella ID från OCR/belopp. Saknade eller återanvända individuella ID:n behåller samlingsposten för granskning. Automatisk avstämning kräver återhärledda, överensstämmande bankfakta; ett korrekt originalhash kan inte legitimera senare ändrade referenskandidater. Rapport-ID, meddelande-ID, kontoförande bank och valutadag bevaras separat från betalare och OCR. Dessa fält är rapportens påståenden; SHA-256 styrker byteintegritet, inte bankens avsändaridentitet.

Sites skyddar bankmutationer med aktuell lease inne i samma D1-batch som skrivningen. Fördröjda svar, utgångna lås och ersatta anslutningar kan inte skriva över nyare tillstånd. Bank/Gmail reserverar beständiga automatiska försök och stoppar efter tre misslyckade eller avbrutna körningar. Leverantörens väntetid består efter omstart och gäller även manuella försök. Backup räknar avbrutna försök och förnyar låset mot databasens klocka. En lyckad hämtning med misslyckad efterkontroll bevarar både sin lyckade checkpoint och en beständig varning.

Banklistan behåller sex fält och mobilkort. Betalningsdetaljen visar nu ägaravgränsad verifieringshistorik med sidindelning, inklusive äldre händelser, uppdelningens ursprung, återtagna fakturakopplingar och belopp. Historiken förnyas när arbetsytans revision ändras. Andra betalningars uppgifter skickas inte med. Bank-/Gmail-stopp visar en konkret återhämtningsåtgärd; fakturaförslag skapar aldrig bankbetalare eller OCR.

## Aktuell teknisk inventering

| Del | Filreferens | Implementerat och faktiskt verifierat |
| --- | --- | --- |
| Historik V2/V3/Sites30 | `docs/V2-DELIVERY.md:1`, `docs/V3-DELIVERY.md:1`, `docs/BANK-EVIDENCE-SAFETY-PUBLICATION.md:1` | Leveranshistorik läst; GitHub bekräftar PR #12 mergad och Sites metadata bekräftar version 30. Tidigare testsiffror räknas inte som V4-resultat. |
| Strikt XML-profil | `sites/lib/camt-xml.js:27` | Samma läsare används i befintliga Node-/Sites-parser; negativa original körs genom båda. |
| Konto, rapport, referenser | `src/importers.js:136`, `sites/lib/bankgiro-parser.js:17`, `sites/lib/camt-xml.js:107` | Individuella syntetiska rader och separat rapportmetadata; originalbyte/hash bevaras. Verklig avsändare/MIG externt blockerad. |
| Originalbaserad import | `sites/lib/bankgiro-service.ts:19`, `sites/lib/server.ts:9` | Servern läser ägt original från R2-gränsen och kontrollerar SHA-256. Syntetiska integrationstester; inget verkligt original importerat. |
| Avstämning och saldon | `src/reconciliation.js:21`, `src/reconciliation.js:112`, `sites/lib/reconciliation.ts:15` | Samma motor, heltalsören, exakta referenser och kundrelation. SQLite-processer och D1-transaktionsfixture verifierar idempotens och konkurrens. |
| Bankjobb | `sites/lib/banking/store.ts:73`, `sites/lib/banking/service.ts:116`, `src/integration-jobs.js:5` | Beständiga lås/försök/väntetider, status, omstart och sena svar. Verkliga externa svar är mockade. |
| Gmail/dokument/OCR | `sites/lib/gmail-service.ts:91`, `sites/lib/document-processing.ts:34`, `.github/workflows/sites-cloud-ocr.yml:1` | Befintlig kö och scheman återanvänds. Syntetiskt original genom verklig svensk Tesseract i integrationstest; faktisk Google-/molndrift inte nyverifierad. |
| Krypterad backup | `src/backup.js:13`, `sites/lib/backup-engine.ts:27`, `sites/tests/backup.test.mjs:15` | Verklig autentiserad kryptering, fel nyckel/hash och återställning till separat syntetisk databas inklusive original. Produktionsbackup lästes endast via status. |
| Betalarpresentation | `sites/lib/payment-presentation.ts:12`, `sites/components/bank-payments.tsx:10`, `sites/app/dashboard.tsx:193` | Bankbetalare, fakturakund, förslag och manuella uppgifter hålls separat. Syntetisk browser-QA. |
| Verifieringshistorik | `sites/app/api/bank/history/route.ts:5`, `sites/lib/payment-history.ts:3`, `sites/components/payment-history.tsx:5` | Ägarisolering, pagination, rättelser, förälder/barn och redigerad projektion testade; inga historiska rader ändras. |
| Databas | `sites/drizzle/0012_minor_naoko.sql:1`, `sites/drizzle/0013_real_mindworm.sql:1` | Endast nya väntetids-/försökskolumner. Migrationskedjan provad i isolerad testdatabas; inte tillämpad i produktion. |
| CI | `.github/workflows/payment-control-ci.yml:1` | Befintliga Node-/Sites-jobb kör syntax, typkontroll, tester, audit och build. Inga nya scheman eller betalningsjobb. |

Detaljer: [bankkanaler och avtal](V4-SWEDBANK-CHANNELS.md), [parsergranskning](V4-BANK-EVIDENCE-REVIEW.md), [drift och återställningsprov](V4-OPERATIONS-REVIEW.md).

## Uppdragets 20 testscenarier

Samtliga nedan verifieras med syntetiska data och kontrollerade externa svar. Radnamn i testfilerna anger respektive scenario; verklig Swedbankverifiering omfattas inte.

| Nr | Scenario | Testevidens |
| --- | --- | --- |
| 1 | Samma belopp hos två kunder | `sites/tests/bankgiro.test.mjs:23`, `test/reconciliation.test.js:37` |
| 2 | Flera betalare i en insättning | `sites/tests/bankgiro.test.mjs:28` |
| 3 | Ingen individuell OCR | `sites/tests/bankgiro.test.mjs:24` |
| 4 | camt med betalare och OCR | `sites/tests/camt-integrity.test.mjs:8`, `sites/tests/helpers/camt-integrity.mjs:17` |
| 5 | Avvikande OCR | `sites/tests/bankgiro.test.mjs:25`, `test/reconciliation.test.js:31` |
| 6 | Betalare skiljer sig från kund | `sites/tests/bankgiro.test.mjs:71`, `test/reconciliation.test.js:71` |
| 7 | Delbetalning | `sites/tests/bankgiro.test.mjs:26`, `test/reconciliation.test.js:27` |
| 8 | Flera fakturor i samma betalning | `test/reconciliation.test.js:51` – explicit granskning, ingen beloppsgissning |
| 9 | Betalning i olika rapporter | `sites/tests/bankgiro.test.mjs:31`, `:32` |
| 10 | Samma fil flera gånger | `sites/tests/bankgiro-api.test.mjs:34` och browser-QA |
| 11 | Tillfälligt bankfel | `test/integration-job-api.test.js`, `sites/tests/banking-security.test.mjs` |
| 12 | Utgånget medgivande | `sites/tests/bank-details.test.mjs`, `sites/tests/banking-security.test.mjs` |
| 13 | Fel rapportkonto | `sites/tests/bankgiro.test.mjs:29`, `test/file-account-evidence.test.js` |
| 14 | Fel totalsumma | `sites/tests/bankgiro.test.mjs:30`, gemensamma camt-integritetstester |
| 15 | Skadad/manipulerad XML | `sites/tests/helpers/camt-integrity.mjs:23`, `sites/tests/bankgiro-api.test.mjs:39` |
| 16 | Inledande OCR-nollor | `sites/tests/bank-payment-ui.test.mjs`, gemensamt camt-original och browser-QA (`000018`) |
| 17 | Rapport före samlingspost | `sites/tests/bankgiro.test.mjs:38`, `:82` |
| 18 | Två processer matchar/importerar | `test/payment-concurrency.test.js`, `sites/tests/bankgiro-api.test.mjs:47` |
| 19 | Avbrott mitt i jobb/import | `test/payment-concurrency.test.js:61` (verklig process avslutas mitt i transaktionen), `test/integration-jobs.test.js`, `sites/tests/backup.test.mjs:79`, `sites/tests/gmail.test.mjs:202` |
| 20 | Äldre koppling rättas med historik | `sites/tests/payment-history.test.mjs:15`, `test/reconciliation.test.js:76` |

## Säkerhet och återställningsplan

Riktiga företagsdokument, konton, medgivanden, OAuth-nycklar, original, backuper och historik används inte som testfixtures. Inga nya bank-/Gmail-/backupscheman skapas. Ingen betalningsinitiering eller kundsändning körs. SFTP/API-adapter för individuella rapporter byggs först när läsbehörighet och tekniskt bankavtal har bekräftats. Internetbanken skrapas inte och BankID kringgås inte.

Produktionssättning kräver senare uttryckligt godkännande. Bevara projekt `appgprj_6adf2f7f7e848191b64192161886b528`, dess åtkomst, D1/R2-bindningar, företagsidentitet och hemligheter. Verifiera först aktuell krypterad backup och åtkomst till nycklar. Tillämpa 0012–0013 som additiva migreringar en gång. Kontrollera begränsad läsning och status före verklig avstämning. V4 har inte publicerats som del av denna leverans.

Kodrollback återgår till tidigare testad version 30 i samma Site med samma lagring. De additiva kolumnerna lämnas kvar; äldre kod kan ignorera dem. Ta inte bort original eller historik och återställ aldrig en äldre databas automatiskt. Återställningsprov ska ske till separat databas/objektmål och jämföras innan en särskilt beslutad produktionsåtgärd.

## Granskningsmatris och acceptans

| Område | Motiverad bedömning |
| --- | --- |
| Bankdatakvalitet | Striktare generiska originalkontroller verifierade. Bankens verkliga individuella data, avsändare och MIG **externt blockerade**. |
| Betalningsidentifiering | Inget namn/OCR från belopp eller fakturaförslag. Verklig betalare kan endast styrkas när det autentiska underlaget finns. |
| Säker matchning | Befintliga regler, originalintegritet, saldo och atomik regressionstestade. Tvetyda fall kräver granskning. |
| UI/UX | Sex fält, mobilkort, utfällbart underlag, verifieringshistorik och konkreta stoppåtgärder. Lokal browser-QA; inget nytt produktionstest. |
| Driftsäkerhet | Sena svar, leasebyte, omstart, återförsök och backupavbrott testade. Verklig D1-/providerdrift behöver driftverifiering. |
| Automatisering | Befintliga scheman återanvänds. Individuell rapporthämtning **externt blockerad**; manuell originalimport fungerar. |
| Säkerhet | Autentisering, ägarisolering, hash, nyckelfel, manipulerade original och revisionsspår testade. SHA-256 är inte avsändarautentisering. |
| Testtäckning | Uppdragets 20 scenarier omfattas lokalt. Syntetiska tester ersätter inte bankoriginal eller produktion. |
| Underhållbarhet | Gemensam XML-läsare, befintliga motorer/köer, additiva schemafält och avgränsade regressioner. |
| Verklig produktionsverifiering | **Inte godkänd.** V4 opublicerad och individuellt bankunderlag/avtalad kanal saknas. Ingen bedömning 10/10. |

Acceptans 2–11 är verifierad i den dokumenterade lokala omfattningen; verkliga externa integrationers beteende är inte bevisat av dessa tester. Kriterium 1 och produktionsdelarna av 4–5 samt 12–13 kvarstår tills autentiskt bankunderlag och kontrollerad företagsmiljö finns. Kriterium 14 uppfylls genom denna öppna redovisning. Fullt mål får inte markeras klart medan dessa hinder kvarstår.

## Slutliga körningar och bilder

Slutkontroll av programkod på revision 04c45b8 (därefter endast dokument/bilder):

| Kontroll | Resultat |
| --- | --- |
| Full Node-svit | **312/312**, 0 fel, 0 överhoppade |
| Full Sites-svit | **394/394**, 0 fel, 0 överhoppade |
| Node syntax | **60 JavaScript-filer**, godkänd |
| TypeScript | Godkänd |
| Produktionsbygge | **Build complete**, exit 0 |
| Båda npm audit, inklusive utvecklingsberoenden | **0 kända sårbarheter** |
| Oberoende kodgranskning | Konkreta fynd reproducerade/rättade; sista separata kontrollen 33 Node + 18 Sites godkänd, inga kvarvarande konkreta kodblockerare i ändrad omfattning |
| Krypterad återställning | Node och Sites återställda till separata syntetiska databaser; original och integritet jämförda |
| Verkliga processer | Konkurrerande importer samt abrupt processavslut mitt i SQLite-import med säker återstart och återimport |
| Browser-QA | Färdigt Worker-bygge med lokal separat D1/R2 och minnesdemo: riktig filväljare → syntetisk camt → rätt samlingspost → namn/OCR; saknad faktura förblir granskning. Dubblettförhandsgranskning visar Redan importerad; upprepad bekräftelse utan dubbla pengar verifieras dessutom genom API-integrationstest. |
| Responsivitet/tangentbord | 320/390/768/1024/1440 px utan dokumentoverflow; mobil dialog 370 px inom 390 px, Enter öppnar källhistorik och Escape stänger dialog. |

GitHub Actions-resultat och PR-länk redovisas i PR-beskrivningen/slutmeddelandet; dessa lokala resultat gör inget påstående om produktion. Det senaste texttestet förhindrar även att ett saknat OCR beskrivs som ett fakturanummer. [Desktop](screenshots/v4/bank-desktop.jpg), [mobil](screenshots/v4/bank-mobile.jpg), [källhistorik desktop](screenshots/v4/payment-evidence-desktop.jpg), [källhistorik mobil](screenshots/v4/payment-evidence-mobile.jpg) visar enbart fiktiva uppgifter. Maskinläsbar UI-verifiering sparas med bilderna.


Den maskinläsbara UI-kontrollen finns i [ui-verification.json](screenshots/v4/ui-verification.json). Det sparade syntetiska QA-originalet har bokföringsdatum 2026-10-24 för att motsvara den rullande demoposten vid kontroll 2026-10-29. Det är inte ett bankoriginal och inga företagsdata ingår. API-/krypteringsproven körs separat mot syntetisk SQLite/D1/R2-gräns; minnesdemot bevisar UI-flödet.


[Granskningsutkast PR #13](https://github.com/sharbel0022/Mgeorge/pull/13). GitHub bekräftade båda CI-jobben som success på 597004d8fce2fa9548f360183b0347b6215bcd3b före PR:n i [körning 40785435801](https://github.com/sharbel0022/Mgeorge/actions/runs/40785435801). Den efterföljande dokumentationsuppdateringen ändrar ingen programkod.
