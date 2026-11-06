# Exakt kvarstående acceptans för minst 314/330

Nuvarande verifierade nivå 250/330 har ett gap på64 poäng. Tabellen anger acceptans som saknas för varje område, inte utlovade höjningar. Varje nytt utfall måste bedömas med samma F/S/K/U/P-rubrik; testantal, åtgärdsplaner, avtal utan faktisk åtkomst eller publicering utan innehållsbindning ger inga automatiska poäng.

## Gemensamma blockerare

1. Slutför ordinarie maintainergranskning och hantera Agent 6:s leveranslucka. Full CI på den frysta kombinationen är redan godkänd; bevara exakta grindar vid varje senare ändring.
2. Godkänn aktuell produktionsmodell för bank/aggregator med leverantörsavtal, API-produkter, certifikat, exakt redirect, kund-/företags-/kontobehörighet och relevant SCA. Genomför tillåten verklig acceptans; kopierade eller manuella fält är inte bankbevis.
3. Aktivera och godkänn faktisk Bankgirokälla. Styrk bankoriginal, kontorelation, rapport-/insättningsidentitet, betalare och referens före fakturarelation.
4. Återställ en oberoende aktuell produktionsbackup i isolerad miljö med separat åtkomliga nycklar. Stäm av alla original, ekonomin, ägare/behörigheter och tjänstestart; mät RPO/RTO och verifiera återgång.
5. Slutför extern juridisk/avtalsmässig/regulatorisk och dataskyddsmässig acceptans med ansvarig part för vald driftmodell.
6. Bind publicerad Siteskälla/arkiv till exakt testat Git-innehåll. Kör godkänd autentiserad användar-, bank-, Gmail-, OCR- och driftacceptans på den revisionen.

## Samtliga33 områden

