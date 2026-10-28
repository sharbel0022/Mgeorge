# En knapp för betalningskontroll

## Leveransens omfattning

Denna ändring gäller **GitHub-versionen med Node.js/SQLite**. Den publicerar inte kod till den befintliga ChatGPT Siten och ändrar inga Sites-data, bankmedgivanden, Gmail-behörigheter eller molnscheman. Den separata Sites-implementationen behöver motsvarande integration och egen verifiering före publicering. Ändringen innehåller inga produktionsuppgifter eller privata nycklar.

## Användarflöde

Översikten har en huvudknapp: **Kontrollera alla betalningar**. Den startar en begränsad kontroll med fem sparade steg:

1. Hämta Gmail-underlag med redan godkänt medgivande, eller använd nyligen hämtat underlag.
2. Tolka ännu inte analyserade dokument med befintlig dokumentmotor.
3. Hämta bankhändelser från redan valda och giltiga konton, med respekt för bankens återförsökstid.
4. Återanvänd den befintliga konservativa avstämningen.
5. Förbered kundmeddelanden som utkast — **skicka aldrig**.

Saknad anslutning, tillfälligt fel eller fler väntande dokument stoppar inte hela översikten. Status visar Klart, Sparat underlag, Väntar, Behöver åtgärd eller Kunde inte slutföras per steg. En ofullständig kontroll blir **Delvis klart**, inte en lyckad fullständig hämtning. Slutförd körning betyder inte att alla fakturor är betalda eller att alla Bankgirospecifikationer finns.

Startsidan visar verkliga databasvärden. **Kvar att stämma av** är inte ett påstående om bevisat obetald skuld. Granskningskön samlar dokument, osäkra inbetalningar, Bankgiro-underlag, ej avstämda fakturor och meddelanden. Oklar mejlleverans prioriteras och får inte sändas om automatiskt.

Navigationen har fem huvudområden: Översikt, Att granska, Fakturor, Bank & betalningar samt Inställningar. Import, leverantörsfakturor, meddelandehistorik och övriga tidigare funktioner finns kvar via respektive område.

Fakturadetaljen visar original, verifierade allokeringar, nya förslag och aktuella mejlutkast samtidigt. **Läs och granska mejlet** öppnar det tidigare versionsbundna godkännandeflödet; förhandsvisningen är inte ett utskicksgodkännande.

## Bankgruppering

Bankvyn prioriterar Inbetalningar och skiljer dem från Bankgiro-underlag, Övrigt, Matchade och Undantagna. Ursprungligt betalarnamn används när det finns, annars bankbeskrivning eller en korrekt riktningsbaserad reservtext. Lön och kortköp får inte etiketten Bankgiro bara för att betalarnamn saknas. Positiva kortåterbetalningar grupperas under Övrigt när beskrivningen identifierar dem som korttransaktioner.

Detta är en **visningsklassificering**, inte en ny betalningsregel. Den ändrar inte originaluppgifter, saldon eller finansiell bokföring. Bankens eller kortutgivarens beskrivning kan vara ofullständig; användaren kan alltid välja Alla och granska originalet. En samlingspost räknas aldrig som en extra kundbetalning.

## Teknisk implementation

- `src/payment-control.js`: beständiga körningar, steg, ägargräns, en aktiv körning per ägare, idempotent request-ID och avbrottsåterställning.
- `src/payment-overview.js`: skrivskyddad modell för sammanfattningar och granskningskö.
- `src/server.js`: privata endpoints och adaptrar till befintlig Gmail-, bank-, OCR-, avstämnings- och utkastkod.
- `public/payment-control.js` / `.css`: huvudknapp, fem steg, granskningskö, bankfilter och samlad fakturadetalj.
- `public/app.js` / `index.html`: förenklad navigation och integration. Vanlig siduppdatering läser data; den startar inte längre avstämningsmutationer genom ett dolt POST.

API:

| Endpoint | Ansvar |
| --- | --- |
| `GET /api/payment-control/overview` | Aktuella totalsummor, kö, grupper och senaste körning. |
| `POST /api/payment-control/run` | Accepterar enbart `request_id`; startar eller återanvänder körning. |
| `GET /api/payment-control/runs/:id` | Ägarbunden sparad status. |

