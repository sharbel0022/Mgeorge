# Ekonomiöversikt – kodleverans 2026-10-28

## Leveransens omfattning

Den här ändringen utvecklar den befintliga Sites-källan och delar av Node-motorn. Den skapar inte ett nytt produktionsregister, flyttar inte företagsdata och publicerar inte automatiskt Sites. Inga privata original, nycklar, medgivanden eller kunduppgifter ingår i testdata eller Git.

Implementerat:

- Fyra svartvita sammanfattningar: verifierat inbetalt innevarande Stockholmsmånad, kvarstående kundsaldo över alla perioder, leverantörssaldo som är förfallet/förfaller inom sju dagar/saknar förfallodatum, och faktiska granskningsbeslut.
- Laddning och fel visas som okänt värde, inte noll. Ofullständiga betalningsspecifikationer, väntande bearbetning, ogranskade fakturor och ofullständig mejlhistorik gör översikten uttryckligen preliminär.
- Senast bekräftade betalningskopplingar visar fakturanummer med inledande nollor, kund, bankdatum och ursprunglig betalare/referens separat. Manuell komplettering ersätter inte bankens originalfält.
- Dokumentklassificering skiljer starkt identifierade logotyper, avtalsvillkor och löneunderlag från fakturor. Originalen bevaras. Oklara bilder och riktiga bildfakturor döljs inte generellt. Nya inline-logotyper filtreras innan onödig nedladdning/OCR.
- Bearbetningsköer och framtida granskade fakturor ger inte automatiskt ett beslutskrav. Övriga dokument går att visa i dokumentvyn.
- Konflikt mellan fakturanummer i text, filnamn och mejlrubrik blockerar automatisk registrering. Kolumnparet Fakturadatum/Fakturanummer hanteras särskilt. Gamla registreringar skrivs inte om.
- Strukturerade, ostrukturerade och refererade dokumentnummer i camt bevaras tillsammans med fältsökväg. Referenser kapas inte tyst. Flera fakturareferenser kräver fortfarande kontrollerad fördelning.
- Regelversionsmärkt konservativ avstämning, med ny kontroll efter varje föreslagen allokering. Beloppslikhet ensam, okända betalare, referenskonflikter, dubbletter och ofullständiga samlingsposter markeras aldrig automatiskt som betalda. Verifierade utbetalningar kan matchas till rätt granskad leverantörsfaktura.
- Skrivskyddad jämförelsekörning via autentiserad GET `/api/payment-control/preview`. Den skapar inte matchningar, utskick eller körningsposter.
- Anslutningsstatus skiljer anslutning, aktiverad automatik, ej verifierad schemaläggning, historikluckor och offline OCR. Befintlig bankväntetid och pausade scheman bevaras.

## Inga nya förbehållslösa löften

En referens som saknas i bankanslutningen kan inte uppfinnas ur en faktura med samma belopp. Systemet behöver ett verkligt individuellt betalningsunderlag från banken. Denna kodleverans aktiverar inte nya bankavtal eller automatisk rapportleverans.

Den befintliga övergripande Sites-kontrollen använder sparade steg men behöver fortfarande anrop för att driva stegen vidare. Den här ändringen aktiverar inte ett obemannat molnschema och ersätter inte lokal bild-OCR med en ny molntjänst. Aktivering kräver separat behörighet och verifiering. Ingen schemainställning ändras.

## Tester och verifiering

Nya syntetiska regressionstester finns i `sites/tests/economy.test.mjs`, `sites/tests/payment-control-ui.test.mjs`, `sites/tests/payment-control.test.mjs` och `test/document-triage.test.js`. Befintliga bank-, dokument-, avstämnings-, ägaråtkomst- och utskicksspärrtester behålls.

Kör från rotmappen `npm run check` och `npm test`. Kör från `sites/` först `npm run install:ci`, därefter `npm run check`, `npm test` och `npm run build`. Aktuell GitHub Actions-körning är källa för fullständiga testresultat. Ett lyckat bygge är inte ett bevis på publicering eller korrekt avstämning av företagets verkliga betalningar.

## Återstående produktionssteg

1. Säkerhetskopiera D1/register, R2-original och befintliga runtimehemligheter på skyddad plats. Testa återställning utan att byta krypteringsnyckel.
2. Publicera den testade `sites/`-källan i samma befintliga Sites-projekt och behåll dess D1/R2-bindningar, identitetslager, ägare, domän, medgivanden och runtimehemligheter. GitHub-push är inte denna publicering.
3. Hämta en riktig individuell betalningsrapport enligt företagets bankavtal. Validera konto, stabila identifierare, bokföringsdatum, valuta, totalsumma och referenser mot kontoposten. Anonymiserade testkopior får användas för regression, inte verkliga kunduppgifter i det offentliga repot.
4. Använd jämförelsekörningen mot ett av verksamheten verifierat startläge. Bekräfta att återimport och avbrutna körningar inte skapar dubbla belopp. Stäm av säkerhet och precision innan utökad automatik aktiveras.
5. Slutför endast uttryckligen godkända schemabehörigheter och kontrollera en verklig obemannad körning. Datorbaserad OCR kräver fortfarande att den valda datorn är tillgänglig.
6. Verifiera inloggad desktop- och mobilvy, sessionens bortfall, källa för varje saldo och fortsatt manuellt godkännande av kundmejl.

## Återställning

Ändringen är additiv i registerfält och ändrar inga befintliga databasmigreringar. Kodåtergång sker till föregående testad Sites-version och Git-commit. Ekonomiska allokeringar återtas enbart med systemets spårbara återtagsfunktion; radera aldrig bankoriginal eller återställ hela databasen bara för att korrigera en enskild koppling.