| Nr | Kriterium | Nu | Avstånd till9,5 | Konkret kvarstående acceptans |
| --- | --- | ---: | ---: | --- |
| 1 | Design och färger | 7 | 2,5 | Acceptera samtliga relevanta vyer med verklig text, kontrast, 200–400 % zoom och skärmläsare på publicerad revision. |
| 2 | Startsida | 7,5 | 2 | Stäm av autentiserade startsidans kort, perioder och summor mot en godkänd uppsättning original och ekonomiska facit. |
| 3 | Navigering | 7,5 | 2 | Dokumentera Tab, Shift+Tab, Escape, framåt/bakåt samt fokusåtergång genom alla centrala autentiserade vyer och dialoger. |
| 4 | Mobilanpassning | 7,5 | 2 | Acceptera iOS/Android, rotation, tangentbord, långa referenser och originaldialoger på aktuell publicering; komplettera relevant hjälpmedelskontroll. |
| 5 | Sökning och filtrering | 7,5 | 2 | Verifiera referensvarianter, kombinerade filter och komplett resultat mot facit på stor realistisk datamängd; mät hela data- och användarkedjan. |
| 6 | Minimal manuell hantering | 6 | 3,5 | Mät en godkänd representativ arbetsperiod: korrekta avslutade ärenden, manuella beslut, tid och undantag; verifiera bank/Gmail-kedjorna. |
| 7 | Kundfakturor | 8 | 1,5 | Verifiera godkänt originalinventarium, registrering, belopp, referens, kundrelation och betalningshistorik i ett autentiserat flöde. |
| 8 | Leverantörsfakturor | 8 | 1,5 | Verifiera godkända leverantörslayouter, kredit/negativa belopp, mottagarrelation och originalbevarande mot ett märkt verkligt facit. |
| 9 | PDF-tolkning | 8 | 1,5 | Utöka och frys godkänd representativ PDF-korpus med fältfacit; redovisa felaktiga gröna godkännanden, osäkerhet och fellägen. |
| 10 | Bild-OCR | 7,5 | 2 | Kör godkänd rasterkorpus och aktuell cloud-worker med verkligt underlag; mät fältkvalitet, osäkerhet, fel, total tid och spårbarhet. |
| 11 | Gmail-anslutning | 8,5 | 1 | Verifiera aktuell levererad Gmailkedja med godkänt originalfacit och representativ autentiserad användaracceptans. Externt schema, OCR och registrering bedöms dessutom separat. |
| 12 | Automatisk fakturaregistrering | 8 | 1,5 | Verifiera automatisk registrering av godkända original med samtliga kritiska fält, exakt-en-gång-beteende och oförändrade äldre poster. |
| 13 | Dubblettkontroll | 8 | 1,5 | Verifiera ägarbundet originalinventarium, godkänd återhämtning, korrigering och historiska luckor; visa att dubbla/importerade original inte skapar dubbel ekonomi. |
| 14 | Dokumentgranskning | 8 | 1,5 | Acceptera prioriterade verkliga dokument med original, versionsbyte, fel/retry och korrekt synlig osäkerhet i aktuell autentiserad UI. |
| 15 | Swedbank-anslutning | 7,5 | 2 | Verifiera att de granskade consent-/race-rättningarna finns i accepterad publicering. Styrk aktuell bankutfärdad kontorelation, behörighet, detaljer, förnyelse och tillåtna retry-fall med verkliga bankbevis. |
| 16 | Automatisk bankhämtning | 7,5 | 2 | Verifiera ett auktoriserat komplett aktuellt bankjobb inklusive sidindelning, leases, kvitton, dedup, avbrott/återupptagning och oförändrad ekonomi vid nekad åtkomst. |
| 17 | Bankgiroimport | 8,5 | 1 | Konfigurera och godkänn faktisk bank-/företags-/kontobunden källa med profil och råkvitto; verifiera betalare, referens och samlingsinsättning före separat fakturarelation. |
| 18 | Identifiera verklig betalare | 7 | 2,5 | Styrk verklig betalare från bankoriginal eller godkänd redovisningsrelation; verifiera attest, konflikt och återkallande utan att interna kunduppgifter blir bankfakta. |
| 19 | Verklig OCR/fakturareferens | 7 | 2,5 | Verifiera bankbunden verklig OCR/referens inklusive avtal/checksiffra där relevant, inledande nollor, frånvaro och konflikter mot ett märkt originalfacit. |
| 20 | Automatisk betalningsmatchning | 7,5 | 2 | Verifiera representativ betalningsvolym med korrekt bankpart, godkända fakturarelationer och exakt facit; mät falska positiva och bevara förslag/bokföring som separata steg. |
| 21 | Delbetalningar | 8 | 1,5 | Verifiera verkliga godkända delbetalningar med korrekt restbelopp, tidsordning, avstämning och obruten audit. |
| 22 | Överbetalningar | 8 | 1,5 | Verifiera verklig överbetalning och godkänd affärshantering, saldo/status, beslut och audit utan automatisk felaktig fakturakoppling. |
| 23 | Flera fakturor i en betalning | 7,5 | 2 | Verifiera kompletta original och godkända grupperingar med summerade belopp, referenser och dokumenterade beslut för flera fakturor per betalning. |
| 24 | Betalningshistorik | 8 | 1,5 | Verifiera autentiserad historik vid realistisk volym, pagination, tidsordning och audit genom migrering och återställning; eliminera relevanta obegränsade listgränser. |
| 25 | Betalningsstatus | 8 | 1,5 | Verifiera aktuell betalningsstatus mot godkända original, kontorelation och aktuellt samtycke; acceptera även reauth/okänd/ofullständig status utan falsk grön signal. |
| 26 | Kontrollera alla betalningar | 7,5 | 2 | Genomför tillåtet komplett produktionsflöde mot avgränsat godkänt underlag med audit, korrekta undantag och dokumenterad tidsåtgång. |
| 27 | Automatiska mejlutkast | 8 | 1,5 | Acceptera mottagare, innehåll, osäker evidens och fel-/retry-lägen i aktuellt flöde. Verifiera att förhandsvisning aldrig sänder och att sändning kräver tillåtet separat beslut. |
| 28 | Schemalagd automatisering | 6,5 | 3 | Verifiera faktiska auktoriserade Gmail-, bank- och OCR-körningar med rätt identitet/kadens, 429/restart/leasehantering och bevarade original. |
| 29 | Säkerhetskopiering | 8,5 | 1 | Verifiera aktuell komplett separat kopia av alla nödvändiga original, metadata och nycklar; kontrollera hash och genomför ägarisolerad restore utan gamla behörigheter/leaser. |
| 30 | Säkerhet och åtkomstkontroll | 8 | 1,5 | Verifiera de rättade consent- och racegränserna i accepterad driftkonfiguration. Bedöm oberoende den publicerade revisionens nycklar, sessioner, ägarbyte, callbacks, export/original och överlastskydd; stäng alla säkerhetskritiska fynd. |
| 31 | Katastrofåterställning | 6,5 | 3 | Återställ från en oberoende komplett backup i isolerad miljö med nycklar, original, ägare, behörigheter, historik och ekonomisk avstämning; mät RPO/RTO och dokumentera start/återgång. |
| 32 | Kodkvalitet och tester | 8,5 | 1 | Bevara reproducerbara fulla grindar vid varje release. Slutför relevant instrumentation-/lint-/underhållsacceptans och knyt faktisk accepterad leverans till samma testade kod; den nu gröna syntetiska CI:n är redan styrkt. |
| 33 | Verifiering i verklig produktion | 5 | 4,5 | Verifiera exakt levererad revision, representativa autentiserade kundflöden, faktisk bank/Gmail/OCR, original-/ekonomifacit och återställningsövning; stäng kommersiella go/no-go-grindar. |

Alla 33 på 9,5 ger 313,5/330. Minst ytterligare 0,5 måste styrkas i ett område utan att andra poäng faller; vilket område kan avgöras först när verkliga bevis finns. Kritiska releasegrindar måste vara stängda oavsett totalpoäng.
