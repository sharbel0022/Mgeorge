# Dokumenttolkning och granskning

## Funktion och gränser

PDF.js extraherar text från varje PDF-sida. Sidor med färre än 60 läsbara tecken renderas och körs genom Tesseract med svenska språkdata. PNG, JPG och WebP körs genom samma OCR-motor. PDF-filer med högst tio sidor och högst 12 miljoner renderade pixlar per sida stöds. Förhandsvisningen visar första sidan; hela originalet finns för nedladdning. En isolerad Node-process har 90 sekunders tidsgräns och 256 MB V8-heap; högst två dokumentprocesser kör samtidigt. Native bildminne ligger utanför V8-heapen; driftens process-/containergräns behövs om hård totalminnesgräns krävs.

Tolkningen använder dokumenterade fältetiketter och deterministiska regler. Den är inte en generell språkmodell. Fakturanummer, ledande nollor, motpart, org.nr, faktura-/förfallodatum, total, moms, netto, referens, Bankgiro, valuta och dokumenttyp sparas med källbelägg och säkerhetsnivå. Svensk decimalhantering, kalenderdatum, org.nr-kontrollsiffra och netto+moms=total kontrolleras. Momssats per fakturarad härleds inte. Referenser måste kontrolleras mot originalet; OCR-kontrollsiffra och Bankgiro-ägarskap verifieras inte mot externa register.

Saknade uppgifter förblir null. Fält med olika lästa värden lämnas tomma. Flera fakturanummer eller totalbelopp i en PDF stoppar automatisk behandling; flera PDF-bilagor importeras separat. Automatisk uppdelning av flera fakturor inne i samma PDF ingår inte. Användaren får dela originalet och granska varje faktura separat. Kvitton/övrigt och okända motparter blir inga automatiskt bokförda skulder. Kreditfakturor hanteras separat från debetfakturor och får omvänd betalningsriktning i Node-registret.

## Granskning och registrering

Grönt kräver nödvändiga, konsistenta och tydligt lästa värden. Gult omfattar osäker riktning, OCR och okänd motpart. Rött omfattar oläsbart underlag, motstridigheter eller saknade avgörande uppgifter. Säkerhetsnivån är en granskningsheuristik och ska inte tolkas som en statistiskt kalibrerad sannolikhet.

Original och fält visas sida vid sida. Fälten går att redigera före Godkänn faktura; avvisade underlag bevaras. De ursprungliga extraherade värdena skrivs inte över av en rättning. Godkännandets före/efter-värden sparas i historiken. En redan godkänd begäran skapar inte en ny faktura vid omkörning.

Automatisk registrering är AV från början. Aktivering i Inställningar tillåter endast gröna dokument från en redan registrerad motpart med samma namn, riktning och organisationsnummer. Dubbletter kontrolleras inom motpart och dokumenttyp. Identiskt innehåll från nya mejl bevarar flera källor på samma original. En semantisk dubblett med nytt dokument kan efter granskning komplettera den tidigare fakturan om beloppet stämmer. Samma fakturanummer hos en annan leverantör är inte samma faktura.

En registrering skapar inga betalningar. Befintliga bokförda bankhändelser används till matchningsförslag. Användaren godkänner alltid en matchning; riktning, valuta, kreditfaktura, samlingspost och återstående belopp kontrolleras av befintlig banklogik. Belopp ensamt ger aldrig ett förslag. Banksessioner, nycklar och gamla transaktioner migreras inte av dokumentfunktionen.

## Dataskydd, installation och kostnader

Kör `npm ci` med Node 22.13 eller senare på en stödd plattform. Beroenden och svenska språkdata är versionslåsta. OCR kräver ingen API-nyckel och inga fakturabytes skickas till en extern AI/OCR-tjänst. Språkmodell och WASM kommer från npm-installationen; Node kör dem lokalt. Sites laddar motsvarande motor och språkdata från den egna webbplatsens `/ocr/` och behandlar fakturan i webbläsaren. Se [Tesseract API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) och [PDF.js](https://mozilla.github.io/pdf.js/examples/).

Det finns ingen extern OCR-avgift per faktura i denna implementation. Server-CPU, minne, Gmail-anrop, Sites/D1/R2-lagring, bandbredd och eventuellt framtida Google-verifiering/säkerhetsgranskning måste bedömas mot verksamhetens driftavtal. Ingen betaltjänst har aktiverats. Original och extraherad fakturatext är företagsuppgifter och behöver skyddad disk, åtkomststyrd backup och beslutad retention. Token är krypterade; SQLite-fakturor och originalfiler är inte separat krypterade på disk.

Sites kör inte Node-child-processer. Den publicerade Sites-koden har eget OAuth-flöde, D1/R2-lagring, manuell fakturagranskning och browser-OCR. Den har inte Node-versionens obevakade OCR eller valbara automatiska registrering. Sites-kreditfakturor hänvisas till det befintliga kreditflödet för en originalfaktura. Dessa gränser visas i driftstatusrapporten.
