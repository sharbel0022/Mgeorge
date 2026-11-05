# Första integrationen: granskning och verifieringsgränser

Datum: 2026-11-05. Grund: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.
Detta är den första leveransen mot målet minst 8 i varje område. Den är inte
en slutbedömning av de 33 områdena och bevisar inte i sig fungerande produktion.

## Oberoende granskning och åtgärdade fynd

| Del | Granskning och åtgärd | Återkontroll |
|---|---|---|
| Bankmedgivande | Oberoende granskning av `9c4a8b0` hittade företagsadoption, strikt cooldown och förlorat commitsvar. `0f15416` rättade dessa. Ett kombinationsfall med förlorat svar, ersatt lease och oläsbart kvitto rättades i `dde248f`. | Recovery-granskaren godkände `dde248f` utan kvarstående Critical/Important/Minor. De två kombinationsfallen kördes separat, med och utan ny lease; återställd kvittoläsning återger utfallet utan ytterligare provideranrop. Root körde 38/38 riktade bankprov. |
| OCR-trigger | Granskningen fann att eventets SHA inte räcker som bevis för aktuell main. `46e8385`, integrerad som `ff5619d`, läser nu den aktuella GitHub-referensen före installation och omedelbart före credential-steget. | Root läste hela ändringen och körde 84/84 trigger-/klientprov. Fail-closed kontroller omfattar identitet, event, branch, SHA, API-svar, redirect, storlek, timeout och avsaknad av token. Ingen befintlig äldre workflowrevision ändras retroaktivt. |
| Dokumentidentitet | Payments-granskaren hittade att en senare rubrik kunde tolkas som fakturanummer efter tomrader. `9c3dcee`, integrerad som `7418618`, begränsar identiteter till etiketten eller omedelbart följande rad. | Root granskade hela diffen och de 40 nya fallen. Beloppsåterhämtning över tomrader behålls, medan referens/datum/konto/identitet inte får samma utvidgning. Tidigare mätningar behåller sina ursprungliga källhashar. |
| Sökning och förslagsbelopp | Documents-granskaren reproducerade en tvetydig sökning där `123 456,00` dolde faktura 123, samt ett förslagskontrakt som accepterade mer än bankpostens rapporterade belopp. `f8a48d5`, integrerad som `72c7c6c`, rättar båda. | Root granskade produktionsdiffen och regressionerna. Båda giltiga söktolkningarna visas, exakt referens rankas först, och alternativens prefix kräver exakt sparad referens. Tillgängligt belopp får inte överstiga bankbeloppets absolutvärde; utgående, noll och reversal hålls blockerade. |
| Återställning | Det isolerade provet använder de faktiska backup-/restore-modulerna, syntetiska original och en separat acceptanskontroll. | Root körde båda återställningsproven själv: 2/2. Rapportens RPO/RTO avser det uttryckligen syntetiska scenariot och är inte en uppmätt produktionsåterställning. |

Bankproven använder syntetisk providergräns och verklig service-/SQL-kod. De
bevisar inte att bankens aktuella produktionssession är godkänd. OCR-triggern
bevisar aktuell main vid de två kontrolltidpunkterna, inte ett lås på main under
hela körningen. Den måste dessutom observeras med faktisk köprogress efter merge.

## Full lokal körning före slutdelta

Den frysta integrationen `74186185672c6c83e35ad2d28451c546c10ac67f` kördes med
Node 24.22.1, isolerade syntetiska data och testkonkurrens 1 per svit.

| Kontroll | Observerat utfall |
|---|---|
| Full Node-svit | 1 995/1 995, inga överhoppade; 638,395 sekunder. |
| Full bridge-svit | 47/47, inga överhoppade. |
| Syntax | 179 JavaScript-filer godkända. |
| Full Sites-svit | 3 748 godkända av 3 836; 88 fel, inga överhoppade. Denna körning är **inte godkänd**. |
| Beroendegranskning | Root, Sites produktion och bridge: noll fynd. Hela Sites-trädet: åtta måttliga utvecklingsfynd, noll höga/kritiska. Inga beroendefiler ändrades. |
| Första lokala Site-bygget | Avbröts med exit 137 under parallell belastning. Det räknas inte som ett lyckat bygge. |

