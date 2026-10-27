# Leverans: betalningsavstämning och kundmeddelanden

**Senare uppdatering:** motsvarande avstämning och godkända kundmeddelanden har nu publicerats separat i Sites version 14. Se [Sites-leveransen, verifiering och kvarstående OCR-/Google-krav](SITES-CUSTOMER-MESSAGES.md). Rapporten nedan beskriver den ursprungliga Node-leveransen.

Utgångspunkt: senaste `origin/main`, hämtad med `git pull --ff-only origin main`. Arbetet ligger på `codex/reconciliation-customer-messages`. Ingen produktionsdatabas har öppnats eller ändrats för verifieringen. Inga verkliga kundmejl har skickats.

## Färdiga funktioner

- Konservativ matchning med fakturanummer/OCR, normaliserad kundidentitet, organisationsnummer när bankfilen innehåller det, konto, valuta, datum och verifierade betalarkopplingar. Tidigare manuellt verifierade betalare kan återanvändas för samma kund och konto. Kundidentiteten sparas vid beslutet; ändring av en äldre faktura skriver inte om historiska betalarkopplingar.
- Automatisk matchning kräver exakt, unik referens, verifierad betalare och bokfört API-underlag eller en importerad bankfil med sparat original. Belopp ensamt ger inget säkert förslag. Manuellt inmatade bankrader matchas inte automatiskt.
- Delbetalning, möjligt momsbelopp, överbetalning, fel/saknad OCR, annan betalare, möjliga dubbelbetalningar och fördelning av en överföring på flera fakturor. Osäkra fall stannar i granskningsflödet. OCR kontrolleras mot hela fakturaregistret, även betalda fakturor.
- Befintlig Bankgirohantering återanvänds. Kompletta specifikationer ersätter samlingsposten en gång. Ofullständiga specifikationer och redan fördelade motsvarande bankreferenser spärras. Osäkra kopplingar mellan olika konton/underlag slås aldrig ihop utifrån enbart belopp.
- Statusarna Betald, Delbetald, Ej avstämd och Obetald efter verifierad kontroll skiljs åt. Nytt bankunderlag upphäver äldre kontroller om utebliven betalning. Ångrad matchning tar bort betalarkopplingen som lärdes in från det beslutet.
- Svenska utkast för delbetalning, möjlig utebliven moms, referensfel, förfallen faktura, överbetalning, möjlig dubbelbetalning och betalningsbekräftelse. Påstående om förfallen obetald faktura kräver verifierad kontroll; annars efterfrågas betalningsbekräftelse. Momstexten uttrycker en möjlighet.
- Fliken Kundmeddelanden visar kund, verifierad adress med belägg, faktura, verifierat fördelat belopp, saldo, bankhändelser, osäkra förslag, originalfaktura när den finns samt redigerbar text. Redigera, Avvisa och Godkänn och skicka ingår.
- Kundadresser kräver en separat administratörsverifiering med underlag. En adress från Gmail eller fakturaregistret räknas inte automatiskt som verifierad. Ändrad kundidentitet kräver ny adresskontroll.
- Separat OAuth-medgivande för `gmail.readonly` + `gmail.send`. Företagets Gmail-profil kontrolleras före utskick. En sessionbunden granskningspost gäller en exakt version och förbrukas en gång efter uttryckligt godkännande.
- Beständig utskicksreservation före Gmail-anropet. Dubbelklick, samtidiga anrop och omstart får inte ge automatisk omsändning. Gmail-ID och utskickstid registreras när Gmail bekräftar. Timeout/fel efter reservation innebär `unknown`; avbrott lämnar `sending`. Båda kräver manuell kontroll i Gmail.
- Nya betalningar, allokeringsändringar, ändrad adress, ändrad faktura och nytt granskningsdatum stoppar gamla utkast/godkännanden. Granskningen gäller 15 minuter. Redigering kräver att den nya versionen öppnas och godkänns.
- Gmail-/banksynkning och schemaläggaren kör avstämning och utkastberedning. Ingen schemalagd väg kan skicka kundmejl. JSON-exporten innehåller även meddelanden, godkännanden, leveranshistorik, adressverifieringar, betalarkopplingar och avvikelser; OAuth-token och sessionshemligheter exporteras inte.

## Databas och revisionsspår

Additiva SQLite-migreringar skapar `verified_contacts`, `payer_links`, `reconciliation_findings`, `customer_messages`, `message_reviews`, `message_approvals` och `message_deliveries`. Befintliga fakturor, original, anslutningar och allokeringar bevaras. Bankuppgifterna används som original; korrigerad fakturakoppling och normaliserade jämförelser ligger i separata beslut/förslag.

