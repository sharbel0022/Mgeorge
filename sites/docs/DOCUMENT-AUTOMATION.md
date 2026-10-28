# Automatisk dokumenthantering

Gmail och PDF-text behandlas i den befintliga Sites-arbetsytan, även när webbläsaren är stängd. Det länkade molnjobbet kör varje timme (Sites tillåter högst en körning per timme) och använder ägarens befintliga Gmail-medgivande. `gmail_auto_sync` begränsar Gmail-hämtningen till var 15:e minut och fortsätter dokumentkön även under väntetiden. `process_invoice_documents` bearbetar bara kön och respekterar paus. Bankhämtningens befintliga schema, medgivande och sex timmars begränsning bevaras. Inga schemalagda verktyg kan skicka kundmejl.

## Lokal OCR

Användaren har valt OCR på sin Windows-dator. Node-repositoryts `scripts/install-sites-ocr.mjs` installerar `MGFakturakoll-LocalOCR`, vid inloggning och varannan minut. Datorn måste vara på, vaken och användaren inloggad. Jobbet gör utgående HTTPS-anrop; ingen port öppnas. Text skickas tillbaka till samma Sites-projekt. Inga externa AI-tjänster används.

Den separata OCR-nyckeln är en skyddad Sites-variabel och sparas lokalt endast DPAPI-krypterad för Windows-användaren under `.codex-work\sites-ocr\ocr-config.dat`. Rå konfiguration överförs i processernas stdin, aldrig i argument, Git eller logg. Nyckeln kan bara hämta aktuella dokumentjobb och lämna resultat för konfigurerad ägare; den ger ingen Gmail-, bank- eller utskicksåtkomst. Den lokala statusfilen innehåller bara antal och generell felstatus. Avinstallera genom att ta bort det namngivna Windows-jobbet och den krypterade filen; återkalla därefter `DOCUMENT_WORKER_TOKEN` och publicera den sparade Sites-versionen igen.

## Kö och begränsningar

Additiva migreringar 0005–0006 skapar separata inställningar, jobb, tolkningshistorik, verifierade motparter och unika registreringskvitton. Originalfiler och tidigare tolkningar behålls. Jobb reserveras atomiskt i tre minuter. Misslyckade jobb återförs med väntetid, högst tre försök; avbrutna reservationer återtas efter tidsgränsen. Granskningskön har ett uttryckligt återförsök. Manuell registrering gör sena OCR-resultat verkningslösa.

- Dokument: högst 15 MB, 10 PDF-sidor, 150 000 tecken, 12 miljoner bildpunkter och 12 000 pixlar per bildaxel.
- Sites PDF-text: högst 5 MB, två sekventiella jobb per anrop, 15 sekunders tolkningsbudget. Skannade PDF:er och större filer går till lokal OCR. Workerd-testet tillåter inga externa nätverksanrop.
- Lokal OCR: ett jobb åt gången, högst sex per körning, separat process med 256 MB V8-heap och 90 sekunders timeout. Bilddimensioner kontrolleras före avkodning. Canvas/Tesseracts inbyggda minne ligger utanför V8-heapen; pixelgränser och processavslut begränsar detta. Windows-jobbet har tolv minuters körtidsgräns och tillåter ingen överlappande körning.
- Hämtning verifierar dokumentets storlek och SHA-256. Resultat måste ha rätt ägare, engångslease, hash och giltighetstid. HTTP-omdirigeringar följs inte.

## Registrering och granskning

Endast grön, konfliktfri PDF-tolkning av en uttryckligen verifierad motpart får skapa en automatisk faktura. Verifiering görs från en redan granskad originalfaktura via **Verifiera motpart för automatik**. Namn, organisationsnummer, mejlriktning, mejladress, Bankgiro och valuta måste överensstämma. Saknade fält fylls aldrig genom gissning. OCR-fält har konservativ säkerhetsnivå och går till granskning. Privatpersoner och okända motparter behöver därför granskas.

Fakturanummer behåller inledande nollor. Mellanrum i PDF-layout, svenska datum, mottagarblock, netto och moms normaliseras. Motstridiga radpriser markeras rött. Varje fält visar värde, belägg, säkerhetsnivå och eventuell varning. Registreringen kontrollerar arbetsytans revision, aktivt källunderlag, aktuell motpartsverifiering och oanvänd fakturaidentitet i samma D1-batch. Kopior och ändrade belopp för samma faktura skapar ingen ny skuld.

Efter registrering används samma betalningsavstämning och utkastberedning som tidigare. Bankgiro-samlingsposter kräver individuella specifikationer; belopp ensamt räcker inte för att tillskriva en kund betalningen. Mottagarverifiering och godkännande av den aktuella mejlversionen krävs fortfarande för utskick.

## Driftinställningar

`DOCUMENT_AUTOMATION_ENABLED=true` och `DOCUMENT_OWNER_EMAIL` aktiverar endast den avsedda ägarens nya inställningsrad. Användarens senare paus skrivs inte över. `DOCUMENT_WORKER_TOKEN` är hemlig. `DOCUMENT_SCHEDULER_CONFIGURED=true` sätts först efter att ett faktiskt molnschema sparats. Ändrade runtime-variabler kräver ny deployment av en sparad version.

Gmail-sidan visar anslutning, senaste synk, köstatus, behandlingsfel och OCR-datorns senaste livstecken. **Pausa dokumentautomatik** stoppar obevakad behandling; manuell **Tolka väntande underlag** är fortfarande möjlig. Befintliga registrerade fakturor tolkas inte om automatiskt.

## Verifiering

`npm run check` och `npm test` omfattar riktig SQL mot syntetisk SQLite/D1, samtidighets- och dubblettskydd, ägarisolering, engångslease, återstart efter timeout, osäkra OCR-fält, ändrade betalningskonton och Workerd-kompatibel PDF-text. Produktionsstatus ska läsas tillbaka efter publicering; syntetiska tester bevisar inte verklig bankåtkomst eller kundmejlleverans. Inga riktiga mejl skickas under verifieringen.