Tabellen `payment_control_runs` läggs till utan att ersätta befintliga tabeller. Ett unikt index begränsar samtidiga körningar för samma ägare. Samma request-ID återanvänder alltid samma körning. Nya klick inom 60 sekunder återanvänder senaste körningen. Klienten behåller request-ID vid förlorat svar så att ett nytt klick inte råkar bli en ny begäran.

Arbetet körs i den befintliga Node-processen, inte i webbläsaren. Stegstatus uppdateras i SQLite och en lease förnyas under körning. Avslutad session eller förlorad lease stoppar fortsatt arbete. Efter serveravbrott visas Avbruten när den gamla leasen löpt ut; en ny kontroll kräver nytt manuellt klick. Detta är inte en distribuerad jobbkö och kan inte köras oförändrat som en kortlivad Worker-request.

De befintliga Gmail-/banklåsen används också. Körningen uppgraderar inga OAuth-behörigheter, byter inga nycklar, väljer inga nya bankkonton och ändrar inga schemaläggnings- eller automatregistreringsval. Kundutskick ligger enbart i den befintliga explicita godkännandevägen.

## Avsiktliga gränser

En körning behandlar högst två ännu inte tolkade dokument och tre bankanslutningar. Gmail hämtar en begränsad omgång enligt befintlig adapter; kvarvarande sidor/dokument visas som väntande. Ett stort historiskt importjobb blir alltså inte färdigt bara för att knappen klickats en gång. Detta skyddar resurser och gör ett partiellt resultat synligt.

Nyligen hämtat Gmail-underlag återanvänds inom 15 minuter när ingen paginering återstår. Nyligen lyckade bankhämtningar återanvänds inom 60 sekunder; leverantörens eventuella `retry_after` gäller dessutom. Dessa är Node-regler, inte en ändring av Sites separata sex timmars bankgräns.

Ingen knapp kan skapa saknade Bankgirodetaljer. Kontokrediteringar utan individuella underlag stannar i granskningskön. Anslutning och cache-status visas från servern; saknad extern konfiguration döljs inte.

## Verifiering

Automatiska tester täcker bland annat idempotens, samtidiga klick, avbrott, leases, nekad åtkomst, revokerad session, partiella fel, providertext som inte får läcka, riktning/återbetalning, räknade saldon, oförändrade inställningar, inga utskick, XSS-escaping, klientrensning efter utloggning och nya statiska resurser under befintlig CSP.

`npm run check` syntaxkontrollerar alla JavaScript-filer. `npm test` kör den befintliga sviten och nya regressioner. `.github/workflows/payment-control-ci.yml` kör kontrollerna i GitHub Actions med syntetiska data och utan produktionshemligheter.

Det nya UI:t har dessutom körts som en isolerad offline-demo i Chromium, med syntetiska data och simulerat nätverkslager. Översikt → kontrollstatus → granskningskö → fakturadetalj → bankfilter är kontrollerat, inklusive mobilbredd 390 px utan horisontell overflow. Detta är en UI-kontroll, inte ett verkligt Gmail-/BankID-/utskickstest eller en publicering till Sites.

## Sites-publicering genomförd 2026-10-28

Den separata Sites-implementationen är publicerad som version 21 med D1-körningar, beständiga idempotensalias, atomiska leases, stegvis återupptagning och bankreservationer. Befintlig dokumentkö, Windows-OCR, Gmail-/bankanslutningar, nycklar och pausade molnscheman bevarades. Ett verkligt knapptryck hämtade 17 nya Gmail-underlag; bankdata återanvändes inom väntetiden. Inga mejl skickades.

Se [slutrapporten](MG-FAKTURAKOLL-2-LEVERANS.md) och [den fullständiga Sites-patchen](sites/payment-control-v2.patch). En GitHub-merge är fortfarande separat från Sites-publicering. Jobbstatus visar kontrollens omfattning, inte att alla fakturor är betalda. Ny bankhämtning och faktiska kundutskick har inte verifierats live i denna leverans.