`audit_events` registrerar förberedelse, adress-/betalarverifiering, granskning, textändring med före/efter, avvisande, godkännande med exakt text och mottagare, lyckat utskick och oklar status. Den befintliga revisionsloggen för fakturor, importer och manuella korrigeringar används fortsatt.

## API och användning

1. Anslut Gmail och banken enligt befintliga guider. Behåll den privata krypteringsnyckeln och databasen.
2. Aktivera önskade synkintervall och eventuell automatisk registrering av väl underbyggda fakturor från kända motparter i Inställningar.
3. Granska osäkra matchningar under Bank. Fakturor från okända motparter eller osäker OCR behöver fortfarande granskas.
4. Öppna Kundmeddelanden, verifiera kundadressen mot ett faktiskt underlag och aktivera Gmail-utskick genom nytt Google-medgivande.
5. Öppna ett utkast, kontrollera original/betalningar och läs texten. Spara först om texten ändras; öppna sedan den nya versionen. Markera godkännandet och välj Godkänn och skicka.
6. Vid oklar/pågående leverans kontrolleras Skickat i företagets Gmail, bland annat med det lagrade RFC Message-ID:t. Systemet erbjuder ingen automatisk återförsöksknapp.

| Endpoint | Funktion |
| --- | --- |
| `POST /api/reconciliation` | Avstämning och förberedelse av utkast |
| `GET /api/customer-messages` | Kö, saldon, underlag och leveransstatus |
| `POST /api/customer-contacts` | Verifiera adress med faktura-ID och belägg |
| `POST /api/payer-links` | Verifiera betalare/konto med belägg |
| `POST /api/customer-messages/:id/review` | Öppna aktuell version och få en sessionbunden granskningspost |
| `POST /api/customer-messages/:id/edit` | Spara ämne/text och öka versionsnumret |
| `POST /api/customer-messages/:id/reject` | Avvisa utkast |
| `POST /api/customer-messages/:id/send` | Kräver aktuell version, granskningspost och `approve: true` |
| `POST /api/gmail/connect` med `send: true` | Starta nytt medgivande för läsning och utskick |

Samtliga privata endpoints använder befintliga administratörs-, session- och origin-kontroller. Ingen separat fristående e-posttjänst eller ny extern AI-tolkning har införts.

## Verifiering

- `npm run check`: **32 JavaScript-filer godkända**.
- `npm test`: **174 tester godkända, 0 misslyckade**.
- Syntetiska SQLite-data och simulerade Google-/banksvar användes. Befintliga PDF-/OCR-tester ingår i hela sviten.
- Nya tester täcker alla tio betalningsscenarier, bland annat OCR som tillhör en redan betald annan faktura, 2 500/3 125 kr, moms som skillnad, Bankgiro/bank-dubletter, ofullständig specifikation, okänd betalare med rätt belopp, organisationskonflikt, historisk annan betalare och återtaget beslut.
- Meddelandetester täcker ny betalning efter utkast, redigering utan nytt godkännande, fel/utgången granskningspost, annan webbläsarsession, återkallad administratörssession, dubbelklick, timeout, låsning vid omstart, adressändring, ändrad kundidentitet, avvisande och schemaläggning utan utskick.
- HTTP-test går genom kontaktverifiering → granskning → godkännande → ett simulerat Gmail-utskick → beständig leveranspost. Gmail-adaptern testas separat för MIME/UTF-8, rätt företagskonto, saknad scope, headerinjektion och frånvaro av automatisk omsändning vid timeout/401.
- Manuell webbläsarkontroll med syntetisk kund: 3 125 kr faktura, 2 500 kr verifierat, 625 kr saldo, bankreferens, läsbart utkast samt redigering som sparar en ny version utan utskick. Ingen riktig Gmail-anslutning användes.

## Kräver riktiga auktoriseringar och driftkontroll

Google Cloud måste konfigurera Gmail API, klient, korrekt callback och både läs-/utskicksscopes för det särskilda utskicksmedgivandet. Företagets behöriga användare måste godkänna kontot. Verifiera verklig import, tokenförnyelse och ett uttryckligen godkänt testmejl innan produktionsutskick används. Ett API-kvitto visar att Gmail accepterat meddelandet, inte att mottagaren läst eller fått det levererat.

Swedbank/Enable Banking behöver giltig applikation, godkänt företagsmedgivande, valt konto och riktiga bokförda händelser. Kontrollera anonymiserade Bankgiro-/camt-filer och referenser mot företagets verkliga underlag. När original inte räcker för att avgöra om två poster är samma ekonomiska händelse stannar fallet för granskning.

Ingen produktionsintegration, riktig Google-auktorisering, verklig bankhämtning eller verklig e-postleverans har verifierats i denna leverans. Node-servern behöver hållas igång för schemalagd synkning.

