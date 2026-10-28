# Bankgiro – leverans 2026-10-28

## Implementerat

Den befintliga Sites-källan finns nu komplett i `sites/` i GitHub-repositoryt. Tidigare fanns endast patchar. Källan motsvarar Sites-commit `3546fb00dcb990a28dc8709da2ca3a5b630dad90`, version 24. Projektet är fortsatt `appgprj_6adf2f7f7e848191b64192161886b528`.

- Gemensam begränsad XML-parser för camt.054/.053 i förhandsgranskning och server. Bokförda SEK-betalningar, individuella belopp, namn, OCR, identifierare, mottagarkonto, Bankgiro/Avinummer och avräkningsdatum bevaras.
- Bankgiro CSV-profil med svenska kolumnnamn, UTF-8/Windows-1252 och referenser som text. Avsändarens Bankgiro/Avinummer blir aldrig faktura-OCR.
- Förhandsgranskning utan betalnings- eller R2-skrivning. Efter uttrycklig importbekräftelse sparas originalfilen; servern läser om just det ägarkontrollerade originalet före registrering. Browserns föreslagna rader och hash får inte styra betalningen.
- Automatisk koppling kräver exakt fullständigt konto, bokföringsdatum, valuta, bankidentifierare och totalsumma. Befintlig bankanslutnings krypterade kontodata får översätta en fullständig identifierare till rätt stabila konto-ID. Slutnummer och lika belopp räcker inte.
- Bankens ursprungliga samlingspost och revisionshistorik behålls. Individuella rader länkas till den och ersätter den ekonomiskt. Föräldern visas via detaljer i stället för som ytterligare betalning i huvudlistan.
- Osäkra specifikationer sparas spärrade för granskning; de kan inte verifieras eller delas upp för att kringgå bankkontrollen. Återimport och ändrat filnamn skapar inga extra tillgängliga pengar. En väntande specifikation kan bedömas igen när bankposten har kommit.
- Exakt OCR/fakturanummer och kundidentitet krävs för automatisk avstämning. Fel referens, annan kund och tvetydiga fakturor stoppas. Delbetalningar och överskott hanteras i heltalsören.
- Saknade fakturor söks först bland redan hämtade Gmail-underlag. En begränsad riktad hämtning får ske med befintligt medgivande, lås och femton minuters spärr. Ordinarie sidmarkör och hämtningsdatum ändras inte. Befintliga OCR- och registreringsinställningar gäller.
- Svartvit betalningslista med Betalare, Faktura/OCR, Belopp, Datum och Status. Detaljen visar original, tillhörande Swedbankpost, systembedömning och en primär åtgärd.
- Den befintliga generiska bankfilimporten finns kvar under Annat bankunderlag.

Node-versionen har dessutom fått in PR #6, stöd för Betalningsdatum, separat bevarande av avsändarens Bankgiro/Avinummer, Windows-1252 och standardens BkToCstmrDbtCdtNtfctn-element. PR-testets felaktiga bokstavliga radbrytning är rättad. `payer_bankgiro` tillkommer additivt i lokal SQLite. Sites nya fält är frivilliga tillägg i befintlig workspaces.payload; ingen Sites-tabell eller tidigare migration ändras.

## Testat med syntetiska uppgifter

209/209 Node-tester och 209/209 Sites-tester passerar. Sites har 28 nya tester för Bankgirodomän och verkliga API-funktioner med isolerade SQLite/D1- och R2-gränser. TypeScript, syntaxkontroll och produktionsbygge är godkända.

Tester täcker Café Gränden Bistro AB/0599/625 kr; exakt faktura; saknad faktura; flera fakturor med samma belopp; saknad OCR; referens som tillhör annan kund; delbetalning; överbetalning; två betalningar per insättning; fel datum/konto/identifierare; ofullständiga belopp och antal; dubbelimport; överlappande bankunderlag; skannad/felaktig/överdimen­sionerad/DTD-indata; avslutad session; fel origin; ägaråtkomst; återläsning av originalet och skydd mot manipulerade browserrader. Importvägen har inget anrop som skickar kundmejl.

I lokal Workers-miljö genomfördes det verkliga webbflödet: syntetisk Swedbank-samlingspost och faktura 0599 → filval → förhandsgranskning → importbekräftelse → Café Gränden Bistro AB/0599 → automatiskt verifierad betalning 625 kr. Originalet kan hämtas från R2 och föräldern öppnas separat. Mobilbredd 390 px gav dokumentbredd och scrollbredd 390 px.

Lokala bildbevis: `.codex-work/bankgiro-local-verifierad.png` och `.codex-work/bankgiro-local-mobil.png`. Dessa är syntetiska testuppgifter, inte företagets verkliga betalningar.

## Publicering och verkliga uppgifter

Version **24 är publicerad**, deployment `appgdep_6ae1ea7658d08191935b4b5c3834f674` har status `succeeded`. Befintlig adress: https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/. Befintlig åtkomstpolicy, D1/R2-bindningar, krypteringsnycklar och integrationer bevaras. Båda befintliga molnschemana förblir pausade.

Anslutningsstatus från den befintliga MG Fakturakoll-pluginen visade Swedbank anslutet utan senaste fel både före och efter publicering. Gmail-anslutningen, hämtade kandidater och körningshistoriken var oförändrade. Inga riktiga bankbetalningar importerades eller matchades i verifieringen. Inga kundmejl skickades.

En vanlig HTTP-läsning av produktions-API:erna kräver fortfarande användarens ChatGPT-inloggning och svarade 401 utan den. De publicerade Bankgirovägarna gav också 401 utan session.

Efter uttryckligt godkännande användes användarens redan inloggade Chrome-flik och den publicerade versionen laddades om. Den riktiga posten 625 kr den 26 oktober, konto ••••0101 och referenstext 58197013 visades som samlingspost med saknad individuell OCR. Ingen faktura presenterades som betald. Den nya importdialogen öppnades och visade Bekräfta import spärrad före filval.

Test av syntetisk fil i produktionsförhandsgranskningen kunde inte slutföras: Chrome-tilläggets filåtkomst var avstängd. Inga tilläggsbehörigheter ändrades. Försöket med vanligt filval stoppades sedan av datorverktyget eftersom aktuell Chrome-adress inte kunde fastställas tillräckligt säkert. UI-kontrollen avslutades där. Den lokala fullflödeskontrollen ska därför inte beskrivas som en bekräftad import i företagets produktionsregister.

## Kvar att verifiera

Företagets verkliga Bankgiroexport har inte tillhandahållits. Sambandet mellan Café Gränden Bistro AB/0599/625 kr och Swedbankposten med referenstext 58197013 är fortfarande obevisat. Inga fakturor, inklusive 0594, får markeras betalda på den grunden.

Bankgirots officiella manual dokumenterar fälten i Insättningsuppgift via Internet, men ingen universell CSV-exportlayout kunde verifieras. Swedbank dokumenterar camt.054; länkad MIG-PDF och exempel-ZIP gav 403. Testfilerna är syntetiska och stödprofilen behöver verifieras mot ett verkligt original. Olika datum eller identifierare hålls för granskning.

Ingen ny Bankgiro-API-integration eller automatiserad inloggning på Bankgirots skyddade sidor har införts. Lösningen använder filimport; befintlig AIS-anslutning antas inte ge individuella Bankgirobetalare. Verklig BankID-/Gmail-återinloggning eller utökade behörigheter kräver användarens medverkan enligt uppdraget.

Formatkällor och användning beskrivs i `sites/BANKGIRO.md`.
