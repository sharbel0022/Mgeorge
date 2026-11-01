# Färskt AIS-kvitto och kontroll av bevarat rapportoriginal

Datum: 2026-11-01. Baslinje: `888980f7143530a7ccc649a5a7012d5626aac411`.

## Uppdrag och genomförande

Användaren har beställt fortsatt kontroll av mottagarkonto och rapportens samband med bankposten, rättad kvittohantering och publicering. Fakturaallokering får ske först efter verifierade underlag. Planen är avgränsad till befintliga Sites-flöden: reproducera saknat kvitto, normalisera den autentiserat nyhämtade listposten, kontrollera identitet och bevarade fakta, adoptera endast faktiskt saknade kvittofält, verifiera sparat rapportoriginal utan uppladdning, kör obligatoriska grindar och publicera. Verklig verksamhetskontroll följer separat efter leverans.

Alternativet att hashberäkna äldre rådata ger ingen ny proveniens och är uteslutet. Bred banksynkronisering är onödig för en riktad detaljkontroll. Manuellt kontoalias härleds inte ur liknande siffror.

## Rättning och skydd

`details-service.ts` använder den befintliga normaliseraren på den färska banklistposten efter ägar-, produktionsmedgivande-, valt konto- och live sessionskontroll. `adoptFreshBankReceipt` kräver samma stabila externa ID, konto, datum, valuta, belopp, bankreferens, intakt originalprojektion och frånvaro av evidenskonflikt. Båda äldre kvittofälten måste vara strikt `undefined`. Befintlig rå-JSON måste vara identisk med den färska; ingen äldre JSON förseglas på egen hand. Tomma, null, felaktiga eller befintliga kvitton ersätts inte. Detaljsvaret bevaras separat, även om banken saknar individuell detaljresurs. Audit anger om kvitto adopterades.

Nyligen sparade detaljer kan inte ersätta en färsk bankhämtning. Legacy-rader med båda kvittofält saknade passerar därför inte detaljcachen; vanliga konto-, medgivande- och väntetidskontroller gäller fortfarande. Inga importer, allokeringar, fakturor, bankfält eller manuella verifieringsbeslut ändras av kvittoadoptionen. Ingen automatisk avstämning eller meddelandeförberedelse körs.

`GET /api/bankgiro/preview` kan läsa ett redan ägt dokument via `documentId` och valfritt ägt `targetId`. Befintlig originalkontroll verifierar ägare, storlek och hash. Svaret innehåller råa och kontoavstämda rader samt förhandsgranskning. Endpointen skriver inte dokument, audit eller arbetsyta och kontaktar inte bankleverantören. Kontoalias måste finnas uttryckligen i ägarens aktiva kontoresurs; ingen BBAN-/IBAN-omräkning införs.

Node bedömdes: det saknar motsvarande riktade detaljendpoint och ändras inte. Dess befintliga bankhämtning och originalkontroller behålls; en generell historisk kvittomigrering ingår inte. Båda applikationernas obligatoriska kontroller körs.

## Testbevis före publicering

- Rött före rättning: riktade tester reproducerade utebliven adoption och legacy-cache som blockerade färsk hämtning.
- Grönt: 44 riktade detaljtester och fem nya ägar-/original-/aliasförhandsgranskningstester.
- Rena installationer: rot `npm ci --ignore-scripts`, Sites `npm run install:ci`.
- Full Node: 595/595; syntax 89 filer; audit 0.
- Full Sites: 987/987; TypeScript och produktionsbygge godkända; produktionsaudit 0. Full audit har fortsatt 16 moderate i utvecklingsverktyg och 0 high/critical; obligatorisk high-grind passerar.
- Oberoende kodgranskning fann inga Critical/Important-fynd. Tester använder syntetiska underlag. Inga kundoriginal eller kontouppgifter lagras här.

## Verifieringsgräns

Lokala bank-PDF:er hittades och granskades privat. De innehåller kontospecifika uppgifter och en individuell rapport, men de får inte publiceras i Git. Levererad kvittofunktion är inte i sig bevis för att två olika original avser samma insättning. Den separata verksamhetskontrollen och eventuell manuell relation/fakturaallokering måste dokumenteras med faktisk driftstatus. Kvalitetspoäng höjs inte på grund av dessa syntetiska tester.