Av Sites-felen var 86 importfel i två testladdare som kompilerar hela Dashboard.
Den nya faktiska sökmodulens alias saknades där. De två laddarna kopplas nu till
`lib/workspace-search.js`; inga förväntningar eller produktionsfunktioner ersätts.
Ett npm-livscykelprov fick fel CLI-sökväg eftersom den direkta lokala Node-körningen
inte ärvde `npm_execpath`. Återkörningen anger den installerade npm-CLI:n explicit;
CI kör redan genom npm. Navigationsladdaren använde dessutom en gammal mock som
saknade exporten `bankPaymentReference`. Den läser nu den faktiska
betalningspresentationsmodulen; samtliga 13 navigationsprov passerar.

Filen `mcp-evidence-read.test.mjs` avbröts även isolerat med `SIGKILL`, efter 32
godkända prov och utan individuellt assertion-fel. Den diagnostiska körningen
mätte 1 923 404 KiB maximal RSS och 57,311 sekunder. Testladdarens rekursivt
inbäddade data-URL:er kopierade hela beroendegrafen i varje förälders adress. Samma
verkliga moduler och fixturegränser använder nu korta fil-URL:er i en privat
temporär katalog, som städas efter testfilen. Alla **34/34 oförändrade prov**
passerar; samma mätmetod rapporterar 205 276 KiB och 14,585 sekunder. Det är en
lokal testresursmätning, inte ett mått på produktionsprestanda. Operativsystemets
exakta orsak till `SIGKILL` är inte verifierad av en OOM-logg.

Slutdeltat innehåller sök-/förslagsrättningen och de tre testladdarna. Det
verifieras med berörda fullständiga testfiler, följt av de ordinarie fulla
CI-grindarna på exakt PR-kod. Den tidigare fulla lokala körningen får inte
redovisas som om den redan hade omfattat detta senare delta.

Root körde det nya sök-/listdeltat i Node: **29/29**. Den kombinerade lokala
Sites-återkörningen passerade Dashboard-, npm-livscykel-, sök- och
förslagsfilerna, men hade fortfarande de två ovan redovisade laddnings-/resursfelen.
De senare separata kompletta återkörningarna av navigation (**13/13**) och
MCP-evidens (**34/34**) rättar just dessa. Slutlig Sites typ-/beroendekontroll
passerar. Överlappande provantal summeras inte. En grön full Sites-svit och ett
lyckat bygge krävs fortfarande från den ordinarie CI-körningen före merge.

## Kvarvarande arbete

- OCR:s bevisbundna ordprecision och dess nya mätning levereras separat. Den
  tidigare normala rasterkorpusens 97,44 procent precision når ännu inte kravet.
- Flerfakturagranskningen visar att Sites stegvisa uppdelning fungerar, men
  direkt upprepad matchning stoppas av den strikta referenspolicyn. Ett separat,
  uttryckligt manuellt godkännande med atomär helfördelning utvecklas och måste
  granskas. C4:s automatiska godkännandepolicy lättas inte i denna leverans.
- Aktuellt bankmedgivande, kontoläsning, faktisk OCR-körning och ekonomiska
  före-/efterkontroller krävs efter publicering. Gmail-schemats observerade
  körning och den kontrollästa backupen finns i respektive driftrapport.
- Visuell granskning ska gälla levererad UI. Den hanterade förhandsvisningen
  har hittills inte startat; den begränsningen får inte döljas av komponenttester.

Ingen slutpoäng ändras av detta dokument. Slutrapporten ska ange PR, main-SHA,
Site-källträd, publicerad version, CI-resultat och faktiska drifttidpunkter.
