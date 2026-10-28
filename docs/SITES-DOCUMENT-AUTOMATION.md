# Sites: automatisk dokumenthantering med lokal OCR

Den befintliga Sites-versionen använder en beständig D1-kö och R2-original. Vanlig PDF-text läses i Cloudflare Workers med `unpdf`. Skannade PDF:er, PNG, JPG och WebP hämtas av den här Windows-datorns OCR-jobb. Det är samma MG Fakturakoll-projekt och samma privata arbetsyta. Node-registret kopieras inte över Sites-registret.

## Lokal drift

`scripts/install-sites-ocr.mjs` tar emot Sites-origin och en separat slumpad OCR-nyckel via dold stdin. Samma nyckel ska vara den hemliga Sites-variabeln `DOCUMENT_WORKER_TOKEN`. Installationen skyddar konfigurationen med Windows DPAPI för aktuell användare och skapar `MGFakturakoll-LocalOCR` i Aktivitetsschemaläggaren. Jobbet kör vid inloggning och varannan minut utan synligt terminalfönster. Ingen inkommande nätverksport eller extern AI-tjänst behövs.

Datorn måste vara på, vaken och användaren inloggad. Gmail-hämtning och PDF-text i molnet fortsätter oberoende av datorn; OCR väntar säkert i kön. Status visas på Sites Gmail-sida och generella körningsantal finns i `.codex-work\sites-ocr\ocr-status.json`. Den krypterade konfigurationen ligger bredvid som `ocr-config.dat`. Varken rå nyckel, dokumenttext eller kunduppgifter loggas där.

Körningen använder Node-installationen och repositoryts sökväg som gällde vid installationen. Installera om jobbet om repositoryt eller Node flyttas. Avinstallera genom att ta bort just `MGFakturakoll-LocalOCR`, ta bort den krypterade konfigurationen och återkalla Sites OCR-nyckel. Ändrade Sites-variabler kräver deployment av en sparad version.

## Skydd och arbetsflöde

- 15 MB per dokument, 10 PDF-sidor, 150 000 tecken, 12 miljoner bildpunkter och 12 000 pixlar per bildaxel.
- Lokal process: ett dokument åt gången, högst sex per körning, 90 sekunder och 256 MB V8-heap. Canvas/Tesseracts inbyggda minne ligger utanför V8-heapen och begränsas genom bildstorlek och processavslut. Windows-jobbet tillåter ingen överlappning och har tolv minuters körtidsgräns.
- HTTPS med separat OCR-token, begränsade svar, inga omdirigeringar, SHA-256-kontroll, ägarbunden reservation i tre minuter och högst tre försök. OCR-token saknar bank-, Gmail- och utskicksåtkomst.
- Tolkningen och fakturaregistreringen valideras i Sites. Automatisk registrering kräver gröna konfliktfria fält och en uttryckligen verifierad motpart med oförändrad identitet, mejladress, Bankgiro och valuta. OCR och okända motparter hamnar för granskning.
- Registreringskvitto, arbetsyterevision, aktivt underlag och aktuell motpartsverifiering kontrolleras atomiskt. Samma faktura med annan bilaga eller ändrat belopp skapar ingen ny skuld.
- Original och tolkningshistorik bevaras. Inledande nollor, svenska datum, mottagarblock och netto/moms stöds; motstridiga radpriser markeras för kontroll.
- Registrerade fakturor går vidare till befintlig bankavstämning och utkastberedning. Bankgiro-samlingsposter kräver individuella betalningsspecifikationer. **Alla kundmejl kräver fortsatt att den aktuella versionen granskas och uttryckligen godkänns.**

## Moln och databas

Gmail-körningen har ett enda länkat Sites-molnschema varje timme, men molnjobbet är för närvarande pausat vid ett ChatGPT-verktygsgodkännande. Sites avvisar tätare intervall; 15 minuter är tjänstens minsta väntetid, inte molnschemats faktiska takt. Verktyget respekterar Gmail-kylperioden och kan ändå tömma dokumentkön. `process_invoice_documents` kan behandla kön utan ny Gmail-hämtning och respekterar användarens paus. Befintlig Swedbank-schemaläggning och begränsningar bevaras. Kundutskick exponeras aldrig som schemaverktyg.

