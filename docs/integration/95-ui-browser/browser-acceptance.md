# Browseracceptans — observerade resultat

**Genomförd 2026-11-05.** Faktisk Chrome/CDP med produktens React-komponenter, egna stilmallar och syntetiska svar över loopback. Slutlig produktkod: `495de1166292cc141030cac7803f03a5f055d646`. Det är en lokal acceptans av gränssnittet, inte ett produktions- eller fullständigt WCAG-godkännande.

## Versionsbindning och underlag

- [Byggmanifest](bundle-source-manifest.json): 69 produktindata, sju bygg-/fixtureindata och nio genererade resurser.
- [Kontrollerad källbindning](capture-source-validation.json): samtliga 76 manifestindata matchar den levererade koden; även ramens separata källhash finns här.
- [Råobservationer och bildhashar](browser-observations.json): tidigare fynd behålls, och omkontroller har fasen `accepted-final`.
- [Anropskvitto](requests.jsonl): endast syntetiska vägar, metod, status och företagsidentitet; inga cookies, headers eller anropskroppar.
- 13 oförändrade JPEG-filer i [screenshots](screenshots/), hämtade från riktiga webbläsarfångster. Inga genererade mockuper eller konstruerade före-/efterpar.

Den slutliga matrisen har **20 vy/bredd-kombinationer**: översikt, kundfakturor, banklista och granskningskö vid **320, 390, 768, 1024 och 1440 CSS-pixlar**, alla 900 px höga. `innerWidth` avlästes i appens dokument. Vyerna skalades inte. Den vertikala rullningslisten tar normalt 15 px av innehållets bredd; `scrollWidth === clientWidth` i samtliga 20 kombinationer.

Totalt finns **28 slutliga layout- och textkontroller** inklusive dialoger, bankguide, bankanslutning, väntan, tom lista och felvy. Resultat i dessa avgränsade kontroller: **0 horisontella sidöverflöden, 0 kontrastfynd, 0 kontroller utan identifierad märkning och 0 aktiva synliga knappar under 24 px i någon dimension**. Upprepade observationer räknas inte som oberoende användartester.

## Flöden som faktiskt utfördes

| Flöde | Handling och observerat resultat |
| --- | --- |
| Fyra belopp | Översikten visade 0 kr verifierat inbetalt, 6 245 kr kvar att få, 875 kr att betala och 3 granskningsärenden. Värden kommer från befintlig `economySummary`, inte kopierade HTML-siffror. Inga allokeringar finns i testdata. |
| Fakturasökning | Sök `0000599`, öppna med Enter, kontrollera exakt nummer och referens. `0599` är en annan faktura. |
| Tom sökning | Sök `SAKNAS-000`, använd **Rensa sökning och filter**. Fem fakturor återkom och fokus återfördes till **Sök fakturor**. |
| Fakturafilter och riktning | **Att granska** gav en faktura. Byte till leverantörsfakturor gav två poster, rätt rubrik och återställt sökfält. |
| Global sökning | Sök `0000599`, ArrowDown till rätt resultat, Enter till fakturan. Escape stängde dialogen och återförde fokus till det stabila globala sökfältet. |
| Dialog och mobilmeny | Initialt fokus på stängning. Shift+Tab stannade inom öppnad yta; Escape stängde och gav fokus till öppnaren. Menyn återförde fokus till **Öppna menyn**. Ingen full skärmläsar- eller generell fokusfällescertifiering härleds. |
| Granskningskö | Vid 320 px öppnades valt underlag inline utan extra dialog. **Tillbaka till listan** återförde fokus till rätt ärende. |
| Bankbevis | Bankoriginalets syntetiska betalare visades med källa. Fakturaförslag var uttryckligen möjliga, bankreferens `0000599` behölls, och saknad bank-OCR påstods inte finnas. Okänd betalare ersattes inte av fakturakunden. |
| Fel och utkast | Skriv en anteckning i bankunderlaget, **Uppdatera** ger 503, välj återförsök. Exakt anteckning och valt ärende bevarades. Under felet var den kvarvarande detaljen `hidden` och `inert`, utan synliga beslutskontroller. |
| Företagsbyte | Byt aktivt företag till Exempel Beta AB. Företagsnamn, organisationsnummer och roll uppdaterades; tidigare bankval rensades. Endast den gemensamma företagsväljaren fanns i onboarding. |
| Bankval | Val med både tangentbord och pekare visade obligatoriska läsbehörigheter och separat Bankgiroavtal. Ingen bankidentifiering slutfördes. |
| Äldre bankanslutning | Bekräftat, okänt, utgånget och frånkopplat medgivande skildes åt. Okänd giltighet visades som **Giltighet inte bekräftad** och krävde förnyelse. Konfigurerat intervall var 6 timmar i testfallet. |
| Väntan/fel/tomt | Väntan och 503 gav streck och spärrade beloppskontroller. 503 erbjöd återförsök utan påhittad utloggning. Lyckat tomt fakturaregister gav en förklarad nästa åtgärd. Saknad bankanslutning fick en separat återställningsväg. |

