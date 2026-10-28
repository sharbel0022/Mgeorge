# MG Fakturakoll – publicerad svartvit granskningsyta

Verifierat 2026-10-28. Befintlig adress: https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/.

## Leverans

Slutversion **23** är publicerad i det befintliga Sites-projektet `appgprj_6adf2f7f7e848191b64192161886b528`.

- Källcommit: `00d65f942621b0bd07b1bcb680ece0422a9f9a32`.
- Deployment: `appgdep_6ae1df95ee8081918df7efd3aec1fae1`, status `succeeded`.
- Utgångspunkt: version 21, commit `6adb8e58b111887074426b3c8d84d5610885a342`.
- Åtkomstpolicy, D1/R2-bindningar och runtime-konfiguration bevarade. Inga datamigreringar ingår.

## Förändringar

Vit sidomeny, fem huvudområden, svart text och svarta huvudknappar, ljusgrå kort och diskreta statusmarkeringar. Gemensam sökning öppnar fakturor och bankhändelser direkt. Sekundär administration är samlad under diskreta menyer.

Att granska visar en gemensam lista och valt underlag sida vid sida på dator. På mobilen visas lista eller detalj, med tillbaka-knapp. Dokument, fakturor och kundmejl använder befintliga kontroller inuti arbetsytan. Filter och sortering ändrar inte registerdata.

Bankens transaktionsreferens, bankens referenstext, betalarens OCR och fakturanumret hålls isär. En samlingspost kan inte få kundens OCR från bankens referenstext. Utan individuella specifikationer är huvudåtgärden Lägg till underlag; någon bekräftelse av fakturamatchning visas inte.

Kontrollresultatet visar faktiska sparade räknare med etiketter för underlag, verifierade betalningar och kvarvarande granskningsärenden. Ofullständiga steg visar Delvis klart och en förklaring. Stegdetaljer kan expanderas.

## Testbevis

- TypeScript och produktionsbygge godkända. **181/181 automatiserade tester** godkända.
- Fyra nya regressionstester täcker samlad lista/detalj, laddning kontra tom kö, korrekta resultaträknare och att samlingspostens providerreferens inte presenteras som kund-OCR.
- Isolerad lokal Workers/D1/R2-miljö: faktura 3 125 kr, verifierat 2 500 kr, kvar 625 kr och synligt original. Samlingspost saknar matchningsknapp. Huvudkontrollen visar Delvis klart vid saknade anslutningar och pausad testautomatik.
- Syntetiskt kundmejl har spärrad Godkänn och skicka. Avvisning av testutkast minskar kön från 7 till 6; testdatabasen innehåller noll leveranser.
- Publicerad version: fem huvudområden, filtrering/sortering och verklig samlingspost 625 kr den 26 oktober kontrollerade. Referenstext 58197013 visas separat; betalarens OCR anges saknas. Enda primära detaljåtgärd är Lägg till underlag.
- Publicerad global sökning hittar faktura 0594, Notuddskajens café AB, 4 375 kr. Fakturadetaljen visar 0 kr verifierat betalt, 4 375 kr kvar och faktiskt renderad originalbild.
- Befintligt produktionsutkast öppnades. Mottagaren saknar verifiering, godkännandet är tomt och Godkänn och skicka är spärrad. Öppningen använder den befintliga granskningsregistreringen; ingen adressverifiering, redigering, avvisning eller sändning utfördes i produktion.
- Produktionsdatabasens arbetsyterevision är fortsatt **13** efter samtliga kontroller. De returnerade workspace-, bank- och Gmail-fälten är oförändrade jämfört med baslinjen; vissa långa värden är trunkerade av läsverktyget. `customer_deliveries` innehåller fortsatt **0** rader.
- Båda befintliga molnschemana är fortsatt pausade. Ingen verklig huvudkontroll eller ny bankhämtning startades i denna leverans.
- Datorvy och publicerad mobilvy 390 px verifierade. I mobilvyn är dokumentbredd och scrollbredd båda 375 px; listan växlar till detaljen och tillbaka. Ingen yttre horisontell överrullning.

## Fortsatta förutsättningar

Individuella Bankgirospecifikationer behövs för att identifiera verkliga betalare. Beloppslikhet räcker inte. Lokal OCR behöver en tillgänglig OCR-dator; väntande dokument bevaras. Befintlig huvudkontroll drivs av den öppna arbetsytan. Inga pausade scheman återaktiveras.

Verklig ny bankhämtning, betalningsmatchning och kundutskick har inte testats i produktion, för att bevara riktiga betalningsuppgifter och undvika kundmejl. Dessa vägar täcks av syntetiska tester och tidigare befintlig funktionalitet.

## Källkod och bilder

Den verifierade Sites-källan finns i `.codex-work/sites`. Den fullständiga diffen från version 21 till 23 finns i `docs/sites/monochrome-review-v23.patch`. Det är en Sites-patch, inte en patch till den separata Node-servern.

Desktopbild: `.codex-work/mg-v23-publicerad.png`. Mobilbild: `.codex-work/mg-v23-mobil.png`. Bilderna innehåller endast samma arbetsyta som verifierades i webbläsaren.
