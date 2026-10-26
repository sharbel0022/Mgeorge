# Mgeorge – MG Fakturakoll

Fakturahantering och avstämning av bankhändelser för M.George Vitvaror AB.

**Liveapp:** https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/

## Status
Detta GitHub-repository är förberett för projektets källkod. **Webbappens källkod är ännu inte exporterad från ChatGPT Sites till GitHub.** Den publicerade tjänsten och detta repository är därför inte automatiskt synkroniserade.

## Funktioner i den publicerade webbappen
- Registrering och uppföljning av kund- och leverantörsfakturor
- Import av bankhändelser från CSV och ISO 20022 camt.053/camt.054
- Förslag till avstämning och manuell granskning
- Påbörjad bankanslutning via Enable Banking för kontoinformation (AIS)

En riktig bankanslutning kräver ett godkänt leverantörskonto och användarens medgivande. Att källkoden publiceras på GitHub ansluter **inte** banken automatiskt.

## Säkerhet
Lägg aldrig upp privata RSA-/PEM-nycklar, API-hemligheter, .env-filer, åtkomsttoken, bankutdrag, fakturor eller kunduppgifter här. Repositoryt är offentligt. Använd skyddade servermiljövariabler och krypterad lagring för hemligheter.

## Nästa steg
Exportera källkoden från ChatGPT Sites, granska den efter hemligheter och kunddata, och lägg först därefter upp applikationskoden. Lägg till instruktioner för lokal utveckling och tester baserat på den faktiska exporterade projektstrukturen.
