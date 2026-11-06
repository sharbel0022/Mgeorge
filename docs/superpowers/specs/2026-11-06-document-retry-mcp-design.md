# Återköning av befintligt fakturaunderlag via MCP

## Avsikt och beslut

Användaren har gett ett övergripande uppdrag att färdigställa hela appen till minst 8/10. Den befintliga knappen **Tolka igen** återköar ett ägt underlag, men motsvarande åtgärd saknas i appens MCP-gränssnitt. Driftundersökningen har identifierat en möjlig befintlig kandidat vars sparade tolkning föregår en motpartsverifiering. Kandidaten är inte godkänd för registrering av denna metadataobservation.

Root väljer en liten, generell komplettering inom uppdraget: `retry_invoice_document` återanvänder samma återköning som webbsidan. Detta är ett implementationsbeslut, inte ett påstående om att användaren har godkänt en viss fakturas sakuppgifter.

## Alternativ

- Använda den befintliga webbsidan: ingen kodändring, men den anslutna lokala webbläsaren är inte tillgänglig i denna session. Inga inloggningskontroller kringgås.
- Lägga en uttrycklig, ägarbunden återköningsåtgärd i MCP: återanvänder produktens vanliga databas- och företagsgräns. Detta väljs, eftersom samma funktion blir tillgänglig i båda avsedda gränssnitten.
- Låta status eller den allmänna processorn automatiskt återköa granskningsposter: skulle ändra innebörden av befintliga läsningar eller schemakörningar och ge upprepade tolkningar. Detta väljs inte.

## Kontrakt

- Nytt MCP-verktyg: `retry_invoice_document`, exakt ett argument `documentId`, en sträng som matchar `^[a-zA-Z0-9_-]{1,100}$`. Alla övriga argument, tomma/ogiltiga ID:n och fel datatyper avvisas.
- Identitet kommer från befintlig Sites OAuth och aktuell företagskontext. Inga owner-, konto-, context-, force- eller fältvärdesargument tas emot. Åtgärden kräver vanlig skrivbehörighet.
- Endast ett befintligt jobb för samma ägare i `failed`, `needs_review` eller `duplicate`, med en aktiv `needs_review`-källa, får återköas. `engine=local` går till `waiting_ocr`; övriga till `queued`, precis som befintligt UI.
- Operationen återställer försök, tillgänglighet och lease för det återköade jobbet. Den ändrar inga original, tolkningar, motpartsverifieringar, fakturor, registreringskvitton eller betalningar. Den läser inga original och kontaktar inga externa tjänster.
- Den kör inte processorn. Ett separat anrop till den ordinarie processorn återprövar samtliga befintliga villkor för tolkning, registrering, dubbletter och efterkontroll. Pausfunktionen kvarstår.
- Svar: `{ok:true,requeued:boolean}`. `requeued=true` betyder bara att exakt en tillåten rad uppdaterades i detta anrop. Ett saknat, främmande eller redan aktivt/slutligt jobb ger `requeued=false` utan att avslöja varför. Ett nytt anrop kan vara meningsfullt efter en senare bearbetning; verktyget annonseras därför inte som generellt idempotent.
- UI och MCP använder samma ägarbundna hjälpfunktion. UI behåller autentisering och origin-kontroll; inget syntetiskt Request används för att kringgå dem.

## Verifiering och leverans

Frys negativa och positiva tester före produktändringen. Verifiera riktiga D1-liknande radövergångar, båda motorerna, alla tillåtna och spärrade tillstånd, främmande ägare, avvisad källa, saknat ID, fel argument, utebliven inloggning och bevarade ekonomiska/originaldata. Kör befintlig Gmail-svit och typkontroll. Låt en oberoende granskare bedöma ändringen före normal PR, full CI och publicering.

Ett eventuellt verkligt efterprov sker först på publicerad kod med det redan befintliga underlaget och utan manuellt sakgodkännande. Varken denna funktion eller testantalet ger ett högre betyg i sig.
