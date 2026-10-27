# Publicerad Sites-leverans: kundmeddelanden

## Gmail aktiverat och verifierat – version 16

Den 28 oktober 2026 (svensk tid) verifierades den verkliga Google-anslutningen för `mg.vitvaror@gmail.com`: `configured: true`, `connection.status: connected` och `send_enabled: true`. Google-profilkontrollen lyckades och Sites visar **Gmail – Ansluten** samt **Utskicksbehörighet finns** på Kundmeddelanden. Granskningskön var tom. Inga verkliga mejl skickades; faktisk leverans till mottagare har därför inte testats.

- Google Cloud-projekt: `celestial-feat-512922-e6`. Gmail API aktiverat, webbklient skapad med Sites exakta `/api/gmail/callback`, företagskontot registrerat som testanvändare och `gmail.readonly` + `gmail.send` godkända.
- Klientuppgifterna är skyddade runtime-hemligheter i Sites, miljörevision 4. Befintlig banknyckel och bankinställningar bevarades. Hemligheterna finns inte i repositoryt.
- Ett verkligt callback-fel rättades: Workers avvisar `redirect: 'error'` innan nätverksanropet. Gmail använder nu `manual` och avvisar 3xx utan att följa dem. Detta gäller token-, profil-, utskicks- och återkallelseanrop. Säker diagnostik skiljer retur-, klient-, nätverks- och lagringsfel utan att logga hemligheter.
- Sites-källa: `ffa15b6b5ab7795076a0b1405fc2a25755adc845`. Version 16: `appgprj_6adf2f7f7e848191b64192161886b528~appgver_2abe9fcc0c4c81919004fe30fe91d2bc`. Deployment `appgdep_6ae12ca8a1008191b2ec07188080d294`: `succeeded`.
- [Kompletterande patch mot version 14](sites/gmail-oauth-runtime.patch). 30 berörda Gmail-/kundmeddelandetester, TypeScript och produktionsbygget passerade. En verklig Workerd-kontroll reproducerade felet för `error` och bekräftade stöd för `manual`.
- Godkännandeflödet verifierades med syntetiska data: verifierad kundadress, läst aktuell version, uttryckligt godkännande, spärr efter ändringar, engångsutskick och lås vid oklar leverans. Inga testposter lades i produktionsregistret.
- Appen är i Googles **Testing**-läge. Gmail-medgivande/refresh token upphör efter sju dagar och behöver då förnyas. Se [Googles beskrivning av testläget](https://support.google.com/cloud/answer/15549945?hl=en). Molnschemat är fortsatt pausat och ingen automatisk mejlsändning är aktiverad.

## Ursprunglig funktionsleverans – version 14

**Publicerat:** version 14 den 27 oktober 2026. Sites rapporterade `succeeded` för deployment `appgdep_6ae124c7bf808191bcb4f4690aca56e0`.

- [Kundmeddelanden på den befintliga Siten](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/kundmeddelanden).
- Sites-källa: `3b29b72088684cdbe782d1dfd6690635cb191576`, baslinje `0793f2ab8c73f0d806a33f72cf70468533d9de62`.
- Sparad version: `appgprj_6adf2f7f7e848191b64192161886b528~appgver_7b0e01ddbf9c8191951381a40c38e1fc`.
- [Reproducerbar Sites-patch](sites/customer-messages.patch) mot baslinjen. Öppna befintlig Site med Sites-källflödet, kör `git apply --check` och applicera endast på motsvarande källversion. Migrera, testa och bygg i Sites-miljön; importera inte Node-databasen över D1/R2.
- TypeScript, samtliga **122 tester** och produktionsbygget är godkända. De nya tabellerna verifierades efter publicering via Sites databasöversikt. Publik åtkomstpolicy, runtime-konfiguration och det pausade molnschemat bevarades.
- Den anslutna molnvägen för bankhämtning accepterade anropet och returnerade `not_due`, 0 importerade poster. Den gjorde alltså ingen ny bankhämtning i denna kontroll. Befintlig status visade en ansluten bank med automatisk hämtning aktiverad. Det pausade molnschemat återaktiverades inte.
- Gmail-status efter publicering visade `configured: false`, ingen Gmail-anslutning och `send_enabled: false`. Google-klienten behöver konfigureras och behörig användare måste godkänna det separata utskicksmedgivandet. Inga verkliga kundmejl skickades.
- Sites behåller webbläsarbaserad OCR-granskning; Node-versionens obevakade server-OCR är inte portad till Workers.

Nedan följer driftguiden som ingår i den publicerade Sites-källan.

---

# Sites: avstämning och godkända kundmeddelanden

Denna uppdatering gäller den befintliga Siten `appgprj_6adf2f7f7e848191b64192161886b528`. GitHub-/Node-registret kopieras inte över Sites D1/R2. Befintligt projekt-ID, publik åtkomstpolicy, användarägda arbetsytor, bank-/Gmail-anslutningar, krypteringsnyckel och pausade scheman bevaras. Inga runtime-hemligheter har ändrats.

## Funktioner

- `/kundmeddelanden` öppnas från arbetsytans meny. Den visar kund, verifierad mottagare med belägg, originalfaktura när den finns, bankhändelser, osäkra förslag, fakturabelopp, verifierat betalt och saldo.
- `lib/reconciliation-engine.js` porterar de konservativa reglerna från Node `main` d029679: unik exakt OCR/fakturanummer, kundidentitet, organisationsnummer när det finns, datum, valuta och tidigare verifierade betalarkopplingar. Belopp ensamt är aldrig ett betalningsbevis.
- Bankgiro-specifikationers kompletta barn ersätter sin samlingspost ekonomiskt. Den ursprungliga samlingsposten finns kvar. Befintlig dubblettkarantän mellan bank-API och filimport bevaras. Osäkra kopplingar och ofullständiga specifikationer stannar för granskning.
- Korrekt betalning kan matchas automatiskt. Delbetalning, möjlig utebliven moms, fel/saknad referens, annan betalare, överbetalning, möjlig dubbelbetalning och en betalning för flera fakturor hanteras med förslag och säkra saldon.
- Betald, Delbetald, Ej avstämd och Obetald efter verifierad kontroll skiljs åt. Utebliven betalning behöver ett separat bekräftat kontrollunderlag. Ny bankimport upphäver en tidigare frånvarokontroll.
- Fakturor bevarar netto, moms och organisationsnummer från granskningen. Manuella fakturor kan kompletteras med dessa fält. En skillnad som motsvarar momsen uttrycks som en möjlighet, aldrig som en anklagelse.
- Bankens originaluppgifter sparas separat från nya verifieringsbeslut. En administratör kan bekräfta en avvikande referens/betalare med ett separat rättelseval och underlag. Ursprunglig OCR skrivs inte över i originalbilden av bankhändelsen.
- Mejlen är svenska utkast för delbetalning, momsavvikelse, referensfel, förfallen faktura, överbetalning, möjlig dubbelbetalning och behov av betalningsbekräftelse. Adresser från fakturor/Gmail räknas inte automatiskt som verifierade kundadresser.
- Redigering sparar en ny version. Avvisa stoppar ett utkast. Godkänn och skicka kräver att den aktuella versionen öppnats, att mottagaren verifierats och att administratören markerat det uttryckliga godkännandet. Ändrad text måste sparas och läsas igen.

## Beständigt godkännande och leverans

En granskningspost gäller 15 minuter och binds till Sites-identitet, mejlversion, underlagshash och en separat HttpOnly-/Secure-/SameSite-cookie i webbläsaren. Varje API-anrop kontrollerar ägare och origin. Ingen besökare kan läsa eller skicka från en annan användares arbetsyta.

D1-reservationen görs atomiskt i en batch. Den kontrollerar version, aktuell workspace-revision, oförändrad kontaktverifiering, aktuell Gmail-anslutning och oanvänt granskningsbeslut innan en beständig leveransrad skapas. Det finns en unik leverans per meddelande och en unik användning per granskningsbeslut. Samtidiga anrop kan därmed inte skicka två mejl.

Alla externa token-/profilkontroller görs före reservationen. Därefter sker ett Gmail-POST utan automatisk retry. Gmail-ID och tidpunkt registreras vid ett godkänt svar. Timeout, fel eller ett ofullständigt svar efter reservation låser leveransen som `unknown`. Avbrott kan lämna `sending`; även detta är en beständig spärr som kräver manuell kontroll i Gmail. Ett meddelande med oklar leverans genereras aldrig om automatiskt. Ingen automatisk återbetalning eller påminnelsekedja ingår.

Förberedelse, granskning, adressverifiering, textens före/efter, avvisande, exakt godkänd text/mottagare, utskick och oklar status finns i revisionshistoriken. Exporten innehåller meddelanden, leveranser, verifierade adresser och avvikelser; token och granskningscookies exporteras inte.

## Google och schemaläggning

Fakturahämtning behåller `gmail.readonly`. Välj Aktivera Gmail-utskick på Kundmeddelanden för ett nytt interaktivt medgivande med både `gmail.readonly` och `gmail.send`. Google-profilen måste motsvara det konfigurerade företagskontot. Callbacken kontrollerar faktiskt beviljad utskicksscope. Befintliga lästoken uppgraderas inte genom en lokal inställning.

Google Cloud behöver tillåta dessa scopes och Sites egen registrerade callback `/api/gmail/callback`. Företagets behöriga användare måste godkänna medgivandet. Inga verkliga mejl har skickats under implementation eller verifiering. Testerna bevisar inte att verklig Google-auktorisering, bankanslutning eller leverans till kund fungerar.

Befintlig bank-/Gmail-synkning anropar nu avstämning och utkastberedning efter hämtning. Sites MCP har dessutom `reconcile_customer_payments` utan ägarparametrar. Det exponerar ingen utskicksoperation. Ett aktiverat molnschema kan använda dessa operationer när anslutningarna och medgivandena är giltiga. Ett befintligt pausat schema återaktiveras inte av denna kodändring.

## Dokumenttolkning

Sites befintliga PDF- och bildtolkning med svensk OCR körs i webbläsaren när ett Gmail-underlag öppnas för granskning. De verifierade fakturafälten bevaras nu för avstämning och momsutkast. Okända fakturor och skannade dokument kräver fortsatt granskning; denna Worker-uppdatering innehåller inte Node-versionens lokala serverprocesser för PDF-rendering/OCR eller obevakad server-OCR. Den begränsningen visas även på Gmail-sidan. Ingen osäker text eller AI-gissning används för att skapa en skuld eller betalningsstatus.

## Databas

Drizzle-migrering `0004_silky_lily_hollister.sql` lägger additivt till `customer_contacts`, `customer_messages`, `customer_reviews`, `customer_deliveries` och `reconciliation_findings`, samt flaggan för begärd utskicksscope i `gmail_flows`. Äldre migreringar och datarader ersätts inte. Nya fakturafält ligger i den befintliga versionskontrollerade workspace-payloaden och är valfria för äldre data. Sites publiceringsflöde applicerar migreringen före Worker-uppladdning.

## Verifiering

- `npm run check`: TypeScript utan fel.
- `npm test`: 122 godkända tester med syntetiska data och simulerade externa svar.
- Produktionsbygge via Sites byggverktyg.
- Lokala D1-migreringar applicerade i ordning; inga produktionsrader användes för testerna.
- Nya tester kör verklig tjänstelogik, kryptering, SQLite som D1-adapter och de faktiska SQL-reservationerna. De täcker betalningsscenarierna, OCR-konflikt, 2 500/3 125 kr, moms, Bankgiro-/bankdubletter, annan betalare, flera fakturor, saknad OCR, verifierad frånvaro, redigering utan nytt godkännande, fel/utgången granskningspost, annan webbläsare, ägarisolering, CSRF, dubbelklick, timeout, samtidiga konto-/adress-/betalningsändringar och OAuth-scope.
- Webbläsargranskning med syntetiskt exempel: adressverifiering, 3 125 kr faktura, 2 500 kr betalt, 625 kr saldo och redigering som sparar en ny version utan utskick.

## Centrala filer

- `lib/reconciliation-engine.js`, `lib/reconciliation.ts`: regler och automatisk avstämning.
- `lib/customer-message-text.js`, `lib/customer-messages.ts`: svenska utkast, kontaktkontroll, granskning och engångsutskick.
- `components/customer-messages.tsx`, `app/kundmeddelanden/page.tsx`, `app/api/customer-messages/[action]/route.ts`: granskningssida och privata API-rutter.
- `lib/domain.ts`, `app/dashboard.tsx`: verifierade statusar, fakturafält, bevarade bankoriginal och separata rättelsebeslut.
- `lib/gmail-service.ts`, `lib/gmail-adapter.js`: valbart utskicksmedgivande, MIME och Gmail-kontroll.
- `lib/banking/service.ts`, `lib/banking/mcp.ts`, `app/api/state/route.ts`: synk-/MCP-/mutationskoppling till avstämning.
- `db/schema.ts`, `drizzle/0004_silky_lily_hollister.sql` med Drizzle-metadata: additiva tabeller och index.
- `app/api/export/route.ts`, `app/globals.css`, `package.json`, `README.md`, denna guide och testerna kompletterar leveransen.
