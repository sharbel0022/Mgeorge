# MG Fakturakoll

**Aktuell granskningsbranch, 28 oktober 2026:** Bankfiler läses om från ägt, hashkontrollerat original på servern; klientens förslag kan inte bli bankfakta. Migration 0011 tillför beständig Gmail-väntetid. Ingen produktion har migrerats eller publicerats av denna leverans. Läs [samlad verifiering och externa bankkrav](../docs/BANK-EVIDENCE-SAFETY-DELIVERY.md). Äldre leveransavsnitt nedan beskriver historiska begränsningar; Gmail och moln-OCR finns nu i källan.

Faktura- och betalningsöversikt för M.George Vitvaror AB, med uppgifter som är privata för varje inloggad ChatGPT-användare.

## Det som fungerar

- Kundfakturor och leverantörsfakturor med granskning, förfallodatum, bilagor, anteckningar och historik.
- Status beräknas från fakturabelopp, bekräftade betalningar och krediter: obetald, delbetald, förfallen, betald, krediterad eller återbetalning.
- Kund- och leverantörsöversikt, sökning, filter, CSV-export och JSON-export med full historik.
- Import av svenska CSV-filer med valbara kolumner samt bokförda SEK-poster i ISO 20022 camt.053/camt.054. Originalfiler sparas som bilagor.
- Bankanslutning via Enable Banking på `/bank`: verifiering av applikationsuppgifter, bankens medgivandeflöde, kontoval, hämtning på begäran och frånkoppling. Verklig åtkomst kräver användarens godkända leverantörs- och bankanslutning.
- PDF-fakturor och EML-mejl med en PDF-bilaga kan läsas till förslag som användaren granskar. Bilder och skannade PDF-filer registreras manuellt med originalbilagan kvar.
- OCR/referensbaserade matchningsförslag, delbetalningar, fördelning på flera fakturor, kreditfakturor och återbetalningar.
- Samlingsbetalningar med exakt kontroll mellan bankposten och dess delbetalningar. Samlingsposten kan inte själv betala en faktura.
- Dubblettkontroll på filhash och bank-ID. Liknande rader utan stark identitet hålls för granskning.
- Matchningar, granskning och uppdelning kan återtas med bibehållen historik.
- Påminnelsetext för granskning och kopiering. Systemet skickar inga meddelanden.
- Avskilt demoläge i minnet; inga exempel registreras som verkliga kunduppgifter.

## Bankanslutning via Enable Banking

Integrationen använder **Account Information (AIS)** för att läsa kontouppgifter och bokförda transaktioner från svenska företagsbanker som leverantören erbjuder för den aktuella applikationen. Den initierar inga betalningar. Sidan visar verklig anslutningsstatus, valda konton, medgivandets giltighet, senaste hämtning och eventuella fel.

### Förbered anslutningen