## Fynd som rättades under acceptansen

Företagets standardidentitet kunde blinka före egen läsning, fakturatabellens belopp/statusar bröts olämpligt, hjälpetiketter hade låg kontrast, två små textknappar var cirka 23,84 px breda, och en initial 503 visade felaktigt en inloggningsuppmaning. Riktade omkontroller på slutversionen är sparade.

Granskningen hittade även ett osparat utkast som försvann vid tillfälligt hämtningsfel. Den första rättningen behöll kön men missade att förälderns nya `readable=false` monterade bort den inre redigeraren. Detta reproducerades i webbläsaren och ligger kvar som ett misslyckat mellanprov. Slutversionen behåller både senaste läsbara kö och dess detaljrenderare under ett dolt, inert omslag. Det slutliga provet `review-draft-survives-503-and-retry-390` visar oförändrad anteckning före och efter. Utloggning/företagsbyte rensar i stället utkastet enligt regressionstesterna.

## Mätmetod och begränsningar

Kontrastprovet läser synliga element med direkta textnoder i öppnad dialog eller dokument. Det beräknar förgrund mot sammansatt bakgrund och jämför med 4,5:1 för normal text respektive 3:1 för stor text. Inaktiva kontroller, opacity, pseudoelement, placeholders och komplexa bakgrunder omfattas inte. Märkningsprovet kontrollerar text/labels/ARIA-referenser, inte en fullständig beräkning av alla tillgängliga namn. Målstorleksprovet gäller aktiva synliga knappar; alla länkar, inmatningsområden och avståndsundantag har inte certifierats.

WCAG 2.2 AA kräver bredare kontroll. Fysisk mobil/surfplatta, skärmtangentbord, skärmläsare, verklig browserzoom 200/400 procent, textavstånd, forced colors och fler webbläsarmotorer har inte verifierats. Reduced-motion/forced-colors-regler finns i koden men är inte likvärdiga med sådana manuella prov. Se [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [målstorlek](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) och [W3C:s utvärderingsvägledning](https://www.w3.org/WAI/test-evaluate/).

Anropskvittot innehåller 794 poster från testomgångarna. Tre POST gäller endast testserverns minnestillstånd: ett företagsbyte och två auto-sync-preferens/no-op-anrop. Inga finansiella eller externa bankåtgärder utfördes. 404 gäller favicon, medveten äldre onboarding-fallback och den ej implementerade syntetiska avstämningsförhandsgranskningen. Den sistnämnda visar ett ärligt otillgängligt läge och är **inte** ett accepterat fullständigt avstämningsflöde. 503 och väntande svar är uttryckliga felprov. Konsolutdraget domineras av 100 transportfel från webbläsartillägget; det utgör ingen fullständig revision av applikationens JavaScriptfel.

## Reproducera

Bygg och starta enligt [README](README.md). Öppna `/qa-frame?width=390&height=900&scenario=standard&view=receivable` och använd de synliga ramväljarnas **Visa** för varje scenario. `error-after-first-read` ger 200 → 503 → 200 med appens egna uppdaterings- och återförsöksknappar. Kontrollera verklig `innerWidth`, sparat manifest och aktuell kod innan nya resultat jämförs. Varje explicit scenario laddar en ny syntetisk session; använd en profil åt gången.

Live BankID/provider, verklig bankhämtning, Gmail-leverans, godkänd avstämning, produktionsdata och beständig driftsmiljö ligger utanför detta kvitto. **9,5/10 är fortsatt ej verifierat.**
