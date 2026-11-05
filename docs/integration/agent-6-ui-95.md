# Agent 6 — gränssnitt, användbarhet och verifieringsunderlag

**Leveransrapport, 2026-11-05.** Sites-gränssnittet är förbättrat och testat på `feature/95-ui`. Rapporten redovisar faktisk lokal browseracceptans, regressionstester och kvarstående acceptansgränser. **9,5/10 är inte verifierat och inga kvalitetspoäng höjs här.** Kod, källbundna testkvitton och 13 verkliga skärmbilder levereras för granskning.

Underlaget är [inventeringen](./95-ui-inventory.md), [designbeskrivningen](../superpowers/specs/2026-11-05-ui-95-design.md), [genomförandeplanen](../superpowers/plans/2026-11-05-ui-95.md), [root-/bridge-kvittot](./95-ui-browser/validation-root-bridge.md) samt faktiska Chromium-observationer och skärmbilder. Inventeringens ursprungsbas var `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Därefter integrerades `origin/main` på `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`, med mergehuvud `a50c57b802e9b2615fad064065bcb6d9d4726c89`. Slutlig produktkod är `495de1166292cc141030cac7803f03a5f055d646`; senare leveranscommits innehåller endast dokumentation och testartefakter.

## 1. Omfattning och bevarade gränser

Agent 6:s produktändringar gäller den befintliga React-applikationen i `sites/`: arbetsytans navigation, ekonomiöversikt, kund- och leverantörsfakturor, bankunderlag, granskningskö samt företagsval och bankanslutning. Befintliga komponenter, dataprojektioner och API-kontrakt återanvänds. Presentationen samlas i det avslutande stilskiktet `workspace-design.css` och avgränsade komponentändringar.

Den separata Node-frontenden är inventerad: `public/index.html`, `app.js`, gransknings- och meddelandesidor samt deras stilmallar. Den får ingen motsvarande omdesign i denna leverans. Root-svitens regressionsbevis ska därför inte beskrivas som ny visuell Node-acceptans. Gmail, kundmeddelanden, import, kontakter, historik, inställningar och juridiska sidor finns också i inventeringen; varje sådan sida har inte en egen fullständig webbläsaracceptans här.

UI-arbetet ändrar inte beräkningsregler, allokeringar, saldon, behörighetsmodell, databasschema eller providerkontrakt. Fakturanummer och referenser behålls som strängar med inledande nollor. Kundidentitet, avsedd betalningsreferens, bankrapporterad referens, formell OCR och verifierad betalare förblir skilda uppgifter. Ett läsbart förslag blir inte ett ekonomiskt beslut.

## 2. Konkreta förändringar

**Översikt och identitet.** De fyra befintliga måtten Inbetalt, Kvar att få, Att betala och Behöver granskas behålls. Aktivt företag visas genom arbetsytans företagskontext. Under väntan eller misslyckad hämtning visas streck och förklarande text i stället för påhittade nollbelopp. Kontroller som kräver aktuella uppgifter är inaktiva. Ett hämtningsfel erbjuder återförsök, och bankproblem förklaras tillsammans med vägen till bankanslutningen.

**Fakturor och sökning.** Gemensamma snabbfilter kompletteras med märkta sök- och statuskontroller. Resultatantal beskriver urvalet. En sökning utan träffar kan återställas; detta hålls åtskilt från ett faktiskt tomt register där användaren kan lägga till sin första faktura. Fakturanummer och avsedd referens har tydligare typografisk hierarki. Kund- och leverantörsriktning behålls vid navigering och återställning. Sidhuvudets åtgärder följer den aktuella uppgiften.

**Navigation och läsbarhet.** Vitt, svart och neutrala gråtoner ger en enhetlig yta. Rubriker, avstånd, radbrytning, knappar och fokusmarkeringar har justerats. Status förklaras med ord och etiketter. Mobilmenyn och dialogerna har tydliga stängningsvägar, medan granskningsdetaljen på smal skärm har en egen tillbakaåtgärd. Befintliga original, källor och kontrollregler finns kvar i detaljvyerna.

**Granskning och återhämtning.** Köfel skiljs från en lyckad tom kö. Ett valt ärende kan återupptas efter nytt lyckat svar. Den sista rättningsomgången gäller dessutom lokala anteckningar: ett tillfälligt hämtningsfel får inte montera bort den detalj som bär ett osparat utkast. Historiskt misslyckande och senare riktad kontroll redovisas nedan; detta ska inte döljas bakom ett generellt grönt testantal.

**Företag och bank.** Onboarding visar vilket företag bankanslutningen gäller och hänvisar till det gemensamma företagsvalet. Bankval, läsbehörigheter, bankens identifiering och separat Bankgirobehörighet presenteras som olika steg och förutsättningar. Den äldre bankvyn skiljer ansluten, okänd giltighet, utgånget medgivande och frånkopplad status. Automatisk hämtning beskrivs villkorligt; schemat framställs inte som en verifierad produktionskörning.

## 3. Webbläsarmetod och skärmstorlekar

[Testmiljön](./95-ui-browser/README.md) bygger och monterar produktens faktiska React-komponenter och CSS mot lokala syntetiska HTTP-svar. Chromium visar appen i en namngiven iframe med exakt CSS-bredd, utan skalning. Kontrollramens väljare ligger utanför produktens appvy. [Råobservationer](./95-ui-browser/browser-observations.json), [fullständigt browserkvitto](./95-ui-browser/browser-acceptance.md) och [källbindning](./95-ui-browser/capture-source-validation.json) är sparade tillsammans med bilderna.

| Appens uppmätta `innerWidth` | Observerad layoutmatris |
| ---: | --- |
| 320 px | Översikt, kundfakturor, bank och granskning |
| 390 px | Samma fyra vyer; dessutom flera interaktiva mobilflöden |
| 768 px | Samma fyra vyer; tomt fakturaregister och äldre bankstatus |
| 1024 px | Samma fyra vyer; översikt utan fungerande bankanslutning |
| 1440 px | Samma fyra vyer; bankdetalj och äldre bankanslutning |

Den dokumenterade matrisen omfattar 20 kombinationer av vy och bredd. Där var `scrollWidth` lika med `clientWidth`; ingen horisontell överströmning på sidnivå registrerades. Vertikal rullningslist förklarar att innehållets bredd ibland är 15 px mindre än `innerWidth`. Mätningen gäller appens ram, inte den yttre webbläsarens fönster.

Detta är **inte provning på fysiska telefoner eller surfplattor**. Operativsystemens skärmtangentbord, verkliga pekgester, andra webbläsarmotorer och hjälpmedel omfattas inte av dessa resultat. Matrisen upprepades efter sista rättningen och binds till den slutliga produktkoden via manifestets 69 produktindata.

## 4. Provade flöden och rättade regressioner

| Flöde | Dokumenterad observation |
| --- | --- |
| Fakturasökning vid 390 px | `0000599` behöll sina nollor i listan och detaljen. Återställning av sökning gav fem kundfakturor och fokus på sökfältet. |
| Filter och fakturariktning | Granskningsfilter gav en träff. Leverantörsvyn visade två fakturor, rätt rubrik och tom söksträng utan sidöverströmning. |
| Fakturadialog | Dialogen var 370 px bred i en 390 px ram. Fokus började på stängningskontrollen; Shift+Tab stannade i dialogen och Escape återförde fokus till öppnaren. |
| Mobilmeny | Tangentbordsfokus stannade i menyn vid bakåttabbning. Escape stängde den och återförde fokus till menyknappen. |
| Granskning vid 320 px | Saknat mottagarkonto, flera betalare och saknade Bankgirodetaljer förblev skilda ärenden. Detaljen öppnades inline; tillbaka återställde fokus till rätt listrad. |
| Kö: lyckat svar → 503 → återförsök | Ett tydligt felmeddelande visades och kontrollåtgärden spärrades. Efter nytt lyckat svar återkom valt ärende och fokus. |
| Företags- och bankval | Bank kunde väljas med tangentbord och pekare. Byte till Exempel Beta AB uppdaterade företagsregionen och rensade tidigare bankval. Medgivandet skickades inte. |
| Äldre bankstatus | Ansluten, okänd giltighet, utgånget medgivande och frånkopplat läge visades vid olika bredder. Okänd giltighet gav ingen bekräftad aktiv anslutning. |
| Väntan, fel, tomt register och saknad bank | Streck skildes från nollvärden; fel erbjöd återförsök; tom fakturalista fick egen väg vidare; bankproblem behöll förklaringen om sparade underlag. |

En tidigare utkastkontroll misslyckades: anteckningen försvann efter ett 503-svar. Den observationen ligger kvar som `intermediate-regression`. Integrationsansvarigs efterföljande riktade kontroll bekräftar att den exakta anteckningen överlever **klart → väntar → 503 → återförsök → 200**. Under felet finns detaljen kvar i DOM, dold och `inert`; därefter återupptas samma ärende med anteckningen. Detta är sparat som `review-draft-survives-503-and-retry-390` med fas `accepted-final`, på samma produktkod som slutmatrisen.

Äldre poster med fasnamnet `final-bundle` avser en mellankandidat. `accepted-final` är slutliga omkontroller: 20 vy/bredd-kombinationer och åtta ytterligare detalj-/tillståndskontroller. Observationer, upprepade mätningar och regressioner summeras inte som oberoende användartester. Global sökning provades dessutom med ArrowDown → Enter → Escape: exakt faktura öppnades och fokus återvände till det stabila sökfältet.

## 5. Tillgänglighet och bildbevis

Tangentbord, fokusåtergång, märkta kontroller, radbrytning och beräknade textkontraster har granskats i angivna lägen. I den tidigare fakturadialogen hittades åtta kontrastanmärkningar; felvyns inloggningstext hade också ett fynd. Översiktens små ”Alla”-kontroller mättes till cirka 23,84 × 44 px. Dessa fynd ledde till sista CSS-rättningar, inklusive minsta bredd 44 px. Slutlig omkontroll av 28 vyer/lägen gav **0 textkontrastfynd, 0 horisontella sidöverflöden, 0 kontroller utan identifierad märkning och 0 synliga aktiva knappar under 24 px**. Fakturadialogen omprovades på mobil och dator. En 503-visning gav korrekt återförsök utan påhittad utloggning.

Detta underlag innebär **ingen fullständig WCAG-granskning eller fastställd överensstämmelse**. Manuell skärmläsaracceptans, förstoring och textanpassning, högkontrastlägen, samtliga fel- och formulärvägar samt fullständigt hjälpmedelsstöd saknar samlat kvitto. Stilregler och automatiska mätningar är avgränsade bevis.

Följande bilder visar faktiskt observerade syntetiska lägen. De är inte ett konstruerat före-/efterpar och visar inte produktionsdata. Alla 13 bilders SHA256 finns i råobservationernas `artifactHashes`.

| Bild | Observerat läge |
| --- | --- |
| [Översikt, 1440 px](./95-ui-browser/screenshots/desktop-overview-1440.jpg) | Företag, fyra ekonomimått, preliminärt underlag och bankstatus |
| [Fakturor, 390 px](./95-ui-browser/screenshots/mobile-invoices-390.jpg) | Filter, läsbar referens och inledande nollor |
| [Granskningsdetalj, 320 px](./95-ui-browser/screenshots/mobile-review-detail-320.jpg) | Saknat konto, okänd betalare och tillbakaåtgärd |
| [Bankdetalj, 1440 px](./95-ui-browser/screenshots/desktop-payment-detail-1440.jpg) | Skilda referenser, källor och kvarstående kontroll |
| [Bankguide, 390 px](./95-ui-browser/screenshots/mobile-bank-onboarding-390.jpg) | Aktivt företag, läsåtkomst och väg genom anslutningen |
| [Äldre bankanslutning, 1440 px](./95-ui-browser/screenshots/desktop-bank-connection-1440.jpg) | Syntetiskt ansluten status, konto, giltighet och åtgärder |
| [Laddning, 390 px](./95-ui-browser/screenshots/mobile-loading-390.jpg) | Okända belopp och inaktiva kontroller |
| [Tom fakturalista, 768 px](./95-ui-browser/screenshots/tablet-empty-invoices-768.jpg) | Lyckat tomt register med nästa steg |

## 6. Slutliga kodgrindar

[Det separata root-/bridge-kvittot](./95-ui-browser/validation-root-bridge.md) gäller mergehuvudet `a50c57b802e9b2615fad064065bcb6d9d4726c89` och redovisar exakta kommandon, tider och logghashar.

| Grind | Dokumenterat resultat | Versionsgräns |
| --- | --- | --- |
| Root | 180 syntaxkontrollerade filer; 1 997/1 997 tester | Avgränsade root-/bridge-indata var oförändrade under körningen |
| Bridge | Sex syntaxmål; 47/47 tester | Samma lokala valideringskvitto |
| Root-/bridge-audit | Noll fynd i alla allvarlighetsklasser; high-grindar godkända | Bridge-audit avsåg produktionsberoenden |
| Sites slutkandidat | **3 888/3 888** tester; check och produktionsbygge godkända | 333 verifierade indata oförändrade under körningen; [slutkvitto](./95-ui-browser/validation-sites.md) |

De tre fulla sviterna ger **5 932 godkända tester**, utan fel, överhoppade, avbrutna eller TODO. Harnessens åtta fixture-/HTTP-tester tillkommer separat. Lokal runtime var Linux, Node 24.22.1 och npm 11.9.0; Node 22-CI är separat. Sites high-audit passerade med 8 befintliga moderate utvecklingsfynd och 0 high/critical; minimatch-kontrollen verifierade ett mål utan skrivning. Tidigare försök och lokal ren installations begränsning redovisas uttryckligen i [Sites-kvittot](./95-ui-browser/validation-sites.md).

## 7. Ej utövade produktionsflöden och poäng

Testmiljön använder syntetiska företag, fakturor och bankunderlag, begränsar nätverket till loopback och saknar tillåtna vägar för verkliga finansiella skrivningar. Verklig BankID-identifiering, providerauktorisering, bankhämtning, Gmail-anslutning eller mejlleverans har inte genomförts. Inga betalningar, produktionsallokeringar, saldoändringar eller externa schemaaktiveringar används som demonstrationsbevis.

En syntetisk ansluten bankruta verifierar varken verklig bankåtkomst eller företagsbehörighet. Denna rapport ändrar inte bankens operativa bedömning och ger inget publicerings- eller kommersiellt godkännande. [Kvalitetspoängen](../../QUALITY-SCORECARD.md) behåller sin tidigare nivå; **nådd 9,5 är inte styrkt**.

## 8. Versionsbindning och leverans

Produktcommiten är `495de1166292cc141030cac7803f03a5f055d646` på `feature/95-ui`, med integrerad main-bas `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`. [Byggmanifestet](./95-ui-browser/bundle-source-manifest.json) kommer från den native runtime som den faktiska webbläsaren använde. Dess 69 produkt- och sju fixture-/byggindata matchar leveransen; ramens hash registreras separat. Alla bilder är omtagna från slutversionens observerade lägen.

Oberoende kodgranskning identifierade förlorade utkast. Rättningen fick först misslyckade och sedan godkända monterade regressioner vid 390/1440 px, samt ett faktiskt lyckat browserprov. Inga andra konkreta blockerande kodregressioner rapporterades inom granskad UI-diff. Det innebär inte att oprövade flöden eller produktionsintegrationer är godkända.

PR:n ska riktas från `feature/95-ui` till `main`; dess aktuella head och obligatoriska CI-jobb är auktoritativa för leveransens status. Denna rapport använder produktcommit och filhashar för att undvika att en dokumentationscommit påstås ha ett självrefererande test-SHA. Ingen merge eller publicering ingår i UI-leveransen.

**Fortsatt acceptans:** faktisk inloggad företagsresa med bank/provider, full avstämningsförhandsgranskning och sparande, relevant Gmail-flöde, fysisk mobil/surfplatta, skärmläsare, förstoring och representativa användares uppgiftsprov behövs före ett styrkt 9,5-beslut. Samtliga 33 befintliga kvalitetspoäng behålls: **255/330 = 7,73/10; 0/33 ≥9,5**.