Additiva migreringar 0005–0006 skapar inställningar, jobb, oföränderlig tolkningshistorik, verifierade motparter och unika registreringskvitton. Äldre fakturor, bankdata, original, medgivanden och krypteringsnycklar bevaras. Den fullständiga Sites-ändringen finns i `docs/sites/automatic-documents.patch`; den appliceras på föregående Sites-kod, inte direkt på Node-servern.

## Verifiering

Node: `npm run check`, 177 godkända tester. Sites: TypeScript och 136 godkända tester, inklusive faktisk Workerd-PDF-tolkning utan externa nätverksanrop. Syntetiska tester täcker köer, återstart, leases, dubbletter, manuell registrering under OCR, kontoavvikelser och befintlig utskicksspärr. Verklig driftstatus läses tillbaka separat efter publicering. Inga riktiga kundmejl skickas vid verifieringen.

## Produktionskontroll 2026-10-28

Sites-version 20 använder källcommit `0287a087ee419f49dd655fe61c12be2c683b850c`. Patchen utgår från version 16 (`ffa15b6b5ab7795076a0b1405fc2a25755adc845`). Samma projekt-ID, åtkomstpolicy, Gmail-/bankanslutningar och ursprungliga krypteringsnycklar har bevarats.

- Gmail är anslutet och befintlig utskicksbehörighet finns. Ett riktigt MCP-anrop hämtade åtta nya underlag och identifierade en dubblett. Fortsatt köbearbetning fungerar under Gmail-väntetiden.
- Av de ursprungliga sex underlagen finns tre tidigare granskade fakturor kvar registrerade, två PDF-underlag behöver kontroll och en bild utan fakturainnehåll har avvisats med originalet bevarat. En verklig layoutkonflikt stoppade automatisk registrering. Leverantörens datum och belopp med europeiska tusentalsavskiljare läses korrekt; saknade uppgifter gissas inte.
- Lokal bild-OCR har lämnat ett resultat tillbaka till Sites. Windows-jobbet har därefter körts upprepade gånger med resultatkod 0 utan en öppen webbplats. Konfigurationen ligger DPAPI-krypterad under repositoryts Git-ignorerade `.codex-work/sites-ocr/`; appmiljöns virtualiserade AppData-sökväg kunde inte användas av Windows-jobbet.
- Ett enda nytt Gmail-molnschema sparades först aktivt varje hel timme i Europe/Stockholm men pausades vid första körningens verktygsgodkännande. Sites avvisade 15-minutersintervallet eftersom plattformen tillåter högst en körning per timme. Slutkontrollen visade en verklig schematrigger som väntar på ”Tillåt en gång” för Gmail-verktyget. Fortsättningen misslyckades med ChatGPT:s fel om kontots Daybreak-inställning. Obemannad molnhämtning är därför inte verifierad eller aktiv. Användaren behöver slutföra godkännandet och återaktivera det befintliga schemat. Sites flagga DOCUMENT_SCHEDULER_CONFIGURED är false tills aktiv drift bekräftats; lokal OCR fortsätter oberoende av detta.
- Swedbank är anslutet med befintlig sex timmars begränsning. Det tidigare molnschemats pausade läge har bevarats. Avstämningen identifierar 19 samlingsinsättningar som behöver individuella betalningsspecifikationer. Dessa kan inte tillskrivas kunder eller räknas som betalningar på enskilda fakturor enbart genom beloppslikhet.
- Ingen ny säker bankmatchning eller kundavvikelse kunde fastställas från dessa underlag. Inga kundmejl har skickats. Kundmeddelandesidan visar att utskicksbehörighet finns och att användarens granskning och uttryckliga godkännande krävs.

Användaren valde därefter att lämna Gmail-molnschemat pausat tills vidare. Återaktivera det inte utan en ny begäran. Lokal OCR för redan hämtade underlag fortsätter när datorn är på, vaken och användaren är inloggad.