## Avsiktliga begränsningar

- Fördelning på flera fakturor, saknad/fel OCR, okänd betalare och misstänkta dubletter kräver manuellt beslut. Systemet gissar inte betalningsstatus.
- Betalarens organisationsnummer används när det levereras som ett uttryckligt organisationsnummer i bankfilen. Ett personnamn eller en OCR-sträng omtolkas aldrig till organisationsnummer. Leverantörsspecifika identitetsfält måste valideras med bankens verkliga svar innan de används.
- Underlagshashen omfattar hela bankregistret för att även upptäcka ej matchade nya betalningar. Även en orelaterad bankändring kan därför kräva ny granskning. Det är ett konservativt stopp, inte bevis på ändrad skuld.
- Ett redan skickat eller oklart meddelande av samma typ/faktura genereras inte om automatiskt. Uppföljning och utredning av oklar leverans görs manuellt. Ingen automatisk påminnelsekedja eller återbetalning ingår.
- Befintlig manuell registrering och uttryckligt bekräftad allokering finns kvar. Administratören ansvarar då för att verifiera det underlag som matats in. Manuellt inmatade bankrader kan inte utlösa automatisk betalningsmatchning.

## Separat arbete för ChatGPT Sites

Denna leverans ändrar Node-/SQLite-kodbasen. GitHub-push publicerar inte Sites-versionen. Följande behöver göras separat i dess Worker/D1/UI:

1. Porta samma avvikelseregler och additiva tabeller till D1 med ägarisolering. Befintliga Sites-fakturor, bankposter och anslutningar måste migreras utan ersättning.
2. Implementera beständig, atomisk utskicksreservation, versionshash, sessionbunden granskning och engångsgodkännande med motsvarande kontroller i Worker-rutterna.
3. Lägg till Kundmeddelanden, adressverifiering, original-/bankunderlag, redigering och uttryckligt godkännande i Sites-gränssnittet.
4. Uppdatera Sites eget Google-medgivande och faktiska registrerade callback med läs-/utskicksscopes. Konfigurera dess egna privata hemligheter; Node-nycklar får inte kopieras blint mellan miljöer.
5. Koppla dess befintliga scheman endast till synkning, avstämning och utkastberedning. Ingen schemalagd operation får anropa utskicksvägen. Obemannad server-OCR är fortfarande ett separat Sites-gap enligt den befintliga Gmail-guiden.
6. Kör motsvarande Sites-tester samt riktiga Google-/banktester före publicering. Granska även informationssidorna mot den utökade behandlingen innan produktionsaktivering.

Ingen Sites-kod, Sites-databas, publicering eller molnautomation har ändrats här.

## Exakt ändrade och nya filer

| Fil | Ändring |
| --- | --- |
| `.env.example` | Förtydligat valbart Gmail-medgivande för utskick |
| `README.md` | Användarflöde och leveranslänk |
| `docs/ARCHITECTURE.md` | Moduler, avstämning, skydd och API |
| `docs/GMAIL.md` | Nytt medgivande, utskicksflöde och begränsningar |
| `docs/RECONCILIATION-CUSTOMER-MESSAGES.md` | Ny leveransrapport |
| `public/app.js` | Navigation, säker köuppdatering och tydliga statusnamn |
| `public/index.html` | Laddar ny granskningsmodul |
| `public/messages.js` | Ny sida, underlag, redigering, adressverifiering och godkännande |
| `public/style.css` | Meddelandekort och läsbart mejltextfält |
| `src/db.js` | Additiva tabeller, dubblettspärrar, historiska betalarkopplingar och upphävda frånvarokontroller |
| `src/reconciliation.js` | Ny avvikelsemotor och rangordning |
| `src/customer-messages.js` | Nya utkast, kontaktverifiering, gransknings-/godkännandeflöde och leveranslogg |
| `src/gmail.js` | Valbar utskicksscope och Gmail-sändare utan automatisk omsändning |
| `src/importers.js` | Uttryckligt organisationsnummer från CSV |
| `src/server.js` | Privata API-rutter, OAuth-uppgradering, synk-/schemakoppling och export |
| `test/bank-ui.test.js` | Testmiljön laddar den nya gränssnittsmodulen |
| `test/reconciliation.test.js` | Nya betalnings-/avvikelsetester |
| `test/customer-messages.test.js` | Nya versions-, godkännande-, saldo- och leveranstester |
| `test/customer-messages-api.test.js` | Nytt HTTP-test av hela gransknings-/utskicksflödet med simulerad Gmail |
| `test/gmail-send.test.js` | Nya OAuth-/MIME-/utskicks- och feltålighetstester |