1. Logga in med det ChatGPT-konto som ska äga MG:s register och öppna **Bankanslutning** på `/bank`.
2. Öppna [Enable Bankings applikationsportal](https://enablebanking.com/cp/applications) och skapa en applikation med namnet **MG Fakturakoll** och tjänsten **Account Information (AIS)**. Sandbox är avsedd för testdata. MG:s löpande företagsanvändning behöver rätt produktionsåtkomst hos leverantören, inklusive deras aktivering/godkännande och eventuella avtal och företagskontroll. Kontrollera kostnader och villkor; en begränsad testanslutning för egna konton innebär inte godkänd kommersiell drift.
3. Registrera exakt denna returadress i applikationen:

   ```text
   https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/bank/callback
   ```

4. Återkalla tidigare exponerade privata nycklar och generera en ny RSA-nyckel (PKCS#8, minst 2048 bitar). Registrera motsvarande publika certifikat hos Enable Banking. En tidigare uppladdad eller delad privat nyckel får inte återanvändas.
5. Systemadministratören konfigurerar endast skyddade Sites-runtimehemligheter: `ENABLE_BANKING_APPLICATION_ID`, `ENABLE_BANKING_PRIVATE_KEY`, `ENABLE_BANKING_ENVIRONMENT` (`SANDBOX` eller `PRODUCTION`) och i produktion `ENABLE_BANKING_KEY_ROTATED=true` efter slutförd återkallelse och nyregistrering. Bevara befintlig `BANK_DATA_ENCRYPTION_KEY`. Inga nycklar tas emot från webbläsaren eller från äldre `bank_applications.encrypted_key` i D1. Lägg aldrig nycklar i chatt, källkod, Git, hostingmanifest eller frontend. `/api/bank/config` POST avvisas utan att kroppen läses.
6. Öppna **Bankanslutning**, där Swedbank är förvald, och tryck **Koppla banken**. Servern verifierar registrerad miljö, aktiv AIS-åtkomst i Sverige, exakt returadress och Swedbanks företagsstöd före bankflödet. Behörighet till rätt företagskonto och bankens autentisering, exempelvis BankID, måste slutföras av kontots behöriga användare.
7. Efter återkomsten till MG kontrollerar du vilka SEK-konton som ska användas. Om banken endast lämnar ett importbart SEK-konto föreslås det i vyn, men inget sparas eller hämtas automatiskt. En uttrycklig åtgärd sparar kontoval och period och hämtar sedan bankhändelser. Om sparandet misslyckas startas ingen hämtning. Om kontovalet sparas men hämtningen misslyckas visas felet och det sparade valet kan användas vid nästa försök. Granska därefter resultatet i **Bankhändelser**.

Den vanliga vyn visar bank, status, maskerade konton och nästa åtgärd. Datum och kontobyte finns under utfällbara inställningar. Om serveraktiveringen saknas visas ”Banktjänsten behöver aktiveras av systemadministratören.” Filimport finns på `/?view=bank&import=1`; `/?view=bank` öppnar bankhändelser direkt. Nyckelrotation gör äldre flöden och anslutningar ogiltiga. En äldre anslutning kan tas bort lokalt utan att den komprometterade nyckeln används; vyn berättar då att tidigare medgivande måste återkallas manuellt hos Swedbank eller Enable Banking.

Returadressen är fast i `lib/banking/service.ts`; ett domänbyte kräver en samordnad ändring i koden och i leverantörens applikation. En resultatparameter i sidans URL är inte i sig bevis för en anslutning: status och konton läses från den inloggade användarens serverdata.

### Hämtning och avstämning

- **Hämtningen startas manuellt.** Ingen schemalagd eller automatisk bakgrundshämtning är aktiverad. En kontroll av anslutningens eller leverantörens status hämtar inga bankhändelser.
- Vald period läses på nytt vid varje hämtning, för att kunna fånga bankhändelser som tillkommit senare. Startdatum kan ändras från kontovalet. Standardvalet i vyn är de senaste 30 dagarna; banken avgör tillgänglig historik.
- Högst 1 000 bankhändelser och 25 sidor får hämtas i ett försök. Ett avbrutet eller för stort hämtförsök ska inte spara en ofullständig import. Välj ett senare startdatum om perioden är för stor. Vänta minst en minut mellan lyckade hämtningar.
- Endast bokförda SEK-händelser inom perioden importeras. Ej bokförda poster, andra valutor och ogiltiga uppgifter hoppas över med varningar.
- Importerade bankposter får `kind: unknown` och `verified: false`. Kontrollera underlaget innan betalningen bekräftas och matchas. Ett mejl med texten ”betald” eller en bankrad utan tillräcklig fakturareferens styrker inte betalning av en viss faktura.
- Stabila konto- och bankreferenser används för dubblettkontroll. När banken inte lämnar ett stabilt transaktions-ID behålls uppgifterna för granskning; återkommande hämtning kan då ge möjliga dubbletter som måste kontrolleras.
- **Bankgirodetaljer är fortfarande ett separat behov.** En samlad insättning via konto-API:t innehåller inte säkert de enskilda betalarnas namn, OCR och delbelopp. Komplettera med camt.054 eller bankens betalningsspecifikation. Filimport och manuell uppdelning finns kvar.
- **Sandbox skriver aldrig testhändelser till det riktiga faktura- eller betalningsregistret.** Testkörningen och dess varningar kan visas i bankvyn, men resultatet ska inte matchas mot verkliga fakturor.
- Ett utgånget eller återkallat medgivande behöver förnyas. **Anslut igen** avslutar först den gamla leverantörssessionen och startar sedan ett nytt medgivande hos samma bank. Om det första steget misslyckas startas inget nytt medgivande. Tidigare importerade bankhändelser behålls. Om leverantören inte bekräftar att sessionen har avslutats behålls anslutningsuppgifterna så att frånkopplingen kan slutföras. Den separata åtgärden för att koppla från finns under anslutningsinställningarna och kräver bekräftelse.

### Skyddade anslutningsuppgifter

Den privata leverantörsnyckeln kommer endast från Sites skyddade serverhemligheter. Banksessionen och leverantörens kontouppgifter krypteras med AES-GCM, bundet till användaren och uppgiftens användningsområde. Äldre D1-nycklar används aldrig; uppdatering av leverantörsmetadata tömmer den gamla nyckelkolumnen. API-svaren lämnar inte ut privata nycklar eller sessionshemligheter; konton visas maskerade i vyn. Medgivandeflödet använder ett kortlivat engångstillstånd tillsammans med en skyddad webbläsarkaka och kontrollerar att samma inloggade användare slutför flödet.

`BANK_DATA_ENCRYPTION_KEY` är redan konfigurerad som en **serverhemlighet i denna publicering**. Den är separat från leverantörens PEM-nyckel och ska inte läggas i frontend, källkod eller dokumentation. Byt eller rotera den inte utan en plan för att dekryptera och återkryptera befintliga uppgifter: en ersatt nyckel gör annars de sparade bankanslutningarna oläsbara. Det finns ingen automatisk nyckelrotationsfunktion.

## Aktuella gränser

Bankens läsintegration är implementerad, men **MG:s verkliga leverantörs- och bankanslutning måste godkännas och verifieras innan den används i drift**. Bankdata kan fortsatt importeras från användarvalda filer när en aktiv bankanslutning saknas.

**Gmail-synkronisering är inte implementerad eller ansluten.** Kontot `mg.vitvaror@gmail.com` behöver en separat behörig anslutning och mejlsynk. Fakturor från mejlen läses för närvarande från PDF-, EML- eller andra filer som användaren väljer. Att spara företagets mejladress i inställningarna ansluter inte Gmail.

Endast SEK stöds. XML-filimporten stoppar främmande valuta, ej bokförda bankposter, återföringsmarkörer och oförklarade beloppsskillnader. Det är ett avstämningsregister, inte en bokföringsmotor eller en tjänst som utför betalningar. Bankbetalningar, e-postutskick och bokföringsöverföringar ingår inte.

Varje bankfil får innehålla högst 1 000 rader. Bilagor är högst 15 MB. Textläsning gäller PDF-filer upp till 30 sidor; skannade bilder kräver manuell inmatning. Registret har ett skydd på 1,8 MB JSON per användare, vilket gör denna version avsedd för en mindre verksamhet. Exportera löpande; bilagor laddas ned separat. Fullständig import av JSON-exporten är inte implementerad.

## Första gången

1. Logga in på den publicerade sidan med ChatGPT för att komma åt din privata arbetsyta.
2. Öppna **Import & underlag**. Du kan där lägga in de två bankhändelser som användaren visade i sina bilder. De är ogranskade och har okända betalare.
3. Lägg till fakturor som skickats till kunder och fakturor från leverantörer. Kontrollera originalen och markera fakturorna granskade.
4. Anslut banken enligt guiden ovan, eller hämta CSV från Swedbank: Konto → välj konto och period → markera rader → Ladda ner rader → CSV.
5. Öppna bankgiroinsättningarnas betalningsdetaljer. Under 2026 kan uppgifterna finnas i Swedbanks Inbetalningar eller historiskt i Bankgirot/ELIN. Importera en tillgänglig camt-fil eller för in specifikationen manuellt.
6. Kontrollera bankhändelsen och matcha till rätt faktura. Kontrollera att betalare och fakturareferens överensstämmer.

## Teknik och åtkomst

Vinext/React körs på Sites med **publik åtkomst till webbgränssnittet**. Register, dokument och bankanslutningar kräver inloggning och begränsas till den autentiserade ägaren. D1 lagrar ett revisionsskyddat register per inloggad användare, separat historik och filmetadata. R2 lagrar originalfiler med ägarskap kontrollerat i varje läsning. Inloggning med ett annat ChatGPT-konto ger en separat arbetsyta; gemensamma företagsroller finns inte i denna version. API-rutter autentiserar genom Sites betrodda identitetslager; starta inte denna app på en allmänt tillgänglig server som accepterar godtyckliga `oai-authenticated-*` headers.

Varje mutation beräknar saldot server-side och använder en atomisk revisionskontroll tillsammans med revisionshistoriken. Föråldrade samtidiga skrivningar nekas. Skrivningar kräver samma ursprung. API-svar och dokument är private/no-store. Dokument hämtas som bilagor, med nosniff och sandbox-policy.

Belopp representeras som heltalsören. D1-migrationer finns i `drizzle/`. Produktionspublicering tillämpar dem; lokala databasen är separat.

Bankmodulen finns i `lib/banking/`: leverantörsanrop, transaktionsnormalisering, krypterad lagring och tjänstelogik. `components/bank-connection.tsx` använder följande API-rutter:

| Rutt | Metod | Funktion |
| --- | --- | --- |
| `/api/bank/status` | GET | Ägarens anslutningsstatus, konton och senaste körning. |
| `/api/bank/config` | POST / DELETE | POST avvisar klientnycklar (405); DELETE kan rensa äldre lokal metadata efter frånkoppling. Runtimehemligheter hanteras administrativt. |
| `/api/bank/banks` | GET | Tillgängliga Swedbank-anslutningar för svenska företagskonton. |
| `/api/bank/connect` | POST | Starta bankens medgivandeflöde. |
| `/api/bank/callback` | GET | Slutföra och verifiera medgivandet. |
| `/api/bank/accounts` | POST | Spara godkända konton och hämtningsperiod. |
| `/api/bank/sync` | POST | Hämta bokförda bankhändelser på användarens begäran. |
| `/api/bank/disconnect` | POST | Avsluta leverantörssessionen och koppla från. |

Bankåtgärder låses per ägare så att samtidiga anslutningar, hämtningar och frånkopplingar inte skriver över varandra. Import, revisionshistorik och lyckad körningsstatus sparas tillsammans med revisionskontroll. Leverantörsadaptern begränsar tillåtna API-adresser och metoder och innehåller inga betalningsinitieringsanrop.

## Kontroll

```bash
node --test --test-isolation=none --test-reporter=spec tests/domain.test.mjs tests/banking-provider.test.mjs tests/banking-security.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
npm run build
```

Logik- och importtesterna täcker bland annat ören, datum, exakta referenser, beloppsambiguitet, delbetalningar, överskott, samlingsbetalningar, dubbletter, främmande valuta, krediter, återbetalningar och ångra-funktioner.

Banktesterna använder syntetiska uppgifter, mockade leverantörssvar och lokal SQLite. De täcker bland annat signering, tillåtna leverantörsanrop, kontoidentifiering, SEK/bokföringsstatus, kryptering och användarisolering, engångscallback, kontoval, Sandbox-isolering, dubbletter, sidindelningsfel, samtidiga skrivningar, återkallat medgivande och frånkopplingsfel.

**Verifieringsgräns:** automatiska tester och en lyckad byggning verifierar inte leverantörens produktionsgodkännande eller bankens faktiska flöde. Verklig Swedbank-anslutning, BankID, MG:s kontobehörigheter och riktig transaktionshämtning är ännu inte live-verifierade. Kontrollera ett känt inbetalnings- och utbetalningsunderlag, betalningsreferenser, återhämtning utan dubblering och frånkoppling innan daglig drift. Riktiga bankfiler behöver också verifieras för de varianter som MG får från banken. Gmail-synk finns ännu inte att verifiera.

## Officiella källor

- https://enablebanking.com/docs/api/quick-start/
- https://enablebanking.com/docs/api/control-panel/
- https://enablebanking.com/cp/applications

- https://www.swedbank.se/foretag/digitala-tjanster/internetbanken-foretag/vanliga-fragor-och-svar.html
- https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige.html
- https://www.swedbank.se/foretag/betala-och-ta-betalt/ta-betalt/bankgiro-inbetalningar.html

## MG Fakturakoll: kundmeddelanden

Öppna `/kundmeddelanden` från arbetsytans meny. Avstämningen matchar endast entydiga betalningar med verifierat bankunderlag och förbereder svenska kundmejl. Adressen verifieras separat; varje aktuell mejlversion måste läsas och uttryckligen godkännas före utskick. Schemalagda operationer skickar aldrig mejl. Vid timeout eller oklar leverans görs ingen automatisk omsändning.

`npm run check` kontrollerar TypeScript och `npm test` kör tester med syntetiska SQLite-/D1-data och simulerad Gmail/bank. Se [leverans- och driftguiden](docs/CUSTOMER-MESSAGES.md) för D1-migrering, säkerhetsregler, Google-medgivande och avgränsningar.

## Automatisk dokumentkö

PDF-text behandlas nu i Sites och skannade dokument kan bearbetas på den anslutna Windows-datorn. Se [driftguiden](docs/DOCUMENT-AUTOMATION.md) för köer, verifierade motparter, begränsningar och paus. Kundmejl kräver fortsatt uttryckligt godkännande.
