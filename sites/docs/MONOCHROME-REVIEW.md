# MG Fakturakoll – svartvit arbetsyta och samlad granskning

2026-10-28. Ändring i befintlig Site, projekt `appgprj_6adf2f7f7e848191b64192161886b528`, från version 21.

## Levererat i koden

- Vit sidomeny med fem huvudområden, svarta huvudknappar, grå kort och diskreta statusmarkeringar. Befintliga funktioner finns kvar.
- Gemensam sökning bland sparade fakturor och bankhändelser, med öppningsbara resultat.
- Att granska visar olösta ärenden till vänster och uppgifter/underlag till höger. På mobilen växlar listan till detaljen, med tillbaka-knapp. Filtrering och sortering sker utan att registerdata ändras.
- Fakturadetalj, Gmail-dokumentgranskning och kundmejl återanvänder sina befintliga API:er och säkerhetskontroller inuti den gemensamma arbetsytan.
- Samlingsposter skiljer bankreferens från betalarens OCR. Utan individuell specifikation är huvudåtgärden Lägg till underlag. Ingen bekräftelse av fakturamatchning erbjuds för sådana poster.
- Fakturaförslag visar verkligt fakturabelopp, verifierad betalning, saldo och tillgängligt original. Beloppslikhet upphöjs inte till betalningsbevis.
- Sekundära administrativa åtgärder finns under Fler åtgärder. Import och matchningsbekräftelse behåller befintliga granskningsdialoger.
- Kontrollresultat sammanfattar sparade räknare med korrekta etiketter: behandlade underlag, verifierade betalningar i kontrollen och aktuella granskningsärenden. Detaljer går att expandera. Ofullständiga körningar visar Delvis klart och orsaken.

## Validering före publicering

TypeScript godkänt. 181/181 automatiserade tester godkända, inklusive skydd mot dubbelräkning, samlingsposter, osäker OCR, förlorade svar, felaktig ägare och obehöriga kundutskick. Fyra nya tester täcker samlad ärende/underlagsvy, laddning kontra tom kö och resultatsammanfattning utan påhittade fakturaräknare, samt att bankens referenstext på en samlingspost inte visas som kundens OCR.

Isolerad lokal Workers/D1/R2-miljö med fiktiva kunder användes. Granskning av en delbetalning visar 2 500 kr av 3 125 kr, kvar 625 kr och originalets första sida. Samlingsposten på 7 000 kr saknar matchningsknapp. Huvudkontrollen rapporterar Delvis klart när testanslutningar saknas och testautomatiken är pausad. Ett syntetiskt mejl har spärrad Godkänn och skicka; avvisning minskade kön från 7 till 6. Mobilbredd 390 px saknar yttre horisontell överrullning.

## Bevarad drift

Ingen schemaändring, datamigrering, radering, ny anslutning eller ändring av åtkomstpolicy ingår. Inga runtime-hemligheter eller pausade molnscheman ändras. Produktionens funktioner verifieras med läsning och navigation; syntetiska uppgifter förs inte in i produktionsregistret. Verkliga bankhämtningar, betalningsmatchningar och kundutskick ingår inte i denna kontroll.

Tidigare begränsningar gäller: individuella Bankgirospecifikationer måste finnas, OCR-datorn måste vara tillgänglig för lokal OCR, och en pågående huvudkontroll drivs av den öppna arbetsytan. Inga pausade scheman återaktiveras.
