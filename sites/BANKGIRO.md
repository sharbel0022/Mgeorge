# Bankgiro – import och säker avstämning

Importen accepterar camt.054/camt.053 XML och Bankgiro CSV. Den läser om det sparade R2-originalet på servern före bekräftelse. Förhandsgranskningen skriver inga betalningar eller originalfiler.

För automatisk koppling till en befintlig Swedbank-samlingspost krävs samma fullständiga mottagarkonto, bokföringsdatum, valuta, insättningsidentifierare och exakt totalsumma. Konton kan översättas till bankanslutningens stabila identitet endast genom fullständiga identifierare från redan valda och krypterat sparade bankkonton. Ett maskerat kontos slutnummer räcker aldrig.

Originalposten ändras inte. Individuella betalningar får parentId och ersätter föräldern ekonomiskt. Obundna specifikationer har specificationStatus=review, saknar verifiering och får inte matchas eller manuellt frigöras. Återimport jämför filhash, individuella bankidentifierare och redan kopplade betalningar. Konflikter hålls för granskning.

Exakt fakturareferens, rätt kundidentitet, registrerad granskad faktura och verifierat betalningsunderlag krävs för automatisk avstämning. 0599 behåller inledande nolla. Belopp hanteras i heltalsören. Saknad/fel OCR, annan kund och flera möjliga fakturor kräver granskning. Delbetalning lämnar kvar saldo; överskott ligger kvar på betalningen.

En saknad faktura söks först i redan hämtade Gmail-underlag. Därefter får högst tio mejl hämtas med befintligt medgivande, befintligt lås och femton minuters spärr. Den riktade referenssökningen ändrar inte den vanliga hämtningens sidmarkör eller datum. Befintliga dokumentinställningar styr registrering och lokal OCR. Ingen mejlsändningsfunktion anropas. Pausade molnscheman ändras inte.

## CSV

Fälten Betalningsdatum/Datum/Bokföringsdatum, Avsändare/Betalare, Betalningsreferens/OCR, Belopp och Valuta identifieras automatiskt. Referenskolumnen behöver finnas men dess värde får saknas; då görs ingen automatisk fakturamatchning. Bankgironummer/Avinummer bevaras som avsändaruppgift. Mottagarkonto och Bankreferens/Insättningsreferens behövs för bankkopplingen. Utan dem sparas underlaget för granskning. UTF-8 och Windows-1252 stöds.

Det finns ännu ingen verklig kundexport i testunderlaget. CSV-profilen är ett uttryckligt stödd kolumnschema, inte ett påstående att Bankgirots skyddade webbplats alltid exporterar denna layout. Ingen skyddad sida skrapas. PDF/bild stöds inte som automatisk betalningsspecifikation.

## Formatkällor

- [Swedbanks officiella ISO 20022-guider](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html).
- [Bankgirots användarmanual för Insättningsuppgift via Internet](https://www.bankgirot.se/globalassets/dokument/anvandarmanualer/insattningsuppgift-via-internet_anvandarmanual_sv.pdf) dokumenterar avsändare, betalningsreferens och avsändarens Bankgiro/Avinummer.
- [Bankgirots information om insättningsposter](https://www.bankgirot.se/tjanster/inbetalningar/bankgiro-inbetalningar/vanliga-fragor/).

Swedbanks länkade MIG-PDF och exempelfil gav HTTP 403 vid granskningen. Företagets faktiska export, identifierarnas överensstämmelse med AIS och eventuella datumavvikelser måste därför verifieras med ett verkligt original. Importen gissar inte vid skillnader.

## Data och tester

Sites använder befintlig workspaces.payload och befintliga D1/R2-tabeller. Nya frivilliga transaktionsfält är additiva i JSON. Inga befintliga migreringar ändras; inget databasbyte behövs. Testerna använder syntetiska dokument och separat lokal databas. Kör npm run check, npm test och npm run build.
